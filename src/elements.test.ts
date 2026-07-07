import { describe, expect, it } from 'vitest';
import { ELEMENTS, colorPalette, getElement, getElementByName, materialProperties } from './elements';

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

  it('categorizes Ice as static, Lava as liquid, and Steam/Fire as gas', () => {
    expect(getElementByName('Ice').category).toBe('static');
    expect(getElementByName('Lava').category).toBe('liquid');
    expect(getElementByName('Steam').category).toBe('gas');
    expect(getElementByName('Fire').category).toBe('gas');
  });

  it('gives Lava a density between Sand and Water, so sand sinks through lava and lava sinks below water', () => {
    expect(getElementByName('Lava').density).toBeLessThan(getElementByName('Sand').density);
    expect(getElementByName('Lava').density).toBeGreaterThan(getElementByName('Water').density);
  });

  it('gives every element a defaultTemp', () => {
    for (const element of ELEMENTS) {
      expect(typeof element.defaultTemp).toBe('number');
    }
  });

  it('gives Phase 1 elements an ambient defaultTemp of 20', () => {
    for (const name of ['Empty', 'Stone', 'Sand', 'Water', 'Wood', 'Smoke']) {
      expect(getElementByName(name).defaultTemp).toBe(20);
    }
  });

  it('gives Ice a defaultTemp below its own 0-degree melt point, so ambient drift does not melt it on the very next tick', () => {
    expect(getElementByName('Ice').defaultTemp).toBeLessThan(0);
  });

  it('gives Lava a molten defaultTemp of 800', () => {
    expect(getElementByName('Lava').defaultTemp).toBe(800);
  });

  it('gives Steam a defaultTemp above the 100 boiling point', () => {
    expect(getElementByName('Steam').defaultTemp).toBeGreaterThan(100);
  });

  it('gives Fire a defaultTemp above the 300 wood-ignition point', () => {
    expect(getElementByName('Fire').defaultTemp).toBeGreaterThan(300);
  });

  it('gives Ice a density high enough to block powder/liquid, like Stone/Wood', () => {
    expect(getElementByName('Ice').density).toBeGreaterThan(getElementByName('Sand').density);
  });

  it('gives every element a positive thermalConductivity and heatCapacity', () => {
    for (const element of ELEMENTS) {
      expect(element.thermalConductivity).toBeGreaterThan(0);
      expect(element.heatCapacity).toBeGreaterThan(0);
    }
  });

  it('gives Water a much higher heatCapacity than Stone, so it acts as a thermal buffer/coolant', () => {
    expect(getElementByName('Water').heatCapacity).toBeGreaterThan(getElementByName('Stone').heatCapacity * 2);
  });

  it('gives Wood a lower thermalConductivity than Stone, so it insulates', () => {
    expect(getElementByName('Wood').thermalConductivity).toBeLessThan(getElementByName('Stone').thermalConductivity);
  });

  it('categorizes Obsidian as a static solid sharing Stone\'s thermal properties', () => {
    const obsidian = getElementByName('Obsidian');
    const stone = getElementByName('Stone');
    expect(obsidian.category).toBe('static');
    expect(obsidian.heatCapacity).toBe(stone.heatCapacity);
    expect(obsidian.thermalConductivity).toBe(stone.thermalConductivity);
  });

  it('assigns family "physical" to every Phase 1-4 element', () => {
    for (const name of ['Empty', 'Stone', 'Sand', 'Water', 'Wood', 'Smoke', 'Ice', 'Lava', 'Steam', 'Fire', 'Obsidian']) {
      expect(getElementByName(name).family).toBe('physical');
    }
  });

  it('leaves formula unset for physical elements', () => {
    for (const name of ['Empty', 'Stone', 'Sand', 'Water', 'Wood', 'Smoke', 'Ice', 'Lava', 'Steam', 'Fire', 'Obsidian']) {
      expect(getElementByName(name).formula).toBeUndefined();
    }
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

describe('materialProperties', () => {
  it('returns 4 floats (density, thermalConductivity, heatCapacity, unused) per element, indexed by element id', () => {
    const props = materialProperties();
    expect(props).toBeInstanceOf(Float32Array);
    expect(props.length).toBe(ELEMENTS.length * 4);
  });

  it('places each element density, thermalConductivity, and heatCapacity at its id offset', () => {
    const water = getElementByName('Water');
    const props = materialProperties();
    const offset = water.id * 4;
    expect(props[offset]).toBeCloseTo(water.density);
    expect(props[offset + 1]).toBeCloseTo(water.thermalConductivity);
    expect(props[offset + 2]).toBeCloseTo(water.heatCapacity);
  });
});

describe('Chem elements', () => {
  it('assigns family "chem" and a formula to each new Chem element', () => {
    for (const name of [
      'Sulfuric Acid (Very Dilute)',
      'Sulfuric Acid (Dilute)',
      'Sulfuric Acid (Concentrated)',
      'Sulfuric Acid (Fuming)',
      'Copper',
      'Copper Sulfate',
      'Hydrogen',
      'Sulfur Dioxide',
    ]) {
      const element = getElementByName(name);
      expect(element.family).toBe('chem');
      expect(element.formula).toBeTruthy();
    }
  });

  it('categorizes all 4 acid tiers as liquid, Copper as static, Copper Sulfate as a powder, and Hydrogen/Sulfur Dioxide as gas', () => {
    for (const name of [
      'Sulfuric Acid (Very Dilute)',
      'Sulfuric Acid (Dilute)',
      'Sulfuric Acid (Concentrated)',
      'Sulfuric Acid (Fuming)',
    ]) {
      expect(getElementByName(name).category).toBe('liquid');
    }
    expect(getElementByName('Copper').category).toBe('static');
    expect(getElementByName('Copper Sulfate').category).toBe('powder');
    expect(getElementByName('Hydrogen').category).toBe('gas');
    expect(getElementByName('Sulfur Dioxide').category).toBe('gas');
  });

  it('gives Dilute Sulfuric Acid a density between Water and Lava', () => {
    const acid = getElementByName('Sulfuric Acid (Dilute)');
    expect(acid.density).toBeGreaterThan(getElementByName('Water').density);
    expect(acid.density).toBeLessThan(getElementByName('Lava').density);
  });

  it('increases acid density with concentration: Very Dilute < Dilute < Concentrated < Fuming', () => {
    const veryDilute = getElementByName('Sulfuric Acid (Very Dilute)').density;
    const dilute = getElementByName('Sulfuric Acid (Dilute)').density;
    const concentrated = getElementByName('Sulfuric Acid (Concentrated)').density;
    const fuming = getElementByName('Sulfuric Acid (Fuming)').density;
    expect(veryDilute).toBeLessThan(dilute);
    expect(dilute).toBeLessThan(concentrated);
    expect(concentrated).toBeLessThan(fuming);
  });

  it('decreases acid heatCapacity with concentration (less water = less thermal buffering)', () => {
    const veryDilute = getElementByName('Sulfuric Acid (Very Dilute)').heatCapacity;
    const dilute = getElementByName('Sulfuric Acid (Dilute)').heatCapacity;
    const concentrated = getElementByName('Sulfuric Acid (Concentrated)').heatCapacity;
    const fuming = getElementByName('Sulfuric Acid (Fuming)').heatCapacity;
    expect(veryDilute).toBeGreaterThan(dilute);
    expect(dilute).toBeGreaterThan(concentrated);
    expect(concentrated).toBeGreaterThan(fuming);
  });

  it('gives every acid tier and Chem element an ambient defaultTemp', () => {
    for (const name of [
      'Sulfuric Acid (Very Dilute)',
      'Sulfuric Acid (Dilute)',
      'Sulfuric Acid (Concentrated)',
      'Sulfuric Acid (Fuming)',
      'Copper',
      'Copper Sulfate',
      'Hydrogen',
      'Sulfur Dioxide',
    ]) {
      expect(getElementByName(name).defaultTemp).toBe(20);
    }
  });
});
