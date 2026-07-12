import { describe, expect, it } from 'vitest';
import { REACH_MAX, REACH_TAU, isLive, reachUpdate } from './electricity';

describe('reachability update', () => {
  it('a source is always MAX', () => {
    expect(reachUpdate(0, 0, true, true)).toBe(REACH_MAX);
  });
  it('a non-conductor is always 0', () => {
    expect(reachUpdate(REACH_MAX, REACH_MAX, false, false)).toBe(0);
  });
  it('a conductor next to a reachable neighbour resets to MAX', () => {
    expect(reachUpdate(0, REACH_MAX, true, false)).toBe(REACH_MAX);
  });
  it('a conductor cut off from any reachable neighbour decays toward 0', () => {
    let r = REACH_MAX;
    for (let i = 0; i < 20; i++) r = reachUpdate(r, 0, true, false);
    expect(r).toBe(0);
    // and strictly decreases while positive
    expect(reachUpdate(REACH_MAX, 0, true, false)).toBeLessThan(REACH_MAX);
  });
  it('LIVE requires both reaches at/above tau (open circuit is dead)', () => {
    expect(isLive(REACH_MAX, REACH_MAX)).toBe(true);
    expect(isLive(REACH_MAX, 0)).toBe(false); // source but no ground path
    expect(isLive(0, REACH_MAX)).toBe(false);
    expect(isLive(REACH_TAU, REACH_TAU)).toBe(true);
  });
});
