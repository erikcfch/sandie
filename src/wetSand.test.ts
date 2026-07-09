import { describe, expect, it } from 'vitest';
import { SAND_TIER_LADDER, wetTierIndex, isSandTier, wetterTier, drierTier, diagonalSlideChance } from './wetSand';
import { absorbDecision, dripDecision } from './wetSand';

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

describe('absorb decision', () => {
  it('wets one tier and consumes water when it fires', () => {
    const r = absorbDecision(2, true, 0.0, 0.08); // roll below chance -> fires
    expect(r).toEqual({ newElementId: 19, consumesWater: true });
  });
  it('does nothing without a water neighbor', () => {
    expect(absorbDecision(2, false, 0.0, 0.08)).toEqual({ newElementId: 2, consumesWater: false });
  });
  it('does nothing when the roll misses', () => {
    expect(absorbDecision(2, true, 0.5, 0.08)).toEqual({ newElementId: 2, consumesWater: false });
  });
  it('saturated sand cannot absorb more', () => {
    expect(absorbDecision(21, true, 0.0, 0.08)).toEqual({ newElementId: 21, consumesWater: false });
  });
});

describe('drip decision', () => {
  it('saturated over empty releases one water and drops a tier', () => {
    expect(dripDecision(21, true, 0.0, 0.10)).toEqual({ newElementId: 20, releasesWater: true });
  });
  it('only saturated drips', () => {
    expect(dripDecision(20, true, 0.0, 0.10)).toEqual({ newElementId: 20, releasesWater: false });
  });
  it('needs an empty cell below', () => {
    expect(dripDecision(21, false, 0.0, 0.10)).toEqual({ newElementId: 21, releasesWater: false });
  });
});
