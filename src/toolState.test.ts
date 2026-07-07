import { describe, expect, it } from 'vitest';
import { getElementByName } from './elements';
import { MAX_BRUSH_SIZE, MAX_FLOW_RATE, MIN_BRUSH_SIZE, MIN_FLOW_RATE, ToolState } from './toolState';

describe('ToolState defaults', () => {
  it('starts with Sand selected, a mid-size brush, unpaused, and a partial flow rate', () => {
    const state = new ToolState();
    expect(state.selectedElementId).toBe(getElementByName('Sand').id);
    expect(state.brushSize).toBeGreaterThanOrEqual(MIN_BRUSH_SIZE);
    expect(state.brushSize).toBeLessThanOrEqual(MAX_BRUSH_SIZE);
    expect(state.paused).toBe(false);
    expect(state.flowRate).toBeGreaterThan(MIN_FLOW_RATE);
    expect(state.flowRate).toBeLessThanOrEqual(MAX_FLOW_RATE);
  });
});

describe('selectElement', () => {
  it('changes the selected element id', () => {
    const state = new ToolState();
    state.selectElement(getElementByName('Water').id);
    expect(state.selectedElementId).toBe(getElementByName('Water').id);
  });

  it('allows selecting Empty to act as an eraser', () => {
    const state = new ToolState();
    state.selectElement(getElementByName('Empty').id);
    expect(state.selectedElementId).toBe(getElementByName('Empty').id);
  });

  it('throws when selecting an id with no matching element', () => {
    const state = new ToolState();
    expect(() => state.selectElement(999)).toThrow(/unknown element id/i);
  });
});

describe('setBrushSize', () => {
  it('sets the brush size within the valid range', () => {
    const state = new ToolState();
    state.setBrushSize(10);
    expect(state.brushSize).toBe(10);
  });

  it('clamps sizes below the minimum up to the minimum', () => {
    const state = new ToolState();
    state.setBrushSize(-5);
    expect(state.brushSize).toBe(MIN_BRUSH_SIZE);
  });

  it('clamps sizes above the maximum down to the maximum', () => {
    const state = new ToolState();
    state.setBrushSize(999);
    expect(state.brushSize).toBe(MAX_BRUSH_SIZE);
  });

  it('rounds fractional sizes to the nearest whole cell', () => {
    const state = new ToolState();
    state.setBrushSize(5.6);
    expect(state.brushSize).toBe(6);
  });
});

describe('setFlowRate', () => {
  it('sets the flow rate within the valid range', () => {
    const state = new ToolState();
    state.setFlowRate(0.5);
    expect(state.flowRate).toBe(0.5);
  });

  it('clamps rates below the minimum up to the minimum', () => {
    const state = new ToolState();
    state.setFlowRate(-1);
    expect(state.flowRate).toBe(MIN_FLOW_RATE);
  });

  it('clamps rates above the maximum down to the maximum', () => {
    const state = new ToolState();
    state.setFlowRate(5);
    expect(state.flowRate).toBe(MAX_FLOW_RATE);
  });
});

describe('pause/resume/togglePause', () => {
  it('pauses and resumes explicitly', () => {
    const state = new ToolState();
    state.pause();
    expect(state.paused).toBe(true);
    state.resume();
    expect(state.paused).toBe(false);
  });

  it('toggles pause state', () => {
    const state = new ToolState();
    state.togglePause();
    expect(state.paused).toBe(true);
    state.togglePause();
    expect(state.paused).toBe(false);
  });
});
