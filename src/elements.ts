export type ElementCategory = 'empty' | 'static' | 'powder' | 'liquid' | 'gas';

export interface ElementDef {
  id: number;
  name: string;
  category: ElementCategory;
  density: number;
  color: [number, number, number];
  defaultTemp: number;
  /** How fast heat flows through this material (0-1, higher = better conductor). */
  thermalConductivity: number;
  /** How much energy it takes to change this material's temperature (higher = more thermal inertia). */
  heatCapacity: number;
}

export const AMBIENT_TEMP = 20;

export const ELEMENTS: readonly ElementDef[] = [
  { id: 0, name: 'Empty', category: 'empty', density: 0, color: [0, 0, 0], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.05, heatCapacity: 0.5 },
  { id: 1, name: 'Stone', category: 'static', density: 100, color: [120, 120, 120], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.5, heatCapacity: 0.8 },
  { id: 2, name: 'Sand', category: 'powder', density: 60, color: [194, 178, 128], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.3, heatCapacity: 0.8 },
  { id: 3, name: 'Water', category: 'liquid', density: 40, color: [64, 128, 220], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.25, heatCapacity: 4.0 },
  { id: 4, name: 'Wood', category: 'static', density: 90, color: [110, 74, 42], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.1, heatCapacity: 1.7 },
  { id: 5, name: 'Smoke', category: 'gas', density: 1, color: [180, 180, 180], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.05, heatCapacity: 0.5 },
  { id: 6, name: 'Ice', category: 'static', density: 95, color: [180, 220, 240], defaultTemp: -10, thermalConductivity: 0.4, heatCapacity: 2.1 },
  { id: 7, name: 'Lava', category: 'liquid', density: 50, color: [220, 80, 20], defaultTemp: 800, thermalConductivity: 0.4, heatCapacity: 1.0 },
  { id: 8, name: 'Steam', category: 'gas', density: 1, color: [220, 220, 220], defaultTemp: 110, thermalConductivity: 0.05, heatCapacity: 2.0 },
  { id: 9, name: 'Fire', category: 'gas', density: 1, color: [240, 120, 30], defaultTemp: 400, thermalConductivity: 0.05, heatCapacity: 0.5 },
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

export function materialProperties(): Float32Array {
  const data = new Float32Array(ELEMENTS.length * 4);
  for (const element of ELEMENTS) {
    const offset = element.id * 4;
    data[offset] = element.density;
    data[offset + 1] = element.thermalConductivity;
    data[offset + 2] = element.heatCapacity;
    data[offset + 3] = 0;
  }
  return data;
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
