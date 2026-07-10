# Material System Phase 2c — Temperature-Dependent Viscosity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make liquid flow a per-liquid, temperature-dependent viscosity. A `fluidity ∈ (0,1]` gate (derived from each cell's temperature via a per-material curve, using 2b's `thermalFromEnthalpy`) throttles every liquid's motion into empty space, generalizing the water-only `waterMovement` pass to all liquids. Water/acids/hot-wax flow freely; cool Lava mounds and only creeps, flows faster when superheated, and freezes to Stone as it cools.

**Architecture:** New per-material viscosity params (`viscosityRefLog10`, `viscosityTempCoeff`) pack into the `materials` buffer, grown 3→4 vec4/element (stride bump like 2a). A pure `src/viscosity.ts` module mirrors the shader fluidity math for unit tests. In `simulate.wgsl`, fluidity helpers feed a generalized `liquidMovement` pass (replacing `waterMovement`); the `movement` pass defers liquid-into-air moves to it (buoyancy/cross-material density swaps stay gravity-driven). Behavior-preserving for every non-flow system; verified in headed Chrome.

**Tech Stack:** TypeScript, WebGPU (WGSL), Vite, Vitest, Playwright.

**Reference spec:** `docs/superpowers/specs/2026-07-09-material-viscosity-design.md`

---

## Locked conventions (read before starting)

**Fluidity model (mirror exactly in TS and WGSL):**
```
logVisc(T)  = clamp(viscosityRefLog10 + viscosityTempCoeff * (T - VISC_TREF), VISC_LOG_MIN, VISC_LOG_MAX)
fluidity(T) = VISC_HALF / (VISC_HALF + 10^logVisc(T))         // horizontal/leveling; ~0 for very thick liquids
dripFluidity(T) = max(FLUID_MIN_DRIP, fluidity(T))            // vertical drip; floored so liquids never hang
```
Constants (both sides): `VISC_TREF = 20`, `VISC_HALF = 200`, `FLUID_MIN_DRIP = 0.02`, `VISC_LOG_MIN = -1`, `VISC_LOG_MAX = 14`. The shader gets `T` from `thermalFromEnthalpy(id, enthalpy).temperature`; the TS mirror takes `T` directly (the enthalpy→T step is already 2b-tested).

**`materials` buffer:** grows from **3 vec4 (12 floats)** to **4 vec4 (16 floats)** per element. The first 12 floats are unchanged; the new vec4[3] = `(viscosityRefLog10, viscosityTempCoeff, 0, 0)`. Every shader accessor stride changes `materials[id * 3u …]` → `materials[id * 4u …]`; within-element offsets 0–11 are unchanged, so `chainStart`/`chainCount` stay at float offsets 10/11 (now `materials[id*4u + 2u].z/.w`).

**Per-liquid values** (fitted so `logVisc` hits real cP at operating temperature; only liquids set them):

| id | liquid | viscosityRefLog10 | viscosityTempCoeff | logVisc @ default T → cP |
|----|--------|-------------------|--------------------|-------------------------|
| 3 | Water | 0 | 0 | 0 → 1 cP |
| 15 | Sulfuric Acid (Very Dilute) | 0.2 | 0 | 0.2 → 1.6 cP |
| 11 | Sulfuric Acid (Dilute) | 0.3 | 0 | 0.3 → 2 cP |
| 16 | Sulfuric Acid (Concentrated) | 1.4 | -0.002 | 1.4 → 25 cP |
| 17 | Sulfuric Acid (Fuming) | 1.5 | -0.002 | 1.5 → 32 cP |
| 27 | Molten Wax | 2.68 | -0.022 | @70 °C: 1.58 → 38 cP |
| 7 | Lava | 11.875 | -0.00625 | @800 °C: 7 → 10⁷ cP |

These are initial values; Task 5 tunes them in-browser. They yield fluidity: Water ≈ 0.995, acids 0.86–0.99, Molten Wax ≈ 0.84 @70 °C (0.98 when hot), Lava ≈ 2e-5 @800 °C (0.007 @1200 °C).

**Element ids:** Water 3, Lava 7, Acid Dilute 11, Acid Very Dilute 15, Acid Concentrated 16, Acid Fuming 17, Molten Wax 27.

**WGSL discipline:** not validated by typecheck/build — after each shader task, drive headed Chrome (`channel:'chrome'`), watch the console for "Invalid ComputePipeline", no i32/u32 mixing (`u32(blockX) + Ku`).

---

# PART A — Data + pure module (TS, unit-tested)

### Task 1: Viscosity fields on `ElementDef` + per-liquid values

**Files:** Modify `src/elements.ts`, `src/elements.test.ts`

- [ ] **Step 1: Write the failing test.** Append to `src/elements.test.ts`:

```ts
describe('viscosity data', () => {
  it('sets a viscosity curve on liquids, ordered water < acids < wax < lava', () => {
    const refLog = (n: string) => getElementByName(n).viscosityRefLog10;
    expect(refLog('Water')).toBe(0);
    expect(refLog('Sulfuric Acid (Concentrated)')!).toBeGreaterThan(refLog('Sulfuric Acid (Dilute)')!);
    expect(refLog('Molten Wax')!).toBeGreaterThan(refLog('Sulfuric Acid (Fuming)')!);
    expect(refLog('Lava')!).toBeGreaterThan(refLog('Molten Wax')!);
  });
  it('gives Lava and Molten Wax a negative temperature coefficient (thinner when hotter)', () => {
    expect(getElementByName('Lava').viscosityTempCoeff!).toBeLessThan(0);
    expect(getElementByName('Molten Wax').viscosityTempCoeff!).toBeLessThan(0);
  });
  it('leaves non-liquids without a viscosity curve', () => {
    expect(getElementByName('Sand').viscosityRefLog10).toBeUndefined();
    expect(getElementByName('Stone').viscosityRefLog10).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, confirm FAIL** — `npm test -- src/elements.test.ts`.

- [ ] **Step 3: Implement.** In `src/elements.ts`, replace the existing future-use viscosity field in `ElementDef` (currently `/** Liquid flow resistance 0..1 (future). */ viscosity?: number;`) with:

```ts
  /** log10 of dynamic viscosity (cP) at VISC_TREF=20 °C. For materials solid at
   * 20 °C (Lava, Molten Wax) this is an extrapolated log-anchor for the curve,
   * not a physical value. Only liquids set it. */
  viscosityRefLog10?: number;
  /** d(log10 cP)/d°C, ≤ 0 (viscosity drops as it heats). Absent/0 = temperature-independent. */
  viscosityTempCoeff?: number;
```

Grep the repo for `.viscosity` to confirm nothing referenced the old field (it was unused/"future"); if anything does, update it. Then set the values by editing the seven liquid rows in `ELEMENTS` (append the fields to each existing row):

- Water (id 3): `viscosityRefLog10: 0`
- Sulfuric Acid (Dilute) (id 11): `viscosityRefLog10: 0.3`
- Sulfuric Acid (Very Dilute) (id 15): `viscosityRefLog10: 0.2`
- Sulfuric Acid (Concentrated) (id 16): `viscosityRefLog10: 1.4, viscosityTempCoeff: -0.002`
- Sulfuric Acid (Fuming) (id 17): `viscosityRefLog10: 1.5, viscosityTempCoeff: -0.002`
- Lava (id 7): `viscosityRefLog10: 11.875, viscosityTempCoeff: -0.00625`
- Molten Wax (id 27): `viscosityRefLog10: 2.68, viscosityTempCoeff: -0.022`

- [ ] **Step 4: Run, confirm PASS** — `npm test -- src/elements.test.ts`, then full `npm test` + `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/elements.ts src/elements.test.ts
git commit -m "Add temperature-dependent viscosity curve fields to liquids"
```

---

### Task 2: `src/viscosity.ts` — pure fluidity mirror + tests

**Files:** Create `src/viscosity.ts`, `src/viscosity.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/viscosity.test.ts`:

```ts
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
```

- [ ] **Step 2: Run, confirm FAIL** — `./viscosity` not found.

- [ ] **Step 3: Implement** — create `src/viscosity.ts`:

```ts
import { getElement } from './elements';

export const VISC_TREF = 20;
export const VISC_HALF = 200;
export const FLUID_MIN_DRIP = 0.02;
export const VISC_LOG_MIN = -1;
export const VISC_LOG_MAX = 14;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** log10 of dynamic viscosity (cP) at temperature `t`, clamped to a sane band. */
export function logViscosityAt(elementId: number, t: number): number {
  const element = getElement(elementId);
  const refLog10 = element.viscosityRefLog10 ?? 0;
  const coeff = element.viscosityTempCoeff ?? 0;
  return clamp(refLog10 + coeff * (t - VISC_TREF), VISC_LOG_MIN, VISC_LOG_MAX);
}

/** Horizontal/leveling fluidity in (0,1]; ~0 for very thick liquids (they mound). */
export function fluidityAt(elementId: number, t: number): number {
  const visc = 10 ** logViscosityAt(elementId, t);
  return VISC_HALF / (VISC_HALF + visc);
}

/** Vertical-drip fluidity, floored so a liquid always eventually settles downward. */
export function dripFluidityAt(elementId: number, t: number): number {
  return Math.max(FLUID_MIN_DRIP, fluidityAt(elementId, t));
}
```

- [ ] **Step 4: Run, confirm PASS**, then full `npm test` + `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/viscosity.ts src/viscosity.test.ts
git commit -m "Add pure fluidity-from-temperature mirror (viscosity.ts)"
```

---

### Task 3: Grow the `materials` buffer 3→4 vec4 (stride migration)

**Files:** Modify `src/elements.ts`, `src/elements.test.ts`, `src/webgpu/simulation.ts`, `src/shaders/simulate.wgsl`, `src/shaders/render.wgsl`

This is a **behavior-preserving** refactor: the buffer grows and the shaders read the new stride, but nothing yet reads the viscosity params. Everything must look identical in-browser afterward.

- [ ] **Step 1: Update the serializer test.** In `src/elements.test.ts`, find the test asserting `materialProperties()` returns 12 floats/element (it references `ELEMENTS.length * 12` and the "returns 12 floats … per element" name). Change `* 12` → `* 16`, update the count in the name, and add assertions for the new slots. The relevant test body becomes:

```ts
  it('returns 16 floats per element (12 existing + viscosityRefLog10, viscosityTempCoeff, 2 reserved), indexed by element id', () => {
    const props = materialProperties();
    expect(props.length).toBe(ELEMENTS.length * 16);
  });
```

Also update any other test in that file that indexes `materialProperties()` with a `* 12` element stride (e.g. the water/wood offset checks) to `* 16` — the within-element offsets (density at +0, heatCapacity at +2, etc.) are unchanged, only the per-element stride changes. Add:

```ts
  it('packs the viscosity curve at offsets 12-13 for liquids', () => {
    const props = materialProperties();
    const lava = getElementByName('Lava');
    expect(props[lava.id * 16 + 12]).toBeCloseTo(lava.viscosityRefLog10!);
    expect(props[lava.id * 16 + 13]).toBeCloseTo(lava.viscosityTempCoeff!);
    const sand = getElementByName('Sand');
    expect(props[sand.id * 16 + 12]).toBe(0); // non-liquid: unused
  });
```

- [ ] **Step 2: Run, confirm FAIL** — `npm test -- src/elements.test.ts`.

- [ ] **Step 3: Grow the serializer.** In `src/elements.ts` `materialProperties()`, change `new Float32Array(ELEMENTS.length * 12)` → `* 16`, change `const offset = element.id * 12;` → `* 16;`, and after the `data[offset + 11] = 0;` line add:

```ts
    data[offset + 12] = element.viscosityRefLog10 ?? 0;
    data[offset + 13] = element.viscosityTempCoeff ?? 0;
    data[offset + 14] = 0;
    data[offset + 15] = 0;
```

- [ ] **Step 4: Update the chain-membership patch.** In `src/webgpu/simulation.ts`, change the two lines in the constructor:

```ts
    mats[element.id * 12 + 10] = chainStartOf(element.id);
    mats[element.id * 12 + 11] = chainCountOf(element.id);
```

to `* 16 + 10` and `* 16 + 11`.

- [ ] **Step 5: Migrate `simulate.wgsl` accessors.** In `src/shaders/simulate.wgsl`, replace every occurrence of `materials[id * 3u` with `materials[id * 4u` (the 12 accessor functions at lines ~108–119: `density`, `conductivityOf`, `heatCapacityOf`, `ignitionTempOf`, `burnProductOf`, `burnRateOf`, `corrosiveStrengthOf`, `solubilityOf`, `dissolvedProductOf`, `weakensToOf`, `chainStartOf`, `chainCountOf`). Immediately after `chainCountOf`, add the two new accessors:

```wgsl
fn refLog10ViscOf(id: u32) -> f32 { return materials[id * 4u + 3u].x; }
fn viscTempCoeffOf(id: u32) -> f32 { return materials[id * 4u + 3u].y; }
```

Update the binding-3 comment (line ~66) from `// (density, thermalConductivity, heatCapacity, unused)` to `// 4 vec4/element; see src/elements.ts materialProperties()`.

- [ ] **Step 6: Migrate `render.wgsl` accessors.** In `src/shaders/render.wgsl`, replace every `materials[id * 3u` with `materials[id * 4u` (3 occurrences: `heatCapacityOf` line ~24, `chainStartOf`/`chainCountOf` lines ~27–28). Update the binding-3 comment (line ~20) the same way.

- [ ] **Step 7: Verify.** `npm test` (serializer tests green), `npm run typecheck`, `npm run build` — all clean. This is safe to run in-browser; the controller confirms the existing sim (movement, thermal, corrosion, phase transitions, render, heat map) is **unchanged** — no console errors, identical behavior — since only the buffer stride moved.

- [ ] **Step 8: Commit**

```bash
git add src/elements.ts src/elements.test.ts src/webgpu/simulation.ts src/shaders/simulate.wgsl src/shaders/render.wgsl
git commit -m "Grow materials buffer to 4 vec4/element for viscosity params (stride migration)"
```

---

# PART B — Flow behavior (verified in-browser)

> After each of Tasks 4 and 5, drive the app in headed Chrome (`channel:'chrome'`, `--enable-unsafe-webgpu`, painting with a large brush). WGSL errors surface only at runtime.

### Task 4: Fluidity helpers + generalize `waterMovement` → `liquidMovement`

**Files:** Modify `src/shaders/simulate.wgsl`, `src/webgpu/simulation.ts`, `src/config.ts`

At the end of this task, all liquids level/drip through the gated `liquidMovement` pass, but `movement` still also moves liquids into air (unchanged), so viscosity is not yet fully dominant — this step must not regress water and must give the other liquids visible leveling.

- [ ] **Step 1: Add fluidity helpers.** In `src/shaders/simulate.wgsl`, immediately after `preserveTempEnthalpy` (~line 457, so `thermalFromEnthalpy` is already declared), add:

```wgsl
const VISC_TREF: f32 = 20.0;
const VISC_HALF: f32 = 200.0;
const FLUID_MIN_DRIP: f32 = 0.02;
const VISC_LOG_MIN: f32 = -1.0;
const VISC_LOG_MAX: f32 = 14.0;

// Temperature-derived flow probability, mirroring src/viscosity.ts. Thick liquids
// (cool lava) return ~0 -> they mound; thin liquids (water, hot lava) return ~1.
fn fluidityAt(id: u32, enthalpy: f32) -> f32 {
  let t = thermalFromEnthalpy(id, enthalpy).temperature;
  let logv = clamp(refLog10ViscOf(id) + viscTempCoeffOf(id) * (t - VISC_TREF), VISC_LOG_MIN, VISC_LOG_MAX);
  let visc = pow(10.0, logv);
  return VISC_HALF / (VISC_HALF + visc);
}
// Vertical-drip fluidity, floored so a liquid over empty always eventually falls.
fn dripFluidityAt(id: u32, enthalpy: f32) -> f32 {
  return max(FLUID_MIN_DRIP, fluidityAt(id, enthalpy));
}
```

- [ ] **Step 2: Delete the water-only pass.** Remove `waterShouldSwapV`, `waterShouldSwapH` (~lines 291–297) and the entire `waterMovement` function (~lines 299–333).

- [ ] **Step 3: Add the generalized pass.** Add this after the fluidity helpers (so `fluidityAt`/`dripFluidityAt` are declared; `isLiquid`/`isGas` are declared far earlier):

```wgsl
// Every liquid levels and drips here, each move gated by the cell's
// temperature-derived fluidity (viscosity). Replaces the old water-only pass:
// water (fluidity ~1) still levels fast; cool lava (fluidity ~0) mounds and only
// creeps; drip is floored so nothing hangs mid-air. Only motion into empty/gas
// happens here - cross-material buoyancy stays in movement().
fn liquidDripInto(top: u32, bottom: u32) -> bool {
  return isLiquid(top) && (bottom == EMPTY || isGas(bottom));
}
fn liquidLevelInto(mover: u32, target: u32) -> bool {
  return isLiquid(mover) && target == EMPTY;
}

@compute @workgroup_size(8, 8)
fn liquidMovement(@builtin(global_invocation_id) gid: vec3<u32>) {
  let width = i32(params.width);
  let height = i32(params.height);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= width || y >= height) { return; }
  let selfIndex = cellIndex(x, y, width);

  let alignment = params.frame % 4u;
  let ox = i32(alignment & 1u);
  let oy = i32((alignment >> 1u) & 1u);
  if (x < ox || y < oy) { writeBuf[selfIndex] = readBuf[selfIndex]; return; }
  let blockX = x - ((x - ox) % 2);
  let blockY = y - ((y - oy) % 2);
  if (blockX + 1 >= width || blockY + 1 >= height) { writeBuf[selfIndex] = readBuf[selfIndex]; return; }
  if (x != blockX || y != blockY) { return; }

  let idxA = cellIndex(blockX, blockY, width);
  let idxB = cellIndex(blockX + 1, blockY, width);
  let idxC = cellIndex(blockX, blockY + 1, width);
  let idxD = cellIndex(blockX + 1, blockY + 1, width);
  var a = readBuf[idxA]; var b = readBuf[idxB]; var c = readBuf[idxC]; var d = readBuf[idxD];

  // Vertical drip (a over c, b over d), floored fluidity.
  let vRollAC = f32(hash(u32(blockX), u32(blockY), params.frame) & 0xffffu) / 65536.0;
  var movedLeft = false;
  if (liquidDripInto(a.elementId, c.elementId) && vRollAC < dripFluidityAt(a.elementId, a.enthalpy)) {
    let t = a; a = c; c = t; movedLeft = true;
  }
  let vRollBD = f32(hash(u32(blockX + 1), u32(blockY), params.frame) & 0xffffu) / 65536.0;
  var movedRight = false;
  if (liquidDripInto(b.elementId, d.elementId) && vRollBD < dripFluidityAt(b.elementId, b.enthalpy)) {
    let t = b; b = d; d = t; movedRight = true;
  }

  // Diagonal ooze for a column that didn't drip straight down.
  let dRollAD = f32(hash(u32(blockX) + 7u, u32(blockY) + 13u, params.frame) & 0xffffu) / 65536.0;
  if (!movedLeft && liquidDripInto(a.elementId, d.elementId) && dRollAD < dripFluidityAt(a.elementId, a.enthalpy)) {
    let t = a; a = d; d = t;
  }
  let dRollBC = f32(hash(u32(blockX) + 17u, u32(blockY) + 19u, params.frame) & 0xffffu) / 65536.0;
  if (!movedRight && liquidDripInto(b.elementId, c.elementId) && dRollBC < dripFluidityAt(b.elementId, b.enthalpy)) {
    let t = b; b = c; c = t;
  }

  // Horizontal leveling (a<->b, c<->d); fluidity gates to ~0 so thick liquids mound.
  let hRollAB = f32(hash(u32(blockX) + 31u, u32(blockY) + 23u, params.frame) & 0xffffu) / 65536.0;
  if (liquidLevelInto(a.elementId, b.elementId) && hRollAB < fluidityAt(a.elementId, a.enthalpy)) {
    let t = a; a = b; b = t;
  } else if (liquidLevelInto(b.elementId, a.elementId) && hRollAB < fluidityAt(b.elementId, b.enthalpy)) {
    let t = a; a = b; b = t;
  }
  let hRollCD = f32(hash(u32(blockX) + 53u, u32(blockY) + 71u, params.frame) & 0xffffu) / 65536.0;
  if (liquidLevelInto(c.elementId, d.elementId) && hRollCD < fluidityAt(c.elementId, c.enthalpy)) {
    let t = c; c = d; d = t;
  } else if (liquidLevelInto(d.elementId, c.elementId) && hRollCD < fluidityAt(d.elementId, d.enthalpy)) {
    let t = c; c = d; d = t;
  }

  writeBuf[idxA] = a; writeBuf[idxB] = b; writeBuf[idxC] = c; writeBuf[idxD] = d;
}
```

- [ ] **Step 4: Rename the substep constant.** In `src/config.ts`, rename `WATER_SUBSTEPS` → `LIQUID_SUBSTEPS` (keep value `12`) and update its doc comment to say "Extra liquid-only movement substeps per frame for fast leveling" (the parity note stays: `1 soak + 1 corrode + LIQUID_SUBSTEPS` must be even).

- [ ] **Step 5: Rewire `simulation.ts`.** In `src/webgpu/simulation.ts`:
  - Update the import `WATER_SUBSTEPS` → `LIQUID_SUBSTEPS` (line 2) and its use in `SIM_SLOTS` (line 31) + that comment ("WATER_SUBSTEPS water-leveling passes" → "LIQUID_SUBSTEPS liquid-leveling passes").
  - Rename the field `waterMovementPipeline` → `liquidMovementPipeline` (line 81).
  - In the pipeline creation (lines ~198–201), rename to `this.liquidMovementPipeline` and change `entryPoint: 'waterMovement'` → `'liquidMovement'`.
  - In the dispatch loop (lines ~388–390), rename the loop bound `WATER_SUBSTEPS` → `LIQUID_SUBSTEPS` and `this.waterMovementPipeline` → `this.liquidMovementPipeline`.

- [ ] **Step 6: Verify** `npm run typecheck` + `npm run build`, then the controller drives headed Chrome: **Water still levels/pools fast and looks unchanged**; Molten Wax / acids now visibly settle and level (they didn't before); Lava still moves (movement unchanged this task); water still soaks into sand; 2b transitions still work; **no console errors**.

- [ ] **Step 7: Commit**

```bash
git add src/shaders/simulate.wgsl src/webgpu/simulation.ts src/config.ts
git commit -m "Generalize water pass to fluidity-gated liquidMovement for all liquids"
```

---

### Task 5: `movement` defers liquid-into-air to `liquidMovement` (viscosity becomes effective)

**Files:** Modify `src/shaders/simulate.wgsl` (+ optional value tuning in `src/elements.ts`)

Now that `liquidMovement` owns gated liquid flow, stop `movement` from freely moving liquids into empty/gas — that is what lets high-viscosity Lava mound instead of spreading 3×/frame. Cross-material density/buoyancy swaps stay untouched.

- [ ] **Step 1: Guard vertical.** In `src/shaders/simulate.wgsl`, change `shouldSwapVertical` (~lines 168–176) to add a first guard:

```wgsl
fn shouldSwapVertical(topVal: u32, bottomVal: u32) -> bool {
  // Liquid free-fall into air/gas is owned by the fluidity-gated liquidMovement.
  if (isLiquid(topVal) && (bottomVal == EMPTY || isGas(bottomVal))) { return false; }
  if (isPowderOrLiquid(topVal) && density(topVal) > density(bottomVal)) {
    return true;
  }
  if (isGas(bottomVal) && topVal == EMPTY) {
    return true;
  }
  return false;
}
```

- [ ] **Step 2: Guard horizontal.** Change `shouldSwapHorizontal` (~lines 178–194) to add the liquid-into-empty guards:

```wgsl
fn shouldSwapHorizontal(leftVal: u32, rightVal: u32) -> bool {
  // Liquid leveling into empty is owned by the fluidity-gated liquidMovement.
  if (isLiquid(leftVal) && rightVal == EMPTY) { return false; }
  if (isLiquid(rightVal) && leftVal == EMPTY) { return false; }
  if (isLiquid(leftVal) && density(leftVal) > density(rightVal)) {
    return true;
  }
  if (isLiquid(rightVal) && density(rightVal) > density(leftVal)) {
    return true;
  }
  // Gas diffuses sideways into empty space too, so it disperses instead of
  // piling into a solid mass (which straight rising alone would produce).
  if (isGas(leftVal) && rightVal == EMPTY) {
    return true;
  }
  if (isGas(rightVal) && leftVal == EMPTY) {
    return true;
  }
  return false;
}
```

- [ ] **Step 3: Verify** `npm run typecheck` + `npm run build`, then the controller drives headed Chrome thoroughly and checks all of:
  - **Water** paints, falls, levels flat, pools, soaks into sand — indistinguishable from before.
  - **Lava** mounds/holds a pile and only creeps horizontally; drips slowly downward; **flows visibly faster when superheated** (raise ambient or add Fire); **crusts/freezes to Stone as it cools** (2b) — the marquee behavior.
  - **Molten Wax** oozes and pools slowly, thicker just above 60 °C, runnier when hotter, resolidifies to Wax when cooled.
  - **Acids** flow nearly like water (concentrated slightly laggier).
  - **Buoyancy intact:** a dense liquid still sinks through a lighter one (paint Lava into Water — Lava sinks); powders still fall through liquids.
  - Heat map correct; **no console errors**.

- [ ] **Step 4: Tune if needed.** If Lava reads as fully frozen (never creeps) or too runny, or wax/acids feel wrong, adjust the per-liquid values in `src/elements.ts` (Task 1 table) and/or `FLUID_MIN_DRIP` / `VISC_HALF` (keep the WGSL constants and `src/viscosity.ts` constants in sync; re-run `npm test`). Re-verify in Chrome. Note any changed values in the commit message.

- [ ] **Step 5: Commit**

```bash
git add src/shaders/simulate.wgsl src/elements.ts
git commit -m "Route liquid-into-empty through fluidity gate so viscosity governs flow"
```

---

# PART C — End-to-end coverage

### Task 6: e2e — liquids flow without errors

**Files:** Modify `e2e/smoke.spec.ts`

- [ ] **Step 1** Append a test (guarded to skip on no-GPU; Water/Lava/Molten Wax are `physical`, no formula, so `exact: true` works; the acid uses a substring match because chem elements render "name + formula"):

```ts
test('viscosity: liquids of different thickness flow without errors', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto('/');
  const canvas = page.locator('canvas#grid');
  const unsupported = page.locator('.unsupported');
  await expect(canvas.or(unsupported)).toBeVisible();
  if (!(await canvas.isVisible())) test.skip();

  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas box');
  const at = (fx: number, fy: number) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
  const dab = async (name: string, fx: number, fy: number, exact = true) => {
    await page.getByRole('button', { name, exact }).first().click();
    const p = at(fx, fy); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 20, p.y); await page.mouse.up();
  };

  await dab('Water', 0.25, 0.3);                          // thin: levels fast
  await dab('Lava', 0.5, 0.3);                            // thick: mounds
  await dab('Molten Wax', 0.7, 0.3);                      // medium: oozes
  await dab('Sulfuric Acid (Concentrated)', 0.85, 0.3, false);
  await page.waitForTimeout(2500);

  expect(pageErrors, `page errors: ${pageErrors.join('; ')}`).toEqual([]);
  expect(consoleErrors, `console errors: ${consoleErrors.join('; ')}`).toEqual([]);
});
```

- [ ] **Step 2** Run `npm run typecheck && npm test && npm run test:e2e` — typecheck clean, all unit green, Playwright passes or skips on no-GPU (or reuses a concurrent-session server — report honestly; the real check is Task 5's headed-Chrome pass).

- [ ] **Step 3: Commit**

```bash
git add e2e/smoke.spec.ts
git commit -m "Add e2e smoke for per-liquid viscosity flow"
```

---

## Final verification

- [ ] `npm run typecheck` clean; `npm test` all green (elements, viscosity, plus existing); `npm run test:e2e` passes/skips.
- [ ] `npm run dev` in headed Chrome: Water/acids level fast; Molten Wax oozes and resolidifies; **Lava mounds, creeps, flows faster when superheated, and freezes to Stone as it cools**; buoyancy (dense liquid sinks through lighter) and water→sand soak still work; all 2b transitions and 2a corrosion unchanged; heat map correct; no console errors.
- [ ] The only intended behavior change vs. master is liquid flow; everything else (movement of powders/gases, thermal, corrosion, phase transitions, rendering) is identical.
