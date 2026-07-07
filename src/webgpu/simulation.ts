import { GRID_HEIGHT, GRID_WIDTH, WORKGROUP_SIZE } from '../config';
import { colorPalette, ELEMENTS } from '../elements';
import paintShaderCode from '../shaders/paint.wgsl?raw';
import renderShaderCode from '../shaders/render.wgsl?raw';
import simulateShaderCode from '../shaders/simulate.wgsl?raw';

const CELL_COUNT = GRID_WIDTH * GRID_HEIGHT;
const GRID_BYTES = CELL_COUNT * 4;
const WORKGROUPS_X = Math.ceil(GRID_WIDTH / WORKGROUP_SIZE);
const WORKGROUPS_Y = Math.ceil(GRID_HEIGHT / WORKGROUP_SIZE);

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

  private readonly gridBufferA: GPUBuffer;
  private readonly gridBufferB: GPUBuffer;
  private readonly paletteBuffer: GPUBuffer;
  private readonly simParamsBuffer: GPUBuffer;
  private readonly paintParamsBuffer: GPUBuffer;
  private readonly renderParamsBuffer: GPUBuffer;

  private readonly simBindGroupAtoB: GPUBindGroup;
  private readonly simBindGroupBtoA: GPUBindGroup;
  private readonly paintBindGroupA: GPUBindGroup;
  private readonly paintBindGroupB: GPUBindGroup;
  private readonly renderBindGroupA: GPUBindGroup;
  private readonly renderBindGroupB: GPUBindGroup;

  private readonly simulatePipeline: GPUComputePipeline;
  private readonly paintPipeline: GPUComputePipeline;
  private readonly renderPipeline: GPURenderPipeline;

  private current: 'A' | 'B' = 'A';
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

    this.simParamsBuffer = device.createBuffer({
      label: 'sim-params',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.paintParamsBuffer = device.createBuffer({
      label: 'paint-params',
      size: 36,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.renderParamsBuffer = device.createBuffer({
      label: 'render-params',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.renderParamsBuffer, 0, new Uint32Array([GRID_WIDTH, GRID_HEIGHT, 0, 0]));

    const simModule = device.createShaderModule({ label: 'simulate', code: simulateShaderCode });
    const paintModule = device.createShaderModule({ label: 'paint', code: paintShaderCode });
    const renderModule = device.createShaderModule({ label: 'render', code: renderShaderCode });

    const simBindGroupLayout = device.createBindGroupLayout({
      label: 'sim-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
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
      ],
    });

    const simPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [simBindGroupLayout] });
    const paintPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [paintBindGroupLayout] });
    const renderPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [renderBindGroupLayout] });

    this.simulatePipeline = device.createComputePipeline({
      layout: simPipelineLayout,
      compute: { module: simModule, entryPoint: 'simulate' },
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

    this.simBindGroupAtoB = device.createBindGroup({
      layout: simBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.simParamsBuffer } },
        { binding: 1, resource: { buffer: this.gridBufferA } },
        { binding: 2, resource: { buffer: this.gridBufferB } },
      ],
    });
    this.simBindGroupBtoA = device.createBindGroup({
      layout: simBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.simParamsBuffer } },
        { binding: 1, resource: { buffer: this.gridBufferB } },
        { binding: 2, resource: { buffer: this.gridBufferA } },
      ],
    });
    this.paintBindGroupA = device.createBindGroup({
      layout: paintBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.paintParamsBuffer } },
        { binding: 1, resource: { buffer: this.gridBufferA } },
      ],
    });
    this.paintBindGroupB = device.createBindGroup({
      layout: paintBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.paintParamsBuffer } },
        { binding: 1, resource: { buffer: this.gridBufferB } },
      ],
    });
    this.renderBindGroupA = device.createBindGroup({
      layout: renderBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.renderParamsBuffer } },
        { binding: 1, resource: { buffer: this.gridBufferA } },
        { binding: 2, resource: { buffer: this.paletteBuffer } },
      ],
    });
    this.renderBindGroupB = device.createBindGroup({
      layout: renderBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.renderParamsBuffer } },
        { binding: 1, resource: { buffer: this.gridBufferB } },
        { binding: 2, resource: { buffer: this.paletteBuffer } },
      ],
    });
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
  render(paint: PaintInput, simulate: boolean): void {
    const currentPaintBindGroup = this.current === 'A' ? this.paintBindGroupA : this.paintBindGroupB;

    const paintParams = new ArrayBuffer(36);
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
    this.device.queue.writeBuffer(this.paintParamsBuffer, 0, paintParams);

    const encoder = this.device.createCommandEncoder();

    if (paint.active) {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.paintPipeline);
      pass.setBindGroup(0, currentPaintBindGroup);
      pass.dispatchWorkgroups(WORKGROUPS_X, WORKGROUPS_Y);
      pass.end();
    }

    if (simulate) {
      this.device.queue.writeBuffer(this.simParamsBuffer, 0, new Uint32Array([GRID_WIDTH, GRID_HEIGHT, this.frame, 0]));

      const bindGroup = this.current === 'A' ? this.simBindGroupAtoB : this.simBindGroupBtoA;
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.simulatePipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(WORKGROUPS_X, WORKGROUPS_Y);
      pass.end();

      this.current = this.current === 'A' ? 'B' : 'A';
      this.frame++;
    }

    const renderBindGroup = this.current === 'A' ? this.renderBindGroupA : this.renderBindGroupB;
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
    renderPass.setBindGroup(0, renderBindGroup);
    renderPass.draw(3);
    renderPass.end();

    this.device.queue.submit([encoder.finish()]);
  }

  reset(): void {
    const zeros = new Uint32Array(CELL_COUNT);
    this.device.queue.writeBuffer(this.gridBufferA, 0, zeros);
    this.device.queue.writeBuffer(this.gridBufferB, 0, zeros);
    this.current = 'A';
    this.frame = 0;
  }
}
