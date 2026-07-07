import { describe, expect, it } from 'vitest';
import { ELEMENTS, colorPalette, getElement, getElementByName } from './elements';

describe('ELEMENTS table', () => {
  it('assigns each element a unique, contiguous id starting at 0', () => {
    const ids = ELEMENTS.map((e) => e.id).sort((a, b) => a - b);
    expect(ids).toEqual(ELEMENTS.map((_, i) => i));
  });

  it('gives Empty the "empty" category and zero density', () => {
    const empty = getElementByName('Empty');
    expect(empty.category).toBe('empty');
    expect(empty.density).toBe(0);
  });

  it('categorizes Stone and Wood as static solids', () => {
    expect(getElementByName('Stone').category).toBe('static');
    expect(getElementByName('Wood').category).toBe('static');
  });

  it('categorizes Sand as a powder', () => {
    expect(getElementByName('Sand').category).toBe('powder');
  });

  it('categorizes Water as a liquid', () => {
    expect(getElementByName('Water').category).toBe('liquid');
  });

  it('categorizes Smoke as a gas', () => {
    expect(getElementByName('Smoke').category).toBe('gas');
  });

  it('gives Sand a higher density than Water, so sand sinks through water', () => {
    expect(getElementByName('Sand').density).toBeGreaterThan(getElementByName('Water').density);
  });

  it('gives Water a higher density than Smoke, so smoke rises through water-adjacent air', () => {
    expect(getElementByName('Water').density).toBeGreaterThan(getElementByName('Smoke').density);
  });
});

describe('getElement', () => {
  it('returns the element definition for a known id', () => {
    const sand = getElementByName('Sand');
    expect(getElement(sand.id)).toEqual(sand);
  });

  it('throws for an id outside the table', () => {
    expect(() => getElement(999)).toThrow(/unknown element id/i);
  });
});

describe('getElementByName', () => {
  it('throws for an unknown name', () => {
    expect(() => getElementByName('Plutonium')).toThrow(/unknown element name/i);
  });
});

describe('colorPalette', () => {
  it('returns 4 normalized floats (rgba) per element, indexed by element id', () => {
    const palette = colorPalette();
    expect(palette).toBeInstanceOf(Float32Array);
    expect(palette.length).toBe(ELEMENTS.length * 4);
  });

  it('normalizes each channel into the 0-1 range', () => {
    const palette = colorPalette();
    for (const channel of palette) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(1);
    }
  });

  it('places each element color at its id offset', () => {
    const sand = getElementByName('Sand');
    const palette = colorPalette();
    const offset = sand.id * 4;
    expect(palette[offset]).toBeCloseTo(sand.color[0] / 255);
    expect(palette[offset + 1]).toBeCloseTo(sand.color[1] / 255);
    expect(palette[offset + 2]).toBeCloseTo(sand.color[2] / 255);
    expect(palette[offset + 3]).toBeCloseTo(1);
  });
});
