import { getElementByName } from './elements';

/**
 * Sentinel `reactionData()` writes for a reaction with no `minTemperature`
 * gate (always applies, at any temperature) - must stay in sync with
 * simulate.wgsl's `NO_MIN_TEMPERATURE` const.
 */
export const NO_MIN_TEMPERATURE = -999;

export interface ContactReaction {
  /** The element that converts. Must not be Wood or Fire - their
   * transformations are handled by bespoke logic in simulate.wgsl's heat(),
   * not by the generic data-driven reaction loop, so an entry with either
   * as reactant would silently never fire. */
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
  /** Minimum temperature (inclusive) the reactant must be at for this
   * reaction to apply. Absent means it applies at any temperature. */
  minTemperature?: number;
}

export const CONTACT_REACTIONS: readonly ContactReaction[] = [
  {
    reactant: getElementByName('Lava').id,
    catalystNeighbor: getElementByName('Water').id,
    product: getElementByName('Obsidian').id,
    chance: 0.05,
    enthalpyDelta: 0,
  },
  // Concentrated acid needs heat to attack copper in reality
  // (Cu + 2H2SO4 -> CuSO4 + SO2 + 2H2O); dilute/very-dilute acid can't
  // oxidize copper at all, so there are deliberately no reactions for those
  // tiers. One cell can only hold one product, so this is split across
  // independent rows, weighted roughly toward the real 1:2 SO2:H2O ratio.
  {
    reactant: getElementByName('Copper').id,
    catalystNeighbor: getElementByName('Sulfuric Acid (Concentrated)').id,
    product: getElementByName('Copper Sulfate').id,
    chance: 0.06,
    enthalpyDelta: 40,
    minTemperature: 150,
  },
  {
    reactant: getElementByName('Sulfuric Acid (Concentrated)').id,
    catalystNeighbor: getElementByName('Copper').id,
    product: getElementByName('Sulfur Dioxide').id,
    chance: 0.02,
    enthalpyDelta: 40,
    minTemperature: 150,
  },
  {
    reactant: getElementByName('Sulfuric Acid (Concentrated)').id,
    catalystNeighbor: getElementByName('Copper').id,
    product: getElementByName('Water').id,
    chance: 0.04,
    enthalpyDelta: 40,
    minTemperature: 150,
  },
  // Fuming acid is more reactive than plain concentrated acid - needs less
  // heat, reacts faster.
  {
    reactant: getElementByName('Copper').id,
    catalystNeighbor: getElementByName('Sulfuric Acid (Fuming)').id,
    product: getElementByName('Copper Sulfate').id,
    chance: 0.10,
    enthalpyDelta: 60,
    minTemperature: 80,
  },
  {
    reactant: getElementByName('Sulfuric Acid (Fuming)').id,
    catalystNeighbor: getElementByName('Copper').id,
    product: getElementByName('Sulfur Dioxide').id,
    chance: 0.04,
    enthalpyDelta: 60,
    minTemperature: 80,
  },
  {
    reactant: getElementByName('Sulfuric Acid (Fuming)').id,
    catalystNeighbor: getElementByName('Copper').id,
    product: getElementByName('Water').id,
    chance: 0.06,
    enthalpyDelta: 60,
    minTemperature: 80,
  },
  // Iron slowly rusts wherever it touches Water (Fe + O2/H2O -> Fe2O3): any
  // temperature, very low per-tick chance, no thermal kick.
  {
    reactant: getElementByName('Iron').id,
    catalystNeighbor: getElementByName('Water').id,
    product: getElementByName('Rust').id,
    chance: 0.002,
    enthalpyDelta: 0,
  },
  // Thermite: hot rust (Fe2O3) reduced by adjacent aluminium releases intense
  // heat and molten iron (2Al + Fe2O3 -> 2Fe + Al2O3). Aluminium is modelled as
  // the catalyst (a simplification - real thermite consumes it). The large
  // enthalpyDelta pushes the Molten Iron product past its 675 plateau start (at
  // the 160C gate the carry-over is 0.45*160=72) to ~1670C, so it stays molten
  // and conducts heat into neighbouring rust to sustain the reaction.
  // Molten Iron is the first PHASE-CHAINED contact-reaction product; assigning a
  // chained product to result.elementId from inside the reaction loop tripped a
  // Dawn/WGSL codegen bug (the grid write silently no-op'd) until the assignment
  // was hoisted out of the loop in simulate.wgsl. minTemperature is 160 (not the
  // ~300 first specced): in-browser, lava cools to stone in ~2s, so it can't
  // sustain-heat the aluminium-adjacent rust anywhere near 300; 160 is reached
  // where lava touches the mix, so a rust+aluminium MIX ignited by lava/fire
  // flares to molten iron. A well-mixed pile with lava in good contact flares
  // hardest; a thin/sparse mix only smoulders - the same heat-delivery character
  // as coal (3d-1) and TNT (3b). 160 stays above MAX_AMBIENT (150) so a hot
  // source is required. chance 0.15 (higher than the acid/rust rows) so the
  // cascade builds before the fresh molten iron drips away.
  {
    reactant: getElementByName('Rust').id,
    catalystNeighbor: getElementByName('Aluminium').id,
    product: getElementByName('Molten Iron').id,
    chance: 0.15,
    enthalpyDelta: 1000,
    minTemperature: 160,
  },
  // Sodium reacts violently at a water boundary. Split into two one-cell
  // products so Sodium flares while adjacent Water releases Hydrogen gas.
  {
    reactant: getElementByName('Sodium').id,
    catalystNeighbor: getElementByName('Water').id,
    product: getElementByName('Fire').id,
    chance: 0.5,
    enthalpyDelta: 600,
  },
  {
    reactant: getElementByName('Water').id,
    catalystNeighbor: getElementByName('Sodium').id,
    product: getElementByName('Hydrogen').id,
    chance: 0.3,
    enthalpyDelta: 0,
  },
  // Salt dissolves into conductive brine wherever it touches Water.
  {
    reactant: getElementByName('Salt').id,
    catalystNeighbor: getElementByName('Water').id,
    product: getElementByName('Salt Water').id,
    chance: 0.1,
    enthalpyDelta: 0,
  },
];

/** Finds the reactions where the given element is the reactant (not merely a catalyst). */
export function getReactionsFor(elementId: number): ContactReaction[] {
  return CONTACT_REACTIONS.filter((reaction) => reaction.reactant === elementId);
}

/**
 * Serializes CONTACT_REACTIONS for the GPU: 2 vec4<f32>s per reaction -
 * (reactant, catalystNeighbor, product, chance) then (enthalpyDelta,
 * minTemperature, unused, unused). Element ids and chance are stored as
 * floats (the shader casts ids back to u32) purely so every reaction fits
 * the same vec4-per-row layout as src/elements.ts's materialProperties().
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
    data[offset + 5] = reaction.minTemperature ?? NO_MIN_TEMPERATURE;
  });
  return data;
}
