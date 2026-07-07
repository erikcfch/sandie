import { getElementByName } from './elements';

export interface ContactReaction {
  /** The element that converts. */
  reactant: number;
  /** The element that must be orthogonally adjacent to trigger the reaction. */
  catalystNeighbor: number;
  /** What the reactant becomes. */
  product: number;
  /** Per-tick probability (stochastic, like Fire's decay chance) - not instant, so a
   * large contact front converts gradually rather than flash-converting in one tick. */
  chance: number;
  /** Extra enthalpy injected into the product beyond the straight temperature
   * carry-over (see simulate.wgsl's enthalpyForNewElement) - 0 for a reaction
   * with no exothermic/endothermic kick. */
  enthalpyDelta: number;
}

export const CONTACT_REACTIONS: readonly ContactReaction[] = [
  {
    reactant: getElementByName('Lava').id,
    catalystNeighbor: getElementByName('Water').id,
    product: getElementByName('Obsidian').id,
    chance: 0.05,
    enthalpyDelta: 0,
  },
  {
    reactant: getElementByName('Copper').id,
    catalystNeighbor: getElementByName('Sulfuric Acid').id,
    product: getElementByName('Copper Sulfate').id,
    chance: 0.08,
    enthalpyDelta: 40,
  },
  {
    reactant: getElementByName('Sulfuric Acid').id,
    catalystNeighbor: getElementByName('Copper').id,
    product: getElementByName('Hydrogen').id,
    chance: 0.08,
    enthalpyDelta: 40,
  },
];

/** Finds the reactions where the given element is the reactant (not merely a catalyst). */
export function getReactionsFor(elementId: number): ContactReaction[] {
  return CONTACT_REACTIONS.filter((reaction) => reaction.reactant === elementId);
}

/**
 * Serializes CONTACT_REACTIONS for the GPU: 2 vec4<f32>s per reaction -
 * (reactant, catalystNeighbor, product, chance) then (enthalpyDelta, 0, 0, 0).
 * Element ids and chance are stored as floats (the shader casts ids back to
 * u32) purely so every reaction fits the same vec4-per-row layout as
 * src/elements.ts's materialProperties().
 */
export function reactionData(): Float32Array {
  const data = new Float32Array(CONTACT_REACTIONS.length * 8);
  CONTACT_REACTIONS.forEach((reaction, i) => {
    const offset = i * 8;
    data[offset] = reaction.reactant;
    data[offset + 1] = reaction.catalystNeighbor;
    data[offset + 2] = reaction.product;
    data[offset + 3] = reaction.chance;
    data[offset + 4] = reaction.enthalpyDelta;
  });
  return data;
}
