import { describe, expect, it } from 'vitest';
import { getElement, getElementByName } from './elements';
import { CONTACT_REACTIONS, getReactionsFor, reactionData } from './reactions';

const LAVA = getElementByName('Lava').id;
const WATER = getElementByName('Water').id;
const OBSIDIAN = getElementByName('Obsidian').id;
const SAND = getElementByName('Sand').id;
const COPPER = getElementByName('Copper').id;
const ACID = getElementByName('Sulfuric Acid (Dilute)').id;
const COPPER_SULFATE = getElementByName('Copper Sulfate').id;
const HYDROGEN = getElementByName('Hydrogen').id;

describe('CONTACT_REACTIONS', () => {
  it('defines Lava becoming Obsidian when touching Water', () => {
    const reaction = CONTACT_REACTIONS.find((r) => r.reactant === LAVA);
    expect(reaction).toBeDefined();
    expect(reaction!.catalystNeighbor).toBe(WATER);
    expect(reaction!.product).toBe(OBSIDIAN);
  });

  it('defines Copper becoming Copper Sulfate when touching Sulfuric Acid', () => {
    const reaction = CONTACT_REACTIONS.find((r) => r.reactant === COPPER);
    expect(reaction).toBeDefined();
    expect(reaction!.catalystNeighbor).toBe(ACID);
    expect(reaction!.product).toBe(COPPER_SULFATE);
  });

  it('defines Sulfuric Acid becoming Hydrogen when touching Copper', () => {
    const reaction = CONTACT_REACTIONS.find((r) => r.reactant === ACID);
    expect(reaction).toBeDefined();
    expect(reaction!.catalystNeighbor).toBe(COPPER);
    expect(reaction!.product).toBe(HYDROGEN);
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

  it('gives the Copper+Acid reactions a positive enthalpyDelta (exothermic)', () => {
    const copperReaction = CONTACT_REACTIONS.find((r) => r.reactant === COPPER)!;
    const acidReaction = CONTACT_REACTIONS.find((r) => r.reactant === ACID)!;
    expect(copperReaction.enthalpyDelta).toBeGreaterThan(0);
    expect(acidReaction.enthalpyDelta).toBeGreaterThan(0);
  });

  it('references only valid element ids', () => {
    for (const reaction of CONTACT_REACTIONS) {
      expect(() => getElement(reaction.reactant)).not.toThrow();
      expect(() => getElement(reaction.catalystNeighbor)).not.toThrow();
      expect(() => getElement(reaction.product)).not.toThrow();
    }
  });
});

describe('getReactionsFor', () => {
  it('returns the reactions where the given element is the reactant', () => {
    const reactions = getReactionsFor(LAVA);
    expect(reactions).toHaveLength(1);
    expect(reactions[0].product).toBe(OBSIDIAN);
  });

  it('does not return reactions where the element is only a catalyst, not a reactant', () => {
    expect(getReactionsFor(WATER)).toHaveLength(0);
  });

  it('returns an empty array for elements with no reactions', () => {
    expect(getReactionsFor(SAND)).toHaveLength(0);
  });
});

describe('reactionData', () => {
  it('returns 8 floats per reaction (reactant, catalystNeighbor, product, chance, enthalpyDelta, 0, 0, 0)', () => {
    const data = reactionData();
    expect(data).toBeInstanceOf(Float32Array);
    expect(data.length).toBe(CONTACT_REACTIONS.length * 8);
  });

  it('places each reaction\'s fields at its index offset', () => {
    const data = reactionData();
    const index = CONTACT_REACTIONS.findIndex((r) => r.reactant === COPPER);
    const offset = index * 8;
    const reaction = CONTACT_REACTIONS[index];
    expect(data[offset]).toBe(reaction.reactant);
    expect(data[offset + 1]).toBe(reaction.catalystNeighbor);
    expect(data[offset + 2]).toBe(reaction.product);
    expect(data[offset + 3]).toBeCloseTo(reaction.chance);
    expect(data[offset + 4]).toBeCloseTo(reaction.enthalpyDelta);
    expect(data[offset + 5]).toBe(0);
    expect(data[offset + 6]).toBe(0);
    expect(data[offset + 7]).toBe(0);
  });
});
