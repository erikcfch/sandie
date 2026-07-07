// Cellular-automaton movement + heat/phase-change rules.
//
// Element ids must stay in sync with src/elements.ts:
//   0=Empty 1=Stone 2=Sand 3=Water 4=Wood 5=Smoke 6=Ice 7=Lava 8=Steam 9=Fire
//
// Each grid cell is a Cell{elementId, temperature} struct (see below), not a
// bare element id. This lets the movement pass swap material and its heat
// together atomically - a falling Lava cell carries its temperature down
// with it - with no separate bookkeeping.
//
// Two compute passes run per tick, sharing this module:
//   `movement` - the Phase 1 Margolus-neighborhood swap logic, now moving
//                whole Cells instead of raw ids.
//   `heat`     - new in Phase 2: blends each cell's temperature toward its
//                4 orthogonal neighbors and a fixed ambient value, then
//                checks the result against phase-change thresholds and
//                rewrites elementId if one is crossed.
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
// This replaced an earlier design that paired every cell with one neighbor
// via a single frame-wide direction choice - that made an entire row (or
// the whole grid) lurch the same way in lockstep every tick, which showed
// up as water "bouncing like a laser" and pours splitting into exactly two
// streams.

struct Cell {
  elementId: u32,
  temperature: f32,
}

struct SimParams {
  width: u32,
  height: u32,
  frame: u32,
  ambientTemp: f32,
}

@group(0) @binding(0) var<uniform> params: SimParams;
@group(0) @binding(1) var<storage, read> readBuf: array<Cell>;
@group(0) @binding(2) var<storage, read_write> writeBuf: array<Cell>;

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

fn density(id: u32) -> i32 {
  switch id {
    case 0u: { return 0; }   // Empty
    case 1u: { return 100; } // Stone
    case 2u: { return 60; }  // Sand
    case 3u: { return 40; }  // Water
    case 4u: { return 90; }  // Wood
    case 5u: { return 1; }   // Smoke
    case 6u: { return 95; }  // Ice - static, but must still block powder/liquid like Stone/Wood
    case 7u: { return 50; }  // Lava - between Sand and Water
    case 8u: { return 1; }   // Steam
    case 9u: { return 1; }   // Fire
    default: { return 0; }
  }
}

fn isPowderOrLiquid(id: u32) -> bool {
  return id == SAND || id == WATER || id == LAVA;
}

fn isGas(id: u32) -> bool {
  return id == SMOKE || id == STEAM || id == FIRE;
}

fn isLiquid(id: u32) -> bool {
  return id == WATER || id == LAVA;
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
  // (so a cell moves at most once per tick).
  if (!movedLeft && shouldSwapVertical(a.elementId, d.elementId)) {
    let tmp = a; a = d; d = tmp;
  }
  if (!movedRight && shouldSwapVertical(b.elementId, c.elementId)) {
    let tmp = b; b = c; c = tmp;
  }

  // 3. Horizontal spread, each row independently.
  if (shouldSwapHorizontal(a.elementId, b.elementId)) {
    let tmp = a; a = b; b = tmp;
  }
  if (shouldSwapHorizontal(c.elementId, d.elementId)) {
    let tmp = c; c = d; d = tmp;
  }

  writeBuf[idxA] = a;
  writeBuf[idxB] = b;
  writeBuf[idxC] = c;
  writeBuf[idxD] = d;
}

const CONDUCTION_RATE: f32 = 0.15;
const AMBIENT_DRIFT_RATE: f32 = 0.001;
const FIRE_DECAY_CHANCE: f32 = 0.05;

// Convective bias for the heat blend below: a cell is warmed 3x more by
// its below-neighbor than it is by its above-neighbor.
const WEIGHT_BELOW: f32 = 1.5;
const WEIGHT_ABOVE: f32 = 0.5;
const WEIGHT_SIDE: f32 = 1.0;
const WEIGHT_TOTAL: f32 = WEIGHT_BELOW + WEIGHT_ABOVE + WEIGHT_SIDE + WEIGHT_SIDE;

const ICE_MELT_POINT: f32 = 0.0;
const WATER_BOIL_POINT: f32 = 100.0;
const LAVA_SOLIDIFY_POINT: f32 = 300.0;
const STONE_MELT_POINT: f32 = 800.0;
const WOOD_IGNITE_POINT: f32 = 300.0;

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

  // Blend with the 4 orthogonal neighbors; at the grid edge, substitute
  // this cell's own value so the boundary doesn't act like an artificial
  // heat sink.
  //
  // Weighted, not a flat average: convection carries hot gas upward, so a
  // cell is warmed more by what's below it than it loses to what's above
  // it (y grows downward, so y+1 is physically below). Side neighbors stay
  // neutral. Weights sum to WEIGHT_TOTAL so the overall conduction rate
  // stays calibrated the same as a plain 4-neighbor average.
  var neighborTempSum = 0.0;
  var touchingWaterOrSteam = false;

  if (x > 0) {
    let n = readBuf[cellIndex(x - 1, y, width)];
    neighborTempSum += n.temperature * WEIGHT_SIDE;
    touchingWaterOrSteam = touchingWaterOrSteam || n.elementId == WATER || n.elementId == STEAM;
  } else {
    neighborTempSum += here.temperature * WEIGHT_SIDE;
  }
  if (x < width - 1) {
    let n = readBuf[cellIndex(x + 1, y, width)];
    neighborTempSum += n.temperature * WEIGHT_SIDE;
    touchingWaterOrSteam = touchingWaterOrSteam || n.elementId == WATER || n.elementId == STEAM;
  } else {
    neighborTempSum += here.temperature * WEIGHT_SIDE;
  }
  if (y > 0) {
    let n = readBuf[cellIndex(x, y - 1, width)]; // above
    neighborTempSum += n.temperature * WEIGHT_ABOVE;
    touchingWaterOrSteam = touchingWaterOrSteam || n.elementId == WATER || n.elementId == STEAM;
  } else {
    neighborTempSum += here.temperature * WEIGHT_ABOVE;
  }
  if (y < height - 1) {
    let n = readBuf[cellIndex(x, y + 1, width)]; // below
    neighborTempSum += n.temperature * WEIGHT_BELOW;
    touchingWaterOrSteam = touchingWaterOrSteam || n.elementId == WATER || n.elementId == STEAM;
  } else {
    neighborTempSum += here.temperature * WEIGHT_BELOW;
  }

  let neighborAvg = neighborTempSum / WEIGHT_TOTAL;
  var newTemp = mix(here.temperature, neighborAvg, CONDUCTION_RATE);
  newTemp = mix(newTemp, params.ambientTemp, AMBIENT_DRIFT_RATE);

  var newElementId = here.elementId;

  switch here.elementId {
    case 3u: { // Water
      if (newTemp < ICE_MELT_POINT) {
        newElementId = ICE;
      } else if (newTemp > WATER_BOIL_POINT) {
        newElementId = STEAM;
      }
    }
    case 6u: { // Ice
      if (newTemp > ICE_MELT_POINT) {
        newElementId = WATER;
      }
    }
    case 8u: { // Steam
      if (newTemp < WATER_BOIL_POINT) {
        newElementId = WATER;
      }
    }
    case 7u: { // Lava
      if (newTemp < LAVA_SOLIDIFY_POINT) {
        newElementId = STONE;
      }
    }
    case 1u: { // Stone
      if (newTemp > STONE_MELT_POINT) {
        newElementId = LAVA;
      }
    }
    case 4u: { // Wood
      if (newTemp > WOOD_IGNITE_POINT) {
        newElementId = FIRE;
      }
    }
    case 9u: { // Fire
      if (touchingWaterOrSteam) {
        newElementId = STEAM;
      } else {
        let roll = f32(hash(u32(x), u32(y), params.frame) & 0xffffu) / 65536.0;
        if (roll < FIRE_DECAY_CHANCE) {
          newElementId = SMOKE;
        }
      }
    }
    default: {}
  }

  writeBuf[idx] = Cell(newElementId, newTemp);
}
