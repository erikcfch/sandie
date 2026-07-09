# Material System — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make material classification data-driven — the shader reads each material's `form` (static/powder/liquid/gas) and `flammable` capability from GPU buffers instead of hardcoded element-id lists — and enrich every material with taxonomy axes, capability flags, and real scientific reference values. Behavior stays identical; adding a material becomes pure data.

**Architecture:** Enrich `ElementDef` (in `src/elements.ts`) with taxonomy (`form`/`phase`/`origin`/`metallic`), capability flags, flammability params, and real reference values (`realDensity`, `specificHeat`, `meltingPoint`/`boilingPoint`, `viscosity`). Pack the taxonomy+flags into a new `materialFlags: array<u32>` GPU buffer and add the flammability params to the existing `materials` float buffer. The shader's `isPowderOrLiquid`/`isLiquid`/`isGas` become `form` lookups, and the bespoke `WOOD_IGNITE_POINT` ignition becomes a generic "any `flammable` cell over its `ignitionTemp` → its `burnProduct`" rule. The values the sim *uses* (`density`, `thermalConductivity`, `heatCapacity`, `form`) are unchanged, so behavior is identical; real values are recorded as reference for later phases.

**Tech Stack:** TypeScript, WebGPU (WGSL), Vite, Vitest, Playwright. Pure logic is unit-tested in TS and mirrored in the shader (the repo's `thermal.ts`/`wetSand.ts` pattern).

**Reference spec:** `docs/superpowers/specs/2026-07-09-material-system-design.md`

---

## Locked conventions (read before starting)

**Form ↔ current category:** `form` equals today's `category` for every element (`static`/`powder`/`liquid`/`gas`), with Empty → `static`. This is why movement behavior is preserved.

**Flag bitfield** (packed into `materialFlags[id]: u32`, mirrored in the shader):
- bits 0–1: `form` (static=0, powder=1, liquid=2, gas=3)
- bit 2: flammable
- bit 3: corrosive
- bit 4: soluble
- bit 5: conductive
- bit 6: organic (origin === 'organic')
- bit 7: metal (metallic === 'metal')

Phase 1's shader only *reads* form (bits 0–1) and flammable (bit 2); the rest are packed for completeness and Phase 2.

**`materials` float buffer** grows from 1 `vec4` to **2 `vec4`s** (8 floats) per element:
- `[0]`: `density` (sim value, UNCHANGED), `thermalConductivity`, `heatCapacity`, `ignitionTemp`
- `[1]`: `burnProduct`, `burnRate`, 0 (reserved), 0 (reserved)

Accessors change from `materials[id]` to `materials[id * 2u]` in BOTH `simulate.wgsl` and `render.wgsl`.

**Behavior-identical rule:** do NOT change any element's `density`, `thermalConductivity`, or `heatCapacity` values, and do NOT add `flammable` to anything except Wood (adding it to Hydrogen etc. would change behavior — that's a Phase 3 feature). Real scientific values go in the NEW `realDensity`/`specificHeat`/… fields only.

---

# PART A — Schema, taxonomy, and serializers (TS, unit-tested)

### Task 1: Taxonomy types + enrich ElementDef + migrate taxonomy

**Files:**
- Modify: `src/elements.ts`, `src/elements.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/elements.test.ts`:

```ts
import { ELEMENTS, getElementByName } from './elements';

describe('material taxonomy', () => {
  it('every element has form matching its category', () => {
    const map: Record<string, string> = { empty: 'static', static: 'static', powder: 'powder', liquid: 'liquid', gas: 'gas' };
    for (const e of ELEMENTS) expect(e.form).toBe(map[e.category]);
  });
  it('every element has phase/origin/metallic set', () => {
    for (const e of ELEMENTS) {
      expect(['solid', 'liquid', 'gas']).toContain(e.phase);
      expect(['organic', 'inorganic']).toContain(e.origin);
      expect(['metal', 'nonmetal']).toContain(e.metallic);
    }
  });
  it('classifies a few materials correctly', () => {
    expect(getElementByName('Wood').origin).toBe('organic');
    expect(getElementByName('Copper').metallic).toBe('metal');
    expect(getElementByName('Water').form).toBe('liquid');
    expect(getElementByName('Sand').phase).toBe('solid');
  });
});
```

- [ ] **Step 2: Run it, confirm FAIL**

Run: `npm test -- src/elements.test.ts`
Expected: FAIL — `e.form` undefined.

- [ ] **Step 3: Implement** — in `src/elements.ts`, add the type aliases after the existing `ElementCategory`/`ElementFamily`:

```ts
export type Form = 'static' | 'powder' | 'liquid' | 'gas';
export type Phase = 'solid' | 'liquid' | 'gas';
export type Origin = 'inorganic' | 'organic';
export type Metallic = 'metal' | 'nonmetal';
```

Extend the `ElementDef` interface with (keep all existing fields):

```ts
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
  /** Liquid flow resistance 0..1 (future). */
  viscosity?: number;
  // --- Capability flags ---
  flammable?: boolean;
  corrosive?: boolean;
  soluble?: boolean;
  conductive?: boolean;
  // --- Behavior params ---
  ignitionTemp?: number;
  burnProduct?: number;
  burnRate?: number;
```

Then add `form`, `phase`, `origin`, `metallic` to EVERY element in the `ELEMENTS` array. Use this mapping (form = category with empty→static):

| id | name | form | phase | origin | metallic |
|----|------|------|-------|--------|----------|
| 0 | Empty | static | solid | inorganic | nonmetal |
| 1 | Stone | static | solid | inorganic | nonmetal |
| 2 | Sand | powder | solid | inorganic | nonmetal |
| 3 | Water | liquid | liquid | inorganic | nonmetal |
| 4 | Wood | static | solid | organic | nonmetal |
| 5 | Smoke | gas | gas | inorganic | nonmetal |
| 6 | Ice | static | solid | inorganic | nonmetal |
| 7 | Lava | liquid | liquid | inorganic | nonmetal |
| 8 | Steam | gas | gas | inorganic | nonmetal |
| 9 | Fire | gas | gas | inorganic | nonmetal |
| 10 | Obsidian | static | solid | inorganic | nonmetal |
| 11 | Sulfuric Acid (Dilute) | liquid | liquid | inorganic | nonmetal |
| 12 | Copper | static | solid | inorganic | metal |
| 13 | Copper Sulfate | powder | solid | inorganic | nonmetal |
| 14 | Hydrogen | gas | gas | inorganic | nonmetal |
| 15 | Sulfuric Acid (Very Dilute) | liquid | liquid | inorganic | nonmetal |
| 16 | Sulfuric Acid (Concentrated) | liquid | liquid | inorganic | nonmetal |
| 17 | Sulfuric Acid (Fuming) | liquid | liquid | inorganic | nonmetal |
| 18 | Sulfur Dioxide | gas | gas | inorganic | nonmetal |
| 19 | Damp Sand | powder | solid | inorganic | nonmetal |
| 20 | Wet Sand | powder | solid | inorganic | nonmetal |
| 21 | Saturated Sand | powder | solid | inorganic | nonmetal |

Add these four fields to each existing element object (e.g. Water becomes `{ id: 3, name: 'Water', category: 'liquid', form: 'liquid', phase: 'liquid', origin: 'inorganic', metallic: 'nonmetal', density: 40, ... }`). Do NOT change any existing field values.

- [ ] **Step 4: Run it, confirm PASS**

Run: `npm test -- src/elements.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/elements.ts src/elements.test.ts
git commit -m "Add taxonomy axes (form/phase/origin/metallic) to every material"
```

---

### Task 2: Flammability + corrosive/metal capability flags + real reference values

**Files:**
- Modify: `src/elements.ts`, `src/elements.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/elements.test.ts`:

```ts
describe('capabilities and reference values', () => {
  it('only Wood is flammable in Phase 1, igniting to Fire', () => {
    const wood = getElementByName('Wood');
    expect(wood.flammable).toBe(true);
    expect(wood.ignitionTemp).toBe(300);
    expect(wood.burnProduct).toBe(getElementByName('Fire').id);
    expect(wood.burnRate).toBe(1);
    // Nothing else is flammable (behavior-identical: Hydrogen stays inert for now).
    expect(ELEMENTS.filter((e) => e.flammable).map((e) => e.name)).toEqual(['Wood']);
  });
  it('acids are corrosive and copper is a conductive metal', () => {
    for (const n of ['Sulfuric Acid (Dilute)', 'Sulfuric Acid (Very Dilute)', 'Sulfuric Acid (Concentrated)', 'Sulfuric Acid (Fuming)'])
      expect(getElementByName(n).corrosive).toBe(true);
    expect(getElementByName('Copper').conductive).toBe(true);
  });
  it('records real reference densities (ice less dense than water; copper dense)', () => {
    expect(getElementByName('Ice').realDensity!).toBeLessThan(getElementByName('Water').realDensity!);
    expect(getElementByName('Copper').realDensity!).toBeGreaterThan(5);
    expect(getElementByName('Water').realDensity).toBeCloseTo(1.0, 1);
  });
});
```

- [ ] **Step 2: Run it, confirm FAIL**

Run: `npm test -- src/elements.test.ts`
Expected: FAIL — `wood.flammable` undefined.

- [ ] **Step 3: Implement** — in `src/elements.ts`, add capability flags + params + real reference values to the relevant elements. Add to each element object:

- Wood (id 4): `flammable: true, ignitionTemp: 300, burnProduct: 9, burnRate: 1, realDensity: 0.7, specificHeat: 1.7`
- Copper (id 12): `conductive: true, realDensity: 8.96, specificHeat: 0.385, meltingPoint: 1085`
- The four acids (ids 11, 15, 16, 17): `corrosive: true` on each, plus `realDensity`: Dilute 1.1, Very Dilute 1.05, Concentrated 1.83, Fuming 1.90; `specificHeat`: Dilute 3.5, Very Dilute 3.8, Concentrated 1.4, Fuming 1.3.
- And record `realDensity`/`specificHeat` (and melting/boiling where notable) on the rest:
  - Stone 2.6 / 0.8; Sand 1.6 / 0.83; Water 1.0 / 4.18 (meltingPoint 0, boilingPoint 100); Smoke 0.0012 / 1.0; Ice 0.92 / 2.1 (meltingPoint 0); Lava 2.9 / 1.0; Steam 0.0006 / 2.0; Fire 0.0003 / 1.0; Obsidian 2.5 / 0.8; Copper Sulfate 3.6 / 0.9; Hydrogen 0.00009 / 14.3; Sulfur Dioxide 0.0026 / 0.64; Damp Sand 1.8 / 1.2; Wet Sand 1.95 / 1.5; Saturated Sand 2.08 / 1.8; Empty 0 / 0.5.

(`burnProduct: 9` is Fire's id. Keep every existing field unchanged; only ADD the new optional fields.)

- [ ] **Step 4: Run it, confirm PASS**

Run: `npm test -- src/elements.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/elements.ts src/elements.test.ts
git commit -m "Add capability flags, flammability params, and real reference values"
```

---

### Task 3: Buffer serializers — expanded `materials` + new `materialFlags`

**Files:**
- Modify: `src/elements.ts`, `src/elements.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/elements.test.ts`:

```ts
import { materialProperties, materialFlags } from './elements';

describe('GPU material serializers', () => {
  it('materials buffer is 8 floats/element with unchanged sim values + flammability params', () => {
    const data = materialProperties();
    expect(data.length).toBe(ELEMENTS.length * 8);
    const wood = getElementByName('Wood');
    const o = wood.id * 8;
    expect(data[o + 0]).toBe(wood.density);            // sim density unchanged
    expect(data[o + 1]).toBe(wood.thermalConductivity);
    expect(data[o + 2]).toBe(wood.heatCapacity);
    expect(data[o + 3]).toBe(300);                     // ignitionTemp
    expect(data[o + 4]).toBe(getElementByName('Fire').id); // burnProduct
    expect(data[o + 5]).toBe(1);                       // burnRate
    // A non-flammable element has zeroed flammability params.
    const stoneO = getElementByName('Stone').id * 8;
    expect(data[stoneO + 3]).toBe(0);
  });
  it('materialFlags packs form in bits 0-1 and capabilities above', () => {
    const flags = materialFlags();
    expect(flags.length).toBe(ELEMENTS.length);
    expect(flags[getElementByName('Water').id] & 3).toBe(2);   // liquid
    expect(flags[getElementByName('Sand').id] & 3).toBe(1);    // powder
    expect(flags[getElementByName('Smoke').id] & 3).toBe(3);   // gas
    expect(flags[getElementByName('Stone').id] & 3).toBe(0);   // static
    expect((flags[getElementByName('Wood').id] >> 2) & 1).toBe(1); // flammable
    expect((flags[getElementByName('Wood').id] >> 6) & 1).toBe(1); // organic
    expect((flags[getElementByName('Copper').id] >> 7) & 1).toBe(1); // metal
  });
});
```

- [ ] **Step 2: Run it, confirm FAIL**

Run: `npm test -- src/elements.test.ts`
Expected: FAIL — `materialFlags` not exported / `materials` length wrong.

- [ ] **Step 3: Implement** — in `src/elements.ts`, replace `materialProperties()` with the 8-float version and add `materialFlags()`:

```ts
export function materialProperties(): Float32Array {
  const data = new Float32Array(ELEMENTS.length * 8);
  for (const element of ELEMENTS) {
    const offset = element.id * 8;
    data[offset + 0] = element.density;             // sim density (unchanged)
    data[offset + 1] = element.thermalConductivity;
    data[offset + 2] = element.heatCapacity;
    data[offset + 3] = element.ignitionTemp ?? 0;
    data[offset + 4] = element.burnProduct ?? 0;
    data[offset + 5] = element.burnRate ?? 0;
    data[offset + 6] = 0; // reserved (Phase 2: corrosiveStrength)
    data[offset + 7] = 0; // reserved (Phase 2: solubility)
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
```

- [ ] **Step 4: Run it, confirm PASS**, then run full `npm test` and `npm run typecheck` (both clean).

Run: `npm test -- src/elements.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/elements.ts src/elements.test.ts
git commit -m "Expand materials serializer and add materialFlags bitfield serializer"
```

---

# PART B — GPU integration (verified in-browser)

> WGSL is NOT validated by typecheck/build — a shader error only surfaces at runtime as an "Invalid ComputePipeline / Invalid CommandBuffer" console error (which, because it shares the frame's command buffer with paint, silently stops all rendering). After Tasks 4–5, drive the app in a real browser (headed `channel:'chrome'`; headless has no GPU adapter) and confirm no console errors AND that behavior is unchanged. WGSL forbids mixing i32 and u32 in arithmetic.

### Task 4: Allocate the materialFlags buffer + expand bindings

**Files:**
- Modify: `src/webgpu/simulation.ts`

- [ ] **Step 1** Read `src/webgpu/simulation.ts` around the material buffer (line ~106), the `simBindGroupLayout` (bindings 0–5, ~line 130), `renderBindGroupLayout` (bindings 0–3, ~line 148), and the movement/heat/render bind groups (~190–224).

- [ ] **Step 2** Add a field `private readonly materialFlagsBuffer: GPUBuffer;` near the other buffers, and import `materialFlags` from `../elements` (alongside `materialProperties`).

- [ ] **Step 3** Create the buffer right after `this.materialsBuffer = ...`:

```ts
const flags = materialFlags();
this.materialFlagsBuffer = device.createBuffer({
  label: 'material-flags',
  size: flags.byteLength,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(this.materialFlagsBuffer, 0, flags);
```

(The existing `this.materialsBuffer = this.createStorageBuffer('materials', materialProperties())` is unchanged — the serializer now returns 8 floats/element, so the buffer auto-sizes.)

- [ ] **Step 4** Add binding 6 to `simBindGroupLayout` (after binding 5):

```ts
{ binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
```

Add `{ binding: 6, resource: { buffer: this.materialFlagsBuffer } }` to BOTH `movementBindGroup` and `heatBindGroup` (the two bind groups built from `simBindGroupLayout`). The render bind group/layout are unchanged (render doesn't use flags).

- [ ] **Step 5** Verify `npm run typecheck` (clean) + `npm run build` (succeeds).

- [ ] **Step 6: Commit**

```bash
git add src/webgpu/simulation.ts
git commit -m "Allocate materialFlags buffer and bind it to the sim passes"
```

---

### Task 5: Shader — read form/flammable from buffers; generic flammability

**Files:**
- Modify: `src/shaders/simulate.wgsl`, `src/shaders/render.wgsl`

- [ ] **Step 1** In `src/shaders/simulate.wgsl`, add the materialFlags binding after the existing binding 5:

```wgsl
@group(0) @binding(6) var<storage, read> materialFlags: array<u32>;
```

- [ ] **Step 2** Update the material accessors for the 2-`vec4` stride and add the new ones. Replace `density`/`conductivityOf`/`heatCapacityOf`:

```wgsl
fn density(id: u32) -> f32 { return materials[id * 2u].x; }
fn conductivityOf(id: u32) -> f32 { return materials[id * 2u].y; }
fn heatCapacityOf(id: u32) -> f32 { return materials[id * 2u].z; }
fn ignitionTempOf(id: u32) -> f32 { return materials[id * 2u].w; }
fn burnProductOf(id: u32) -> u32 { return u32(materials[id * 2u + 1u].x); }
fn burnRateOf(id: u32) -> f32 { return materials[id * 2u + 1u].y; }
```

- [ ] **Step 3** Add form/flag readers (near the other helpers) and rewrite the movement class predicates to use them. Add:

```wgsl
const FORM_POWDER: u32 = 1u;
const FORM_LIQUID: u32 = 2u;
const FORM_GAS: u32 = 3u;
const FLAMMABLE_BIT: u32 = 4u; // 1u << 2u
fn formOf(id: u32) -> u32 { return materialFlags[id] & 3u; }
fn isFlammable(id: u32) -> bool { return (materialFlags[id] & FLAMMABLE_BIT) != 0u; }
```

Replace the bodies of `isPowderOrLiquid`, `isGas`, `isLiquid` (keep the function signatures):

```wgsl
fn isPowderOrLiquid(id: u32) -> bool {
  let f = formOf(id);
  return f == FORM_POWDER || f == FORM_LIQUID;
}
fn isGas(id: u32) -> bool {
  return formOf(id) == FORM_GAS;
}
fn isLiquid(id: u32) -> bool {
  return formOf(id) == FORM_LIQUID;
}
```

- [ ] **Step 4** Replace the bespoke Wood ignition with the generic flammable rule. In `heat()`, the current branch is:

```wgsl
  if (here.elementId == WOOD && result.temperature > WOOD_IGNITE_POINT) {
    result.elementId = FIRE;
    newEnthalpy = enthalpyForNewElement(result.temperature, FIRE);
  } else if (here.elementId == FIRE) {
```

Change the first condition to the generic rule (Wood's `burnRate` is 1, so `roll < 1.0` always holds → identical deterministic ignition; other flammables can be stochastic later):

```wgsl
  let burnRoll = f32(hash(u32(x), u32(y), params.frame) & 0xffffu) / 65536.0;
  if (isFlammable(here.elementId) && result.temperature > ignitionTempOf(here.elementId) && burnRoll < burnRateOf(here.elementId)) {
    let burnProduct = burnProductOf(here.elementId);
    result.elementId = burnProduct;
    newEnthalpy = enthalpyForNewElement(result.temperature, burnProduct);
  } else if (here.elementId == FIRE) {
```

Then delete the now-unused `const WOOD_IGNITE_POINT: f32 = 300.0;` line.

- [ ] **Step 5** In `src/shaders/render.wgsl`, update `heatCapacityOf` for the new stride (the render buffer is the same expanded `materials` buffer):

```wgsl
fn heatCapacityOf(id: u32) -> f32 {
  return materials[id * 2u].z;
}
```

- [ ] **Step 6** Verify `npm run typecheck` (clean) + `npm run build` (succeeds). Then **drive it in Chrome** (headed) and confirm no console errors AND behavior is unchanged:
  - Sand falls and piles; Water levels, sinks, soaks; gas rises as a plume (all form-driven now).
  - Paint Wood next to Fire (or Lava): it heats past 300 °C and turns to Fire — the generic flammable rule.
  - Watch the console for "Invalid ComputePipeline / Invalid CommandBuffer" (would mean a WGSL error) — there should be none.

- [ ] **Step 7: Commit**

```bash
git add src/shaders/simulate.wgsl src/shaders/render.wgsl
git commit -m "Read form/flammable from material buffers; generic flammability rule"
```

---

# PART C — End-to-end coverage

### Task 6: e2e — behavior preserved + generic ignition

**Files:**
- Modify: `e2e/smoke.spec.ts`

- [ ] **Step 1** Append a test (guarded on WebGPU like the existing tests, so it skips on no-GPU CI):

```ts
test('material system: elements still behave and wood ignites — no errors', async ({ page }) => {
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

  // Wood over Lava should ignite (generic flammable rule).
  await page.getByRole('button', { name: 'Lava', exact: true }).click();
  let p = at(0.5, 0.55); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 20, p.y); await page.mouse.up();
  await page.getByRole('button', { name: 'Wood', exact: true }).click();
  p = at(0.5, 0.4); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 20, p.y); await page.mouse.up();

  await page.waitForTimeout(2000);

  expect(pageErrors, `page errors: ${pageErrors.join('; ')}`).toEqual([]);
  expect(consoleErrors, `console errors: ${consoleErrors.join('; ')}`).toEqual([]);
});
```

- [ ] **Step 2** Run the full suite:

Run: `npm run typecheck && npm test && npm run test:e2e`
Expected: typecheck clean, all Vitest green, Playwright passes or skips on no-GPU.

- [ ] **Step 3: Commit**

```bash
git add e2e/smoke.spec.ts
git commit -m "Add e2e for the data-driven material system and generic ignition"
```

---

## Final verification

- [ ] `npm run typecheck` — clean.
- [ ] `npm test` — all unit tests pass (taxonomy, capabilities, serializers, plus existing).
- [ ] `npm run test:e2e` — passes or skips on no-GPU.
- [ ] `npm run dev` in Chrome: every existing behavior is unchanged (sand/water/gas/soak/reactions), Wood ignites near heat via the generic rule, and the console is clean. Confirm that adding a hypothetical new element would now require only a data row in `elements.ts` (form/flags drive movement; flammable+ignitionTemp+burnProduct drive ignition) with no shader edits.
