// Stamps the selected element into a circular brush around the cursor.
// Reads and writes the same buffer in place: safe because each invocation
// only ever touches its own cell (a comparison against the fixed cursor
// position), never a neighbor's.
//
// Deposits stochastically rather than instantly filling the whole circle
// every frame: at flowRate < 1, each cell in range only has a per-tick
// chance of receiving material. This spreads a pour out over several
// frames instead of dumping a solid disc every tick, giving the pile time
// to settle and widen as it grows instead of everything funneling down a
// single column and forking off immediately (see the "two streams" issue).

struct PaintParams {
  width: u32,
  height: u32,
  cursorX: f32,
  cursorY: f32,
  radius: f32,
  elementId: u32,
  enabled: u32,
  flowRate: f32,
  frame: u32,
}

@group(0) @binding(0) var<uniform> params: PaintParams;
@group(0) @binding(1) var<storage, read_write> grid: array<u32>;

fn hash(x: u32, y: u32, frame: u32) -> u32 {
  var h = x * 374761393u + y * 668265263u + frame * 2246822519u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return h ^ (h >> 16u);
}

@compute @workgroup_size(8, 8)
fn paint(@builtin(global_invocation_id) gid: vec3<u32>) {
  let width = i32(params.width);
  let height = i32(params.height);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= width || y >= height || params.enabled == 0u) {
    return;
  }

  let dx = f32(x) - params.cursorX;
  let dy = f32(y) - params.cursorY;
  if (dx * dx + dy * dy > params.radius * params.radius) {
    return;
  }

  if (params.flowRate < 1.0) {
    let roll = f32(hash(u32(x), u32(y), params.frame) & 0xffffu) / 65536.0;
    if (roll >= params.flowRate) {
      return;
    }
  }

  grid[u32(y * width + x)] = params.elementId;
}
