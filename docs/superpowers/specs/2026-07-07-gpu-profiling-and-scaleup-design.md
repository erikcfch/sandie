# GPU profiling overlay + resolution/tick-rate scale-up

## Purpose

The simulation currently runs a 320x180 grid (57,600 cells), one movement+heat
tick per rendered frame, upscaled 4x per axis into a 1280x720 canvas. Rough
FLOP estimates put this at a tiny fraction of what any WebGPU-capable GPU can
do per 16.6ms frame budget — there's no evidence for this beyond back-of-envelope
math, though. Before spending that headroom, we want real numbers, and then to
spend the headroom on: a higher-resolution grid, faster physics (more ticks per
rendered frame), and a documented baseline for how much room future features
(more reactions, more materials, more passes) have to work with.

## Scope

**In scope:**
- A permanent, toggleable on-screen profiling overlay showing GPU compute time,
  GPU render time, CPU submit time, measured frame time/fps, grid dimensions,
  and ticks/frame.
- Bump `GRID_WIDTH`/`GRID_HEIGHT` to 1280x720 (native 1:1 with the canvas,
  removing the current 4x upscale).
- Run multiple simulation ticks per rendered frame (`TICKS_PER_FRAME` = 3,
  tunable via the overlay's real numbers).
- A post-change profiler reading, recorded in the implementation's commit
  message or a short note in this doc, establishing a baseline for future
  feature headroom.

**Out of scope (explicitly deferred):**
- Decoupling simulation rate from display refresh rate (fixed-timestep
  accumulator loop independent of `requestAnimationFrame`). Ticks-per-frame
  stays coupled to rAF for now — simpler, and sufficient for "faster physics."
- A resolution/tick-count *setting* exposed in the toolbar UI. Both are config
  constants for now; the profiler overlay is the tuning tool, not a live
  slider.
- Any change to the movement/heat simulation rules themselves.
- Automated performance regression testing (e.g. asserting frame time stays
  under a threshold in CI). This is a manual/dev-facing tool for now.

## Profiling overlay

New module `src/webgpu/profiler.ts`, used by `Simulation`.

**GPU timing (when available):** `Simulation.create` requests the device with
`requiredFeatures: ['timestamp-query']` when the adapter supports it
(`adapter.features.has('timestamp-query')`); otherwise device creation omits
it and the profiler runs CPU-only. When supported, a 4-slot `GPUQuerySet`
brackets two spans per frame via `timestampWrites` on the pass descriptors:
- compute span: start-of-first-compute-pass to end-of-last-compute-pass
  (paint, if active, plus all `TICKS_PER_FRAME` movement/heat pairs)
- render span: start/end of the single render pass

Query results resolve into a `MAP_READ` buffer via `resolveQuerySet` +
`copyBufferToBuffer`, and are read back asynchronously on a throttled interval
(~4 times/sec) rather than every frame, to avoid a synchronous stall on the
mapping.

**CPU timing:** `performance.now()` brackets `device.queue.submit()` (CPU
submit time). Frame time is measured in `main.ts` as the delta between the
`performance.now()` timestamp captured at the start of one
`requestAnimationFrame` callback and the timestamp captured at the start of
the previous one -- i.e. the rAF-to-rAF period, which folds in idle/vsync
wait time rather than just the callback body's own execution duration.

**Display:** a plain DOM `<div>` overlay positioned over the canvas (not
GPU-rendered — it's debug text, no reason to route it through WebGPU). Toggled
with a backtick keypress. Shows, updated at the same ~4Hz throttle as the GPU
readback:
- GPU compute time / GPU render time (or "unsupported" if the feature isn't
  available)
- CPU submit time
- Frame time / fps
- Grid dimensions and cell count
- Ticks per frame

## Grid resolution

`config.ts`: `GRID_WIDTH = 1280`, `GRID_HEIGHT = 720` (matching
`CANVAS_WIDTH`/`CANVAS_HEIGHT`). No shader changes — `simulate.wgsl` and
`render.wgsl` already derive everything from `params.width`/`params.height`.
Buffer sizes scale automatically since `GRID_BYTES` is computed from
`CELL_COUNT = GRID_WIDTH * GRID_HEIGHT`. This takes cell count from 57,600 to
921,600 (~16x), and per-grid-buffer size from ~460KB to ~7.4MB (two buffers,
~14.75MB total) — well within any WebGPU-capable device's VRAM budget.

## Multi-tick per frame

New `TICKS_PER_FRAME = 3` constant in `config.ts`. `Simulation.render()` runs
the movement+heat pass pair 3 times per rendered frame instead of once.

**Why this isn't just "loop the existing code 3x":** each tick needs its own
`params.frame` value, since the Margolus block alignment cycles on
`frame % 4`. WebGPU's `queue.writeBuffer` takes effect once, at the point in
the queue timeline where it's called — it does not take a new value "per
recorded pass" within a single submitted command buffer. A single
`writeBuffer` + single `submit()` per rendered frame would mean all 3 ticks'
dispatches see the same `frame` value.

Fix: expand `simParamsBuffer` to hold `TICKS_PER_FRAME` slots, each padded to
the device's `minUniformBufferOffsetAlignment` (typically 256 bytes). Write
all 3 ticks' params (each with its own `frame` value, `this.frame`,
`this.frame + 1`, `this.frame + 2`) in one `writeBuffer` call before the
frame's encoder is built. The sim bind group layout's uniform entry gains
`hasDynamicOffset: true`; `pass.setBindGroup(0, bindGroup, [offset])` selects
the correct slot before each tick's movement+heat dispatches. All 3 tick pairs
still record into the same command encoder and single `submit()` — no extra
submit overhead.

`this.frame` (the JS-side counter used for the *next* frame's alignment and
by `PaintInput`/paint pass) increments by `TICKS_PER_FRAME` per rendered
frame instead of by 1.

## Baseline headroom

After the above lands, take a fresh overlay reading at the new resolution and
tick count, and record it (commit message or an addendum to this file):
GPU compute time, GPU render time, and how much of the 16.6ms (60fps) budget
remains. This becomes the reference point for deciding how much more the sim
can take on (more reactions, more materials, more passes) before it becomes
GPU-bound rather than CPU/JS-bound.

## Testing

- Existing unit tests (`coords.test.ts`, `elements.test.ts`, etc.) reference
  `GRID_WIDTH`/`GRID_HEIGHT` via the `config.ts` import rather than hardcoded
  values — expected to keep passing unchanged after the resolution bump, will
  confirm this holds.
- `e2e/smoke.spec.ts` drives tool interactions rather than asserting exact
  pixel output — expected to be unaffected; will confirm during
  implementation.
- No new automated tests for the profiler itself (it's a manual dev-facing
  tool). A basic "overlay toggles on/off" check may be added if cheap to
  write alongside the e2e smoke test.
