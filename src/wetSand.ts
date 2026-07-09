export const SAND_TIER_LADDER = [2, 19, 20, 21]; // dry, damp, wet, saturated

const COHESION = new Map<number, number>([
  [2, 1.0],
  [19, 0.6],
  [20, 0.3],
  [21, 0.12],
]);

export function wetTierIndex(elementId: number): number {
  return SAND_TIER_LADDER.indexOf(elementId);
}

export function isSandTier(elementId: number): boolean {
  return wetTierIndex(elementId) !== -1;
}

export function wetterTier(elementId: number): number {
  const i = wetTierIndex(elementId);
  if (i === -1) return elementId;
  return SAND_TIER_LADDER[Math.min(i + 1, SAND_TIER_LADDER.length - 1)];
}

export function drierTier(elementId: number): number {
  const i = wetTierIndex(elementId);
  if (i === -1) return elementId;
  return SAND_TIER_LADDER[Math.max(i - 1, 0)];
}

export function diagonalSlideChance(elementId: number): number {
  return COHESION.get(elementId) ?? 1.0;
}

const SATURATED = 21;

export function absorbDecision(
  elementId: number,
  hasWaterNeighbor: boolean,
  roll: number,
  chance: number,
): { newElementId: number; consumesWater: boolean } {
  const i = wetTierIndex(elementId);
  const canAbsorb = i !== -1 && i < SAND_TIER_LADDER.length - 1;
  if (canAbsorb && hasWaterNeighbor && roll < chance) {
    return { newElementId: wetterTier(elementId), consumesWater: true };
  }
  return { newElementId: elementId, consumesWater: false };
}

export function dripDecision(
  elementId: number,
  hasEmptyBelow: boolean,
  roll: number,
  chance: number,
): { newElementId: number; releasesWater: boolean } {
  if (elementId === SATURATED && hasEmptyBelow && roll < chance) {
    return { newElementId: drierTier(elementId), releasesWater: true };
  }
  return { newElementId: elementId, releasesWater: false };
}
