import { describe, expect, it } from 'vitest';
import { BLAST_DECAY, blastEffect, CHAIN_PRESSURE, DESTROY_PRESSURE, IGNITE_PRESSURE, nextPressure } from './blast';

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

describe('blast effect selection', () => {
  it('below all thresholds does nothing', () => {
    expect(blastEffect(0, { flammable: false, explosive: false })).toBe('none');
  });
  it('an explosive over the chain threshold detonates', () => {
    expect(blastEffect(CHAIN_PRESSURE, { flammable: false, explosive: true })).toBe('detonate');
  });
  it('a flammable over the ignite threshold ignites', () => {
    expect(blastEffect(IGNITE_PRESSURE, { flammable: true, explosive: false })).toBe('ignite');
  });
  it('anything over the destroy threshold is destroyed', () => {
    expect(blastEffect(DESTROY_PRESSURE, { flammable: false, explosive: false })).toBe('destroy');
  });
  it('thresholds are ordered destroy >= chain >= ignite > 0', () => {
    expect(DESTROY_PRESSURE).toBeGreaterThanOrEqual(CHAIN_PRESSURE);
    expect(CHAIN_PRESSURE).toBeGreaterThanOrEqual(IGNITE_PRESSURE);
    expect(IGNITE_PRESSURE).toBeGreaterThan(0);
  });
});
