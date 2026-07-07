import { describe, expect, it } from 'vitest';
import { getElement, getElementByName } from './elements';
import { CONTACT_REACTIONS, getReactionsFor } from './reactions';

const LAVA = getElementByName('Lava').id;
const WATER = getElementByName('Water').id;
const OBSIDIAN = getElementByName('Obsidian').id;
const SAND = getElementByName('Sand').id;

describe('CONTACT_REACTIONS', () => {
  it('defines Lava becoming Obsidian when touching Water', () => {
    const reaction = CONTACT_REACTIONS.find((r) => r.reactant === LAVA);
    expect(reaction).toBeDefined();
    expect(reaction!.catalystNeighbor).toBe(WATER);
    expect(reaction!.product).toBe(OBSIDIAN);
  });

  it('gives every reaction a chance strictly between 0 and 1 (stochastic, not instant)', () => {
    for (const reaction of CONTACT_REACTIONS) {
      expect(reaction.chance).toBeGreaterThan(0);
      expect(reaction.chance).toBeLessThan(1);
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
