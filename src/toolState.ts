import { getElement, getElementByName } from './elements';

export const MIN_BRUSH_SIZE = 1;
export const MAX_BRUSH_SIZE = 20;
const DEFAULT_BRUSH_SIZE = 4;

export const MIN_FLOW_RATE = 0;
export const MAX_FLOW_RATE = 1;
const DEFAULT_FLOW_RATE = 0.35;

export const MIN_AMBIENT_TEMP = -50;
export const MAX_AMBIENT_TEMP = 150;
const DEFAULT_AMBIENT_TEMP = 20;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export class ToolState {
  selectedElementId: number = getElementByName('Sand').id;
  brushSize: number = DEFAULT_BRUSH_SIZE;
  flowRate: number = DEFAULT_FLOW_RATE;
  paused: boolean = false;
  heatMapEnabled: boolean = false;
  ambientTemp: number = DEFAULT_AMBIENT_TEMP;

  selectElement(id: number): void {
    getElement(id); // throws if unknown
    this.selectedElementId = id;
  }

  setBrushSize(size: number): void {
    this.brushSize = clamp(Math.round(size), MIN_BRUSH_SIZE, MAX_BRUSH_SIZE);
  }

  setFlowRate(rate: number): void {
    this.flowRate = clamp(rate, MIN_FLOW_RATE, MAX_FLOW_RATE);
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  togglePause(): void {
    this.paused = !this.paused;
  }

  toggleHeatMap(): void {
    this.heatMapEnabled = !this.heatMapEnabled;
  }

  setAmbientTemp(temp: number): void {
    this.ambientTemp = clamp(temp, MIN_AMBIENT_TEMP, MAX_AMBIENT_TEMP);
  }
}
