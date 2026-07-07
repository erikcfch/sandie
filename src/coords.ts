export interface Cell {
  x: number;
  y: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function pixelToCell(
  pixelX: number,
  pixelY: number,
  canvasWidth: number,
  canvasHeight: number,
  gridWidth: number,
  gridHeight: number,
): Cell {
  const cellX = Math.floor((pixelX / canvasWidth) * gridWidth);
  const cellY = Math.floor((pixelY / canvasHeight) * gridHeight);
  return {
    x: clamp(cellX, 0, gridWidth - 1),
    y: clamp(cellY, 0, gridHeight - 1),
  };
}
