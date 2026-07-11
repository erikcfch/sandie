import { describe, expect, it } from 'vitest';
import { getElementByName } from './elements';
import { PHASE_TRANSITIONS } from './phaseTransitions';
import { enthalpyForTemperature, heatFlux, temperatureAndElementFromEnthalpy } from './thermal';

const ICE = getElementByName('Ice').id;
const WATER = getElementByName('Water').id;
const STEAM = getElementByName('Steam').id;
const STONE = getElementByName('Stone').id;
const LAVA = getElementByName('Lava').id;
const SAND = getElementByName('Sand').id;

describe('non-chain elements (no phase transitions)', () => {
  it('round-trips temperature through enthalpy linearly', () => {
    const enthalpy = enthalpyForTemperature(50, SAND);
    const result = temperatureAndElementFromEnthalpy(SAND, enthalpy);
    expect(result.temperature).toBeCloseTo(50);
    expect(result.elementId).toBe(SAND);
  });

  it('scales enthalpy by heat capacity', () => {
    const cap = getElementByName('Sand').specificHeat;
    expect(enthalpyForTemperature(10, SAND)).toBeCloseTo(10 * cap);
  });
});

describe('water chain (Ice-Water-Steam) round trips within each segment', () => {
  it('decodes a cold temperature as Ice', () => {
    const enthalpy = enthalpyForTemperature(-20, WATER);
    const result = temperatureAndElementFromEnthalpy(WATER, enthalpy);
    expect(result.temperature).toBeCloseTo(-20);
    expect(result.elementId).toBe(ICE);
  });

  it('decodes a mid-range temperature as Water', () => {
    const enthalpy = enthalpyForTemperature(50, ICE);
    const result = temperatureAndElementFromEnthalpy(ICE, enthalpy);
    expect(result.temperature).toBeCloseTo(50);
    expect(result.elementId).toBe(WATER);
  });

  it('decodes a hot temperature as Steam', () => {
    const enthalpy = enthalpyForTemperature(150, WATER);
    const result = temperatureAndElementFromEnthalpy(WATER, enthalpy);
    expect(result.temperature).toBeCloseTo(150);
    expect(result.elementId).toBe(STEAM);
  });

  it('round-trips each element own defaultTemp back to itself', () => {
    for (const name of ['Ice', 'Water', 'Steam'] as const) {
      const element = getElementByName(name);
      const enthalpy = enthalpyForTemperature(element.defaultTemp, element.id);
      const result = temperatureAndElementFromEnthalpy(element.id, enthalpy);
      expect(result.elementId).toBe(element.id);
      expect(result.temperature).toBeCloseTo(element.defaultTemp);
    }
  });
});

describe('latent heat plateau (Ice<->Water at 0 degrees)', () => {
  it('holds temperature at exactly 0 across the whole plateau width, both entering as Ice and as Water', () => {
    const justMelted = enthalpyForTemperature(0, ICE);
    const fullyMelted = enthalpyForTemperature(0.0001, WATER); // just past the boundary, i.e. plateau end
    const midpoint = (justMelted + fullyMelted) / 2;

    for (const enthalpy of [justMelted, midpoint]) {
      expect(temperatureAndElementFromEnthalpy(ICE, enthalpy).temperature).toBeCloseTo(0);
      expect(temperatureAndElementFromEnthalpy(WATER, enthalpy).temperature).toBeCloseTo(0);
    }
  });

  it('stays Ice while still on the plateau if it entered as Ice (hysteresis)', () => {
    const justMelted = enthalpyForTemperature(0, ICE);
    const result = temperatureAndElementFromEnthalpy(ICE, justMelted + 1);
    expect(result.elementId).toBe(ICE);
  });

  it('stays Water while still on the plateau if it entered as Water (hysteresis)', () => {
    const justMelted = enthalpyForTemperature(0, ICE);
    const result = temperatureAndElementFromEnthalpy(WATER, justMelted + 1);
    expect(result.elementId).toBe(WATER);
  });

  it('fully melts to Water once enthalpy clears the full latent heat width', () => {
    const justMelted = enthalpyForTemperature(0, ICE);
    const fusion = PHASE_TRANSITIONS.find((t) => t.lowElementId === ICE)!;
    const result = temperatureAndElementFromEnthalpy(ICE, justMelted + fusion.latentHeat + 1);
    expect(result.elementId).toBe(WATER);
    expect(result.temperature).toBeGreaterThan(0);
  });
});

describe('stone-lava chain', () => {
  it('decodes below the boundary as Stone and above as Lava', () => {
    const cool = temperatureAndElementFromEnthalpy(STONE, enthalpyForTemperature(650, STONE));
    expect(cool.elementId).toBe(STONE);
    expect(cool.temperature).toBeCloseTo(650);

    const hot = temperatureAndElementFromEnthalpy(STONE, enthalpyForTemperature(750, LAVA));
    expect(hot.elementId).toBe(LAVA);
    expect(hot.temperature).toBeCloseTo(750);
  });
});

describe('heatFlux', () => {
  it('flows from hotter to cooler (positive when from > to)', () => {
    expect(heatFlux(100, 20, 0.5, 0.5, 0.1)).toBeGreaterThan(0);
  });

  it('is zero when temperatures are equal', () => {
    expect(heatFlux(50, 50, 0.5, 0.5, 0.1)).toBe(0);
  });

  it('reverses sign when direction reverses', () => {
    const forward = heatFlux(100, 20, 0.5, 0.5, 0.1);
    const backward = heatFlux(20, 100, 0.5, 0.5, 0.1);
    expect(backward).toBeCloseTo(-forward);
  });

  it('is bottlenecked by the less conductive side', () => {
    const withPoorInsulator = heatFlux(100, 20, 0.9, 0.1, 0.1);
    const bothPoor = heatFlux(100, 20, 0.1, 0.1, 0.1);
    expect(withPoorInsulator).toBeCloseTo(bothPoor);
  });
});
