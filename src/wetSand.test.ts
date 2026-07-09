import { describe, expect, it } from 'vitest';
import { SAND_TIER_LADDER, wetTierIndex, isSandTier, wetterTier, drierTier, diagonalSlideChance } from './wetSand';

describe('wet-sand tiers', () => {
  it('ladder is dry..saturated', () => {
    expect(SAND_TIER_LADDER).toEqual([2, 19, 20, 21]);
  });
  it('classifies tiers', () => {
    expect(isSandTier(2)).toBe(true);
    expect(isSandTier(21)).toBe(true);
    expect(isSandTier(3)).toBe(false); // Water
    expect(wetTierIndex(20)).toBe(2);
    expect(wetTierIndex(3)).toBe(-1);
  });
  it('steps wetter and drier, clamped at the ends', () => {
    expect(wetterTier(2)).toBe(19);
    expect(wetterTier(21)).toBe(21); // saturated stays
    expect(drierTier(21)).toBe(20);
    expect(drierTier(2)).toBe(2);    // dry stays
    expect(wetterTier(3)).toBe(3);   // non-tier unchanged
  });
  it('cohesion falls as sand gets wetter', () => {
    expect(diagonalSlideChance(2)).toBeCloseTo(1);
    expect(diagonalSlideChance(19)).toBeCloseTo(0.6);
    expect(diagonalSlideChance(21)).toBeCloseTo(0.12);
    expect(diagonalSlideChance(3)).toBeCloseTo(1); // non-tier: no cohesion gate
  });
});
