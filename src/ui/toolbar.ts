import { ELEMENTS } from '../elements';
import { MAX_BRUSH_SIZE, MAX_FLOW_RATE, MIN_BRUSH_SIZE, MIN_FLOW_RATE, ToolState } from '../toolState';

export interface ToolbarCallbacks {
  onStep: () => void;
  onReset: () => void;
}

export function createToolbar(container: HTMLElement, toolState: ToolState, callbacks: ToolbarCallbacks): void {
  container.innerHTML = '';
  container.className = 'toolbar';

  const elementPicker = document.createElement('div');
  elementPicker.className = 'element-picker';
  const elementButtons = new Map<number, HTMLButtonElement>();

  for (const element of ELEMENTS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = element.name === 'Empty' ? 'Eraser' : element.name;
    button.style.setProperty('--swatch', `rgb(${element.color[0]}, ${element.color[1]}, ${element.color[2]})`);
    button.addEventListener('click', () => {
      toolState.selectElement(element.id);
      updateSelectedButton();
    });
    elementButtons.set(element.id, button);
    elementPicker.appendChild(button);
  }

  function updateSelectedButton(): void {
    for (const [id, button] of elementButtons) {
      button.classList.toggle('selected', id === toolState.selectedElementId);
    }
  }
  updateSelectedButton();

  const brushLabel = document.createElement('label');
  brushLabel.className = 'brush-size';
  brushLabel.textContent = 'Brush size';
  const brushSlider = document.createElement('input');
  brushSlider.type = 'range';
  brushSlider.min = String(MIN_BRUSH_SIZE);
  brushSlider.max = String(MAX_BRUSH_SIZE);
  brushSlider.value = String(toolState.brushSize);
  brushSlider.addEventListener('input', () => {
    toolState.setBrushSize(Number(brushSlider.value));
  });
  brushLabel.appendChild(brushSlider);

  const flowLabel = document.createElement('label');
  flowLabel.className = 'flow-rate';
  flowLabel.textContent = 'Flow rate';
  const flowSlider = document.createElement('input');
  flowSlider.type = 'range';
  flowSlider.min = String(MIN_FLOW_RATE);
  flowSlider.max = String(MAX_FLOW_RATE);
  flowSlider.step = '0.01';
  flowSlider.value = String(toolState.flowRate);
  flowSlider.addEventListener('input', () => {
    toolState.setFlowRate(Number(flowSlider.value));
  });
  flowLabel.appendChild(flowSlider);

  const controls = document.createElement('div');
  controls.className = 'controls';

  const pauseButton = document.createElement('button');
  pauseButton.type = 'button';
  const updatePauseLabel = () => {
    pauseButton.textContent = toolState.paused ? 'Resume' : 'Pause';
  };
  updatePauseLabel();
  pauseButton.addEventListener('click', () => {
    toolState.togglePause();
    updatePauseLabel();
  });

  const stepButton = document.createElement('button');
  stepButton.type = 'button';
  stepButton.textContent = 'Step';
  stepButton.addEventListener('click', () => callbacks.onStep());

  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.textContent = 'Reset';
  resetButton.addEventListener('click', () => callbacks.onReset());

  controls.append(pauseButton, stepButton, resetButton);
  container.append(elementPicker, brushLabel, flowLabel, controls);
}
