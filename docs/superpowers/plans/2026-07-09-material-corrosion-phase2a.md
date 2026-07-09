# Material System Phase 2a — Generic Corrosion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the generic corrosion/dissolving engine — any `corrosive` cell dissolves any adjacent `soluble` cell when `corrosiveStrength ≥ solubility`, turning the soluble into its `dissolvedProduct` and stepping the corrosive down via `weakensTo` — plus a demo resistance ladder (Salt/Limestone→CO₂/Rust).

**Architecture:** Extend the material schema with `corrosiveStrength`/`solubility`/`dissolvedProduct`/`weakensTo` params (packed into the `materials` GPU buffer, grown to 3 `vec4`s/element). Add a new race-free block-CA `corrode` compute pass (the `soak` pass's two-cell pattern, enthalpy re-encoded via `preserveTempEnthalpy`), dispatched per frame with its own SimParams slot. Copper stays non-`soluble` so its specific override reaction is untouched. Pure logic is unit-tested in TS and mirrored in the shader.

**Tech Stack:** TypeScript, WebGPU (WGSL), Vite, Vitest, Playwright.

**Reference spec:** `docs/superpowers/specs/2026-07-09-material-corrosion-design.md`

---

## Locked conventions (read before starting)

**`materials` float buffer** grows from 2 `vec4`s (8 floats) to **3 `vec4`s (12 floats)** per element:
- `[0]`: density, thermalConductivity, heatCapacity, ignitionTemp *(Phase 1)*
- `[1]`: burnProduct, burnRate, **corrosiveStrength, solubility**
- `[2]`: **dissolvedProduct, weakensTo**, 0, 0

Shader accessors change from `materials[id * 2u]` to `materials[id * 3u]` (both `simulate.wgsl` and `render.wgsl`).

**Flags** (`materialFlags`, unchanged from Phase 1): `corrosive` = bit 3, `soluble` = bit 4.

**`weakensTo` sentinel:** the serializer emits `weakensTo ?? element.id` (a corrosive with no `weakensTo` maps to its own id = "does not deplete"). The shader only changes the corrosive when `weakensTo(id) != id`.

**Parity:** the frame runs movement/heat (ends in buffer A), then `soak`, `corrode`, then `WATER_SUBSTEPS` water passes — `2 + WATER_SUBSTEPS` flips must be even to end back in A, so **`WATER_SUBSTEPS` becomes 12** (was 13). `SIM_SLOTS = TICKS_PER_FRAME + 2 + WATER_SUBSTEPS`.

---

# PART A — Schema, materials, serializer, logic (TS, unit-tested)

### Task 1: Add corrosion params to the schema + acids

**Files:** Modify `src/elements.ts`, `src/elements.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/elements.test.ts`:

```ts
describe('acid corrosion params', () => {
  const acid = (n: string) => getElementByName(n);
  it('acids have ascending corrosiveStrength and step down a tier when consumed', () => {
    expect(acid('Sulfuric Acid (Very Dilute)').corrosiveStrength).toBe(1);
    expect(acid('Sulfuric Acid (Dilute)').corrosiveStrength).toBe(2);
    expect(acid('Sulfuric Acid (Concentrated)').corrosiveStrength).toBe(3);
    expect(acid('Sulfuric Acid (Fuming)').corrosiveStrength).toBe(4);
    expect(acid('Sulfuric Acid (Very Dilute)').weakensTo).toBe(getElementByName('Water').id);
    expect(acid('Sulfuric Acid (Dilute)').weakensTo).toBe(acid('Sulfuric Acid (Very Dilute)').id);
    expect(acid('Sulfuric Acid (Concentrated)').weakensTo).toBe(acid('Sulfuric Acid (Dilute)').id);
    expect(acid('Sulfuric Acid (Fuming)').weakensTo).toBe(acid('Sulfuric Acid (Concentrated)').id);
  });
});
```

- [ ] **Step 2: Run it, confirm FAIL** — `npm test -- src/elements.test.ts` (corrosiveStrength undefined).

- [ ] **Step 3: Implement** — in `src/elements.ts`, add these fields to the `ElementDef` interface after `burnRate?: number;`:

```ts
  /** Corrosive's strength tier (higher dissolves tougher solubles). */
  corrosiveStrength?: number;
  /** Soluble's threshold: min corrosiveStrength that dissolves it (low = dissolves easily). */
  solubility?: number;
  /** What a soluble becomes when dissolved (element id; Empty = vanishes). */
  dissolvedProduct?: number;
  /** What a corrosive becomes when it reacts (element id); absent = does not deplete. */
  weakensTo?: number;
```

Then add to the four acid element objects (ADD only, keep existing fields):
- Sulfuric Acid (Very Dilute) id 15: `corrosiveStrength: 1, weakensTo: 3`
- Sulfuric Acid (Dilute) id 11: `corrosiveStrength: 2, weakensTo: 15`
- Sulfuric Acid (Concentrated) id 16: `corrosiveStrength: 3, weakensTo: 11`
- Sulfuric Acid (Fuming) id 17: `corrosiveStrength: 4, weakensTo: 16`

(`3` = Water's id, `15`/`11`/`16` are the next-weaker acid tiers.)

- [ ] **Step 4: Run it, confirm PASS**, then `npm run typecheck` (clean).

- [ ] **Step 5: Commit**

```bash
git add src/elements.ts src/elements.test.ts
git commit -m "Add corrosion params to schema and the acid tiers"
```

---

### Task 2: Add the resistance-ladder materials (Salt, Limestone, Rust, CO₂)

**Files:** Modify `src/elements.ts`, `src/elements.test.ts`, `src/shaders/simulate.wgsl`

- [ ] **Step 1: Write the failing test** — append to `src/elements.test.ts`:

```ts
describe('corrosion demo materials', () => {
  it('adds Salt/Limestone/Rust as solubles with ascending resistance', () => {
    const salt = getElementByName('Salt');
    const lime = getElementByName('Limestone');
    const rust = getElementByName('Rust');
    expect([salt.id, lime.id, rust.id, getElementByName('CO₂').id]).toEqual([22, 23, 24, 25]);
    for (const e of [salt, lime, rust]) { expect(e.soluble).toBe(true); expect(e.form).toBe('powder'); }
    expect(salt.solubility).toBe(1);
    expect(lime.solubility).toBe(2);
    expect(rust.solubility).toBe(3);
    expect(lime.dissolvedProduct).toBe(getElementByName('CO₂').id); // limestone fizzes CO₂
    expect(salt.dissolvedProduct).toBe(0); // dissolves to Empty
    expect(getElementByName('CO₂').form).toBe('gas');
  });
});
```

- [ ] **Step 2: Run it, confirm FAIL** — `Unknown element name: Salt`.

- [ ] **Step 3: Implement** — append four elements to the `ELEMENTS` array (after id 21, array index === id):

```ts
  { id: 22, name: 'Salt', category: 'powder', density: 62, color: [235, 235, 240], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.3, heatCapacity: 0.88, family: 'chem', formula: 'NaCl', form: 'powder', phase: 'solid', origin: 'inorganic', metallic: 'nonmetal', soluble: true, solubility: 1, dissolvedProduct: 0, realDensity: 2.17, specificHeat: 0.88 },
  { id: 23, name: 'Limestone', category: 'powder', density: 64, color: [225, 220, 205], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.35, heatCapacity: 0.84, family: 'chem', formula: 'CaCO₃', form: 'powder', phase: 'solid', origin: 'inorganic', metallic: 'nonmetal', soluble: true, solubility: 2, dissolvedProduct: 25, realDensity: 2.71, specificHeat: 0.84 },
  { id: 24, name: 'Rust', category: 'powder', density: 76, color: [150, 70, 35], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.4, heatCapacity: 0.65, family: 'chem', formula: 'Fe₂O₃', form: 'powder', phase: 'solid', origin: 'inorganic', metallic: 'nonmetal', soluble: true, solubility: 3, dissolvedProduct: 0, realDensity: 5.24, specificHeat: 0.65 },
  { id: 25, name: 'CO₂', category: 'gas', density: 1, color: [200, 215, 205], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.05, heatCapacity: 0.85, family: 'chem', formula: 'CO₂', form: 'gas', phase: 'gas', origin: 'inorganic', metallic: 'nonmetal', realDensity: 0.00198, specificHeat: 0.85 },
```

Also update the element-id comment block at the top of `src/shaders/simulate.wgsl` to include `22=Salt 23=Limestone 24=Rust 25=CO₂` (documentation; the shader references these only by data, no new consts needed).

- [ ] **Step 4: Run it, confirm PASS**, then full `npm test` and `npm run typecheck` (clean — the wet-sand/movement code is unaffected; new powders fall like sand, new gas rises).

- [ ] **Step 5: Commit**

```bash
git add src/elements.ts src/elements.test.ts src/shaders/simulate.wgsl
git commit -m "Add Salt/Limestone/Rust solubles and CO2 gas (corrosion ladder)"
```

---

### Task 3: Expand the materials serializer to 12 floats

**Files:** Modify `src/elements.ts`, `src/elements.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/elements.test.ts`:

```ts
describe('materials serializer with corrosion params', () => {
  it('is 12 floats/element with corrosion params in the documented slots', () => {
    const data = materialProperties();
    expect(data.length).toBe(ELEMENTS.length * 12);
    const conc = getElementByName('Sulfuric Acid (Concentrated)');
    const o = conc.id * 12;
    expect(data[o + 0]).toBe(conc.density); // sim density unchanged
    expect(data[o + 6]).toBe(3);            // corrosiveStrength
    expect(data[o + 9]).toBe(getElementByName('Sulfuric Acid (Dilute)').id); // weakensTo
    const lime = getElementByName('Limestone');
    const lo = lime.id * 12;
    expect(data[lo + 7]).toBe(2);           // solubility
    expect(data[lo + 8]).toBe(getElementByName('CO₂').id); // dissolvedProduct
    // A material with no weakensTo maps to its own id.
    const stone = getElementByName('Stone');
    expect(data[stone.id * 12 + 9]).toBe(stone.id);
  });
});
```

- [ ] **Step 2: Run it, confirm FAIL** (length is ELEMENTS.length * 8).

- [ ] **Step 3: Implement** — replace `materialProperties()` in `src/elements.ts` with the 12-float version:

```ts
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
```

- [ ] **Step 4: Run it, confirm PASS**, then full `npm test` + `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/elements.ts src/elements.test.ts
git commit -m "Expand materials serializer to 12 floats with corrosion params"
```

---

### Task 4: Pure corrosion ladder logic

**Files:** Create `src/corrosion.ts`, `src/corrosion.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/corrosion.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getElementByName } from './elements';
import { dissolves } from './corrosion';

const id = (n: string) => getElementByName(n).id;

describe('corrosion ladder', () => {
  it('gates dissolving on corrosiveStrength >= solubility', () => {
    // Very Dilute (1) dissolves Salt (1) only.
    expect(dissolves(id('Sulfuric Acid (Very Dilute)'), id('Salt'))).toBe(true);
    expect(dissolves(id('Sulfuric Acid (Very Dilute)'), id('Limestone'))).toBe(false);
    // Dilute (2) adds Limestone; still not Rust.
    expect(dissolves(id('Sulfuric Acid (Dilute)'), id('Limestone'))).toBe(true);
    expect(dissolves(id('Sulfuric Acid (Dilute)'), id('Rust'))).toBe(false);
    // Concentrated (3) dissolves Rust.
    expect(dissolves(id('Sulfuric Acid (Concentrated)'), id('Rust'))).toBe(true);
  });
  it('non-corrosive or non-soluble pairs never dissolve', () => {
    expect(dissolves(id('Water'), id('Salt'))).toBe(false);       // water isn't corrosive
    expect(dissolves(id('Sulfuric Acid (Fuming)'), id('Sand'))).toBe(false); // sand isn't soluble
  });
});
```

- [ ] **Step 2: Run it, confirm FAIL** — `./corrosion` not found.

- [ ] **Step 3: Implement** — create `src/corrosion.ts`:

```ts
import { getElement } from './elements';

/** Whether a corrosive element dissolves a soluble element: both flags set and
 * the corrosive's strength meets the soluble's threshold. Mirrored in the
 * shader's corrode pass. */
export function dissolves(corrosiveId: number, solubleId: number): boolean {
  const c = getElement(corrosiveId);
  const s = getElement(solubleId);
  if (!c.corrosive || !s.soluble) return false;
  return (c.corrosiveStrength ?? 0) >= (s.solubility ?? Number.POSITIVE_INFINITY);
}
```

- [ ] **Step 4: Run it, confirm PASS**, then full `npm test` + `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/corrosion.ts src/corrosion.test.ts
git commit -m "Add pure corrosion ladder logic (dissolves)"
```

---

# PART B — Shader + dispatch (verified in-browser)

> WGSL is NOT validated by typecheck/build — errors show only at runtime as "Invalid ComputePipeline / Invalid CommandBuffer" (which stops all rendering). After Tasks 5–6, drive the app in headed Chrome (`channel:'chrome'`; headless has no GPU adapter), confirm no console errors, and verify behavior. No i32/u32 mixing in hash seeds (`u32(blockX) + Ku`).

### Task 5: Config + dispatch the corrode pass

**Files:** Modify `src/config.ts`, `src/webgpu/simulation.ts`

- [ ] **Step 1** In `src/config.ts`, change `WATER_SUBSTEPS` from 13 to **12** (keeps `2 + WATER_SUBSTEPS` even so the grid ends in buffer A after soak+corrode+substeps). Update its comment to mention the soak+corrode parity.

- [ ] **Step 2** In `src/webgpu/simulation.ts`:
  - Update `SIM_SLOTS` (near line 28) from `TICKS_PER_FRAME + 1 + WATER_SUBSTEPS` to `TICKS_PER_FRAME + 2 + WATER_SUBSTEPS` (one extra slot for corrode's distinct Margolus alignment). Update the comment.
  - Add a field `private readonly corrodePipeline: GPUComputePipeline;`.
  - Create it next to `this.soakPipeline` (same `simPipelineLayout`, entry point `corrode`):
```ts
this.corrodePipeline = device.createComputePipeline({
  layout: simPipelineLayout,
  compute: { module: simModule, entryPoint: 'corrode' },
});
```
  - In `render()`, in the dispatch block, insert the corrode dispatch between soak and the substep loop, and shift the substep slot base by one:
```ts
dispatchSim(this.soakPipeline, TICKS_PER_FRAME);
dispatchSim(this.corrodePipeline, TICKS_PER_FRAME + 1);
for (let s = 0; s < WATER_SUBSTEPS; s++) {
  dispatchSim(this.waterMovementPipeline, TICKS_PER_FRAME + 2 + s);
}
```
  (`this.frame += SIM_SLOTS;` stays. The `simParams` pre-write loop already fills all `SIM_SLOTS` slots with `frame = this.frame + i`, so corrode's slot gets a distinct frame automatically.)

- [ ] **Step 3** Verify `npm run typecheck` (clean) + `npm run build` (succeeds). NOTE: the `corrode` entry point doesn't exist in the shader yet (next task), so do NOT run the app here — creating `corrodePipeline` against a missing entry point would fail at runtime. Just confirm typecheck/build pass (they don't validate WGSL). The next task adds the entry point; verify in-browser after that.

- [ ] **Step 4: Commit**

```bash
git add src/config.ts src/webgpu/simulation.ts
git commit -m "Dispatch the corrode pass and adjust substep parity"
```

---

### Task 6: The corrode shader pass + 3-vec4 stride

**Files:** Modify `src/shaders/simulate.wgsl`, `src/shaders/render.wgsl`

- [ ] **Step 1** In `simulate.wgsl`, update the material accessors from stride 2 to **stride 3**, and add the corrosion accessors. Replace the existing `density`/`conductivityOf`/`heatCapacityOf`/`ignitionTempOf`/`burnProductOf`/`burnRateOf`:

```wgsl
fn density(id: u32) -> f32 { return materials[id * 3u].x; }
fn conductivityOf(id: u32) -> f32 { return materials[id * 3u].y; }
fn heatCapacityOf(id: u32) -> f32 { return materials[id * 3u].z; }
fn ignitionTempOf(id: u32) -> f32 { return materials[id * 3u].w; }
fn burnProductOf(id: u32) -> u32 { return u32(materials[id * 3u + 1u].x); }
fn burnRateOf(id: u32) -> f32 { return materials[id * 3u + 1u].y; }
fn corrosiveStrengthOf(id: u32) -> f32 { return materials[id * 3u + 1u].z; }
fn solubilityOf(id: u32) -> f32 { return materials[id * 3u + 1u].w; }
fn dissolvedProductOf(id: u32) -> u32 { return u32(materials[id * 3u + 2u].x); }
fn weakensToOf(id: u32) -> u32 { return u32(materials[id * 3u + 2u].y); }
```

- [ ] **Step 2** Add the corrosive/soluble flag readers near `isFlammable`:

```wgsl
const CORROSIVE_BIT: u32 = 8u; // 1u << 3u
const SOLUBLE_BIT: u32 = 16u;  // 1u << 4u
fn isCorrosive(id: u32) -> bool { return (materialFlags[id] & CORROSIVE_BIT) != 0u; }
fn isSoluble(id: u32) -> bool { return (materialFlags[id] & SOLUBLE_BIT) != 0u; }
```

- [ ] **Step 3** Add the `corrode` pass. Place it AFTER the `soak` function (so `preserveTempEnthalpy`/`enthalpyForNewElement`, which it needs, are already declared). Append:

```wgsl
const CORRODE_CHANCE: f32 = 0.15;

// A corrosive dissolves an orthogonally-adjacent soluble when its strength meets
// the soluble's threshold: the soluble becomes its dissolvedProduct and the
// corrosive steps down to its weakensTo. Two-cell transform -> block-owned pass
// (soak's pattern). Enthalpy re-encoded across each elementId change.
@compute @workgroup_size(8, 8)
fn corrode(@builtin(global_invocation_id) gid: vec3<u32>) {
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

  let roll = f32(hash(u32(blockX), u32(blockY), params.frame) & 0xffffu) / 65536.0;
  if (roll < CORRODE_CHANCE) {
    // First corrosive<->soluble pair (a-b, a-c, b-d, c-d, both directions) dissolves.
    if (corrodes(a.elementId, b.elementId)) { let r = applyCorrode(a, b); a = r.corrosive; b = r.soluble; }
    else if (corrodes(b.elementId, a.elementId)) { let r = applyCorrode(b, a); b = r.corrosive; a = r.soluble; }
    else if (corrodes(a.elementId, c.elementId)) { let r = applyCorrode(a, c); a = r.corrosive; c = r.soluble; }
    else if (corrodes(c.elementId, a.elementId)) { let r = applyCorrode(c, a); c = r.corrosive; a = r.soluble; }
    else if (corrodes(b.elementId, d.elementId)) { let r = applyCorrode(b, d); b = r.corrosive; d = r.soluble; }
    else if (corrodes(d.elementId, b.elementId)) { let r = applyCorrode(d, b); d = r.corrosive; b = r.soluble; }
    else if (corrodes(c.elementId, d.elementId)) { let r = applyCorrode(c, d); c = r.corrosive; d = r.soluble; }
    else if (corrodes(d.elementId, c.elementId)) { let r = applyCorrode(d, c); d = r.corrosive; c = r.soluble; }
  }

  writeBuf[idxA] = a; writeBuf[idxB] = b; writeBuf[idxC] = c; writeBuf[idxD] = d;
}
```

And add these two helpers ABOVE `corrode` (after the accessors, but they use `preserveTempEnthalpy`/`enthalpyForNewElement`, so place them AFTER those functions too — i.e. immediately before `corrode`):

```wgsl
// Mirrors src/corrosion.ts dissolves(): corrosive strong enough for the soluble.
fn corrodes(corrosiveId: u32, solubleId: u32) -> bool {
  return isCorrosive(corrosiveId) && isSoluble(solubleId)
      && corrosiveStrengthOf(corrosiveId) >= solubilityOf(solubleId);
}

struct CorrodeResult { corrosive: Cell, soluble: Cell }

fn applyCorrode(corrosive: Cell, soluble: Cell) -> CorrodeResult {
  let prod = dissolvedProductOf(soluble.elementId);
  let newSoluble = Cell(prod, preserveTempEnthalpy(soluble.elementId, soluble.enthalpy, prod));
  let wt = weakensToOf(corrosive.elementId);
  var newCorrosive = corrosive;
  if (wt != corrosive.elementId) {
    newCorrosive = Cell(wt, preserveTempEnthalpy(corrosive.elementId, corrosive.enthalpy, wt));
  }
  return CorrodeResult(newCorrosive, newSoluble);
}
```

- [ ] **Step 4** In `src/shaders/render.wgsl`, update `heatCapacityOf` to the new stride: `return materials[id * 3u].z;`.

- [ ] **Step 5** Verify `npm run typecheck` + `npm run build`, then **drive it in headed Chrome** and confirm no console errors AND:
  - Existing behavior unchanged (sand/water/gas/soak/flammability, wood ignites) — the stride change is behavior-preserving for Phase-1 fields.
  - Paint a pool of each acid tier onto Salt/Limestone/Rust: **Very Dilute** dissolves only Salt; **Dilute** also dissolves Limestone (watch **CO₂ fizz upward**); **Concentrated** also dissolves Rust. The acid visibly dilutes (tier steps down, color shifts) as it works and stops at Water.
  - Toggle the heat map (backtick? use the "Heat map" button): dissolving should NOT create hot/cold spots (enthalpy re-encoded).
  - Watch the console for "Invalid ComputePipeline" — there should be none.

- [ ] **Step 6: Commit**

```bash
git add src/shaders/simulate.wgsl src/shaders/render.wgsl
git commit -m "Add corrode pass (generic strength-gated dissolving) and 3-vec4 stride"
```

---

# PART C — End-to-end coverage

### Task 7: e2e — corrosion ladder + no errors

**Files:** Modify `e2e/smoke.spec.ts`

- [ ] **Step 1** Append a test (guarded to skip on no-GPU, like the existing tests; `exact: true` on element buttons):

```ts
test('generic corrosion: acid dissolves solubles — no errors', async ({ page }) => {
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
  // NOTE: the chem materials (Salt/Limestone/…) and acids have a formula, so
  // their button's accessible name is "name + formula" — use a non-exact
  // (substring) match, not exact. Their names are unique substrings.
  const dab = async (name: string, fx: number, fy: number) => {
    await page.getByRole('button', { name }).first().click();
    const p = at(fx, fy); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 15, p.y); await page.mouse.up();
  };

  // A limestone bed with concentrated acid on top: exercises dissolve + CO2 fizz.
  await dab('Limestone', 0.5, 0.6);
  await dab('Sulfuric Acid (Concentrated)', 0.5, 0.45);
  await dab('Salt', 0.25, 0.6);
  await page.waitForTimeout(2500);

  expect(pageErrors, `page errors: ${pageErrors.join('; ')}`).toEqual([]);
  expect(consoleErrors, `console errors: ${consoleErrors.join('; ')}`).toEqual([]);
});
```

- [ ] **Step 2** Run `npm run typecheck && npm test && npm run test:e2e` — typecheck clean, all unit tests green, Playwright passes or skips on no-GPU. Report honestly.

- [ ] **Step 3: Commit**

```bash
git add e2e/smoke.spec.ts
git commit -m "Add e2e for generic corrosion"
```

---

## Final verification

- [ ] `npm run typecheck` clean; `npm test` all green (elements, corrosion, plus existing); `npm run test:e2e` passes/skips.
- [ ] `npm run dev` in Chrome: the resistance ladder works (very-dilute→salt only; dilute→+limestone w/ CO₂ fizz; concentrated→+rust), acid dilutes as it dissolves and stops at Water, Copper still reacts via the override table (unchanged), heat map stays at ambient during dissolving, no console errors. Existing sim (water/soak/gas/flammability) unchanged.
