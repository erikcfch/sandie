import { GRID_HEIGHT, GRID_WIDTH, TICKS_PER_FRAME, WORKGROUP_SIZE } from '../config';
import { AMBIENT_TEMP as ELEMENT_AMBIENT_TEMP, colorPalette, getElement, materialProperties } from '../elements';
import { CONTACT_REACTIONS, reactionData } from '../reactions';
import paintShaderCode from '../shaders/paint.wgsl?raw';
import renderShaderCode from '../shaders/render.wgsl?raw';
import simulateShaderCode from '../shaders/simulate.wgsl?raw';
import { enthalpyForTemperature } from '../thermal';
import { THRESHOLD_REACTIONS, thresholdReactionData } from '../thresholdReactions';
import { Profiler, type ProfilerSnapshot } from './profiler';

const CELL_COUNT = GRID_WIDTH * GRID_HEIGHT;
const CELL_BYTES = 8; // Cell{elementId: u32, enthalpy: f32}
const GRID_BYTES = CELL_COUNT * CELL_BYTES;
const WORKGROUPS_X = Math.ceil(GRID_WIDTH / WORKGROUP_SIZE);
const WORKGROUPS_Y = Math.ceil(GRID_HEIGHT / WORKGROUP_SIZE);
const AMBIENT_TEMP = 20;
const EMPTY_ID = 0;
const SIM_PARAMS_BYTES = 24; // SimParams{width, height, frame, ambientTemp, reactionCount, thresholdReactionCount}

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
  private readonly thresholdReactionsBuffer: GPUBuffer;
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

  /** Creates a STORAGE|COPY_DST buffer sized to `data` and uploads it immediately. */
  private createStorageBuffer(label: string, data: Float32Array): GPUBuffer {
    const buffer = this.device.createBuffer({
      label,
      size: data.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  }

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

    this.paletteBuffer = this.createStorageBuffer('palette', colorPalette());
    this.materialsBuffer = this.createStorageBuffer('materials', materialProperties());
    this.reactionsBuffer = this.createStorageBuffer('reactions', reactionData());
    this.thresholdReactionsBuffer = this.createStorageBuffer('threshold-reactions', thresholdReactionData());

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
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
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
        { binding: 5, resource: { buffer: this.thresholdReactionsBuffer } },
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
        { binding: 5, resource: { buffer: this.thresholdReactionsBuffer } },
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
        simView.setUint32(slotOffset + 20, THRESHOLD_REACTIONS.length, true);
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

    this.profiler.recordResolve(encoder, didRunComputePass);

    const submitStart = performance.now();
    this.device.queue.submit([encoder.finish()]);
    this.profiler.recordCpuSubmitMs(performance.now() - submitStart);
    this.profiler.startReadback();
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
