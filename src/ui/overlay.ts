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
      `Grid: ${snapshot.gridWidth}x${snapshot.gridHeight} (${snapshot.gridWidth * snapshot.gridHeight} cells)`,
      `Ticks/frame: ${snapshot.ticksPerFrame}`,
    ].join('\n');
  }
}
