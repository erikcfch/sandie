import { describe, expect, it } from 'vitest';
import { getElement, getElementByName } from './elements';
import { CONTACT_REACTIONS, NO_MIN_TEMPERATURE, getReactionsFor, reactionData } from './reactions';

const LAVA = getElementByName('Lava').id;
const WATER = getElementByName('Water').id;
const OBSIDIAN = getElementByName('Obsidian').id;
const SAND = getElementByName('Sand').id;
const COPPER = getElementByName('Copper').id;
const VERY_DILUTE = getElementByName('Sulfuric Acid (Very Dilute)').id;
const DILUTE = getElementByName('Sulfuric Acid (Dilute)').id;
const CONCENTRATED = getElementByName('Sulfuric Acid (Concentrated)').id;
const FUMING = getElementByName('Sulfuric Acid (Fuming)').id;
const COPPER_SULFATE = getElementByName('Copper Sulfate').id;
const SULFUR_DIOXIDE = getElementByName('Sulfur Dioxide').id;
const FIRE = getElementByName('Fire').id;
const HYDROGEN = getElementByName('Hydrogen').id;
const SALT = getElementByName('Salt').id;
const SODIUM = getElementByName('Sodium').id;
const SALT_WATER = getElementByName('Salt Water').id;

describe('CONTACT_REACTIONS', () => {
  it('defines Lava becoming Obsidian when touching Water, with no temperature gate', () => {
    const reaction = CONTACT_REACTIONS.find((r) => r.reactant === LAVA);
    expect(reaction).toBeDefined();
    expect(reaction!.catalystNeighbor).toBe(WATER);
    expect(reaction!.product).toBe(OBSIDIAN);
    expect(reaction!.minTemperature).toBeUndefined();
  });

  it('defines hot Concentrated Acid + Copper producing Copper Sulfate, Sulfur Dioxide, and Water', () => {
    const copper = CONTACT_REACTIONS.find((r) => r.reactant === COPPER && r.catalystNeighbor === CONCENTRATED);
    const so2 = CONTACT_REACTIONS.find((r) => r.reactant === CONCENTRATED && r.product === SULFUR_DIOXIDE);
    const water = CONTACT_REACTIONS.find((r) => r.reactant === CONCENTRATED && r.product === WATER);
    expect(copper).toBeDefined();
    expect(copper!.product).toBe(COPPER_SULFATE);
    expect(copper!.minTemperature).toBe(150);
    expect(so2).toBeDefined();
    expect(so2!.minTemperature).toBe(150);
    expect(water).toBeDefined();
    expect(water!.minTemperature).toBe(150);
  });

  it('defines Fuming Acid + Copper as more reactive than Concentrated (lower minTemperature, higher chance)', () => {
    const concentratedCopper = CONTACT_REACTIONS.find((r) => r.reactant === COPPER && r.catalystNeighbor === CONCENTRATED)!;
    const fumingCopper = CONTACT_REACTIONS.find((r) => r.reactant === COPPER && r.catalystNeighbor === FUMING);
    expect(fumingCopper).toBeDefined();
    expect(fumingCopper!.product).toBe(COPPER_SULFATE);
    expect(fumingCopper!.minTemperature!).toBeLessThan(concentratedCopper.minTemperature!);
    expect(fumingCopper!.chance).toBeGreaterThan(concentratedCopper.chance);
  });

  it('gives Very Dilute and Dilute Acid no reaction with Copper at all (dilute acid cannot oxidize copper)', () => {
    for (const acid of [VERY_DILUTE, DILUTE]) {
      expect(CONTACT_REACTIONS.some((r) => r.reactant === acid && r.catalystNeighbor === COPPER)).toBe(false);
      expect(CONTACT_REACTIONS.some((r) => r.reactant === COPPER && r.catalystNeighbor === acid)).toBe(false);
    }
  });

  it('gives every reaction a chance strictly between 0 and 1 (stochastic, not instant)', () => {
    for (const reaction of CONTACT_REACTIONS) {
      expect(reaction.chance).toBeGreaterThan(0);
      expect(reaction.chance).toBeLessThan(1);
    }
  });

  it('gives every reaction a non-negative enthalpyDelta', () => {
    for (const reaction of CONTACT_REACTIONS) {
      expect(reaction.enthalpyDelta).toBeGreaterThanOrEqual(0);
    }
  });

  it('references only valid element ids', () => {
    for (const reaction of CONTACT_REACTIONS) {
      expect(() => getElement(reaction.reactant)).not.toThrow();
      expect(() => getElement(reaction.catalystNeighbor)).not.toThrow();
      expect(() => getElement(reaction.product)).not.toThrow();
    }
  });
});

describe('metal reactions (3d-2)', () => {
  const IRON = getElementByName('Iron').id;
  const RUST = getElementByName('Rust').id;
  const WATER_ID = getElementByName('Water').id;
  const ALUMINIUM = getElementByName('Aluminium').id;
  const MOLTEN_IRON = getElementByName('Molten Iron').id;

  it('rusts Iron in contact with Water, slowly, at any temperature', () => {
    const r = CONTACT_REACTIONS.find((x) => x.reactant === IRON && x.catalystNeighbor === WATER_ID);
    expect(r).toBeDefined();
    expect(r!.product).toBe(RUST);
    expect(r!.minTemperature).toBeUndefined(); // any temperature
    expect(r!.chance).toBeLessThan(0.01);       // slow
  });

  it('thermite: hot Rust next to Aluminium becomes Molten Iron with a large exothermic kick', () => {
    const r = CONTACT_REACTIONS.find((x) => x.reactant === RUST && x.catalystNeighbor === ALUMINIUM);
    expect(r).toBeDefined();
    expect(r!.product).toBe(MOLTEN_IRON);
    expect(r!.minTemperature).toBe(160);
    // Must clear the Iron<->Molten Iron plateau start (675) from the 160C gate
    // carry-over (0.45*160=72) so the product does not resolidify next tick.
    expect(72 + r!.enthalpyDelta).toBeGreaterThan(675);
  });

  it('treats Aluminium as a catalyst only (not itself a reactant)', () => {
    expect(getReactionsFor(ALUMINIUM)).toHaveLength(0);
    expect(getReactionsFor(IRON)).toHaveLength(1); // rusting
    expect(getReactionsFor(RUST)).toHaveLength(1); // thermite
  });
});

describe('reactive contact reactions (3d-3)', () => {
  it('splits Sodium + Water into Fire and Hydrogen at room temperature', () => {
    const fire = CONTACT_REACTIONS.find((r) => r.reactant === SODIUM && r.catalystNeighbor === WATER);
    const hydrogen = CONTACT_REACTIONS.find((r) => r.reactant === WATER && r.catalystNeighbor === SODIUM);
    expect(fire).toBeDefined();
    expect(fire!.product).toBe(FIRE);
    expect(fire!.chance).toBeCloseTo(0.5);
    expect(fire!.enthalpyDelta).toBe(600);
    expect(fire!.minTemperature).toBeUndefined();
    expect(hydrogen).toBeDefined();
    expect(hydrogen!.product).toBe(HYDROGEN);
    expect(hydrogen!.chance).toBeCloseTo(0.3);
    expect(hydrogen!.enthalpyDelta).toBe(0);
    expect(hydrogen!.minTemperature).toBeUndefined();
    expect(getReactionsFor(WATER)).toHaveLength(1);
  });

  it('dissolves Salt into conductive Salt Water where it touches Water', () => {
    const brine = CONTACT_REACTIONS.find((r) => r.reactant === SALT && r.catalystNeighbor === WATER);
    expect(brine).toBeDefined();
    expect(brine!.product).toBe(SALT_WATER);
    expect(brine!.chance).toBeCloseTo(0.1);
    expect(brine!.enthalpyDelta).toBe(0);
    expect(brine!.minTemperature).toBeUndefined();
  });
});

describe('getReactionsFor', () => {
  it('returns the reactions where the given element is the reactant', () => {
    const reactions = getReactionsFor(LAVA);
    expect(reactions).toHaveLength(1);
    expect(reactions[0].product).toBe(OBSIDIAN);
  });

  it('does not return reactions where the element is only a catalyst, not a reactant', () => {
    expect(getReactionsFor(getElementByName('Aluminium').id)).toHaveLength(0);
  });

  it('returns an empty array for elements with no reactions', () => {
    expect(getReactionsFor(SAND)).toHaveLength(0);
  });

  it('returns 2 reactions each for Concentrated Acid, Fuming Acid, and Copper as reactant', () => {
    expect(getReactionsFor(CONCENTRATED)).toHaveLength(2); // -> Sulfur Dioxide, -> Water
    expect(getReactionsFor(FUMING)).toHaveLength(2); // -> Sulfur Dioxide, -> Water
    expect(getReactionsFor(COPPER)).toHaveLength(2); // -> Copper Sulfate, once per acid tier
  });
});

describe('reactionData', () => {
  it('returns 8 floats per reaction (reactant, catalystNeighbor, product, chance, enthalpyDelta, minTemperature, 0, 0)', () => {
    const data = reactionData();
    expect(data).toBeInstanceOf(Float32Array);
    expect(data.length).toBe(CONTACT_REACTIONS.length * 8);
  });

  it('places each reaction\'s fields at its index offset, including a real minTemperature', () => {
    const data = reactionData();
    const index = CONTACT_REACTIONS.findIndex((r) => r.reactant === COPPER && r.catalystNeighbor === CONCENTRATED);
    const offset = index * 8;
    const reaction = CONTACT_REACTIONS[index];
    expect(data[offset]).toBe(reaction.reactant);
    expect(data[offset + 1]).toBe(reaction.catalystNeighbor);
    expect(data[offset + 2]).toBe(reaction.product);
    expect(data[offset + 3]).toBeCloseTo(reaction.chance);
    expect(data[offset + 4]).toBeCloseTo(reaction.enthalpyDelta);
    expect(data[offset + 5]).toBeCloseTo(reaction.minTemperature!);
    expect(data[offset + 6]).toBe(0);
    expect(data[offset + 7]).toBe(0);
  });

  it('writes the NO_MIN_TEMPERATURE sentinel for a reaction with no minTemperature (Lava+Water->Obsidian)', () => {
    const data = reactionData();
    const index = CONTACT_REACTIONS.findIndex((r) => r.reactant === LAVA);
    const offset = index * 8;
    expect(data[offset + 5]).toBe(NO_MIN_TEMPERATURE);
  });
});
