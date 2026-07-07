// Cellular-automaton movement rules.
//
// Element ids must stay in sync with src/elements.ts:
//   0 = Empty, 1 = Stone, 2 = Sand, 3 = Water, 4 = Wood, 5 = Smoke
//
// Uses a Margolus neighborhood: the grid is partitioned into non-overlapping
// 2x2 blocks, and each block is resolved by exactly one thread (its
// top-left cell), which reads all 4 cells and decides how they rearrange
// entirely locally. Blocks never overlap, so there are no cross-thread
// races and no atomics are needed. Which 2x2 partitioning is used (there
// are 4 possible alignments) cycles every tick via params.frame, so over
// a few ticks every possible adjacency gets a chance to interact.
//
// This replaces an earlier design that paired every cell with one neighbor
// via a single frame-wide direction choice - that made an entire row (or
// the whole grid) lurch the same way in lockstep every tick, which showed
// up as water "bouncing like a laser" and pours splitting into exactly two
// streams (the row's single shared direction alternated between frames,
// so roughly half of arrivals went left, half went right, with nothing in
// between). A Margolus block makes its decision from its own 4 cells only,
// so neighboring blocks can independently choose different outcomes.

struct SimParams {
  width: u32,
  height: u32,
  frame: u32,
  _pad: u32,
}

@group(0) @binding(0) var<uniform> params: SimParams;
@group(0) @binding(1) var<storage, read> readBuf: array<u32>;
@group(0) @binding(2) var<storage, read_write> writeBuf: array<u32>;

const EMPTY: u32 = 0u;
const SAND: u32 = 2u;
const WATER: u32 = 3u;
const SMOKE: u32 = 5u;

fn density(id: u32) -> i32 {
  switch id {
    case 0u: { return 0; }   // Empty
    case 1u: { return 100; } // Stone
    case 2u: { return 60; }  // Sand
    case 3u: { return 40; }  // Water
    case 4u: { return 90; }  // Wood
    case 5u: { return 1; }   // Smoke
    default: { return 0; }
  }
}

fn isPowderOrLiquid(id: u32) -> bool {
  return id == SAND || id == WATER;
}

fn isGas(id: u32) -> bool {
  return id == SMOKE;
}

fn isLiquid(id: u32) -> bool {
  return id == WATER;
}

fn cellIndex(x: i32, y: i32, width: i32) -> u32 {
  return u32(y * width + x);
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
fn simulate(@builtin(global_invocation_id) gid: vec3<u32>) {
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
  let movedLeft = shouldSwapVertical(a, c);
  if (movedLeft) {
    let tmp = a; a = c; c = tmp;
  }
  let movedRight = shouldSwapVertical(b, d);
  if (movedRight) {
    let tmp = b; b = d; d = tmp;
  }

  // 2. Diagonal, only for a column that didn't just resolve straight down
  // (so a cell moves at most once per tick).
  if (!movedLeft && shouldSwapVertical(a, d)) {
    let tmp = a; a = d; d = tmp;
  }
  if (!movedRight && shouldSwapVertical(b, c)) {
    let tmp = b; b = c; c = tmp;
  }

  // 3. Horizontal spread, each row independently.
  if (shouldSwapHorizontal(a, b)) {
    let tmp = a; a = b; b = tmp;
  }
  if (shouldSwapHorizontal(c, d)) {
    let tmp = c; c = d; d = tmp;
  }

  writeBuf[idxA] = a;
  writeBuf[idxB] = b;
  writeBuf[idxC] = c;
  writeBuf[idxD] = d;
}
