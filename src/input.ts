import { pixelToCell } from './coords';

export class PointerTracker {
  private down = false;
  private cellX = 0;
  private cellY = 0;

  constructor(canvas: HTMLCanvasElement, gridWidth: number, gridHeight: number) {
    const updateFromEvent = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const pixelX = event.clientX - rect.left;
      const pixelY = event.clientY - rect.top;
      const cell = pixelToCell(pixelX, pixelY, rect.width, rect.height, gridWidth, gridHeight);
      this.cellX = cell.x;
      this.cellY = cell.y;
    };

    canvas.addEventListener('pointerdown', (event) => {
      this.down = true;
      updateFromEvent(event);
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', updateFromEvent);
    canvas.addEventListener('pointerup', () => {
      this.down = false;
    });
    canvas.addEventListener('pointercancel', () => {
      this.down = false;
    });
  }

  get isDown(): boolean {
    return this.down;
  }

  get cell(): { x: number; y: number } {
    return { x: this.cellX, y: this.cellY };
  }
}
