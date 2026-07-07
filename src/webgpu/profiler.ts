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
