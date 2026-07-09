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
@group(0) @binding(3) var<storage, read> materials: array<vec4<f32>>; // (density, thermalConductivity, heatCapacity, unused)

const STONE: u32 = 1u;
const WATER: u32 = 3u;
const ICE: u32 = 6u;
const LAVA: u32 = 7u;
const STEAM: u32 = 8u;

// Phase-transition boundary temps and latent heats - must stay in sync
// with src/phaseTransitions.ts (and src/shaders/simulate.wgsl).
const ICE_WATER_BOUNDARY: f32 = 0.0;
const ICE_WATER_LATENT: f32 = 80.0;
const WATER_STEAM_BOUNDARY: f32 = 100.0;
const WATER_STEAM_LATENT: f32 = 540.0;
const STONE_LAVA_BOUNDARY: f32 = 700.0;
const STONE_LAVA_LATENT: f32 = 200.0;

fn heatCapacityOf(id: u32) -> f32 {
  return materials[id * 2u].z;
}

// Temperature-only decode (no element-id resolution needed for display, so
// this is leaner than simulate.wgsl's thermalFromEnthalpy).
fn waterChainTemp(enthalpy: f32) -> f32 {
  let iceCap = heatCapacityOf(ICE);
  let waterCap = heatCapacityOf(WATER);
  let steamCap = heatCapacityOf(STEAM);
  let plateau1Start = iceCap * ICE_WATER_BOUNDARY;
  let plateau1End = plateau1Start + ICE_WATER_LATENT;
  let plateau2Start = plateau1End + waterCap * (WATER_STEAM_BOUNDARY - ICE_WATER_BOUNDARY);
  let plateau2End = plateau2Start + WATER_STEAM_LATENT;

  if (enthalpy < plateau1Start) {
    return enthalpy / iceCap;
  }
  if (enthalpy < plateau1End) {
    return ICE_WATER_BOUNDARY;
  }
  if (enthalpy < plateau2Start) {
    return ICE_WATER_BOUNDARY + (enthalpy - plateau1End) / waterCap;
  }
  if (enthalpy < plateau2End) {
    return WATER_STEAM_BOUNDARY;
  }
  return WATER_STEAM_BOUNDARY + (enthalpy - plateau2End) / steamCap;
}

fn lavaChainTemp(enthalpy: f32) -> f32 {
  let stoneCap = heatCapacityOf(STONE);
  let lavaCap = heatCapacityOf(LAVA);
  let plateauStart = stoneCap * STONE_LAVA_BOUNDARY;
  let plateauEnd = plateauStart + STONE_LAVA_LATENT;

  if (enthalpy < plateauStart) {
    return enthalpy / stoneCap;
  }
  if (enthalpy < plateauEnd) {
    return STONE_LAVA_BOUNDARY;
  }
  return STONE_LAVA_BOUNDARY + (enthalpy - plateauEnd) / lavaCap;
}

fn temperatureFromEnthalpy(elementId: u32, enthalpy: f32) -> f32 {
  if (elementId == ICE || elementId == WATER || elementId == STEAM) {
    return waterChainTemp(enthalpy);
  }
  if (elementId == STONE || elementId == LAVA) {
    return lavaChainTemp(enthalpy);
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
  let cell = grid[cellY * params.width + cellX];
  if (params.heatMap != 0u) {
    return temperatureColor(temperatureFromEnthalpy(cell.elementId, cell.enthalpy));
  }
  return palette[cell.elementId];
}
