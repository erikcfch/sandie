import { describe, expect, it } from 'vitest';
import { getElement, getElementByName } from './elements';
import {
  THRESHOLD_REACTIONS,
  getThresholdReactionsFor,
  thresholdReactionData,
  type ThresholdReaction,
} from './thresholdReactions';

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

  it('has strictly increasing minTemperature thresholds up the tier chain, per reactant', () => {
    // Scoped per reactant: independent reaction chains (e.g. acid concentration
    // vs. sand drying) may legitimately share minTemperature values with each
    // other, but a single reactant's own rows must still strictly increase.
    const byReactant = new Map<number, ThresholdReaction[]>();
    for (const reaction of THRESHOLD_REACTIONS) {
      const rows = byReactant.get(reaction.reactant) ?? [];
      rows.push(reaction);
      byReactant.set(reaction.reactant, rows);
    }
    for (const rows of byReactant.values()) {
      const sorted = [...rows].sort((a, b) => a.minTemperature - b.minTemperature);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].minTemperature).toBeGreaterThan(sorted[i - 1].minTemperature);
      }
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

describe('wet-sand drying', () => {
  const rowsFor = (name: string) =>
    THRESHOLD_REACTIONS.filter((r) => r.reactant === getElementByName(name).id);

  it('every wet tier can dry one step (slow ambient + fast hot)', () => {
    for (const [wet, drier] of [['Damp Sand', 'Sand'], ['Wet Sand', 'Damp Sand'], ['Saturated Sand', 'Wet Sand']] as const) {
      const rows = rowsFor(wet);
      expect(rows.length).toBeGreaterThanOrEqual(2);
      for (const r of rows) expect(r.product).toBe(getElementByName(drier).id);
      // one always-on slow row, one hot fast row
      expect(rows.some((r) => r.minTemperature <= 0 && r.chance < 0.01)).toBe(true);
      expect(rows.some((r) => r.minTemperature >= 60 && r.chance >= 0.02)).toBe(true);
    }
  });
});
