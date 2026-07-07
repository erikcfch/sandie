# GPU Profiling Overlay + Resolution/Tick Scale-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggleable WebGPU profiling overlay (GPU compute/render time, CPU submit time, frame time/fps), then use the GPU headroom it reveals to bump the sim grid to 1280x720 (native 1:1 with the canvas) and run 3 simulation ticks per rendered frame.

**Architecture:** A `Profiler` class owns a `GPUQuerySet` (timestamp-query) plus resolve/readback buffers and hands pass descriptors their `timestampWrites`; `Simulation` records CPU submit time and exposes a snapshot; an `Overlay` DOM component (parallel to the existing `ui/toolbar.ts` pattern) renders that snapshot, toggled by backtick. Multi-tick dispatch reuses the existing movement/heat bind groups but selects a per-tick uniform buffer slot via a dynamic bind group offset, since a single uniform slot can't hold a different `frame` value per tick within one `submit()`.

**Tech Stack:** TypeScript, WebGPU (`@webgpu/types`), Vite, Vitest, Playwright.

## Global Constraints

- Grid resolution: `GRID_WIDTH = 1280`, `GRID_HEIGHT = 720` (matches `CANVAS_WIDTH`/`CANVAS_HEIGHT`, native 1:1).
- `TICKS_PER_FRAME = 3` simulation ticks per rendered frame.
- Overlay toggle key: backtick (`` ` ``).
- Overlay DOM updates throttle to ~250ms (4Hz), independent of rAF rate.
- No toolbar slider for resolution or tick count — both are `config.ts` constants for now.
- No decoupled fixed-timestep loop — ticks stay coupled to `requestAnimationFrame`.
- No changes to `simulate.wgsl`'s movement/heat rules.
- No automated performance-regression testing; the overlay is a manual dev tool, matching this codebase's existing convention that DOM-manipulating UI code (`src/ui/toolbar.ts`, `src/input.ts`) has no unit tests — only pure-logic modules do.

---

### Task 1: Bump grid resolution and add tick-rate constant

**Files:**
- Modify: `src/config.ts`

**Interfaces:**
- Produces: `TICKS_PER_FRAME: number` (new export), `GRID_WIDTH`/`GRID_HEIGHT` now `1280`/`720` (existing exports, values only).

- [ ] **Step 1: Update `src/config.ts`**

```ts
export const GRID_WIDTH = 1280;
export const GRID_HEIGHT = 720;
export const CANVAS_WIDTH = 1280;
export const CANVAS_HEIGHT = 720;
export const WORKGROUP_SIZE = 8;
export const TICKS_PER_FRAME = 3;
```

- [ ] **Step 2: Run typecheck and the unit test suite**

Run: `npm run typecheck && npm test`
Expected: both pass. `src/coords.test.ts` defines its own local `GRID`/`CANVAS` constants (doesn't import from `config.ts`), so it's unaffected by this change — confirm its tests are still in the passing output.

- [ ] **Step 3: Commit**

```bash
git add src/config.ts
git commit -m "$(cat <<'EOF'
Bump grid resolution to 1280x720 and add TICKS_PER_FRAME constant

Native 1:1 grid-to-canvas resolution (up from 320x180's 4x upscale)
and a config constant for the upcoming multi-tick-per-frame change.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Add the `Profiler` class

**Files:**
- Create: `src/webgpu/profiler.ts`

**Interfaces:**
- Produces:
  - `interface ProfilerSnapshot { gpuComputeMs: number | null; gpuRenderMs: number | null; cpuSubmitMs: number | null; }`
  - `class Profiler`:
    - `constructor(device: GPUDevice, supported: boolean)`
    - `computeTimestampWrites(): GPUComputePassTimestampWrites | undefined`
    - `renderTimestampWrites(): GPURenderPassTimestampWrites | undefined`
    - `resolveInto(encoder: GPUCommandEncoder, didRunComputePass: boolean): void`
    - `recordCpuSubmitMs(ms: number): void`
    - `snapshot(): ProfilerSnapshot`

- [ ] **Step 1: Write `src/webgpu/profiler.ts`**

```ts
export interface ProfilerSnapshot {
  gpuComputeMs: number | null;
  gpuRenderMs: number | null;
  cpuSubmitMs: number | null;
}

const QUERY_COUNT = 4; // 0=compute-start, 1=compute-end, 2=render-start, 3=render-end
const COMPUTE_RESOLVE_OFFSET = 0;
const RENDER_RESOLVE_OFFSET = 256; // resolveQuerySet's destinationOffset must be a multiple of 256
const RESOLVE_BUFFER_SIZE = 512;
const TIMESTAMP_PAIR_BYTES = 16; // 2 x u64 nanosecond timestamps

/**
 * Wraps WebGPU timestamp-query GPU timing plus CPU submit timing for the
 * profiling overlay. Degrades to CPU-only numbers when the adapter doesn't
 * support the 'timestamp-query' feature (pass supported: false).
 */
export class Profiler {
  readonly supported: boolean;
  private readonly querySet?: GPUQuerySet;
  private readonly resolveBuffer?: GPUBuffer;
  private readonly readbackBuffer?: GPUBuffer;
  private mapping = false;
  private latestGpuComputeMs: number | null = null;
  private latestGpuRenderMs: number | null = null;
  private latestCpuSubmitMs: number | null = null;

  constructor(device: GPUDevice, supported: boolean) {
    this.supported = supported;
    if (!supported) {
      return;
    }
    this.querySet = device.createQuerySet({ type: 'timestamp', count: QUERY_COUNT });
    this.resolveBuffer = device.createBuffer({
      label: 'profiler-resolve',
      size: RESOLVE_BUFFER_SIZE,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    this.readbackBuffer = device.createBuffer({
      label: 'profiler-readback',
      size: RESOLVE_BUFFER_SIZE,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  }

  computeTimestampWrites(): GPUComputePassTimestampWrites | undefined {
    if (!this.querySet) {
      return undefined;
    }
    return { querySet: this.querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 };
  }

  renderTimestampWrites(): GPURenderPassTimestampWrites | undefined {
    if (!this.querySet) {
      return undefined;
    }
    return { querySet: this.querySet, beginningOfPassWriteIndex: 2, endOfPassWriteIndex: 3 };
  }

  /**
   * Call once per frame, after all passes are recorded but before
   * encoder.finish(). Skips entirely while a previous readback is still in
   * flight, so GPU->CPU sync happens roughly one round-trip at a time
   * instead of queuing a new mapAsync every frame.
   */
  resolveInto(encoder: GPUCommandEncoder, didRunComputePass: boolean): void {
    if (!this.supported || !this.querySet || !this.resolveBuffer || !this.readbackBuffer || this.mapping) {
      return;
    }

    if (didRunComputePass) {
      encoder.resolveQuerySet(this.querySet, 0, 2, this.resolveBuffer, COMPUTE_RESOLVE_OFFSET);
      encoder.copyBufferToBuffer(
        this.resolveBuffer,
        COMPUTE_RESOLVE_OFFSET,
        this.readbackBuffer,
        COMPUTE_RESOLVE_OFFSET,
        TIMESTAMP_PAIR_BYTES,
      );
    }
    encoder.resolveQuerySet(this.querySet, 2, 2, this.resolveBuffer, RENDER_RESOLVE_OFFSET);
    encoder.copyBufferToBuffer(
      this.resolveBuffer,
      RENDER_RESOLVE_OFFSET,
      this.readbackBuffer,
      RENDER_RESOLVE_OFFSET,
      TIMESTAMP_PAIR_BYTES,
    );

    this.mapping = true;
    const readbackBuffer = this.readbackBuffer;
    readbackBuffer
      .mapAsync(GPUMapMode.READ)
      .then(() => {
        if (didRunComputePass) {
          const compute = new BigUint64Array(
            readbackBuffer.getMappedRange(COMPUTE_RESOLVE_OFFSET, TIMESTAMP_PAIR_BYTES),
          );
          this.latestGpuComputeMs = Number(compute[1] - compute[0]) / 1e6;
        }
        const render = new BigUint64Array(readbackBuffer.getMappedRange(RENDER_RESOLVE_OFFSET, TIMESTAMP_PAIR_BYTES));
        this.latestGpuRenderMs = Number(render[1] - render[0]) / 1e6;
        readbackBuffer.unmap();
        this.mapping = false;
      })
      .catch(() => {
        // mapAsync can reject if the device is lost mid-frame; drop this
        // reading and let the next resolveInto() call try again.
        this.mapping = false;
      });
  }

  recordCpuSubmitMs(ms: number): void {
    this.latestCpuSubmitMs = ms;
  }

  snapshot(): ProfilerSnapshot {
    return {
      gpuComputeMs: this.latestGpuComputeMs,
      gpuRenderMs: this.latestGpuRenderMs,
      cpuSubmitMs: this.latestCpuSubmitMs,
    };
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS. (No unit tests for this file: it only does anything meaningful against a real `GPUDevice`, and this codebase has no WebGPU test harness — `src/webgpu/simulation.ts` itself has no test file today, for the same reason. Verified via the dev server in Task 7.)

- [ ] **Step 3: Commit**

```bash
git add src/webgpu/profiler.ts
git commit -m "$(cat <<'EOF'
Add Profiler class for WebGPU timestamp-query + CPU submit timing

Standalone class, not yet wired into Simulation. Owns the query set
and resolve/readback buffers, hands out pass timestampWrites
descriptors, and exposes a throttled snapshot() for the upcoming
overlay.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Wire the profiler and multi-tick dispatch into `Simulation`

**Files:**
- Modify: `src/webgpu/simulation.ts` (full-file rewrite — most of the file changes in a coordinated way; see complete new contents below)

**Interfaces:**
- Consumes: `Profiler` (`constructor`, `computeTimestampWrites()`, `renderTimestampWrites()`, `resolveInto()`, `recordCpuSubmitMs()`, `snapshot()`), `ProfilerSnapshot`, from Task 2. `TICKS_PER_FRAME` from `src/config.ts` (Task 1).
- Produces: `Simulation.getProfilerSnapshot(): ProfilerSnapshot` (new public method, for `main.ts`/`Overlay` to poll each frame).

> **Reconciliation note (added after Task 3's first dispatch attempt):** the
> code below was originally written against an earlier snapshot of
> `simulation.ts`/`simulate.wgsl`, before a concurrent contact-reaction
> system (data-driven `reactions` buffer, a `reactionCount` field on
> `SimParams`, and bind-group binding 4) landed on `master`. The
> implementer correctly refused to transcribe the stale version (it would
> have failed WebGPU pipeline-layout validation at runtime, undetectable
> by `tsc`) and escalated instead of improvising a redesign. The code block
> below has been corrected in place to carry the existing reactions
> wiring through unchanged — `reactionsBuffer`, binding 4, and
> `CONTACT_REACTIONS`/`reactionData()` are untouched from what's already
> on disk — while folding `reactionCount` into each tick's per-slot
> uniform data (the slot is already `paramsStride`-sized, far larger than
> the now-20-byte `SimParams`, so there's room). This is a mechanical
> merge of two independent, non-conflicting features, not a new design
> decision: the dynamic-offset/multi-tick technique and the reactions
> buffer touch disjoint parts of the bind group (binding 0 vs. binding 4)
> and disjoint parts of the uniform struct (first 16 bytes vs. byte 16).

- [ ] **Step 1: Replace the full contents of `src/webgpu/simulation.ts`**

```ts
import { GRID_HEIGHT, GRID_WIDTH, TICKS_PER_FRAME, WORKGROUP_SIZE } from '../config';
import { AMBIENT_TEMP as ELEMENT_AMBIENT_TEMP, colorPalette, ELEMENTS, getElement, materialProperties } from '../elements';
import { CONTACT_REACTIONS, reactionData } from '../reactions';
import paintShaderCode from '../shaders/paint.wgsl?raw';
import renderShaderCode from '../shaders/render.wgsl?raw';
import simulateShaderCode from '../shaders/simulate.wgsl?raw';
import { enthalpyForTemperature } from '../thermal';
import { Profiler, type ProfilerSnapshot } from './profiler';

const CELL_COUNT = GRID_WIDTH * GRID_HEIGHT;
const CELL_BYTES = 8; // Cell{elementId: u32, enthalpy: f32}
const GRID_BYTES = CELL_COUNT * CELL_BYTES;
const WORKGROUPS_X = Math.ceil(GRID_WIDTH / WORKGROUP_SIZE);
const WORKGROUPS_Y = Math.ceil(GRID_HEIGHT / WORKGROUP_SIZE);
const AMBIENT_TEMP = 20;
const EMPTY_ID = 0;
const SIM_PARAMS_BYTES = 20; // SimParams{width, height, frame, ambientTemp, reactionCount}

export interface PaintInput {
  active: boolean;
  cellX: number;
  cellY: number;
  radius: number;
  elementId: number;
  flowRate: number;
}

export class WebGPUUnsupportedError extends Error {
  constructor() {
    super('WebGPU is not supported in this browser.');
    this.name = 'WebGPUUnsupportedError';
  }
}

export class Simulation {
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly profiler: Profiler;
  // Byte stride between each tick's slot in simParamsBuffer. Must be a
  // multiple of the device's minUniformBufferOffsetAlignment so each slot
  // can be selected via a dynamic bind group offset (see render()).
  private readonly paramsStride: number;

  // Buffer A is the single source of truth outside a tick: paint writes
  // into it directly, and render always reads from it. Buffer B is scratch
  // space the two simulation passes round-trip through each tick
  // (A -> movement -> B -> heat -> A), so no ping-pong flag is needed.
  private readonly gridBufferA: GPUBuffer;
  private readonly gridBufferB: GPUBuffer;
  private readonly paletteBuffer: GPUBuffer;
  private readonly materialsBuffer: GPUBuffer;
  private readonly reactionsBuffer: GPUBuffer;
  private readonly simParamsBuffer: GPUBuffer;
  private readonly paintParamsBuffer: GPUBuffer;
  private readonly renderParamsBuffer: GPUBuffer;

  private readonly movementBindGroup: GPUBindGroup;
  private readonly heatBindGroup: GPUBindGroup;
  private readonly paintBindGroup: GPUBindGroup;
  private readonly renderBindGroup: GPUBindGroup;

  private readonly movementPipeline: GPUComputePipeline;
  private readonly heatPipeline: GPUComputePipeline;
  private readonly paintPipeline: GPUComputePipeline;
  private readonly renderPipeline: GPURenderPipeline;

  private frame = 0;

  private constructor(device: GPUDevice, context: GPUCanvasContext, format: GPUTextureFormat, profiler: Profiler) {
    this.device = device;
    this.context = context;
    this.profiler = profiler;
    this.paramsStride = device.limits.minUniformBufferOffsetAlignment;

    this.gridBufferA = device.createBuffer({
      label: 'grid-a',
      size: GRID_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.gridBufferB = device.createBuffer({
      label: 'grid-b',
      size: GRID_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.paletteBuffer = device.createBuffer({
      label: 'palette',
      size: ELEMENTS.length * 4 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.paletteBuffer, 0, colorPalette());

    this.materialsBuffer = device.createBuffer({
      label: 'materials',
      size: ELEMENTS.length * 4 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.materialsBuffer, 0, materialProperties());

    const reactions = reactionData();
    this.reactionsBuffer = device.createBuffer({
      label: 'reactions',
      size: reactions.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.reactionsBuffer, 0, reactions);

    this.simParamsBuffer = device.createBuffer({
      label: 'sim-params',
      size: this.paramsStride * TICKS_PER_FRAME,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.paintParamsBuffer = device.createBuffer({
      label: 'paint-params',
      size: 40,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.renderParamsBuffer = device.createBuffer({
      label: 'render-params',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const simModule = device.createShaderModule({ label: 'simulate', code: simulateShaderCode });
    const paintModule = device.createShaderModule({ label: 'paint', code: paintShaderCode });
    const renderModule = device.createShaderModule({ label: 'render', code: renderShaderCode });

    const simBindGroupLayout = device.createBindGroupLayout({
      label: 'sim-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform', hasDynamicOffset: true } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      ],
    });
    const paintBindGroupLayout = device.createBindGroupLayout({
      label: 'paint-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    const renderBindGroupLayout = device.createBindGroupLayout({
      label: 'render-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ],
    });

    const simPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [simBindGroupLayout] });
    const paintPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [paintBindGroupLayout] });
    const renderPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [renderBindGroupLayout] });

    this.movementPipeline = device.createComputePipeline({
      layout: simPipelineLayout,
      compute: { module: simModule, entryPoint: 'movement' },
    });
    this.heatPipeline = device.createComputePipeline({
      layout: simPipelineLayout,
      compute: { module: simModule, entryPoint: 'heat' },
    });
    this.paintPipeline = device.createComputePipeline({
      layout: paintPipelineLayout,
      compute: { module: paintModule, entryPoint: 'paint' },
    });
    this.renderPipeline = device.createRenderPipeline({
      layout: renderPipelineLayout,
      vertex: { module: renderModule, entryPoint: 'vertexMain' },
      fragment: { module: renderModule, entryPoint: 'fragmentMain', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });

    this.movementBindGroup = device.createBindGroup({
      layout: simBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.simParamsBuffer, offset: 0, size: SIM_PARAMS_BYTES } },
        { binding: 1, resource: { buffer: this.gridBufferA } },
        { binding: 2, resource: { buffer: this.gridBufferB } },
        { binding: 3, resource: { buffer: this.materialsBuffer } },
        { binding: 4, resource: { buffer: this.reactionsBuffer } },
      ],
    });
    this.heatBindGroup = device.createBindGroup({
      layout: simBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.simParamsBuffer, offset: 0, size: SIM_PARAMS_BYTES } },
        { binding: 1, resource: { buffer: this.gridBufferB } },
        { binding: 2, resource: { buffer: this.gridBufferA } },
        { binding: 3, resource: { buffer: this.materialsBuffer } },
        { binding: 4, resource: { buffer: this.reactionsBuffer } },
      ],
    });
    this.paintBindGroup = device.createBindGroup({
      layout: paintBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.paintParamsBuffer } },
        { binding: 1, resource: { buffer: this.gridBufferA } },
      ],
    });
    this.renderBindGroup = device.createBindGroup({
      layout: renderBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.renderParamsBuffer } },
        { binding: 1, resource: { buffer: this.gridBufferA } },
        { binding: 2, resource: { buffer: this.paletteBuffer } },
        { binding: 3, resource: { buffer: this.materialsBuffer } },
      ],
    });

    this.reset();
  }

  static async create(canvas: HTMLCanvasElement): Promise<Simulation> {
    if (!navigator.gpu) {
      throw new WebGPUUnsupportedError();
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new WebGPUUnsupportedError();
    }
    const timestampQuerySupported = adapter.features.has('timestamp-query');
    const device = await adapter.requestDevice(
      timestampQuerySupported ? { requiredFeatures: ['timestamp-query'] } : undefined,
    );
    const context = canvas.getContext('webgpu');
    if (!context) {
      throw new WebGPUUnsupportedError();
    }
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });
    const profiler = new Profiler(device, timestampQuerySupported);
    return new Simulation(device, context, format, profiler);
  }

  getProfilerSnapshot(): ProfilerSnapshot {
    return this.profiler.snapshot();
  }

  /** Runs one animation frame: paint, then (optionally) TICKS_PER_FRAME simulation ticks, then render. */
  render(paint: PaintInput, simulate: boolean, heatMapEnabled: boolean, ambientTemp: number): void {
    // Elements whose defaultTemp is just "ambient" (Empty, Stone, Sand, Water,
    // Wood, Smoke) should be painted at whatever the current ambient setting
    // is, not the fixed 20 baked into the element table. Elements with a
    // deliberately fixed hot/cold default (Ice, Lava, Steam, Fire) keep it
    // regardless of ambient.
    const element = getElement(paint.elementId);
    const paintTemperature = element.defaultTemp === ELEMENT_AMBIENT_TEMP ? ambientTemp : element.defaultTemp;
    // Encoded CPU-side so the shaders never need to duplicate the
    // chain/latent-heat math from src/thermal.ts.
    const paintEnthalpy = enthalpyForTemperature(paintTemperature, paint.elementId);

    const paintParams = new ArrayBuffer(40);
    const paintView = new DataView(paintParams);
    paintView.setUint32(0, GRID_WIDTH, true);
    paintView.setUint32(4, GRID_HEIGHT, true);
    paintView.setFloat32(8, paint.cellX, true);
    paintView.setFloat32(12, paint.cellY, true);
    paintView.setFloat32(16, paint.radius, true);
    paintView.setUint32(20, paint.elementId, true);
    paintView.setUint32(24, paint.active ? 1 : 0, true);
    paintView.setFloat32(28, paint.flowRate, true);
    paintView.setUint32(32, this.frame, true);
    paintView.setFloat32(36, paintEnthalpy, true);
    this.device.queue.writeBuffer(this.paintParamsBuffer, 0, paintParams);

    this.device.queue.writeBuffer(
      this.renderParamsBuffer,
      0,
      new Uint32Array([GRID_WIDTH, GRID_HEIGHT, heatMapEnabled ? 1 : 0, 0]),
    );

    if (simulate) {
      // Each of the TICKS_PER_FRAME ticks needs its own params.frame value
      // (movement's Margolus alignment cycles on frame % 4), but a single
      // writeBuffer + single submit means one uniform slot would only ever
      // hold the last value written before the queue processes this
      // frame's commands. Each tick gets its own paramsStride-aligned slot
      // instead, selected via a dynamic bind group offset per dispatch
      // (see the tick loop below).
      const simParams = new ArrayBuffer(this.paramsStride * TICKS_PER_FRAME);
      const simView = new DataView(simParams);
      for (let tick = 0; tick < TICKS_PER_FRAME; tick++) {
        const slotOffset = tick * this.paramsStride;
        simView.setUint32(slotOffset + 0, GRID_WIDTH, true);
        simView.setUint32(slotOffset + 4, GRID_HEIGHT, true);
        simView.setUint32(slotOffset + 8, this.frame + tick, true);
        simView.setFloat32(slotOffset + 12, ambientTemp, true);
        simView.setUint32(slotOffset + 16, CONTACT_REACTIONS.length, true);
      }
      this.device.queue.writeBuffer(this.simParamsBuffer, 0, simParams);
    }

    const encoder = this.device.createCommandEncoder();
    const didRunComputePass = paint.active || simulate;

    if (didRunComputePass) {
      const computePassDescriptor: GPUComputePassDescriptor = {};
      const computeTimestampWrites = this.profiler.computeTimestampWrites();
      if (computeTimestampWrites) {
        computePassDescriptor.timestampWrites = computeTimestampWrites;
      }
      const pass = encoder.beginComputePass(computePassDescriptor);

      if (paint.active) {
        pass.setPipeline(this.paintPipeline);
        pass.setBindGroup(0, this.paintBindGroup);
        pass.dispatchWorkgroups(WORKGROUPS_X, WORKGROUPS_Y);
      }

      if (simulate) {
        for (let tick = 0; tick < TICKS_PER_FRAME; tick++) {
          const slotOffset = tick * this.paramsStride;
          pass.setPipeline(this.movementPipeline);
          pass.setBindGroup(0, this.movementBindGroup, [slotOffset]);
          pass.dispatchWorkgroups(WORKGROUPS_X, WORKGROUPS_Y);
          pass.setPipeline(this.heatPipeline);
          pass.setBindGroup(0, this.heatBindGroup, [slotOffset]);
          pass.dispatchWorkgroups(WORKGROUPS_X, WORKGROUPS_Y);
        }
        this.frame += TICKS_PER_FRAME;
      }

      pass.end();
    }

    const renderPassDescriptor: GPURenderPassDescriptor = {
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    };
    const renderTimestampWrites = this.profiler.renderTimestampWrites();
    if (renderTimestampWrites) {
      renderPassDescriptor.timestampWrites = renderTimestampWrites;
    }
    const renderPass = encoder.beginRenderPass(renderPassDescriptor);
    renderPass.setPipeline(this.renderPipeline);
    renderPass.setBindGroup(0, this.renderBindGroup);
    renderPass.draw(3);
    renderPass.end();

    this.profiler.resolveInto(encoder, didRunComputePass);

    const submitStart = performance.now();
    this.device.queue.submit([encoder.finish()]);
    this.profiler.recordCpuSubmitMs(performance.now() - submitStart);
  }

  reset(ambientTemp: number = AMBIENT_TEMP): void {
    const emptyEnthalpy = enthalpyForTemperature(ambientTemp, EMPTY_ID);
    const cells = new ArrayBuffer(GRID_BYTES);
    const view = new DataView(cells);
    for (let i = 0; i < CELL_COUNT; i++) {
      view.setUint32(i * CELL_BYTES, 0, true);
      view.setFloat32(i * CELL_BYTES + 4, emptyEnthalpy, true);
    }
    this.device.queue.writeBuffer(this.gridBufferA, 0, cells);
    this.device.queue.writeBuffer(this.gridBufferB, 0, cells);
    this.frame = 0;
  }
}
```

- [ ] **Step 2: Run typecheck and the unit test suite**

Run: `npm run typecheck && npm test`
Expected: both pass (no unit test file targets `simulation.ts` directly, so this mainly guards against a TS error and confirms nothing else regressed).

- [ ] **Step 3: Manual smoke check with the dev server**

Run: `npm run dev`, open the printed local URL in a browser.
Expected: the simulation renders and responds to painting exactly as before (visually — this is checked more rigorously in Task 7). No console errors. This is a quick sanity check before layering the overlay UI on top in the next tasks — full profiler-driven verification happens in Task 7 once the overlay can display numbers.

- [ ] **Step 4: Commit**

```bash
git add src/webgpu/simulation.ts
git commit -m "$(cat <<'EOF'
Wire profiler timestamps and multi-tick dispatch into Simulation

Requests the timestamp-query device feature when available, brackets
the per-frame compute/render passes for the profiler, and runs
TICKS_PER_FRAME movement+heat pairs per rendered frame using a
dynamic-offset uniform buffer slot per tick (a single writeBuffer +
submit can't otherwise give each tick its own params.frame value).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Add the `Overlay` UI component

**Files:**
- Create: `src/ui/overlay.ts`
- Modify: `src/style.css`

**Interfaces:**
- Consumes: `ProfilerSnapshot` type from `src/webgpu/profiler.ts` (Task 2).
- Produces:
  - `interface OverlaySnapshot extends ProfilerSnapshot { frameMs: number | null; gridWidth: number; gridHeight: number; ticksPerFrame: number; }`
  - `class Overlay`: `constructor(container: HTMLElement)`, `toggle(): void`, `update(snapshot: OverlaySnapshot): void`

- [ ] **Step 1: Write `src/ui/overlay.ts`**

```ts
import type { ProfilerSnapshot } from '../webgpu/profiler';

export interface OverlaySnapshot extends ProfilerSnapshot {
  frameMs: number | null;
  gridWidth: number;
  gridHeight: number;
  ticksPerFrame: number;
}

const UPDATE_INTERVAL_MS = 250;

function formatMs(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)}ms`;
}

/** Toggleable dev-facing profiling readout, positioned over the canvas by src/style.css. */
export class Overlay {
  private readonly el: HTMLDivElement;
  private visible = false;
  private lastUpdate = 0;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'profiler-overlay';
    this.el.hidden = true;
    container.appendChild(this.el);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.hidden = !this.visible;
  }

  update(snapshot: OverlaySnapshot): void {
    if (!this.visible) {
      return;
    }
    const now = performance.now();
    if (now - this.lastUpdate < UPDATE_INTERVAL_MS) {
      return;
    }
    this.lastUpdate = now;

    const fps = snapshot.frameMs && snapshot.frameMs > 0 ? Math.round(1000 / snapshot.frameMs) : null;
    this.el.textContent = [
      `GPU compute: ${formatMs(snapshot.gpuComputeMs)}`,
      `GPU render: ${formatMs(snapshot.gpuRenderMs)}`,
      `CPU submit: ${formatMs(snapshot.cpuSubmitMs)}`,
      `Frame: ${formatMs(snapshot.frameMs)}${fps !== null ? ` (${fps}fps)` : ''}`,
      `Grid: ${snapshot.gridWidth}x${snapshot.gridHeight}`,
      `Ticks/frame: ${snapshot.ticksPerFrame}`,
    ].join('\n');
  }
}
```

- [ ] **Step 2: Add overlay styling to `src/style.css`**

Modify the existing `.app` rule to add `position: relative;` (so the overlay's `position: absolute` is relative to it, not the page):

```css
.app {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 16px;
}
```

Append a new rule at the end of the file:

```css
.profiler-overlay {
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 8px 10px;
  background: rgba(0, 0, 0, 0.7);
  color: #0f0;
  font-family: ui-monospace, monospace;
  font-size: 0.75rem;
  white-space: pre;
  pointer-events: none;
  border-radius: 4px;
  z-index: 10;
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS. (No unit test for this file, matching `src/ui/toolbar.ts`'s existing precedent — no jsdom/DOM test environment is configured in this project's `vitest.config.ts`, which uses `environment: 'node'`.)

- [ ] **Step 4: Commit**

```bash
git add src/ui/overlay.ts src/style.css
git commit -m "$(cat <<'EOF'
Add toggleable profiler overlay UI component

Plain DOM readout (not GPU-rendered — it's debug text), positioned
over the canvas via CSS, throttled to ~4Hz updates. Not yet wired
into main.ts.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Wire the overlay into `main.ts`

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `Overlay` (Task 4), `Simulation.getProfilerSnapshot()` (Task 3), `TICKS_PER_FRAME` (Task 1).

- [ ] **Step 1: Replace the full contents of `src/main.ts`**

```ts
import './style.css';
import { CANVAS_HEIGHT, CANVAS_WIDTH, GRID_HEIGHT, GRID_WIDTH, TICKS_PER_FRAME } from './config';
import { PointerTracker } from './input';
import { ToolState } from './toolState';
import { Overlay } from './ui/overlay';
import { createToolbar } from './ui/toolbar';
import { Simulation, WebGPUUnsupportedError } from './webgpu/simulation';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div class="app">
    <canvas id="grid" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}"></canvas>
    <div id="toolbar"></div>
  </div>
`;

const canvas = document.querySelector<HTMLCanvasElement>('#grid')!;
const toolbarContainer = document.querySelector<HTMLDivElement>('#toolbar')!;
const appContainer = document.querySelector<HTMLDivElement>('.app')!;

async function main(): Promise<void> {
  let simulation: Simulation;
  try {
    simulation = await Simulation.create(canvas);
  } catch (error) {
    if (error instanceof WebGPUUnsupportedError) {
      app.innerHTML = `<p class="unsupported">This browser doesn't support WebGPU yet. Try a recent Chrome or Edge.</p>`;
      return;
    }
    throw error;
  }

  const toolState = new ToolState();
  const pointer = new PointerTracker(canvas, GRID_WIDTH, GRID_HEIGHT);
  const overlay = new Overlay(appContainer);
  let stepRequested = false;
  let lastFrameStart: number | null = null;

  window.addEventListener('keydown', (event) => {
    if (event.key === '`') {
      overlay.toggle();
    }
  });

  createToolbar(toolbarContainer, toolState, {
    onStep: () => {
      stepRequested = true;
    },
    onReset: () => {
      simulation.reset(toolState.ambientTemp);
    },
  });

  function frame(): void {
    const frameStart = performance.now();
    const frameMs = lastFrameStart === null ? null : frameStart - lastFrameStart;
    lastFrameStart = frameStart;

    const cell = pointer.cell;
    const simulate = !toolState.paused || stepRequested;
    simulation.render(
      {
        active: pointer.isDown,
        cellX: cell.x,
        cellY: cell.y,
        radius: toolState.brushSize,
        elementId: toolState.selectedElementId,
        flowRate: toolState.flowRate,
      },
      simulate,
      toolState.heatMapEnabled,
      toolState.ambientTemp,
    );
    stepRequested = false;

    overlay.update({
      ...simulation.getProfilerSnapshot(),
      frameMs,
      gridWidth: GRID_WIDTH,
      gridHeight: GRID_HEIGHT,
      ticksPerFrame: TICKS_PER_FRAME,
    });

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

void main();
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Manual smoke check**

Run: `npm run dev`, open the app in a browser, press backtick.
Expected: a small dark readout box appears in the top-left corner of the canvas showing GPU compute/render, CPU submit, frame time/fps, grid size, and ticks/frame, updating a few times per second. Press backtick again to confirm it hides. Leave this browser tab open — Task 7 uses it to record baseline numbers.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "$(cat <<'EOF'
Wire profiler overlay into main.ts, toggled with backtick

Measures CPU frame time via performance.now() deltas between rAF
callbacks and feeds it plus the Simulation's profiler snapshot into
the Overlay each frame.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Add e2e coverage for the overlay toggle

**Files:**
- Modify: `e2e/smoke.spec.ts`

- [ ] **Step 1: Add a new test to `e2e/smoke.spec.ts`**

Append this test after the existing one (keep the existing `test('app loads...')` block unchanged):

```ts
test('backtick toggles the profiler overlay', async ({ page }) => {
  await page.goto('/');

  const canvas = page.locator('canvas#grid');
  const unsupported = page.locator('.unsupported');
  await expect(canvas.or(unsupported)).toBeVisible();
  if (!(await canvas.isVisible())) {
    test.skip();
  }

  const overlay = page.locator('.profiler-overlay');
  await expect(overlay).toBeHidden();

  await page.keyboard.press('`');
  await expect(overlay).toBeVisible();

  await page.keyboard.press('`');
  await expect(overlay).toBeHidden();
});
```

- [ ] **Step 2: Run the e2e suite**

Run: `npm run test:e2e`
Expected: both tests in `e2e/smoke.spec.ts` PASS. If the environment has no reachable GPU adapter, `canvas` won't be visible and this new test calls `test.skip()` — same graceful-degradation pattern the existing test already uses.

- [ ] **Step 3: Commit**

```bash
git add e2e/smoke.spec.ts
git commit -m "$(cat <<'EOF'
Add e2e coverage for the profiler overlay toggle

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Record baseline GPU headroom numbers

**Files:**
- Modify: `docs/superpowers/specs/2026-07-07-gpu-profiling-and-scaleup-design.md`

- [ ] **Step 1: Gather a real reading**

Run: `npm run dev`, open the app, press backtick to show the overlay, leave the simulation running (unpaused) for a few seconds so the numbers settle, and paint a few strokes to exercise the paint pass too. Note the displayed GPU compute, GPU render, and CPU submit values, plus whether GPU timestamps were supported on the test machine's browser/adapter.

- [ ] **Step 2: Append a "Baseline (measured)" section to the design doc**

Add this section at the end of `docs/superpowers/specs/2026-07-07-gpu-profiling-and-scaleup-design.md`, filled in with the actual numbers observed in Step 1 (replace the bracketed placeholders with real values — do not leave them as placeholders in the committed file):

```markdown
## Baseline (measured)

Measured via the overlay at 1280x720 / 3 ticks-per-frame, in [browser name
and version] on [OS]:

- GPU compute: [X]ms
- GPU render: [Y]ms
- CPU submit: [Z]ms
- Frame time / fps: [F]ms ([N]fps)
- Remaining headroom against the 16.6ms (60fps) budget: [~R]ms

Timestamp-query support: [supported | unsupported, CPU-only numbers shown].
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-07-07-gpu-profiling-and-scaleup-design.md
git commit -m "$(cat <<'EOF'
Record measured GPU headroom baseline at 1280x720 / 3 ticks-per-frame

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
