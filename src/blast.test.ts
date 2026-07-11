import { describe, expect, it } from 'vitest';
import { BLAST_DECAY, nextPressure } from './blast';

describe('pressure field update', () => {
  it('an isolated pressure cell decays toward zero', () => {
    let p = 40;
    for (let i = 0; i < 30; i++) p = nextPressure(p, 0, 0, 0, 0, 0);
    expect(p).toBeLessThan(0.5);
  });
  it('pressure spreads to neighbours (a zero cell beside a hot one gains pressure)', () => {
    expect(nextPressure(0, 40, 0, 0, 0, 0)).toBeGreaterThan(0);
  });
  it('injection adds on top of the decayed/diffused value', () => {
    expect(nextPressure(0, 0, 0, 0, 0, 40)).toBeGreaterThanOrEqual(40 * BLAST_DECAY);
  });
  it('is monotonic in injection', () => {
    expect(nextPressure(10, 0, 0, 0, 0, 20)).toBeGreaterThan(nextPressure(10, 0, 0, 0, 0, 0));
  });
});
