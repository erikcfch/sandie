import { getElement, getElementByName } from './elements';

export interface PhaseTransition {
  /** The cooler phase (e.g. Ice). */
  lowElementId: number;
  /** The warmer phase (e.g. Water). */
  highElementId: number;
  /** Equilibrium temperature - the single point at which both directions happen. */
  boundaryTemp: number;
  /** Enthalpy width of the plateau at boundaryTemp: energy absorbed/released while temperature holds flat. */
  latentHeat: number;
}

// Each transition happens at ONE equilibrium temperature in both directions,
// matching real phase equilibria (ice melts and water freezes at the same
// 0 degrees - there's no physical basis for different melt/freeze points).
export const PHASE_TRANSITIONS: readonly PhaseTransition[] = [
  { lowElementId: getElementByName('Ice').id, highElementId: getElementByName('Water').id, boundaryTemp: 0, latentHeat: 80 },
  { lowElementId: getElementByName('Water').id, highElementId: getElementByName('Steam').id, boundaryTemp: 100, latentHeat: 540 },
  { lowElementId: getElementByName('Stone').id, highElementId: getElementByName('Lava').id, boundaryTemp: 700, latentHeat: 200 },
  { lowElementId: getElementByName('Wax').id, highElementId: getElementByName('Molten Wax').id, boundaryTemp: 60, latentHeat: 40 },
];

export interface ChainSegment {
  elementId: number;
  heatCapacity: number;
}

export interface Chain {
  /** Ordered coldest to hottest. */
  segments: ChainSegment[];
  /** transitions[i] connects segments[i] and segments[i + 1]. */
  transitions: PhaseTransition[];
}

const chainCache = new Map<number, Chain | undefined>();

/** Finds the full ordered chain of phases an element belongs to (e.g. querying Steam returns Ice-Water-Steam), or undefined if it has no phase transitions. */
export function getChain(elementId: number): Chain | undefined {
  if (chainCache.has(elementId)) {
    return chainCache.get(elementId);
  }

  const touchesElement = PHASE_TRANSITIONS.some((t) => t.lowElementId === elementId || t.highElementId === elementId);
  if (!touchesElement) {
    chainCache.set(elementId, undefined);
    return undefined;
  }

  let coldest = elementId;
  let downTransition = PHASE_TRANSITIONS.find((t) => t.highElementId === coldest);
  while (downTransition) {
    coldest = downTransition.lowElementId;
    downTransition = PHASE_TRANSITIONS.find((t) => t.highElementId === coldest);
  }

  const segments: ChainSegment[] = [{ elementId: coldest, heatCapacity: getElement(coldest).heatCapacity }];
  const transitions: PhaseTransition[] = [];
  let current = coldest;
  let upTransition = PHASE_TRANSITIONS.find((t) => t.lowElementId === current);
  while (upTransition) {
    transitions.push(upTransition);
    current = upTransition.highElementId;
    segments.push({ elementId: current, heatCapacity: getElement(current).heatCapacity });
    upTransition = PHASE_TRANSITIONS.find((t) => t.lowElementId === current);
  }

  const chain: Chain = { segments, transitions };
  chainCache.set(elementId, chain);
  return chain;
}
