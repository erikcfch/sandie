import { describe, expect, it } from 'vitest';
import { getElementByName } from './elements';
import { chainData, chainStartOf, chainCountOf } from './chains';

const id = (n: string) => getElementByName(n).id;

describe('chain buffer', () => {
  it('flattens each chain to 4 floats/segment, coldest first, with the transition above', () => {
    const data = chainData();
    const start = chainStartOf(id('Ice'));
    expect(chainCountOf(id('Ice'))).toBe(3);
    expect(data[start * 4 + 0]).toBe(id('Ice'));
    expect(data[start * 4 + 2]).toBe(0);   // Ice->Water boundary temp
    expect(data[start * 4 + 3]).toBe(80);  // Ice->Water latent heat
    expect(data[(start + 1) * 4 + 0]).toBe(id('Water'));
    expect(data[(start + 1) * 4 + 2]).toBe(100); // Water->Steam boundary
  });
  it('all elements in a chain share start/count; simple materials get 0', () => {
    expect(chainStartOf(id('Water'))).toBe(chainStartOf(id('Ice')));
    expect(chainCountOf(id('Steam'))).toBe(3);
    expect(chainCountOf(id('Lava'))).toBe(2);
    expect(chainCountOf(id('Sand'))).toBe(0);
    expect(chainStartOf(id('Sand'))).toBe(0);
    expect(chainCountOf(id('Wax'))).toBe(2);
  });
});
