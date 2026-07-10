import { describe, expect, it } from 'vitest';
import {
  BARRIER_DENSITY,
  DENSITY_LOG_MAX,
  SIM_DENSITY_HI,
  SIM_DENSITY_LO,
  normalizedDensity,
  simDensity,
} from './density';

describe('normalizedDensity', () => {
  it('maps non-positive density to 0', () => {
    expect(normalizedDensity(0)).toBe(0);
    expect(normalizedDensity(-1)).toBe(0);
  });

  it('is monotonic increasing in real density', () => {
    const samples = [0.0001, 0.001, 0.8, 1.0, 1.6, 2.9, 5.24, 8.96];
    for (let i = 1; i < samples.length; i++) {
      expect(normalizedDensity(samples[i])).toBeGreaterThan(normalizedDensity(samples[i - 1]));
    }
  });

  it('clamps into [LO, HI]', () => {
    expect(normalizedDensity(1e-9)).toBeGreaterThanOrEqual(SIM_DENSITY_LO);
    expect(normalizedDensity(10 ** (DENSITY_LOG_MAX + 5))).toBe(SIM_DENSITY_HI);
  });

  it('matches the golden derived values (3 dp)', () => {
    expect(normalizedDensity(1.0)).toBeCloseTo(72.3704, 3); // Water
    expect(normalizedDensity(1.6)).toBeCloseTo(75.9236, 3); // Sand
    expect(normalizedDensity(2.9)).toBeCloseTo(80.4195, 3); // Lava
    expect(normalizedDensity(5.24)).toBeCloseTo(84.8921, 3); // Rust
    expect(normalizedDensity(0.0003)).toBeCloseTo(11.0462, 3); // Fire
  });
});

describe('simDensity', () => {
  it('gives static solids the barrier sentinel', () => {
    expect(simDensity('static', 2.6)).toBe(BARRIER_DENSITY); // Stone
    expect(simDensity('static', 0.7)).toBe(BARRIER_DENSITY); // Wood (lighter than sand, still a barrier)
  });

  it('gives Empty (static, zero real density) 0', () => {
    expect(simDensity('static', 0)).toBe(0);
  });

  it('derives movable densities from real density', () => {
    expect(simDensity('powder', 1.6)).toBeCloseTo(75.9236, 3);
    expect(simDensity('liquid', 2.9)).toBeCloseTo(80.4195, 3);
    expect(simDensity('gas', 0.0012)).toBeCloseTo(21.5265, 3);
  });

  it('keeps every movable strictly below the barrier sentinel', () => {
    for (const r of [1.0, 1.6, 2.9, 5.24, 8.96]) {
      expect(simDensity('powder', r)).toBeLessThan(BARRIER_DENSITY);
    }
  });
});
