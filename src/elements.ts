export type ElementCategory = 'empty' | 'static' | 'powder' | 'liquid' | 'gas';

export interface ElementDef {
  id: number;
  name: string;
  category: ElementCategory;
  density: number;
  color: [number, number, number];
}

export const ELEMENTS: readonly ElementDef[] = [
  { id: 0, name: 'Empty', category: 'empty', density: 0, color: [0, 0, 0] },
  { id: 1, name: 'Stone', category: 'static', density: 100, color: [120, 120, 120] },
  { id: 2, name: 'Sand', category: 'powder', density: 60, color: [194, 178, 128] },
  { id: 3, name: 'Water', category: 'liquid', density: 40, color: [64, 128, 220] },
  { id: 4, name: 'Wood', category: 'static', density: 90, color: [110, 74, 42] },
  { id: 5, name: 'Smoke', category: 'gas', density: 1, color: [180, 180, 180] },
];

const BY_NAME = new Map(ELEMENTS.map((e) => [e.name, e]));

export function getElement(id: number): ElementDef {
  const element = ELEMENTS[id];
  if (!element) {
    throw new Error(`Unknown element id: ${id}`);
  }
  return element;
}

export function getElementByName(name: string): ElementDef {
  const element = BY_NAME.get(name);
  if (!element) {
    throw new Error(`Unknown element name: ${name}`);
  }
  return element;
}

export function colorPalette(): Float32Array {
  const palette = new Float32Array(ELEMENTS.length * 4);
  for (const element of ELEMENTS) {
    const offset = element.id * 4;
    palette[offset] = element.color[0] / 255;
    palette[offset + 1] = element.color[1] / 255;
    palette[offset + 2] = element.color[2] / 255;
    palette[offset + 3] = 1;
  }
  return palette;
}
