export type ElementCategory = 'empty' | 'static' | 'powder' | 'liquid' | 'gas';
export type ElementFamily = 'physical' | 'chem';

export type Form = 'static' | 'powder' | 'liquid' | 'gas';
export type Phase = 'solid' | 'liquid' | 'gas';
export type Origin = 'inorganic' | 'organic';
export type Metallic = 'metal' | 'nonmetal';

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
  /** Movement behavior class — drives the sim (replaces reliance on `category`). */
  form: Form;
  /** Scientific state of matter (solid covers static + powder). */
  phase: Phase;
  origin: Origin;
  metallic: Metallic;
  // --- Real scientific reference values (recorded now; adopted into the sim in a later phase). ---
  /** Real density in g/cm³. (The sim uses `density`, a game-tuned value, for movement.) */
  realDensity?: number;
  /** Real specific heat J/(g·K). (The sim uses `heatCapacity`.) */
  specificHeat?: number;
  meltingPoint?: number;
  boilingPoint?: number;
  /** log10 of dynamic viscosity (cP) at VISC_TREF=20 °C. For materials solid at
   * 20 °C (Lava, Molten Wax) this is an extrapolated log-anchor for the curve,
   * not a physical value. Only liquids set it. */
  viscosityRefLog10?: number;
  /** d(log10 cP)/d°C, ≤ 0 (viscosity drops as it heats). Absent/0 = temperature-independent. */
  viscosityTempCoeff?: number;
  // --- Capability flags ---
  flammable?: boolean;
  corrosive?: boolean;
  soluble?: boolean;
  conductive?: boolean;
  // --- Behavior params ---
  ignitionTemp?: number;
  burnProduct?: number;
  burnRate?: number;
  /** Corrosive's strength tier (higher dissolves tougher solubles). */
  corrosiveStrength?: number;
  /** Soluble's threshold: min corrosiveStrength that dissolves it (low = dissolves easily). */
  solubility?: number;
  /** What a soluble becomes when dissolved (element id; Empty = vanishes). */
  dissolvedProduct?: number;
  /** What a corrosive becomes when it reacts (element id); absent = does not deplete. */
  weakensTo?: number;
}

export const AMBIENT_TEMP = 20;

export const ELEMENTS: readonly ElementDef[] = [
  { id: 0, name: 'Empty', category: 'empty', density: 0, color: [0, 0, 0], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.05, heatCapacity: 0.5, family: 'physical', form: 'static', phase: 'solid', origin: 'inorganic', metallic: 'nonmetal', realDensity: 0, specificHeat: 0.5 },
  { id: 1, name: 'Stone', category: 'static', density: 100, color: [120, 120, 120], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.5, heatCapacity: 0.8, family: 'physical', form: 'static', phase: 'solid', origin: 'inorganic', metallic: 'nonmetal', realDensity: 2.6, specificHeat: 0.8 },
  { id: 2, name: 'Sand', category: 'powder', density: 60, color: [194, 178, 128], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.3, heatCapacity: 0.8, family: 'physical', form: 'powder', phase: 'solid', origin: 'inorganic', metallic: 'nonmetal', realDensity: 1.6, specificHeat: 0.83 },
  { id: 3, name: 'Water', category: 'liquid', density: 40, color: [64, 128, 220], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.25, heatCapacity: 4.0, family: 'physical', form: 'liquid', phase: 'liquid', origin: 'inorganic', metallic: 'nonmetal', realDensity: 1.0, specificHeat: 4.18, meltingPoint: 0, boilingPoint: 100, viscosityRefLog10: 0 },
  { id: 4, name: 'Wood', category: 'static', density: 90, color: [110, 74, 42], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.1, heatCapacity: 1.7, family: 'physical', form: 'static', phase: 'solid', origin: 'organic', metallic: 'nonmetal', flammable: true, ignitionTemp: 300, burnProduct: 9, burnRate: 1, realDensity: 0.7, specificHeat: 1.7 },
  { id: 5, name: 'Smoke', category: 'gas', density: 1, color: [180, 180, 180], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.05, heatCapacity: 0.5, family: 'physical', form: 'gas', phase: 'gas', origin: 'inorganic', metallic: 'nonmetal', realDensity: 0.0012, specificHeat: 1.0 },
  { id: 6, name: 'Ice', category: 'static', density: 95, color: [180, 220, 240], defaultTemp: -10, thermalConductivity: 0.4, heatCapacity: 2.1, family: 'physical', form: 'static', phase: 'solid', origin: 'inorganic', metallic: 'nonmetal', realDensity: 0.92, specificHeat: 2.1, meltingPoint: 0 },
  { id: 7, name: 'Lava', category: 'liquid', density: 50, color: [220, 80, 20], defaultTemp: 800, thermalConductivity: 0.4, heatCapacity: 1.0, family: 'physical', form: 'liquid', phase: 'liquid', origin: 'inorganic', metallic: 'nonmetal', realDensity: 2.9, specificHeat: 1.0, viscosityRefLog10: 11.875, viscosityTempCoeff: -0.00625 },
  { id: 8, name: 'Steam', category: 'gas', density: 1, color: [220, 220, 220], defaultTemp: 110, thermalConductivity: 0.05, heatCapacity: 2.0, family: 'physical', form: 'gas', phase: 'gas', origin: 'inorganic', metallic: 'nonmetal', realDensity: 0.0006, specificHeat: 2.0 },
  { id: 9, name: 'Fire', category: 'gas', density: 1, color: [240, 120, 30], defaultTemp: 400, thermalConductivity: 0.05, heatCapacity: 0.5, family: 'physical', form: 'gas', phase: 'gas', origin: 'inorganic', metallic: 'nonmetal', realDensity: 0.0003, specificHeat: 1.0 },
  { id: 10, name: 'Obsidian', category: 'static', density: 100, color: [40, 30, 45], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.5, heatCapacity: 0.8, family: 'physical', form: 'static', phase: 'solid', origin: 'inorganic', metallic: 'nonmetal', realDensity: 2.5, specificHeat: 0.8 },
  { id: 11, name: 'Sulfuric Acid (Dilute)', category: 'liquid', density: 45, color: [190, 220, 40], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.25, heatCapacity: 4.0, family: 'chem', formula: 'H₂SO₄', form: 'liquid', phase: 'liquid', origin: 'inorganic', metallic: 'nonmetal', corrosive: true, realDensity: 1.1, specificHeat: 3.5, corrosiveStrength: 2, weakensTo: 15, viscosityRefLog10: 0.3 },
  { id: 12, name: 'Copper', category: 'static', density: 100, color: [184, 115, 51], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.9, heatCapacity: 0.6, family: 'chem', formula: 'Cu', form: 'static', phase: 'solid', origin: 'inorganic', metallic: 'metal', conductive: true, realDensity: 8.96, specificHeat: 0.385, meltingPoint: 1085 },
  { id: 13, name: 'Copper Sulfate', category: 'powder', density: 70, color: [210, 225, 235], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.3, heatCapacity: 0.8, family: 'chem', formula: 'CuSO₄', form: 'powder', phase: 'solid', origin: 'inorganic', metallic: 'nonmetal', realDensity: 3.6, specificHeat: 0.9 },
  { id: 14, name: 'Hydrogen', category: 'gas', density: 1, color: [230, 245, 255], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.05, heatCapacity: 0.5, family: 'chem', formula: 'H₂', form: 'gas', phase: 'gas', origin: 'inorganic', metallic: 'nonmetal', realDensity: 0.00009, specificHeat: 14.3 },
  { id: 15, name: 'Sulfuric Acid (Very Dilute)', category: 'liquid', density: 41, color: [210, 230, 120], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.28, heatCapacity: 4.2, family: 'chem', formula: 'H₂SO₄', form: 'liquid', phase: 'liquid', origin: 'inorganic', metallic: 'nonmetal', corrosive: true, realDensity: 1.05, specificHeat: 3.8, corrosiveStrength: 1, weakensTo: 3, viscosityRefLog10: 0.2 },
  { id: 16, name: 'Sulfuric Acid (Concentrated)', category: 'liquid', density: 52, color: [200, 160, 20], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.20, heatCapacity: 2.5, family: 'chem', formula: 'H₂SO₄', form: 'liquid', phase: 'liquid', origin: 'inorganic', metallic: 'nonmetal', corrosive: true, realDensity: 1.83, specificHeat: 1.4, corrosiveStrength: 3, weakensTo: 11, viscosityRefLog10: 1.4, viscosityTempCoeff: -0.002 },
  { id: 17, name: 'Sulfuric Acid (Fuming)', category: 'liquid', density: 56, color: [140, 100, 10], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.15, heatCapacity: 2.0, family: 'chem', formula: 'H₂SO₄·SO₃', form: 'liquid', phase: 'liquid', origin: 'inorganic', metallic: 'nonmetal', corrosive: true, realDensity: 1.90, specificHeat: 1.3, corrosiveStrength: 4, weakensTo: 16, viscosityRefLog10: 1.5, viscosityTempCoeff: -0.002 },
  { id: 18, name: 'Sulfur Dioxide', category: 'gas', density: 1, color: [225, 225, 150], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.05, heatCapacity: 0.6, family: 'chem', formula: 'SO₂', form: 'gas', phase: 'gas', origin: 'inorganic', metallic: 'nonmetal', realDensity: 0.0026, specificHeat: 0.64 },
  { id: 19, name: 'Damp Sand', category: 'powder', density: 63, color: [150, 135, 95], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.35, heatCapacity: 1.5, family: 'physical', form: 'powder', phase: 'solid', origin: 'inorganic', metallic: 'nonmetal', realDensity: 1.8, specificHeat: 1.2 },
  { id: 20, name: 'Wet Sand', category: 'powder', density: 66, color: [120, 105, 72], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.4, heatCapacity: 2.5, family: 'physical', form: 'powder', phase: 'solid', origin: 'inorganic', metallic: 'nonmetal', realDensity: 1.95, specificHeat: 1.5 },
  { id: 21, name: 'Saturated Sand', category: 'powder', density: 70, color: [90, 78, 52], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.45, heatCapacity: 3.5, family: 'physical', form: 'powder', phase: 'solid', origin: 'inorganic', metallic: 'nonmetal', realDensity: 2.08, specificHeat: 1.8 },
  { id: 22, name: 'Salt', category: 'powder', density: 62, color: [235, 235, 240], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.3, heatCapacity: 0.88, family: 'chem', formula: 'NaCl', form: 'powder', phase: 'solid', origin: 'inorganic', metallic: 'nonmetal', soluble: true, solubility: 1, dissolvedProduct: 0, realDensity: 2.17, specificHeat: 0.88 },
  { id: 23, name: 'Limestone', category: 'powder', density: 64, color: [225, 220, 205], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.35, heatCapacity: 0.84, family: 'chem', formula: 'CaCO₃', form: 'powder', phase: 'solid', origin: 'inorganic', metallic: 'nonmetal', soluble: true, solubility: 2, dissolvedProduct: 25, realDensity: 2.71, specificHeat: 0.84 },
  { id: 24, name: 'Rust', category: 'powder', density: 76, color: [150, 70, 35], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.4, heatCapacity: 0.65, family: 'chem', formula: 'Fe₂O₃', form: 'powder', phase: 'solid', origin: 'inorganic', metallic: 'nonmetal', soluble: true, solubility: 3, dissolvedProduct: 0, realDensity: 5.24, specificHeat: 0.65 },
  { id: 25, name: 'CO₂', category: 'gas', density: 1, color: [200, 215, 205], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.05, heatCapacity: 0.85, family: 'chem', formula: 'CO₂', form: 'gas', phase: 'gas', origin: 'inorganic', metallic: 'nonmetal', realDensity: 0.00198, specificHeat: 0.85 },
  { id: 26, name: 'Wax', category: 'static', density: 85, color: [240, 235, 215], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.2, heatCapacity: 2.0, family: 'physical', form: 'static', phase: 'solid', origin: 'organic', metallic: 'nonmetal', realDensity: 0.9, specificHeat: 2.1, meltingPoint: 60 },
  { id: 27, name: 'Molten Wax', category: 'liquid', density: 42, color: [235, 210, 150], defaultTemp: 70, thermalConductivity: 0.2, heatCapacity: 2.2, family: 'physical', form: 'liquid', phase: 'liquid', origin: 'organic', metallic: 'nonmetal', realDensity: 0.8, specificHeat: 2.2, meltingPoint: 60, viscosityRefLog10: 2.68, viscosityTempCoeff: -0.022 },
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
  const data = new Float32Array(ELEMENTS.length * 12);
  for (const element of ELEMENTS) {
    const offset = element.id * 12;
    data[offset + 0] = element.density;
    data[offset + 1] = element.thermalConductivity;
    data[offset + 2] = element.heatCapacity;
    data[offset + 3] = element.ignitionTemp ?? 0;
    data[offset + 4] = element.burnProduct ?? 0;
    data[offset + 5] = element.burnRate ?? 0;
    data[offset + 6] = element.corrosiveStrength ?? 0;
    data[offset + 7] = element.solubility ?? 0;
    data[offset + 8] = element.dissolvedProduct ?? 0;
    data[offset + 9] = element.weakensTo ?? element.id; // self = does not deplete
    data[offset + 10] = 0;
    data[offset + 11] = 0;
  }
  return data;
}

const FORM_BITS: Record<Form, number> = { static: 0, powder: 1, liquid: 2, gas: 3 };

/** Packs each material's form (bits 0-1) + capability/taxonomy flags into one u32.
 * Mirrored in simulate.wgsl. */
export function materialFlags(): Uint32Array {
  const data = new Uint32Array(ELEMENTS.length);
  for (const element of ELEMENTS) {
    let f = FORM_BITS[element.form];
    if (element.flammable) f |= 1 << 2;
    if (element.corrosive) f |= 1 << 3;
    if (element.soluble) f |= 1 << 4;
    if (element.conductive) f |= 1 << 5;
    if (element.origin === 'organic') f |= 1 << 6;
    if (element.metallic === 'metal') f |= 1 << 7;
    data[element.id] = f >>> 0;
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
