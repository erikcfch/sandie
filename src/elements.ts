export type ElementCategory = 'empty' | 'static' | 'powder' | 'liquid' | 'gas';
export type ElementFamily = 'physical' | 'chem';

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
  /** Which toolbar section this element groups under. */
  family: ElementFamily;
  /** Chemical formula shown alongside a chem-family element's name (e.g. 'CuSO₄'). */
  formula?: string;
}

export const AMBIENT_TEMP = 20;

export const ELEMENTS: readonly ElementDef[] = [
  { id: 0, name: 'Empty', category: 'empty', density: 0, color: [0, 0, 0], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.05, heatCapacity: 0.5, family: 'physical' },
  { id: 1, name: 'Stone', category: 'static', density: 100, color: [120, 120, 120], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.5, heatCapacity: 0.8, family: 'physical' },
  { id: 2, name: 'Sand', category: 'powder', density: 60, color: [194, 178, 128], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.3, heatCapacity: 0.8, family: 'physical' },
  { id: 3, name: 'Water', category: 'liquid', density: 40, color: [64, 128, 220], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.25, heatCapacity: 4.0, family: 'physical' },
  { id: 4, name: 'Wood', category: 'static', density: 90, color: [110, 74, 42], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.1, heatCapacity: 1.7, family: 'physical' },
  { id: 5, name: 'Smoke', category: 'gas', density: 1, color: [180, 180, 180], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.05, heatCapacity: 0.5, family: 'physical' },
  { id: 6, name: 'Ice', category: 'static', density: 95, color: [180, 220, 240], defaultTemp: -10, thermalConductivity: 0.4, heatCapacity: 2.1, family: 'physical' },
  { id: 7, name: 'Lava', category: 'liquid', density: 50, color: [220, 80, 20], defaultTemp: 800, thermalConductivity: 0.4, heatCapacity: 1.0, family: 'physical' },
  { id: 8, name: 'Steam', category: 'gas', density: 1, color: [220, 220, 220], defaultTemp: 110, thermalConductivity: 0.05, heatCapacity: 2.0, family: 'physical' },
  { id: 9, name: 'Fire', category: 'gas', density: 1, color: [240, 120, 30], defaultTemp: 400, thermalConductivity: 0.05, heatCapacity: 0.5, family: 'physical' },
  { id: 10, name: 'Obsidian', category: 'static', density: 100, color: [40, 30, 45], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.5, heatCapacity: 0.8, family: 'physical' },
  { id: 11, name: 'Sulfuric Acid (Dilute)', category: 'liquid', density: 45, color: [190, 220, 40], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.25, heatCapacity: 4.0, family: 'chem', formula: 'H₂SO₄' },
  { id: 12, name: 'Copper', category: 'static', density: 100, color: [184, 115, 51], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.9, heatCapacity: 0.6, family: 'chem', formula: 'Cu' },
  { id: 13, name: 'Copper Sulfate', category: 'powder', density: 70, color: [210, 225, 235], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.3, heatCapacity: 0.8, family: 'chem', formula: 'CuSO₄' },
  { id: 14, name: 'Hydrogen', category: 'gas', density: 1, color: [230, 245, 255], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.05, heatCapacity: 0.5, family: 'chem', formula: 'H₂' },
  { id: 15, name: 'Sulfuric Acid (Very Dilute)', category: 'liquid', density: 41, color: [210, 230, 120], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.28, heatCapacity: 4.2, family: 'chem', formula: 'H₂SO₄' },
  { id: 16, name: 'Sulfuric Acid (Concentrated)', category: 'liquid', density: 52, color: [200, 160, 20], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.20, heatCapacity: 2.5, family: 'chem', formula: 'H₂SO₄' },
  { id: 17, name: 'Sulfuric Acid (Fuming)', category: 'liquid', density: 56, color: [140, 100, 10], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.15, heatCapacity: 2.0, family: 'chem', formula: 'H₂SO₄·SO₃' },
  { id: 18, name: 'Sulfur Dioxide', category: 'gas', density: 1, color: [225, 225, 150], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.05, heatCapacity: 0.6, family: 'chem', formula: 'SO₂' },
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
