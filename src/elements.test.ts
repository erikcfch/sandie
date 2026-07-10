import { describe, expect, it } from 'vitest';
import { ELEMENTS, colorPalette, getElement, getElementByName, materialProperties, materialFlags } from './elements';
import { simDensity } from './density';

const sim = (name: string) => {
  const e = getElementByName(name);
  return simDensity(e.form, e.realDensity);
};

describe('ELEMENTS table', () => {
  it('assigns each element a unique, contiguous id starting at 0', () => {
    const ids = ELEMENTS.map((e) => e.id).sort((a, b) => a - b);
    expect(ids).toEqual(ELEMENTS.map((_, i) => i));
  });

  it('gives Empty the "empty" category and zero density', () => {
    const empty = getElementByName('Empty');
    expect(empty.category).toBe('empty');
    expect(sim('Empty')).toBe(0);
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
    expect(sim('Sand')).toBeGreaterThan(sim('Water'));
  });

  it('gives Water a higher density than Smoke, so smoke rises through water-adjacent air', () => {
    expect(sim('Water')).toBeGreaterThan(sim('Smoke'));
  });

  it('categorizes Ice as static, Lava as liquid, and Steam/Fire as gas', () => {
    expect(getElementByName('Ice').category).toBe('static');
    expect(getElementByName('Lava').category).toBe('liquid');
    expect(getElementByName('Steam').category).toBe('gas');
    expect(getElementByName('Fire').category).toBe('gas');
  });

  it('gives Lava a real density above Water and above powders, so lava sinks below water and dense powders rest on it', () => {
    expect(sim('Lava')).toBeGreaterThan(sim('Water'));
    expect(sim('Lava')).toBeGreaterThan(sim('Sand'));
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

  it('gives static solids a barrier density above every movable, so powders/liquids cannot sink through them', () => {
    for (const s of ['Ice', 'Stone', 'Wood', 'Obsidian', 'Copper']) {
      for (const m of ['Sand', 'Water', 'Lava', 'Rust']) {
        expect(sim(s)).toBeGreaterThan(sim(m));
      }
    }
  });

  it('gives every element a positive thermalConductivity and heatCapacity', () => {
    for (const element of ELEMENTS) {
      expect(element.thermalConductivity).toBeGreaterThan(0);
      expect(element.specificHeat).toBeGreaterThan(0);
    }
  });

  it('gives Water a much higher heatCapacity than Stone, so it acts as a thermal buffer/coolant', () => {
    expect(getElementByName('Water').specificHeat).toBeGreaterThan(getElementByName('Stone').specificHeat * 2);
  });

  it('gives Wood a lower thermalConductivity than Stone, so it insulates', () => {
    expect(getElementByName('Wood').thermalConductivity).toBeLessThan(getElementByName('Stone').thermalConductivity);
  });

  it('categorizes Obsidian as a static solid sharing Stone\'s thermal properties', () => {
    const obsidian = getElementByName('Obsidian');
    const stone = getElementByName('Stone');
    expect(obsidian.category).toBe('static');
    expect(obsidian.specificHeat).toBe(stone.specificHeat);
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
  it('returns 16 floats per element (12 existing + viscosityRefLog10, viscosityTempCoeff, 2 reserved), indexed by element id', () => {
    const props = materialProperties();
    expect(props.length).toBe(ELEMENTS.length * 16);
  });

  it('places each element density, thermalConductivity, and heatCapacity at its id offset', () => {
    const water = getElementByName('Water');
    const props = materialProperties();
    const offset = water.id * 16;
    expect(props[offset]).toBeCloseTo(simDensity(water.form, water.realDensity));
    expect(props[offset + 1]).toBeCloseTo(water.thermalConductivity);
    expect(props[offset + 2]).toBeCloseTo(water.specificHeat);
  });

  it('packs the viscosity curve at offsets 12-13 for liquids', () => {
    const props = materialProperties();
    const lava = getElementByName('Lava');
    expect(props[lava.id * 16 + 12]).toBeCloseTo(lava.viscosityRefLog10!);
    expect(props[lava.id * 16 + 13]).toBeCloseTo(lava.viscosityTempCoeff!);
    const sand = getElementByName('Sand');
    expect(props[sand.id * 16 + 12]).toBe(0); // non-liquid: unused
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
    expect(sim('Sulfuric Acid (Dilute)')).toBeGreaterThan(sim('Water'));
    expect(sim('Sulfuric Acid (Dilute)')).toBeLessThan(sim('Lava'));
  });

  it('increases acid density with concentration: Very Dilute < Dilute < Concentrated < Fuming', () => {
    const veryDilute = sim('Sulfuric Acid (Very Dilute)');
    const dilute = sim('Sulfuric Acid (Dilute)');
    const concentrated = sim('Sulfuric Acid (Concentrated)');
    const fuming = sim('Sulfuric Acid (Fuming)');
    expect(veryDilute).toBeLessThan(dilute);
    expect(dilute).toBeLessThan(concentrated);
    expect(concentrated).toBeLessThan(fuming);
  });

  it('decreases acid heatCapacity with concentration (less water = less thermal buffering)', () => {
    const veryDilute = getElementByName('Sulfuric Acid (Very Dilute)').specificHeat;
    const dilute = getElementByName('Sulfuric Acid (Dilute)').specificHeat;
    const concentrated = getElementByName('Sulfuric Acid (Concentrated)').specificHeat;
    const fuming = getElementByName('Sulfuric Acid (Fuming)').specificHeat;
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

describe('wet-sand tiers', () => {
  it('exist with ascending density and are powders', () => {
    const sand = getElementByName('Sand');
    const damp = getElementByName('Damp Sand');
    const wet = getElementByName('Wet Sand');
    const sat = getElementByName('Saturated Sand');
    expect([damp.id, wet.id, sat.id]).toEqual([19, 20, 21]);
    // Denser than water (so they sink through it) and increasing with wetness.
    for (const e of [sand, damp, wet, sat]) expect(sim(e.name)).toBeGreaterThan(sim('Water'));
    expect(sim('Sand')).toBeLessThan(sim('Damp Sand'));
    expect(sim('Damp Sand')).toBeLessThan(sim('Wet Sand'));
    expect(sim('Wet Sand')).toBeLessThan(sim('Saturated Sand'));
    for (const e of [damp, wet, sat]) expect(e.category).toBe('powder');
  });
});

describe('material taxonomy', () => {
  it('every element has form matching its category', () => {
    const map: Record<string, string> = { empty: 'static', static: 'static', powder: 'powder', liquid: 'liquid', gas: 'gas' };
    for (const e of ELEMENTS) expect(e.form).toBe(map[e.category]);
  });
  it('every element has phase/origin/metallic set', () => {
    for (const e of ELEMENTS) {
      expect(['solid', 'liquid', 'gas']).toContain(e.phase);
      expect(['organic', 'inorganic']).toContain(e.origin);
      expect(['metal', 'nonmetal']).toContain(e.metallic);
    }
  });
  it('classifies a few materials correctly', () => {
    expect(getElementByName('Wood').origin).toBe('organic');
    expect(getElementByName('Copper').metallic).toBe('metal');
    expect(getElementByName('Water').form).toBe('liquid');
    expect(getElementByName('Sand').phase).toBe('solid');
  });
});

describe('capabilities and reference values', () => {
  it('only Wood is flammable in Phase 1, igniting to Fire', () => {
    const wood = getElementByName('Wood');
    expect(wood.flammable).toBe(true);
    expect(wood.ignitionTemp).toBe(300);
    expect(wood.burnProduct).toBe(getElementByName('Fire').id);
    expect(wood.burnRate).toBe(1);
    expect(ELEMENTS.filter((e) => e.flammable).map((e) => e.name)).toEqual(['Wood']);
  });
  it('acids are corrosive and copper is a conductive metal', () => {
    for (const n of ['Sulfuric Acid (Dilute)', 'Sulfuric Acid (Very Dilute)', 'Sulfuric Acid (Concentrated)', 'Sulfuric Acid (Fuming)'])
      expect(getElementByName(n).corrosive).toBe(true);
    expect(getElementByName('Copper').conductive).toBe(true);
  });
  it('records real reference densities (ice less dense than water; copper dense)', () => {
    expect(getElementByName('Ice').realDensity!).toBeLessThan(getElementByName('Water').realDensity!);
    expect(getElementByName('Copper').realDensity!).toBeGreaterThan(5);
    expect(getElementByName('Water').realDensity).toBeCloseTo(1.0, 1);
  });
});

describe('GPU material serializers', () => {
  it('materials buffer is 12 floats/element with unchanged sim values + flammability params', () => {
    const data = materialProperties();
    expect(data.length).toBe(ELEMENTS.length * 16);
    const wood = getElementByName('Wood');
    const o = wood.id * 16;
    expect(data[o + 0]).toBeCloseTo(simDensity(wood.form, wood.realDensity));
    expect(data[o + 1]).toBeCloseTo(wood.thermalConductivity);
    expect(data[o + 2]).toBeCloseTo(wood.specificHeat);
    expect(data[o + 3]).toBe(300);
    expect(data[o + 4]).toBe(getElementByName('Fire').id);
    expect(data[o + 5]).toBe(1);
    const stoneO = getElementByName('Stone').id * 16;
    expect(data[stoneO + 3]).toBe(0);
  });
  it('materialFlags packs form in bits 0-1 and capabilities above', () => {
    const flags = materialFlags();
    expect(flags.length).toBe(ELEMENTS.length);
    expect(flags[getElementByName('Water').id] & 3).toBe(2);
    expect(flags[getElementByName('Sand').id] & 3).toBe(1);
    expect(flags[getElementByName('Smoke').id] & 3).toBe(3);
    expect(flags[getElementByName('Stone').id] & 3).toBe(0);
    expect((flags[getElementByName('Wood').id] >> 2) & 1).toBe(1);
    expect((flags[getElementByName('Wood').id] >> 6) & 1).toBe(1);
    expect((flags[getElementByName('Copper').id] >> 7) & 1).toBe(1);
  });
});

describe('acid corrosion params', () => {
  const acid = (n: string) => getElementByName(n);
  it('acids have ascending corrosiveStrength and step down a tier when consumed', () => {
    expect(acid('Sulfuric Acid (Very Dilute)').corrosiveStrength).toBe(1);
    expect(acid('Sulfuric Acid (Dilute)').corrosiveStrength).toBe(2);
    expect(acid('Sulfuric Acid (Concentrated)').corrosiveStrength).toBe(3);
    expect(acid('Sulfuric Acid (Fuming)').corrosiveStrength).toBe(4);
    expect(acid('Sulfuric Acid (Very Dilute)').weakensTo).toBe(getElementByName('Water').id);
    expect(acid('Sulfuric Acid (Dilute)').weakensTo).toBe(acid('Sulfuric Acid (Very Dilute)').id);
    expect(acid('Sulfuric Acid (Concentrated)').weakensTo).toBe(acid('Sulfuric Acid (Dilute)').id);
    expect(acid('Sulfuric Acid (Fuming)').weakensTo).toBe(acid('Sulfuric Acid (Concentrated)').id);
  });
});

describe('corrosion demo materials', () => {
  it('adds Salt/Limestone/Rust as solubles with ascending resistance', () => {
    const salt = getElementByName('Salt');
    const lime = getElementByName('Limestone');
    const rust = getElementByName('Rust');
    expect([salt.id, lime.id, rust.id, getElementByName('CO₂').id]).toEqual([22, 23, 24, 25]);
    for (const e of [salt, lime, rust]) { expect(e.soluble).toBe(true); expect(e.form).toBe('powder'); }
    expect(salt.solubility).toBe(1);
    expect(lime.solubility).toBe(2);
    expect(rust.solubility).toBe(3);
    expect(lime.dissolvedProduct).toBe(getElementByName('CO₂').id);
    expect(salt.dissolvedProduct).toBe(0);
    expect(getElementByName('CO₂').form).toBe('gas');
  });
});

describe('materials serializer with corrosion params', () => {
  it('is 12 floats/element with corrosion params in the documented slots', () => {
    const data = materialProperties();
    expect(data.length).toBe(ELEMENTS.length * 16);
    const conc = getElementByName('Sulfuric Acid (Concentrated)');
    const o = conc.id * 16;
    expect(data[o + 0]).toBeCloseTo(simDensity(conc.form, conc.realDensity));
    expect(data[o + 6]).toBe(3);            // corrosiveStrength
    expect(data[o + 9]).toBe(getElementByName('Sulfuric Acid (Dilute)').id); // weakensTo
    const lime = getElementByName('Limestone');
    const lo = lime.id * 16;
    expect(data[lo + 7]).toBe(2);           // solubility
    expect(data[lo + 8]).toBe(getElementByName('CO₂').id); // dissolvedProduct
    const stone = getElementByName('Stone');
    expect(data[stone.id * 16 + 9]).toBe(stone.id); // no weakensTo -> own id
  });
});

describe('wax', () => {
  it('adds Wax (static solid) and Molten Wax (liquid), both organic, no formula', () => {
    const wax = getElementByName('Wax');
    const molten = getElementByName('Molten Wax');
    expect([wax.id, molten.id]).toEqual([26, 27]);
    expect(wax.form).toBe('static');
    expect(molten.form).toBe('liquid');
    expect(wax.origin).toBe('organic');
    expect(wax.meltingPoint).toBe(60);
    expect(wax.formula).toBeUndefined();
  });
});

describe('viscosity data', () => {
  it('sets a viscosity curve on liquids, ordered water < acids < wax < lava', () => {
    const refLog = (n: string) => getElementByName(n).viscosityRefLog10;
    expect(refLog('Water')).toBe(0);
    expect(refLog('Sulfuric Acid (Concentrated)')!).toBeGreaterThan(refLog('Sulfuric Acid (Dilute)')!);
    expect(refLog('Molten Wax')!).toBeGreaterThan(refLog('Sulfuric Acid (Fuming)')!);
    expect(refLog('Lava')!).toBeGreaterThan(refLog('Molten Wax')!);
  });
  it('gives Lava and Molten Wax a negative temperature coefficient (thinner when hotter)', () => {
    expect(getElementByName('Lava').viscosityTempCoeff!).toBeLessThan(0);
    expect(getElementByName('Molten Wax').viscosityTempCoeff!).toBeLessThan(0);
  });
  it('leaves non-liquids without a viscosity curve', () => {
    expect(getElementByName('Sand').viscosityRefLog10).toBeUndefined();
    expect(getElementByName('Stone').viscosityRefLog10).toBeUndefined();
  });
});
