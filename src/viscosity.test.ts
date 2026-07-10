import { describe, expect, it } from 'vitest';
import { getElementByName } from './elements';
import { FLUID_MIN_DRIP, dripFluidityAt, fluidityAt, logViscosityAt } from './viscosity';

const id = (n: string) => getElementByName(n).id;

describe('fluidity from temperature', () => {
  it('water is fully fluid across its range', () => {
    expect(fluidityAt(id('Water'), 20)).toBeGreaterThan(0.98);
    expect(fluidityAt(id('Water'), 90)).toBeGreaterThan(0.98);
  });
  it('lava is far less fluid than water at equal temperature, and near-zero horizontally', () => {
    expect(fluidityAt(id('Lava'), 800)).toBeLessThan(fluidityAt(id('Water'), 800));
    expect(fluidityAt(id('Lava'), 800)).toBeLessThan(0.001);
  });
  it('lava and wax get more fluid as they heat', () => {
    expect(fluidityAt(id('Lava'), 1200)).toBeGreaterThan(fluidityAt(id('Lava'), 800));
    expect(fluidityAt(id('Molten Wax'), 120)).toBeGreaterThan(fluidityAt(id('Molten Wax'), 65));
  });
  it('concentrated acid is a touch less fluid than dilute', () => {
    expect(fluidityAt(id('Sulfuric Acid (Concentrated)'), 20)).toBeLessThan(
      fluidityAt(id('Sulfuric Acid (Dilute)'), 20),
    );
  });
  it('drip fluidity is floored so even lava eventually settles', () => {
    expect(dripFluidityAt(id('Lava'), 20)).toBe(FLUID_MIN_DRIP);
    expect(dripFluidityAt(id('Water'), 20)).toBeGreaterThan(FLUID_MIN_DRIP);
  });
  it('non-liquids fall back to a fluid default (never read in the sim)', () => {
    expect(logViscosityAt(id('Sand'), 20)).toBe(0);
  });
});
