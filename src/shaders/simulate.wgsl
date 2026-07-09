// Cellular-automaton movement + heat/phase-change rules.
//
// Element ids must stay in sync with src/elements.ts:
//   0=Empty 1=Stone 2=Sand 3=Water 4=Wood 5=Smoke 6=Ice 7=Lava 8=Steam 9=Fire
//   10=Obsidian 11=Sulfuric Acid (Dilute) 12=Copper 13=Copper Sulfate 14=Hydrogen
//   15=Sulfuric Acid (Very Dilute) 16=Sulfuric Acid (Concentrated)
//   17=Sulfuric Acid (Fuming) 18=Sulfur Dioxide
//   19=Damp Sand 20=Wet Sand 21=Saturated Sand
//
// Each grid cell is a Cell{elementId, enthalpy} struct. Enthalpy (not raw
// temperature) is the stored quantity - see the "Latent heat" section below
// for why. The movement pass swaps whole Cells, so heat travels with
// material atomically with no separate bookkeeping.
//
// Two compute passes run per tick, sharing this module:
//   `movement` - the Phase 1 Margolus-neighborhood swap logic, now moving
//                whole Cells instead of raw ids.
//   `heat`     - blends heat with neighbors (conduction, scaled by each
//                material's thermalConductivity), drifts toward ambient,
//                and derives a new temperature/elementId from the result.
//
// Movement uses a Margolus neighborhood: the grid is partitioned into
// non-overlapping 2x2 blocks, and each block is resolved by exactly one
// thread (its top-left cell), which reads all 4 cells and decides how they
// rearrange entirely locally. Blocks never overlap, so there are no
// cross-thread races and no atomics are needed. Which 2x2 partitioning is
// used (there are 4 possible alignments) cycles every tick via
// params.frame, so over a few ticks every possible adjacency gets a chance
// to interact.
//
// Material properties (density, thermalConductivity, heatCapacity) are read
// from a GPU buffer built from src/elements.ts - the single source of
// truth - instead of being hand-duplicated as WGSL constants.
//
// Latent heat: a cell stores enthalpy (accumulated heat energy), not
// temperature directly. Temperature is derived from enthalpy via each
// material's heatCapacity. This is what makes true latent heat work with no
// extra per-cell state: within a phase, temperature = enthalpy / heatCapacity
// (a straight line). At a phase transition (e.g. Ice melting at 0 degrees),
// energy keeps accumulating in enthalpy while temperature holds flat at the
// boundary for a stretch (the plateau's width is that transition's
// latentHeat) - exactly the melting-plateau behavior real materials show,
// and it also means the element only flips (Ice -> Water) once enthalpy has
// climbed all the way through that band, not the instant it touches 0.
// Phase-transition boundary temps and latent heats must stay in sync with
// src/phaseTransitions.ts.

struct Cell {
  elementId: u32,
  enthalpy: f32,
}

struct SimParams {
  width: u32,
  height: u32,
  frame: u32,
  ambientTemp: f32,
  reactionCount: u32,
  thresholdReactionCount: u32,
}

@group(0) @binding(0) var<uniform> params: SimParams;
@group(0) @binding(1) var<storage, read> readBuf: array<Cell>;
@group(0) @binding(2) var<storage, read_write> writeBuf: array<Cell>;
@group(0) @binding(3) var<storage, read> materials: array<vec4<f32>>; // (density, thermalConductivity, heatCapacity, unused)
// Data-driven contact reactions built from src/reactions.ts's CONTACT_REACTIONS
// (see reactionData()) - 2 vec4s per reaction: (reactant, catalystNeighbor,
// product, chance) then (enthalpyDelta, minTemperature, unused, unused).
@group(0) @binding(4) var<storage, read> reactions: array<vec4<f32>>;
// Data-driven temperature-only (no catalyst) transitions built from
// src/thresholdReactions.ts's THRESHOLD_REACTIONS (see thresholdReactionData())
// - 1 vec4 per reaction: (reactant, minTemperature, product, chance).
@group(0) @binding(5) var<storage, read> thresholdReactions: array<vec4<f32>>;

const EMPTY: u32 = 0u;
const STONE: u32 = 1u;
const SAND: u32 = 2u;
const WATER: u32 = 3u;
const WOOD: u32 = 4u;
const SMOKE: u32 = 5u;
const ICE: u32 = 6u;
const LAVA: u32 = 7u;
const STEAM: u32 = 8u;
const FIRE: u32 = 9u;
const OBSIDIAN: u32 = 10u;
const ACID: u32 = 11u;
const COPPER: u32 = 12u;
const COPPER_SULFATE: u32 = 13u;
const HYDROGEN: u32 = 14u;
const ACID_VERY_DILUTE: u32 = 15u;
const ACID_CONCENTRATED: u32 = 16u;
const ACID_FUMING: u32 = 17u;
const SULFUR_DIOXIDE: u32 = 18u;
const DAMP_SAND: u32 = 19u;
const WET_SAND: u32 = 20u;
const SATURATED_SAND: u32 = 21u;
// Per-tick chance a gas cell spreads sideways. < 1 so gas rises as a plume
// instead of fanning flat every tick. Tune visually.
const GAS_DISPERSE_CHANCE: f32 = 0.25;
const NO_NEIGHBOR: u32 = 0xffffffffu;
// Sentinel for "no minimum temperature gate" written by reactions.ts's
// reactionData() - must stay in sync with its NO_MIN_TEMPERATURE export.
const NO_MIN_TEMPERATURE: f32 = -999.0;

fn density(id: u32) -> f32 {
  return materials[id].x;
}

fn conductivityOf(id: u32) -> f32 {
  return materials[id].y;
}

fn heatCapacityOf(id: u32) -> f32 {
  return materials[id].z;
}

fn isPowderOrLiquid(id: u32) -> bool {
  return id == SAND || id == WATER || id == LAVA || id == ACID || id == COPPER_SULFATE
      || id == ACID_VERY_DILUTE || id == ACID_CONCENTRATED || id == ACID_FUMING
      || id == DAMP_SAND || id == WET_SAND || id == SATURATED_SAND;
}

fn isGas(id: u32) -> bool {
  return id == SMOKE || id == STEAM || id == FIRE || id == HYDROGEN || id == SULFUR_DIOXIDE;
}

fn isLiquid(id: u32) -> bool {
  return id == WATER || id == LAVA || id == ACID || id == ACID_VERY_DILUTE || id == ACID_CONCENTRATED || id == ACID_FUMING;
}

// Cohesion: wetter sand resists sliding diagonally off a pile (mirrors
// src/wetSand.ts diagonalSlideChance). 1.0 = always slides (dry/other).
fn diagonalSlideChance(id: u32) -> f32 {
  if (id == DAMP_SAND) { return 0.6; }
  if (id == WET_SAND) { return 0.3; }
  if (id == SATURATED_SAND) { return 0.12; }
  return 1.0;
}

fn cellIndex(x: i32, y: i32, width: i32) -> u32 {
  return u32(y * width + x);
}

fn hash(x: u32, y: u32, frame: u32) -> u32 {
  var h = x * 374761393u + y * 668265263u + frame * 2246822519u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return h ^ (h >> 16u);
}

// A powder/liquid on top sinks into a less-dense cell below it; a gas on
// the bottom rises into an empty cell above it. Used both for the
// straight vertical pair (a,c) / (b,d) and, applied diagonally, for the
// crossed pair (a,d) / (b,c).
fn shouldSwapVertical(topVal: u32, bottomVal: u32) -> bool {
  if (isPowderOrLiquid(topVal) && density(topVal) > density(bottomVal)) {
    return true;
  }
  if (isGas(bottomVal) && topVal == EMPTY) {
    return true;
  }
  return false;
}

fn shouldSwapHorizontal(leftVal: u32, rightVal: u32) -> bool {
  if (isLiquid(leftVal) && density(leftVal) > density(rightVal)) {
    return true;
  }
  if (isLiquid(rightVal) && density(rightVal) > density(leftVal)) {
    return true;
  }
  // Gas diffuses sideways into empty space too, so it disperses instead of
  // piling into a solid mass (which straight rising alone would produce).
  if (isGas(leftVal) && rightVal == EMPTY) {
    return true;
  }
  if (isGas(rightVal) && leftVal == EMPTY) {
    return true;
  }
  return false;
}

@compute @workgroup_size(8, 8)
fn movement(@builtin(global_invocation_id) gid: vec3<u32>) {
  let width = i32(params.width);
  let height = i32(params.height);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= width || y >= height) {
    return;
  }
  let selfIndex = cellIndex(x, y, width);

  // Which of the 4 block alignments is active this tick.
  let alignment = params.frame % 4u;
  let ox = i32(alignment & 1u);
  let oy = i32((alignment >> 1u) & 1u);

  // Cells in the top/left boundary strip (when the alignment offset is 1)
  // aren't covered by any block this tick - just pass them through.
  if (x < ox || y < oy) {
    writeBuf[selfIndex] = readBuf[selfIndex];
    return;
  }

  let blockX = x - ((x - ox) % 2);
  let blockY = y - ((y - oy) % 2);

  // Likewise for a leftover column/row on the bottom/right edge when the
  // grid dimensions don't evenly divide into blocks at this alignment.
  if (blockX + 1 >= width || blockY + 1 >= height) {
    writeBuf[selfIndex] = readBuf[selfIndex];
    return;
  }

  if (x != blockX || y != blockY) {
    // Covered by a block, but not its top-left owner - the owner thread
    // (which runs elsewhere) writes this cell's result, not us.
    return;
  }

  // We own this block: TL=a, TR=b, BL=c, BR=d (y grows downward, so c/d
  // are physically below a/b).
  let idxA = cellIndex(blockX, blockY, width);
  let idxB = cellIndex(blockX + 1, blockY, width);
  let idxC = cellIndex(blockX, blockY + 1, width);
  let idxD = cellIndex(blockX + 1, blockY + 1, width);

  var a = readBuf[idxA];
  var b = readBuf[idxB];
  var c = readBuf[idxC];
  var d = readBuf[idxD];

  // 1. Straight down/up, one check per column.
  let movedLeft = shouldSwapVertical(a.elementId, c.elementId);
  if (movedLeft) {
    let tmp = a; a = c; c = tmp;
  }
  let movedRight = shouldSwapVertical(b.elementId, d.elementId);
  if (movedRight) {
    let tmp = b; b = d; d = tmp;
  }

  // 2. Diagonal, only for a column that didn't just resolve straight down
  // (so a cell moves at most once per tick), gated by cohesion so wet sand
  // clumps instead of sliding.
  let rollAD = f32(hash(u32(blockX), u32(blockY), params.frame) & 0xffffu) / 65536.0;
  let gateAD = select(diagonalSlideChance(a.elementId), 0.5, isGas(d.elementId) && a.elementId == EMPTY);
  if (!movedLeft && shouldSwapVertical(a.elementId, d.elementId) && rollAD < gateAD) {
    let tmp = a; a = d; d = tmp;
  }
  let rollBC = f32(hash(u32(blockX + 1), u32(blockY), params.frame) & 0xffffu) / 65536.0;
  let gateBC = select(diagonalSlideChance(b.elementId), 0.5, isGas(c.elementId) && b.elementId == EMPTY);
  if (!movedRight && shouldSwapVertical(b.elementId, c.elementId) && rollBC < gateBC) {
    let tmp = b; b = c; c = tmp;
  }

  // 3. Horizontal spread. Gas disperses sideways only occasionally so it rises
  // as a plume; liquids and other spreads are unchanged.
  let hRollAB = f32(hash(u32(blockX) + 31u, u32(blockY) + 17u, params.frame) & 0xffffu) / 65536.0;
  let gasAB = isGas(a.elementId) || isGas(b.elementId);
  if ((!gasAB || hRollAB < GAS_DISPERSE_CHANCE) && shouldSwapHorizontal(a.elementId, b.elementId)) {
    let tmp = a; a = b; b = tmp;
  }
  let hRollCD = f32(hash(u32(blockX) + 53u, u32(blockY) + 71u, params.frame) & 0xffffu) / 65536.0;
  let gasCD = isGas(c.elementId) || isGas(d.elementId);
  if ((!gasCD || hRollCD < GAS_DISPERSE_CHANCE) && shouldSwapHorizontal(c.elementId, d.elementId)) {
    let tmp = c; c = d; d = tmp;
  }

  writeBuf[idxA] = a;
  writeBuf[idxB] = b;
  writeBuf[idxC] = c;
  writeBuf[idxD] = d;
}

// Water-only vertical swap: water sinks into empty or gas directly below.
fn waterShouldSwapV(topVal: u32, bottomVal: u32) -> bool {
  return topVal == WATER && (bottomVal == EMPTY || isGas(bottomVal));
}
// Water-only horizontal swap: water spreads into adjacent empty space.
fn waterShouldSwapH(leftVal: u32, rightVal: u32) -> bool {
  return (leftVal == WATER && rightVal == EMPTY) || (rightVal == WATER && leftVal == EMPTY);
}

@compute @workgroup_size(8, 8)
fn waterMovement(@builtin(global_invocation_id) gid: vec3<u32>) {
  let width = i32(params.width);
  let height = i32(params.height);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= width || y >= height) { return; }
  let selfIndex = cellIndex(x, y, width);

  let alignment = params.frame % 4u;
  let ox = i32(alignment & 1u);
  let oy = i32((alignment >> 1u) & 1u);
  if (x < ox || y < oy) { writeBuf[selfIndex] = readBuf[selfIndex]; return; }
  let blockX = x - ((x - ox) % 2);
  let blockY = y - ((y - oy) % 2);
  if (blockX + 1 >= width || blockY + 1 >= height) { writeBuf[selfIndex] = readBuf[selfIndex]; return; }
  if (x != blockX || y != blockY) { return; }

  let idxA = cellIndex(blockX, blockY, width);
  let idxB = cellIndex(blockX + 1, blockY, width);
  let idxC = cellIndex(blockX, blockY + 1, width);
  let idxD = cellIndex(blockX + 1, blockY + 1, width);
  var a = readBuf[idxA]; var b = readBuf[idxB]; var c = readBuf[idxC]; var d = readBuf[idxD];

  let movedLeft = waterShouldSwapV(a.elementId, c.elementId);
  if (movedLeft) { let t = a; a = c; c = t; }
  let movedRight = waterShouldSwapV(b.elementId, d.elementId);
  if (movedRight) { let t = b; b = d; d = t; }
  if (!movedLeft && waterShouldSwapV(a.elementId, d.elementId)) { let t = a; a = d; d = t; }
  if (!movedRight && waterShouldSwapV(b.elementId, c.elementId)) { let t = b; b = c; c = t; }
  if (waterShouldSwapH(a.elementId, b.elementId)) { let t = a; a = b; b = t; }
  if (waterShouldSwapH(c.elementId, d.elementId)) { let t = c; c = d; d = t; }

  writeBuf[idxA] = a; writeBuf[idxB] = b; writeBuf[idxC] = c; writeBuf[idxD] = d;
}

const ABSORB_CHANCE: f32 = 0.08;
const DRIP_CHANCE: f32 = 0.10;

fn isSandTier(id: u32) -> bool {
  return id == SAND || id == DAMP_SAND || id == WET_SAND || id == SATURATED_SAND;
}
fn wetterTier(id: u32) -> u32 {
  if (id == SAND) { return DAMP_SAND; }
  if (id == DAMP_SAND) { return WET_SAND; }
  if (id == WET_SAND) { return SATURATED_SAND; }
  return id; // saturated stays
}

// The soak() pass lives further down, after the thermal helpers
// (thermalFromEnthalpy / enthalpyForNewElement) it needs to re-encode enthalpy
// across an elementId change - WGSL requires those to be declared first.

const CONDUCTION_RATE: f32 = 0.1;
const AMBIENT_DRIFT_RATE: f32 = 0.003;
const FIRE_DECAY_CHANCE: f32 = 0.05;
const WOOD_IGNITE_POINT: f32 = 300.0;

// Data-driven contact reactions (Lava+Water->Obsidian, and any Chem-category
// reactions) are handled generically in heat() via the `reactions` buffer -
// see src/reactions.ts. Wood/Fire below aren't simple reactant+catalyst pairs
// (threshold-triggered ignition, catalyst-free self-decay) so they stay
// bespoke.

// Convective bias: a cell exchanges heat 3x more readily with its
// below-neighbor than its above-neighbor (hot gas rises, so heat "arrives
// from below" more than it "leaks upward" from above). Side neighbors
// stay neutral.
const WEIGHT_BELOW: f32 = 1.5;
const WEIGHT_ABOVE: f32 = 0.5;
const WEIGHT_SIDE: f32 = 1.0;

// Phase-transition boundary temps and latent heats - must stay in sync
// with src/phaseTransitions.ts.
const ICE_WATER_BOUNDARY: f32 = 0.0;
const ICE_WATER_LATENT: f32 = 80.0;
const WATER_STEAM_BOUNDARY: f32 = 100.0;
const WATER_STEAM_LATENT: f32 = 540.0;
const STONE_LAVA_BOUNDARY: f32 = 700.0;
const STONE_LAVA_LATENT: f32 = 200.0;

fn isWaterFamily(id: u32) -> bool {
  return id == ICE || id == WATER || id == STEAM;
}

fn isLavaFamily(id: u32) -> bool {
  return id == STONE || id == LAVA;
}

struct ThermalResult {
  temperature: f32,
  elementId: u32,
}

// Ice(6) <-> Water(3) <-> Steam(8). Hand-unrolled port of thermal.ts's
// generic chain-walk for this specific 3-segment chain.
fn waterChainFromEnthalpy(currentElementId: u32, enthalpy: f32) -> ThermalResult {
  let iceCap = heatCapacityOf(ICE);
  let waterCap = heatCapacityOf(WATER);
  let steamCap = heatCapacityOf(STEAM);
  let plateau1Start = iceCap * ICE_WATER_BOUNDARY;
  let plateau1End = plateau1Start + ICE_WATER_LATENT;
  let plateau2Start = plateau1End + waterCap * (WATER_STEAM_BOUNDARY - ICE_WATER_BOUNDARY);
  let plateau2End = plateau2Start + WATER_STEAM_LATENT;

  if (enthalpy < plateau1Start) {
    return ThermalResult(enthalpy / iceCap, ICE);
  }
  if (enthalpy < plateau1End) {
    return ThermalResult(ICE_WATER_BOUNDARY, select(ICE, WATER, currentElementId == WATER));
  }
  if (enthalpy < plateau2Start) {
    return ThermalResult(ICE_WATER_BOUNDARY + (enthalpy - plateau1End) / waterCap, WATER);
  }
  if (enthalpy < plateau2End) {
    return ThermalResult(WATER_STEAM_BOUNDARY, select(WATER, STEAM, currentElementId == STEAM));
  }
  return ThermalResult(WATER_STEAM_BOUNDARY + (enthalpy - plateau2End) / steamCap, STEAM);
}

// Stone(1) <-> Lava(7).
fn lavaChainFromEnthalpy(currentElementId: u32, enthalpy: f32) -> ThermalResult {
  let stoneCap = heatCapacityOf(STONE);
  let lavaCap = heatCapacityOf(LAVA);
  let plateauStart = stoneCap * STONE_LAVA_BOUNDARY;
  let plateauEnd = plateauStart + STONE_LAVA_LATENT;

  if (enthalpy < plateauStart) {
    return ThermalResult(enthalpy / stoneCap, STONE);
  }
  if (enthalpy < plateauEnd) {
    return ThermalResult(STONE_LAVA_BOUNDARY, select(STONE, LAVA, currentElementId == LAVA));
  }
  return ThermalResult(STONE_LAVA_BOUNDARY + (enthalpy - plateauEnd) / lavaCap, LAVA);
}

fn thermalFromEnthalpy(currentElementId: u32, enthalpy: f32) -> ThermalResult {
  if (isWaterFamily(currentElementId)) {
    return waterChainFromEnthalpy(currentElementId, enthalpy);
  }
  if (isLavaFamily(currentElementId)) {
    return lavaChainFromEnthalpy(currentElementId, enthalpy);
  }
  return ThermalResult(enthalpy / heatCapacityOf(currentElementId), currentElementId);
}

// Inverse of waterChainFromEnthalpy: encodes a temperature as enthalpy
// consistent with the water chain's plateau structure.
fn waterChainEnthalpyForTemperature(temperature: f32) -> f32 {
  let waterCap = heatCapacityOf(WATER);
  let steamCap = heatCapacityOf(STEAM);
  let plateau1End = heatCapacityOf(ICE) * ICE_WATER_BOUNDARY + ICE_WATER_LATENT;
  let plateau2End = plateau1End + waterCap * (WATER_STEAM_BOUNDARY - ICE_WATER_BOUNDARY) + WATER_STEAM_LATENT;

  if (temperature <= ICE_WATER_BOUNDARY) {
    return heatCapacityOf(ICE) * temperature;
  }
  if (temperature <= WATER_STEAM_BOUNDARY) {
    return plateau1End + waterCap * (temperature - ICE_WATER_BOUNDARY);
  }
  return plateau2End + steamCap * (temperature - WATER_STEAM_BOUNDARY);
}

// Inverse of lavaChainFromEnthalpy: encodes a temperature as enthalpy
// consistent with the Stone<->Lava plateau structure.
fn lavaChainEnthalpyForTemperature(temperature: f32) -> f32 {
  let lavaCap = heatCapacityOf(LAVA);
  let plateauEnd = heatCapacityOf(STONE) * STONE_LAVA_BOUNDARY + STONE_LAVA_LATENT;

  if (temperature <= STONE_LAVA_BOUNDARY) {
    return heatCapacityOf(STONE) * temperature;
  }
  return plateauEnd + lavaCap * (temperature - STONE_LAVA_BOUNDARY);
}

// Encodes `temperature` as enthalpy consistent with `targetElementId`'s
// family. Used when a reaction changes a cell's elementId outright (Wood ->
// Fire, Fire -> Steam, Lava -> Obsidian) so the pre-reaction temperature
// carries over continuously, instead of the pre-reaction enthalpy getting
// reinterpreted under the new element's (possibly very different)
// heatCapacity - which would silently jump the temperature (see e.g. Lava's
// heatCapacity of 1.0 vs Obsidian's 0.8).
fn enthalpyForNewElement(temperature: f32, targetElementId: u32) -> f32 {
  if (isWaterFamily(targetElementId)) {
    return waterChainEnthalpyForTemperature(temperature);
  }
  if (isLavaFamily(targetElementId)) {
    return lavaChainEnthalpyForTemperature(temperature);
  }
  return temperature * heatCapacityOf(targetElementId);
}

// Enthalpy for `newId` that preserves the cell's current temperature (decoded
// under `oldId`). Changing elementId while carrying the raw enthalpy number
// across a heatCapacity change would silently jump the temperature (Water's 4.0
// vs Empty's 0.5 reads a 20C cell as ~160C, i.e. 320C once the heat pass
// decodes it) - this re-encodes so soaking neither injects nor loses heat.
fn preserveTempEnthalpy(oldId: u32, enthalpy: f32, newId: u32) -> f32 {
  return enthalpyForNewElement(thermalFromEnthalpy(oldId, enthalpy).temperature, newId);
}

// Absorb one adjacent Water into a sand-tier cell (Water->Empty, sand->wetter),
// and let Saturated Sand drip one Water into an Empty cell below. Both are
// two-cell transforms, so they run in this block-owned pass rather than the
// per-cell heat() reaction loop. Every elementId change re-encodes enthalpy for
// the new element: a promoted sand tier keeps its own temperature, a consumed
// Water cell becomes ambient air, and a dripped Water cell inherits the sand's
// temperature - so soaking doesn't reinterpret enthalpy under a new heatCapacity
// and spuriously heat/cool the grid.
@compute @workgroup_size(8, 8)
fn soak(@builtin(global_invocation_id) gid: vec3<u32>) {
  let width = i32(params.width);
  let height = i32(params.height);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= width || y >= height) { return; }
  let selfIndex = cellIndex(x, y, width);

  let alignment = params.frame % 4u;
  let ox = i32(alignment & 1u);
  let oy = i32((alignment >> 1u) & 1u);
  if (x < ox || y < oy) { writeBuf[selfIndex] = readBuf[selfIndex]; return; }
  let blockX = x - ((x - ox) % 2);
  let blockY = y - ((y - oy) % 2);
  if (blockX + 1 >= width || blockY + 1 >= height) { writeBuf[selfIndex] = readBuf[selfIndex]; return; }
  if (x != blockX || y != blockY) { return; }

  let idxA = cellIndex(blockX, blockY, width);
  let idxB = cellIndex(blockX + 1, blockY, width);
  let idxC = cellIndex(blockX, blockY + 1, width);
  let idxD = cellIndex(blockX + 1, blockY + 1, width);
  var a = readBuf[idxA]; var b = readBuf[idxB]; var c = readBuf[idxC]; var d = readBuf[idxD];

  // A consumed Water cell leaves fresh air at the ambient temperature.
  let emptyAmbient = enthalpyForNewElement(params.ambientTemp, EMPTY);

  let roll = f32(hash(u32(blockX), u32(blockY), params.frame) & 0xffffu) / 65536.0;

  // --- Absorb: at most one sand<->water pair in this block (a-b, a-c, b-d, c-d).
  if (roll < ABSORB_CHANCE) {
    if (isSandTier(a.elementId) && a.elementId != SATURATED_SAND && b.elementId == WATER) {
      let nt = wetterTier(a.elementId); a = Cell(nt, preserveTempEnthalpy(a.elementId, a.enthalpy, nt)); b = Cell(EMPTY, emptyAmbient);
    } else if (isSandTier(b.elementId) && b.elementId != SATURATED_SAND && a.elementId == WATER) {
      let nt = wetterTier(b.elementId); b = Cell(nt, preserveTempEnthalpy(b.elementId, b.enthalpy, nt)); a = Cell(EMPTY, emptyAmbient);
    } else if (isSandTier(a.elementId) && a.elementId != SATURATED_SAND && c.elementId == WATER) {
      let nt = wetterTier(a.elementId); a = Cell(nt, preserveTempEnthalpy(a.elementId, a.enthalpy, nt)); c = Cell(EMPTY, emptyAmbient);
    } else if (isSandTier(c.elementId) && c.elementId != SATURATED_SAND && a.elementId == WATER) {
      let nt = wetterTier(c.elementId); c = Cell(nt, preserveTempEnthalpy(c.elementId, c.enthalpy, nt)); a = Cell(EMPTY, emptyAmbient);
    } else if (isSandTier(b.elementId) && b.elementId != SATURATED_SAND && d.elementId == WATER) {
      let nt = wetterTier(b.elementId); b = Cell(nt, preserveTempEnthalpy(b.elementId, b.enthalpy, nt)); d = Cell(EMPTY, emptyAmbient);
    } else if (isSandTier(d.elementId) && d.elementId != SATURATED_SAND && b.elementId == WATER) {
      let nt = wetterTier(d.elementId); d = Cell(nt, preserveTempEnthalpy(d.elementId, d.enthalpy, nt)); b = Cell(EMPTY, emptyAmbient);
    } else if (isSandTier(c.elementId) && c.elementId != SATURATED_SAND && d.elementId == WATER) {
      let nt = wetterTier(c.elementId); c = Cell(nt, preserveTempEnthalpy(c.elementId, c.enthalpy, nt)); d = Cell(EMPTY, emptyAmbient);
    } else if (isSandTier(d.elementId) && d.elementId != SATURATED_SAND && c.elementId == WATER) {
      let nt = wetterTier(d.elementId); d = Cell(nt, preserveTempEnthalpy(d.elementId, d.enthalpy, nt)); c = Cell(EMPTY, emptyAmbient);
    }
  }

  // --- Drip: saturated sand over an empty cell (a over c, b over d) releases
  // water; the dripped Water and the drier sand both inherit the sand's temp.
  let dripRoll = f32(hash(u32(blockX) + 7u, u32(blockY) + 13u, params.frame) & 0xffffu) / 65536.0;
  if (dripRoll < DRIP_CHANCE) {
    if (a.elementId == SATURATED_SAND && c.elementId == EMPTY) {
      let t = thermalFromEnthalpy(a.elementId, a.enthalpy).temperature;
      a = Cell(WET_SAND, enthalpyForNewElement(t, WET_SAND)); c = Cell(WATER, enthalpyForNewElement(t, WATER));
    } else if (b.elementId == SATURATED_SAND && d.elementId == EMPTY) {
      let t = thermalFromEnthalpy(b.elementId, b.enthalpy).temperature;
      b = Cell(WET_SAND, enthalpyForNewElement(t, WET_SAND)); d = Cell(WATER, enthalpyForNewElement(t, WATER));
    }
  }

  writeBuf[idxA] = a; writeBuf[idxB] = b; writeBuf[idxC] = c; writeBuf[idxD] = d;
}

// Energy flowing from `tempFrom` toward `tempTo` this tick, bottlenecked by
// whichever side conducts worse (a poor insulator anywhere in the path
// limits flow, like a resistor in series).
fn heatFlux(tempFrom: f32, tempTo: f32, condFrom: f32, condTo: f32, rate: f32) -> f32 {
  return min(condFrom, condTo) * rate * (tempFrom - tempTo);
}

@compute @workgroup_size(8, 8)
fn heat(@builtin(global_invocation_id) gid: vec3<u32>) {
  let width = i32(params.width);
  let height = i32(params.height);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= width || y >= height) {
    return;
  }
  let idx = cellIndex(x, y, width);
  let here = readBuf[idx];
  let hereTemp = thermalFromEnthalpy(here.elementId, here.enthalpy).temperature;
  let hereConductivity = conductivityOf(here.elementId);

  var energyDelta = 0.0;
  var touchingWaterOrSteam = false;
  // The up-to-4 orthogonal neighbor element ids, used by the generic
  // contact-reaction loop below to check for a catalyst - NO_NEIGHBOR fills
  // any slot off the edge of the grid.
  var neighborIds = array<u32, 4>(NO_NEIGHBOR, NO_NEIGHBOR, NO_NEIGHBOR, NO_NEIGHBOR);

  if (x > 0) {
    let n = readBuf[cellIndex(x - 1, y, width)];
    let nTemp = thermalFromEnthalpy(n.elementId, n.enthalpy).temperature;
    energyDelta += heatFlux(nTemp, hereTemp, conductivityOf(n.elementId), hereConductivity, CONDUCTION_RATE) * WEIGHT_SIDE;
    touchingWaterOrSteam = touchingWaterOrSteam || n.elementId == WATER || n.elementId == STEAM;
    neighborIds[0] = n.elementId;
  }
  if (x < width - 1) {
    let n = readBuf[cellIndex(x + 1, y, width)];
    let nTemp = thermalFromEnthalpy(n.elementId, n.enthalpy).temperature;
    energyDelta += heatFlux(nTemp, hereTemp, conductivityOf(n.elementId), hereConductivity, CONDUCTION_RATE) * WEIGHT_SIDE;
    touchingWaterOrSteam = touchingWaterOrSteam || n.elementId == WATER || n.elementId == STEAM;
    neighborIds[1] = n.elementId;
  }
  if (y > 0) {
    let n = readBuf[cellIndex(x, y - 1, width)]; // above
    let nTemp = thermalFromEnthalpy(n.elementId, n.enthalpy).temperature;
    energyDelta += heatFlux(nTemp, hereTemp, conductivityOf(n.elementId), hereConductivity, CONDUCTION_RATE) * WEIGHT_ABOVE;
    touchingWaterOrSteam = touchingWaterOrSteam || n.elementId == WATER || n.elementId == STEAM;
    neighborIds[2] = n.elementId;
  }
  if (y < height - 1) {
    let n = readBuf[cellIndex(x, y + 1, width)]; // below
    let nTemp = thermalFromEnthalpy(n.elementId, n.enthalpy).temperature;
    energyDelta += heatFlux(nTemp, hereTemp, conductivityOf(n.elementId), hereConductivity, CONDUCTION_RATE) * WEIGHT_BELOW;
    touchingWaterOrSteam = touchingWaterOrSteam || n.elementId == WATER || n.elementId == STEAM;
    neighborIds[3] = n.elementId;
  }

  // Ambient drift: bottlenecked only by this material's own conductivity
  // (a good insulator drifts toward ambient slower).
  energyDelta += hereConductivity * AMBIENT_DRIFT_RATE * (params.ambientTemp - hereTemp);

  var newEnthalpy = here.enthalpy + energyDelta;
  var result = thermalFromEnthalpy(here.elementId, newEnthalpy);

  // Combustion isn't a phase change of one substance (it's Wood becoming a
  // different substance, Fire), so it stays a simple threshold/stochastic
  // rule rather than going through the latent-heat machinery above or the
  // generic reaction loops below (neither Wood's ignition nor Fire's decay
  // is a reactant+catalyst-neighbor pair). Each branch re-encodes
  // result.temperature as the new element's enthalpy (rather than leaving
  // newEnthalpy as-is) so the temperature carries over continuously across
  // the elementId change instead of getting reinterpreted under the new
  // element's heatCapacity. Consequence: the generic loops below are only
  // reached in the `else` case, so a CONTACT_REACTIONS entry (src/reactions.ts)
  // or a THRESHOLD_REACTIONS entry (src/thresholdReactions.ts) with reactant
  // WOOD or FIRE would never be evaluated - it would be silently skipped,
  // not an error.
  if (here.elementId == WOOD && result.temperature > WOOD_IGNITE_POINT) {
    result.elementId = FIRE;
    newEnthalpy = enthalpyForNewElement(result.temperature, FIRE);
  } else if (here.elementId == FIRE) {
    if (touchingWaterOrSteam) {
      result.elementId = STEAM;
      newEnthalpy = enthalpyForNewElement(result.temperature, STEAM);
    } else {
      let roll = f32(hash(u32(x), u32(y), params.frame) & 0xffffu) / 65536.0;
      if (roll < FIRE_DECAY_CHANCE) {
        result.elementId = SMOKE;
        newEnthalpy = enthalpyForNewElement(result.temperature, SMOKE);
      }
    }
  } else {
    // Data-driven contact reactions (src/reactions.ts): reactant + adjacent
    // catalyst -> product, e.g. Lava+Water->Obsidian or
    // Copper+Acid->Copper Sulfate. First matching-and-triggered reaction
    // wins (a cell can't be transformed twice in one tick).
    for (var i = 0u; i < params.reactionCount; i = i + 1u) {
      let row0 = reactions[i * 2u];
      if (here.elementId != u32(row0.x)) {
        continue;
      }
      let catalyst = u32(row0.y);
      var matched = false;
      for (var j = 0u; j < 4u; j = j + 1u) {
        if (neighborIds[j] == catalyst) {
          matched = true;
        }
      }
      if (!matched) {
        continue;
      }
      let row1 = reactions[i * 2u + 1u];
      let minTemperature = row1.y;
      if (minTemperature != NO_MIN_TEMPERATURE && result.temperature < minTemperature) {
        continue;
      }
      // Seed with the reaction index too, so multiple reactions don't share
      // (and correlate with) the same roll on a given cell/frame.
      let roll = f32(hash(u32(x), u32(y), params.frame + i * 7919u) & 0xffffu) / 65536.0;
      if (roll < row0.w) {
        let product = u32(row0.z);
        result.elementId = product;
        newEnthalpy = enthalpyForNewElement(result.temperature, product) + row1.x;
        break;
      }
    }

    // Data-driven threshold reactions (src/thresholdReactions.ts): a
    // temperature-only, one-way substance change with no catalyst neighbor
    // needed (e.g. heat boiling water out of dilute acid to concentrate it)
    // - the same shape as Wood's ignition below, but shared across several
    // cases instead of duplicated as bespoke branches. Only tried if no
    // contact reaction already fired this tick (result.elementId is still
    // unchanged), so a cell can't be transformed twice in one tick.
    if (result.elementId == here.elementId) {
      for (var k = 0u; k < params.thresholdReactionCount; k = k + 1u) {
        let trow = thresholdReactions[k];
        if (here.elementId != u32(trow.x)) {
          continue;
        }
        if (result.temperature < trow.y) {
          continue;
        }
        // Distinct seed multiplier from the contact-reaction loop above, so
        // the two engines' rolls don't correlate.
        let roll = f32(hash(u32(x), u32(y), params.frame + k * 104729u) & 0xffffu) / 65536.0;
        if (roll < trow.w) {
          let product = u32(trow.z);
          result.elementId = product;
          newEnthalpy = enthalpyForNewElement(result.temperature, product);
          break;
        }
      }
    }
  }

  writeBuf[idx] = Cell(result.elementId, newEnthalpy);
}
