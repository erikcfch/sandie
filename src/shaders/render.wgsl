// Draws the grid straight from the storage buffer to the canvas: a
// full-screen triangle in the vertex stage, and a per-pixel element-id ->
// color lookup in the fragment stage. No CPU readback of the grid.

struct Cell {
  elementId: u32,
  enthalpy: f32,
}

struct RenderParams {
  width: u32,
  height: u32,
  heatMap: u32,
  _pad: u32,
}

@group(0) @binding(0) var<uniform> params: RenderParams;
@group(0) @binding(1) var<storage, read> grid: array<Cell>;
@group(0) @binding(2) var<storage, read> palette: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> materials: array<vec4<f32>>; // 4 vec4/element; see src/elements.ts materialProperties()
@group(0) @binding(4) var<storage, read> chains: array<vec4<f32>>;
// Blast pressure field (Phase 3b), location-indexed — same layout as the
// simulation's `blastPressureOut`. Read-only here; used only for the debug
// tint below so the otherwise-invisible pressure field can be watched.
@group(0) @binding(5) var<storage, read> pressureField: array<f32>;
// Electricity reachability field (Phase 3c), (.x=srcReach, .y=gndReach) —
// same layout as the simulation's `elecChargeOut`. Read-only here; used only
// for the glow tint below so the (otherwise invisible) powered path can be
// watched.
@group(0) @binding(6) var<storage, read> chargeField: array<vec2<f32>>;

// Mirrored verbatim from src/electricity.ts — do not let this drift.
const REACH_TAU: f32 = 0.5;

fn heatCapacityOf(id: u32) -> f32 {
  return materials[id * 4u].z;
}

fn chainStartOf(id: u32) -> u32 { return u32(materials[id * 4u + 2u].z); }
fn chainCountOf(id: u32) -> u32 { return u32(materials[id * 4u + 2u].w); }

fn temperatureFromEnthalpy(elementId: u32, enthalpy: f32) -> f32 {
  let count = chainCountOf(elementId);
  if (count == 0u) { return enthalpy / heatCapacityOf(elementId); }
  let start = chainStartOf(elementId);
  var prevBoundaryTemp = 0.0;
  var enthalpyAtPrev = 0.0;
  for (var i = 0u; i < count; i = i + 1u) {
    let seg = chains[start + i];
    let segCap = seg.y;
    if (i < count - 1u) {
      let boundaryTemp = seg.z;
      let latent = seg.w;
      let plateauStart = enthalpyAtPrev + segCap * (boundaryTemp - prevBoundaryTemp);
      let plateauEnd = plateauStart + latent;
      if (enthalpy < plateauStart) { return prevBoundaryTemp + (enthalpy - enthalpyAtPrev) / segCap; }
      if (enthalpy < plateauEnd) { return boundaryTemp; }
      prevBoundaryTemp = boundaryTemp;
      enthalpyAtPrev = plateauEnd;
    } else {
      return prevBoundaryTemp + (enthalpy - enthalpyAtPrev) / segCap;
    }
  }
  return enthalpy / heatCapacityOf(elementId);
}

// Piecewise gradient: cold blue -> neutral gray at ambient -> hot red ->
// white-hot, clamped at both ends. Lets the (otherwise invisible)
// temperature field be watched directly, e.g. to confirm conduction and
// ambient drift are actually happening and not just phase changes.
fn temperatureColor(temp: f32) -> vec4<f32> {
  let cold = vec3<f32>(0.0, 0.2, 1.0);
  let ambient = vec3<f32>(0.5, 0.5, 0.5);
  let hot = vec3<f32>(1.0, 0.15, 0.0);
  let whiteHot = vec3<f32>(1.0, 1.0, 1.0);

  var rgb: vec3<f32>;
  if (temp <= -50.0) {
    rgb = cold;
  } else if (temp <= 20.0) {
    rgb = mix(cold, ambient, (temp + 50.0) / 70.0);
  } else if (temp <= 500.0) {
    rgb = mix(ambient, hot, (temp - 20.0) / 480.0);
  } else if (temp <= 900.0) {
    rgb = mix(hot, whiteHot, (temp - 500.0) / 400.0);
  } else {
    rgb = whiteHot;
  }
  return vec4<f32>(rgb, 1.0);
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  // Fullscreen triangle covering the viewport; corners outside [-1,1] get
  // clipped, cheaper than two triangles for a quad.
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0),
  );
  let pos = positions[vertexIndex];

  var out: VertexOutput;
  out.position = vec4<f32>(pos, 0.0, 1.0);
  // Flip Y: clip space +Y is up, texture/grid space +Y is down.
  out.uv = vec2<f32>((pos.x + 1.0) * 0.5, (1.0 - pos.y) * 0.5);
  return out;
}

@fragment
fn fragmentMain(in: VertexOutput) -> @location(0) vec4<f32> {
  let cellX = min(u32(in.uv.x * f32(params.width)), params.width - 1u);
  let cellY = min(u32(in.uv.y * f32(params.height)), params.height - 1u);
  let idx = cellY * params.width + cellX;
  let cell = grid[idx];

  var color: vec4<f32>;
  if (params.heatMap != 0u) {
    color = temperatureColor(temperatureFromEnthalpy(cell.elementId, cell.enthalpy));
  } else {
    color = palette[cell.elementId];
  }

  // Debug pressure tint (Phase 3b): faint magenta blended in proportional to
  // blast pressure at this cell, purely so the (otherwise invisible)
  // pressure field can be watched during verification. Kept subtle — must
  // not obscure the underlying material/heat colour.
  let pressure = clamp(pressureField[idx] / 50.0, 0.0, 1.0);
  let pressureTint = vec3<f32>(1.0, 0.0, 1.0);
  color = vec4<f32>(mix(color.rgb, pressureTint, pressure * 0.35), color.a);

  // Electric glow (Phase 3c): cyan blended in where this cell is LIVE (reachable
  // from both a source and a ground), so the powered path lights up. Invisible at
  // rest (no charge => no glow); prominent enough to read as "powered".
  let charge = chargeField[idx];
  let live = f32(charge.x >= REACH_TAU && charge.y >= REACH_TAU);
  let glowTint = vec3<f32>(0.2, 1.0, 1.0);
  color = vec4<f32>(mix(color.rgb, glowTint, live * 0.6), color.a);

  return color;
}
