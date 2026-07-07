import { describe, expect, it } from 'vitest';
import { pixelToCell } from './coords';

const GRID = { width: 320, height: 180 };
const CANVAS = { width: 1280, height: 720 }; // 4x scale in both axes

describe('pixelToCell', () => {
  it('maps the top-left canvas pixel to cell (0, 0)', () => {
    expect(pixelToCell(0, 0, CANVAS.width, CANVAS.height, GRID.width, GRID.height)).toEqual({
      x: 0,
      y: 0,
    });
  });

  it('scales pixel coordinates down to grid resolution', () => {
    // pixel (8, 4) is 4x canvas-to-grid scale -> cell (2, 1)
    expect(pixelToCell(8, 4, CANVAS.width, CANVAS.height, GRID.width, GRID.height)).toEqual({
      x: 2,
      y: 1,
    });
  });

  it('maps the bottom-right-most pixel to the last valid cell, not one past it', () => {
    expect(
      pixelToCell(CANVAS.width - 1, CANVAS.height - 1, CANVAS.width, CANVAS.height, GRID.width, GRID.height),
    ).toEqual({ x: GRID.width - 1, y: GRID.height - 1 });
  });

  it('clamps negative pixel coordinates to the grid edge', () => {
    expect(pixelToCell(-50, -50, CANVAS.width, CANVAS.height, GRID.width, GRID.height)).toEqual({
      x: 0,
      y: 0,
    });
  });

  it('clamps out-of-bounds pixel coordinates past the canvas edge', () => {
    expect(
      pixelToCell(CANVAS.width + 100, CANVAS.height + 100, CANVAS.width, CANVAS.height, GRID.width, GRID.height),
    ).toEqual({ x: GRID.width - 1, y: GRID.height - 1 });
  });
});
