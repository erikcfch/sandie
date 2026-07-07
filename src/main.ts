import './style.css';
import { CANVAS_HEIGHT, CANVAS_WIDTH, GRID_HEIGHT, GRID_WIDTH } from './config';
import { PointerTracker } from './input';
import { ToolState } from './toolState';
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
  let stepRequested = false;

  createToolbar(toolbarContainer, toolState, {
    onStep: () => {
      stepRequested = true;
    },
    onReset: () => {
      simulation.reset();
    },
  });

  function frame(): void {
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
    );
    stepRequested = false;
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

void main();
