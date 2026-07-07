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
