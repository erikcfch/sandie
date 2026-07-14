import { getElementByName } from './elements';

export interface ThresholdReaction {
  /** The element that converts once its temperature crosses minTemperature. */
  reactant: number;
  /** Temperature (inclusive) the reactant must reach to convert. */
  minTemperature: number;
  /** What the reactant becomes. */
  product: number;
  /** Per-tick probability once the threshold is met (stochastic, like Fire's
   * decay chance) - not instant, so conversion happens gradually. */
  chance: number;
}

// One-way, heat-driven concentration progression: boiling off water
// concentrates the acid (like real dilute H2SO4 losing its water content),
// but cooling back down does not reverse it - the water is gone, not a
// reversible phase equilibrium like Ice<->Water. Thresholds are game-balance
// approximations (documented, not lab-precise), same spirit as
// simulate.wgsl's WOOD_IGNITE_POINT.
export const THRESHOLD_REACTIONS: readonly ThresholdReaction[] = [
  {
    reactant: getElementByName('Sulfuric Acid (Very Dilute)').id,
    minTemperature: 100, // water's boiling point
    product: getElementByName('Sulfuric Acid (Dilute)').id,
    chance: 0.05,
  },
  {
    reactant: getElementByName('Sulfuric Acid (Dilute)').id,
    minTemperature: 180, // boiling point rises as water content drops
    product: getElementByName('Sulfuric Acid (Concentrated)').id,
    chance: 0.05,
  },
  {
    reactant: getElementByName('Sulfuric Acid (Concentrated)').id,
    minTemperature: 300, // further heating drives off SO3 character
    product: getElementByName('Sulfuric Acid (Fuming)').id,
    chance: 0.05,
  },
  // Wet sand dries back toward dry Sand: a slow trickle at any temperature,
  // and a fast pass near heat (the absorbed water evaporates - no cell spawned).
  { reactant: getElementByName('Damp Sand').id, minTemperature: -273, product: getElementByName('Sand').id, chance: 0.0008 },
  { reactant: getElementByName('Damp Sand').id, minTemperature: 60, product: getElementByName('Sand').id, chance: 0.03 },
  { reactant: getElementByName('Wet Sand').id, minTemperature: -273, product: getElementByName('Damp Sand').id, chance: 0.0006 },
  { reactant: getElementByName('Wet Sand').id, minTemperature: 60, product: getElementByName('Damp Sand').id, chance: 0.03 },
  { reactant: getElementByName('Saturated Sand').id, minTemperature: -273, product: getElementByName('Wet Sand').id, chance: 0.0005 },
  { reactant: getElementByName('Saturated Sand').id, minTemperature: 60, product: getElementByName('Wet Sand').id, chance: 0.03 },
  // Gasoline is volatile: it slowly gives off a flammable vapor even at mild
  // temperatures (one-way, like the acid concentration steps).
  { reactant: getElementByName('Gasoline').id, minTemperature: 35, product: getElementByName('Gasoline Vapor').id, chance: 0.01 },
  // Sand fuses to inert Glass only under sustained intense heat.
  { reactant: getElementByName('Sand').id, minTemperature: 700, product: getElementByName('Glass').id, chance: 0.05 },
];

/** Finds the threshold reaction(s) where the given element is the reactant. */
export function getThresholdReactionsFor(elementId: number): ThresholdReaction[] {
  return THRESHOLD_REACTIONS.filter((reaction) => reaction.reactant === elementId);
}

/**
 * Serializes THRESHOLD_REACTIONS for the GPU: 1 vec4<f32> per reaction -
 * (reactant, minTemperature, product, chance). Only 1 vec4 (not 2, unlike
 * reactions.ts's reactionData()) since these are simple substance changes
 * with no exothermic/endothermic component to track.
 */
export function thresholdReactionData(): Float32Array {
  const data = new Float32Array(THRESHOLD_REACTIONS.length * 4);
  THRESHOLD_REACTIONS.forEach((reaction, i) => {
    const offset = i * 4;
    data[offset] = reaction.reactant;
    data[offset + 1] = reaction.minTemperature;
    data[offset + 2] = reaction.product;
    data[offset + 3] = reaction.chance;
  });
  return data;
}
