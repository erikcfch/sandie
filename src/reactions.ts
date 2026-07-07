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
}

export const CONTACT_REACTIONS: readonly ContactReaction[] = [
  {
    reactant: getElementByName('Lava').id,
    catalystNeighbor: getElementByName('Water').id,
    product: getElementByName('Obsidian').id,
    chance: 0.05,
  },
];

/** Finds the reactions where the given element is the reactant (not merely a catalyst). */
export function getReactionsFor(elementId: number): ContactReaction[] {
  return CONTACT_REACTIONS.filter((reaction) => reaction.reactant === elementId);
}
