import { describe, expect, it } from 'vitest';
import { getElementByName } from './elements';
import { getChain, PHASE_TRANSITIONS } from './phaseTransitions';

const ICE = getElementByName('Ice').id;
const WATER = getElementByName('Water').id;
const STEAM = getElementByName('Steam').id;
const STONE = getElementByName('Stone').id;
const LAVA = getElementByName('Lava').id;
const SAND = getElementByName('Sand').id;
const EMPTY = getElementByName('Empty').id;

describe('PHASE_TRANSITIONS', () => {
  it('defines Ice<->Water at 0 degrees', () => {
    const t = PHASE_TRANSITIONS.find((t) => t.lowElementId === ICE);
    expect(t).toBeDefined();
    expect(t!.highElementId).toBe(WATER);
    expect(t!.boundaryTemp).toBe(0);
    expect(t!.latentHeat).toBeGreaterThan(0);
  });

  it('defines Water<->Steam at 100 degrees with much larger latent heat than Ice<->Water', () => {
    const fusion = PHASE_TRANSITIONS.find((t) => t.lowElementId === ICE)!;
    const vaporization = PHASE_TRANSITIONS.find((t) => t.lowElementId === WATER)!;
    expect(vaporization.highElementId).toBe(STEAM);
    expect(vaporization.boundaryTemp).toBe(100);
    expect(vaporization.latentHeat).toBeGreaterThan(fusion.latentHeat);
  });

  it('defines a single Stone<->Lava transition point (not asymmetric thresholds)', () => {
    const t = PHASE_TRANSITIONS.find((t) => t.lowElementId === STONE);
    expect(t).toBeDefined();
    expect(t!.highElementId).toBe(LAVA);
    expect(t!.latentHeat).toBeGreaterThan(0);
  });
});

describe('getChain', () => {
  it('builds the full Ice-Water-Steam chain regardless of which member is queried', () => {
    for (const id of [ICE, WATER, STEAM]) {
      const chain = getChain(id);
      expect(chain).toBeDefined();
      expect(chain!.segments.map((s) => s.elementId)).toEqual([ICE, WATER, STEAM]);
      expect(chain!.transitions).toHaveLength(2);
    }
  });

  it('builds the Stone-Lava chain regardless of which member is queried', () => {
    for (const id of [STONE, LAVA]) {
      const chain = getChain(id);
      expect(chain).toBeDefined();
      expect(chain!.segments.map((s) => s.elementId)).toEqual([STONE, LAVA]);
      expect(chain!.transitions).toHaveLength(1);
    }
  });

  it('includes each segment heat capacity matching the element table', () => {
    const chain = getChain(WATER)!;
    const waterSegment = chain.segments.find((s) => s.elementId === WATER)!;
    expect(waterSegment.heatCapacity).toBe(getElementByName('Water').heatCapacity);
  });

  it('returns undefined for elements with no phase transitions', () => {
    expect(getChain(SAND)).toBeUndefined();
    expect(getChain(EMPTY)).toBeUndefined();
  });
});
