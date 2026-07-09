import { describe, expect, it } from 'vitest';
import { getElementByName } from './elements';
import { dissolves } from './corrosion';

const id = (n: string) => getElementByName(n).id;

describe('corrosion ladder', () => {
  it('gates dissolving on corrosiveStrength >= solubility', () => {
    expect(dissolves(id('Sulfuric Acid (Very Dilute)'), id('Salt'))).toBe(true);
    expect(dissolves(id('Sulfuric Acid (Very Dilute)'), id('Limestone'))).toBe(false);
    expect(dissolves(id('Sulfuric Acid (Dilute)'), id('Limestone'))).toBe(true);
    expect(dissolves(id('Sulfuric Acid (Dilute)'), id('Rust'))).toBe(false);
    expect(dissolves(id('Sulfuric Acid (Concentrated)'), id('Rust'))).toBe(true);
  });
  it('non-corrosive or non-soluble pairs never dissolve', () => {
    expect(dissolves(id('Water'), id('Salt'))).toBe(false);
    expect(dissolves(id('Sulfuric Acid (Fuming)'), id('Sand'))).toBe(false);
  });
});
