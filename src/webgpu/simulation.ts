import { GRID_HEIGHT, GRID_WIDTH, WORKGROUP_SIZE } from '../config';
import { AMBIENT_TEMP as ELEMENT_AMBIENT_TEMP, colorPalette, ELEMENTS, getElement, materialProperties } from '../elements';
import paintShaderCode from '../shaders/paint.wgsl?raw';
import renderShaderCode from '../shaders/render.wgsl?raw';
import simulateShaderCode from '../shaders/simulate.wgsl?raw';
import { enthalpyForTemperature } from '../thermal';

const CELL_COUNT = GRID_WIDTH * GRID_HEIGHT;
const CELL_BYTES = 8; // Cell{elementId: u32, enthalpy: f32}
const GRID_BYTES = CELL_COUNT * CELL_BYTES;
const WORKGROUPS_X = Math.ceil(GRID_WIDTH / WORKGROUP_SIZE);
const WORKGROUPS_Y = Math.ceil(GRID_HEIGHT / WORKGROUP_SIZE);
const AMBIENT_TEMP = 20;
const EMPTY_ID = 0;

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

  // Buffer A is the single source of truth outside a tick: paint writes
  // into it directly, and render always reads from it. Buffer B is scratch
  // space the two simulation passes round-trip through each tick
  // (A -> movement -> B -> heat -> A), so no ping-pong flag is needed.
  private readonly gridBufferA: GPUBuffer;
  private readonly gridBufferB: GPUBuffer;
  private readonly paletteBuffer: GPUBuffer;
  private readonly materialsBuffer: GPUBuffer;
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

  private constructor(device: GPUDevice, context: GPUCanvasContext, format: GPUTextureFormat) {
    this.device = device;
    this.context = context;

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

    this.simParamsBuffer = device.createBuffer({
      label: 'sim-params',
      size: 16,
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
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
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
        { binding: 0, resource: { buffer: this.simParamsBuffer } },
        { binding: 1, resource: { buffer: this.gridBufferA } },
        { binding: 2, resource: { buffer: this.gridBufferB } },
        { binding: 3, resource: { buffer: this.materialsBuffer } },
      ],
    });
    this.heatBindGroup = device.createBindGroup({
      layout: simBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.simParamsBuffer } },
        { binding: 1, resource: { buffer: this.gridBufferB } },
        { binding: 2, resource: { buffer: this.gridBufferA } },
        { binding: 3, resource: { buffer: this.materialsBuffer } },
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
    const device = await adapter.requestDevice();
    const context = canvas.getContext('webgpu');
    if (!context) {
      throw new WebGPUUnsupportedError();
    }
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });
    return new Simulation(device, context, format);
  }

  /** Runs one animation frame: paint, then (optionally) one simulation tick, then render. */
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

    const encoder = this.device.createCommandEncoder();

    if (paint.active) {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.paintPipeline);
      pass.setBindGroup(0, this.paintBindGroup);
      pass.dispatchWorkgroups(WORKGROUPS_X, WORKGROUPS_Y);
      pass.end();
    }

    if (simulate) {
      const simParams = new ArrayBuffer(16);
      const simView = new DataView(simParams);
      simView.setUint32(0, GRID_WIDTH, true);
      simView.setUint32(4, GRID_HEIGHT, true);
      simView.setUint32(8, this.frame, true);
      simView.setFloat32(12, ambientTemp, true);
      this.device.queue.writeBuffer(this.simParamsBuffer, 0, simParams);

      const pass = encoder.beginComputePass();
      pass.setPipeline(this.movementPipeline);
      pass.setBindGroup(0, this.movementBindGroup);
      pass.dispatchWorkgroups(WORKGROUPS_X, WORKGROUPS_Y);
      pass.setPipeline(this.heatPipeline);
      pass.setBindGroup(0, this.heatBindGroup);
      pass.dispatchWorkgroups(WORKGROUPS_X, WORKGROUPS_Y);
      pass.end();

      this.frame++;
    }

    const renderPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    });
    renderPass.setPipeline(this.renderPipeline);
    renderPass.setBindGroup(0, this.renderBindGroup);
    renderPass.draw(3);
    renderPass.end();

    this.device.queue.submit([encoder.finish()]);
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
