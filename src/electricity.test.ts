import { describe, expect, it } from 'vitest';
import { REACH_MAX, REACH_STEP, REACH_TAU, isLive, reachUpdate } from './electricity';

describe('reachability update (gradient)', () => {
  it('a source pins to MAX', () => {
    expect(reachUpdate(0, true, true)).toBe(REACH_MAX);
  });
  it('a non-conductor is always 0', () => {
    expect(reachUpdate(REACH_MAX, false, false)).toBe(0);
  });
  it('a conductor sits one step below its highest neighbour', () => {
    expect(reachUpdate(REACH_MAX, true, false)).toBe(REACH_MAX - REACH_STEP);
  });
  it('reach descends with hop distance from a source', () => {
    let r = REACH_MAX; // source
    const chain = [] as number[];
    for (let i = 0; i < 5; i++) { r = reachUpdate(r, true, false); chain.push(r); }
    expect(chain).toEqual([REACH_MAX - REACH_STEP, REACH_MAX - 2 * REACH_STEP, REACH_MAX - 3 * REACH_STEP, REACH_MAX - 4 * REACH_STEP, REACH_MAX - 5 * REACH_STEP]);
  });
  it('an orphaned segment (no source anchor) collapses toward 0', () => {
    // a conductor whose only neighbour also keeps dropping: feed it its own decreasing value
    let r = REACH_MAX;
    for (let i = 0; i < REACH_MAX / REACH_STEP + 5; i++) r = reachUpdate(r, true, false);
    expect(r).toBe(0);
  });
  it('clamps at 0 (never negative)', () => {
    expect(reachUpdate(0, true, false)).toBe(0);
  });
  it('LIVE requires both reaches at/above tau (open circuit is dead)', () => {
    expect(isLive(REACH_MAX, REACH_MAX)).toBe(true);
    expect(isLive(REACH_MAX, 0)).toBe(false);
    expect(isLive(0, REACH_MAX)).toBe(false);
    expect(isLive(REACH_TAU, REACH_TAU)).toBe(true);
  });
});
