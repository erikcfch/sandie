import { describe, expect, it } from 'vitest';
import { getElement, getElementByName } from './elements';
import { THRESHOLD_REACTIONS, getThresholdReactionsFor, thresholdReactionData } from './thresholdReactions';

const VERY_DILUTE = getElementByName('Sulfuric Acid (Very Dilute)').id;
const DILUTE = getElementByName('Sulfuric Acid (Dilute)').id;
const CONCENTRATED = getElementByName('Sulfuric Acid (Concentrated)').id;
const FUMING = getElementByName('Sulfuric Acid (Fuming)').id;

describe('THRESHOLD_REACTIONS', () => {
  it('defines Very Dilute becoming Dilute at 100 degrees', () => {
    const reaction = THRESHOLD_REACTIONS.find((r) => r.reactant === VERY_DILUTE);
    expect(reaction).toBeDefined();
    expect(reaction!.minTemperature).toBe(100);
    expect(reaction!.product).toBe(DILUTE);
  });

  it('defines Dilute becoming Concentrated at 180 degrees', () => {
    const reaction = THRESHOLD_REACTIONS.find((r) => r.reactant === DILUTE);
    expect(reaction).toBeDefined();
    expect(reaction!.minTemperature).toBe(180);
    expect(reaction!.product).toBe(CONCENTRATED);
  });

  it('defines Concentrated becoming Fuming at 300 degrees', () => {
    const reaction = THRESHOLD_REACTIONS.find((r) => r.reactant === CONCENTRATED);
    expect(reaction).toBeDefined();
    expect(reaction!.minTemperature).toBe(300);
    expect(reaction!.product).toBe(FUMING);
  });

  it('gives every reaction a chance strictly between 0 and 1 (stochastic, not instant)', () => {
    for (const reaction of THRESHOLD_REACTIONS) {
      expect(reaction.chance).toBeGreaterThan(0);
      expect(reaction.chance).toBeLessThan(1);
    }
  });

  it('gives Fuming Acid (the final tier) no further threshold reaction', () => {
    expect(getThresholdReactionsFor(FUMING)).toHaveLength(0);
  });

  it('references only valid element ids', () => {
    for (const reaction of THRESHOLD_REACTIONS) {
      expect(() => getElement(reaction.reactant)).not.toThrow();
      expect(() => getElement(reaction.product)).not.toThrow();
    }
  });

  it('has strictly increasing minTemperature thresholds up the tier chain', () => {
    const sorted = [...THRESHOLD_REACTIONS].sort((a, b) => a.minTemperature - b.minTemperature);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].minTemperature).toBeGreaterThan(sorted[i - 1].minTemperature);
    }
  });
});

describe('getThresholdReactionsFor', () => {
  it('returns the reaction where the given element is the reactant', () => {
    const reactions = getThresholdReactionsFor(VERY_DILUTE);
    expect(reactions).toHaveLength(1);
    expect(reactions[0].product).toBe(DILUTE);
  });

  it('returns an empty array for an element with no threshold reaction', () => {
    expect(getThresholdReactionsFor(getElementByName('Water').id)).toHaveLength(0);
  });
});

describe('thresholdReactionData', () => {
  it('returns 4 floats per reaction (reactant, minTemperature, product, chance)', () => {
    const data = thresholdReactionData();
    expect(data).toBeInstanceOf(Float32Array);
    expect(data.length).toBe(THRESHOLD_REACTIONS.length * 4);
  });

  it('places each reaction\'s fields at its index offset', () => {
    const data = thresholdReactionData();
    const index = THRESHOLD_REACTIONS.findIndex((r) => r.reactant === DILUTE);
    const offset = index * 4;
    const reaction = THRESHOLD_REACTIONS[index];
    expect(data[offset]).toBe(reaction.reactant);
    expect(data[offset + 1]).toBeCloseTo(reaction.minTemperature);
    expect(data[offset + 2]).toBe(reaction.product);
    expect(data[offset + 3]).toBeCloseTo(reaction.chance);
  });
});
