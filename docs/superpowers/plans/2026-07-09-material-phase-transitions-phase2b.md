# Material System Phase 2b — Data-Driven Phase Transitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the shader's thermal decode generic and data-driven — walk chain data (segments + latent-heat plateaus) from a GPU buffer instead of hand-unrolled per-family functions — so a new melting/boiling material is a pure `PHASE_TRANSITIONS` data row. Add Wax↔Molten Wax as the demo.

**Architecture:** A new `chains` GPU buffer (one `vec4` per chain segment). Each element's `chainStart`/`chainCount` are merged into the `materials` buffer's two reserved slots (offsets 10/11) by `simulation.ts` (keeping `elements.ts` free of a circular import). The shader's `thermalFromEnthalpy`/`enthalpyForNewElement` (and render's `temperatureFromEnthalpy`) become a generic loop over the chain mirroring `thermal.ts`, and the hand-unrolled water/lava functions + hardcoded consts are deleted. Behavior-preserving; unit-tested in TS and mirrored in WGSL.

**Tech Stack:** TypeScript, WebGPU (WGSL), Vite, Vitest, Playwright.

**Reference spec:** `docs/superpowers/specs/2026-07-09-material-phase-transitions-design.md`

---

## Locked conventions (read before starting)

**`chains` buffer** — `array<vec4<f32>>`, one entry per chain segment, coldest→hottest within each chain: `(segmentElementId, heatCapacity, boundaryTempAbove, latentHeatAbove)`. The last segment of a chain has no transition above (z/w unused — the walk knows it's last by index).

**Chain membership** — each element's `chainStart` (flat vec4 index of its chain's coldest segment) and `chainCount` (segment count; `0` = no chain) live in the `materials` buffer at **offsets 10 and 11** (the two slots Phase 2a reserved). `elements.ts`'s `materialProperties()` leaves them 0; `simulation.ts` patches them from `chains.ts` when building the buffer (avoids an `elements.ts ↔ phaseTransitions.ts` init-time cycle).

**Bindings:** `chains` is a new storage buffer — sim bind-group **binding 7** (after `materialFlags`=6) and render bind-group **binding 4** (after `materials`=3). Shader accessors: `chainStartOf(id) = u32(materials[id*3u+2u].z)`, `chainCountOf(id) = u32(materials[id*3u+2u].w)`.

**Behavior-preserving:** the migrated chains carry identical boundary temps/latent heats; the generic walk reproduces the hand-unrolled math exactly (including plateau hysteresis). Verify in-browser.

---

# PART A — Data + serializers (TS, unit-tested)

### Task 1: Wax + Molten Wax elements and the phase transition

**Files:** Modify `src/elements.ts`, `src/phaseTransitions.ts`, `src/elements.test.ts`, `src/phaseTransitions.test.ts`, `src/shaders/simulate.wgsl`

- [ ] **Step 1: Write the failing tests.** Append to `src/elements.test.ts`:

```ts
describe('wax', () => {
  it('adds Wax (static solid) and Molten Wax (liquid), both organic, no formula', () => {
    const wax = getElementByName('Wax');
    const molten = getElementByName('Molten Wax');
    expect([wax.id, molten.id]).toEqual([26, 27]);
    expect(wax.form).toBe('static');
    expect(molten.form).toBe('liquid');
    expect(wax.origin).toBe('organic');
    expect(wax.meltingPoint).toBe(60);
    expect(wax.formula).toBeUndefined(); // physical family -> exact-matchable button
  });
});
```

Append to `src/phaseTransitions.test.ts`:

```ts
import { getChain } from './phaseTransitions';
import { temperatureAndElementFromEnthalpy, enthalpyForTemperature } from './thermal';

describe('wax melt chain', () => {
  it('Wax melts to Molten Wax above 60C and resolidifies when cooled', () => {
    const wax = getElementByName('Wax').id;
    const molten = getElementByName('Molten Wax').id;
    const chain = getChain(wax)!;
    expect(chain.segments.map((s) => s.elementId)).toEqual([wax, molten]);
    // Heat solid wax past the melt plateau -> becomes Molten Wax.
    const hot = enthalpyForTemperature(80, molten);
    expect(temperatureAndElementFromEnthalpy(wax, hot).elementId).toBe(molten);
    // Cool molten wax below the plateau -> becomes Wax.
    const cold = enthalpyForTemperature(20, wax);
    expect(temperatureAndElementFromEnthalpy(molten, cold).elementId).toBe(wax);
  });
});
```

(If `getElementByName` isn't imported in `phaseTransitions.test.ts`, add it.)

- [ ] **Step 2: Run, confirm FAIL** — `npm test -- src/elements.test.ts src/phaseTransitions.test.ts`.

- [ ] **Step 3: Implement.** Append two elements to `ELEMENTS` in `src/elements.ts` (index === id):

```ts
  { id: 26, name: 'Wax', category: 'static', density: 85, color: [240, 235, 215], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.2, heatCapacity: 2.0, family: 'physical', form: 'static', phase: 'solid', origin: 'organic', metallic: 'nonmetal', realDensity: 0.9, specificHeat: 2.1, meltingPoint: 60 },
  { id: 27, name: 'Molten Wax', category: 'liquid', density: 42, color: [235, 210, 150], defaultTemp: 70, thermalConductivity: 0.2, heatCapacity: 2.2, family: 'physical', form: 'liquid', phase: 'liquid', origin: 'organic', metallic: 'nonmetal', realDensity: 0.8, specificHeat: 2.2, meltingPoint: 60 },
```

Add the transition to `PHASE_TRANSITIONS` in `src/phaseTransitions.ts` (after the existing rows):

```ts
  { lowElementId: getElementByName('Wax').id, highElementId: getElementByName('Molten Wax').id, boundaryTemp: 60, latentHeat: 40 },
```

Update the element-id comment block at the top of `src/shaders/simulate.wgsl` to append `26=Wax 27=Molten Wax`.

- [ ] **Step 4: Run, confirm PASS**, then full `npm test` + `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/elements.ts src/phaseTransitions.ts src/elements.test.ts src/phaseTransitions.test.ts src/shaders/simulate.wgsl
git commit -m "Add Wax <-> Molten Wax phase transition (demo material)"
```

---

### Task 2: `chains.ts` — chain buffer + membership serializers

**Files:** Create `src/chains.ts`, `src/chains.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/chains.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getElementByName } from './elements';
import { chainData, chainStartOf, chainCountOf } from './chains';

const id = (n: string) => getElementByName(n).id;

describe('chain buffer', () => {
  it('flattens each chain to 4 floats/segment, coldest first, with the transition above', () => {
    const data = chainData();
    // Ice-Water-Steam chain: find Ice's segment.
    const start = chainStartOf(id('Ice'));
    expect(chainCountOf(id('Ice'))).toBe(3);
    expect(data[start * 4 + 0]).toBe(id('Ice'));        // segment element
    expect(data[start * 4 + 2]).toBe(0);                // Ice->Water boundary temp
    expect(data[start * 4 + 3]).toBe(80);               // Ice->Water latent heat
    expect(data[(start + 1) * 4 + 0]).toBe(id('Water')); // next segment
    expect(data[(start + 1) * 4 + 2]).toBe(100);        // Water->Steam boundary
  });
  it('all elements in a chain share start/count; simple materials get 0', () => {
    expect(chainStartOf(id('Water'))).toBe(chainStartOf(id('Ice')));
    expect(chainCountOf(id('Steam'))).toBe(3);
    expect(chainCountOf(id('Lava'))).toBe(2);
    expect(chainCountOf(id('Sand'))).toBe(0);           // no phase transition
    expect(chainStartOf(id('Sand'))).toBe(0);
    expect(chainCountOf(id('Wax'))).toBe(2);            // new chain
  });
});
```

- [ ] **Step 2: Run, confirm FAIL** — `./chains` not found.

- [ ] **Step 3: Implement** — create `src/chains.ts`:

```ts
import { ELEMENTS } from './elements';
import { getChain } from './phaseTransitions';

interface Built {
  data: Float32Array;
  start: Map<number, number>;
  count: Map<number, number>;
}

let cache: Built | undefined;

function build(): Built {
  if (cache) return cache;
  const entries: number[] = [];
  const start = new Map<number, number>();
  const count = new Map<number, number>();
  const seen = new Set<number>();
  for (const element of ELEMENTS) {
    const chain = getChain(element.id);
    if (!chain) continue;
    const coldest = chain.segments[0].elementId;
    if (seen.has(coldest)) continue;
    seen.add(coldest);
    const segStart = entries.length / 4; // vec4 index
    chain.segments.forEach((seg, i) => {
      const transition = chain.transitions[i]; // undefined for the last segment
      entries.push(seg.elementId, seg.heatCapacity, transition ? transition.boundaryTemp : 0, transition ? transition.latentHeat : 0);
    });
    for (const seg of chain.segments) {
      start.set(seg.elementId, segStart);
      count.set(seg.elementId, chain.segments.length);
    }
  }
  cache = { data: new Float32Array(entries), start, count };
  return cache;
}

/** The flattened chain buffer (one vec4 per segment). */
export function chainData(): Float32Array {
  return build().data;
}
/** Flat vec4 index of the element's chain's coldest segment (0 if no chain). */
export function chainStartOf(elementId: number): number {
  return build().start.get(elementId) ?? 0;
}
/** Number of segments in the element's chain (0 = no phase transitions). */
export function chainCountOf(elementId: number): number {
  return build().count.get(elementId) ?? 0;
}
```

- [ ] **Step 4: Run, confirm PASS**, then full `npm test` + `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/chains.ts src/chains.test.ts
git commit -m "Add chain buffer + membership serializers (chains.ts)"
```

---

# PART B — Buffers + shaders (verified in-browser)

> WGSL is NOT validated by typecheck/build — errors show only at runtime as "Invalid ComputePipeline". After each shader task, drive the app in headed Chrome (`channel:'chrome'`) and confirm no console errors + behavior. No i32/u32 mixing.

### Task 3: Allocate the chains buffer, merge membership, bind it

**Files:** Modify `src/webgpu/simulation.ts`

- [ ] **Step 1** Read `src/webgpu/simulation.ts` — the `materialsBuffer` creation (`this.materialsBuffer = this.createStorageBuffer('materials', materialProperties())`), the `simBindGroupLayout` (bindings 0–6) + `renderBindGroupLayout` (bindings 0–3), and the movement/heat/render bind groups.

- [ ] **Step 2** Imports: add `ELEMENTS` to the `../elements` import, and add `import { chainData, chainStartOf, chainCountOf } from '../chains';`.

- [ ] **Step 3** Add a field `private readonly chainsBuffer: GPUBuffer;`.

- [ ] **Step 4** Replace the `materialsBuffer` creation to patch the chain-membership slots, and create the chains buffer right after:

```ts
const mats = materialProperties();
for (const element of ELEMENTS) {
  mats[element.id * 12 + 10] = chainStartOf(element.id);
  mats[element.id * 12 + 11] = chainCountOf(element.id);
}
this.materialsBuffer = this.createStorageBuffer('materials', mats);
this.chainsBuffer = this.createStorageBuffer('chains', chainData());
```

- [ ] **Step 5** Add binding 7 to `simBindGroupLayout` (after binding 6): `{ binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },` and add `{ binding: 7, resource: { buffer: this.chainsBuffer } }` to BOTH `movementBindGroup` and `heatBindGroup`.

- [ ] **Step 6** Add binding 4 to `renderBindGroupLayout` (after binding 3): `{ binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },` and add `{ binding: 4, resource: { buffer: this.chainsBuffer } }` to `renderBindGroup`.

- [ ] **Step 7** Verify `npm run typecheck` + `npm run build`. This is safe to run in-browser too (the shaders don't declare the new bindings yet, but unused layout bindings are allowed, and the OLD hand-unrolled thermal still works — chain slots 10/11 are simply not read yet). Optional in-browser sanity: existing sim unchanged, no console errors.

- [ ] **Step 8: Commit**

```bash
git add src/webgpu/simulation.ts
git commit -m "Allocate chains buffer, merge chain membership, bind to sim + render"
```

---

### Task 4: Generic thermal walk in `simulate.wgsl`

**Files:** Modify `src/shaders/simulate.wgsl`

- [ ] **Step 1** Add the chains binding after `@group(0) @binding(6) ... materialFlags ...`:

```wgsl
@group(0) @binding(7) var<storage, read> chains: array<vec4<f32>>;
```

- [ ] **Step 2** Add chain-membership accessors near the other material accessors:

```wgsl
fn chainStartOf(id: u32) -> u32 { return u32(materials[id * 3u + 2u].z); }
fn chainCountOf(id: u32) -> u32 { return u32(materials[id * 3u + 2u].w); }
```

- [ ] **Step 3** Replace `thermalFromEnthalpy` with the generic chain-walk (keep the `ThermalResult` struct; it's reused). Mirrors `thermal.ts` `temperatureAndElementFromEnthalpy`:

```wgsl
fn thermalFromEnthalpy(currentElementId: u32, enthalpy: f32) -> ThermalResult {
  let count = chainCountOf(currentElementId);
  if (count == 0u) {
    return ThermalResult(enthalpy / heatCapacityOf(currentElementId), currentElementId);
  }
  let start = chainStartOf(currentElementId);
  var prevBoundaryTemp = 0.0;
  var enthalpyAtPrev = 0.0;
  for (var i = 0u; i < count; i = i + 1u) {
    let seg = chains[start + i];
    let segCap = seg.y;
    if (i < count - 1u) {
      let boundaryTemp = seg.z;
      let latent = seg.w;
      let plateauStart = enthalpyAtPrev + segCap * (boundaryTemp - prevBoundaryTemp);
      let plateauEnd = plateauStart + latent;
      if (enthalpy < plateauStart) {
        return ThermalResult(prevBoundaryTemp + (enthalpy - enthalpyAtPrev) / segCap, u32(seg.x));
      }
      if (enthalpy < plateauEnd) {
        let nextElem = u32(chains[start + i + 1u].x);
        let resultElem = select(u32(seg.x), nextElem, currentElementId == nextElem);
        return ThermalResult(boundaryTemp, resultElem);
      }
      prevBoundaryTemp = boundaryTemp;
      enthalpyAtPrev = plateauEnd;
    } else {
      return ThermalResult(prevBoundaryTemp + (enthalpy - enthalpyAtPrev) / segCap, u32(seg.x));
    }
  }
  return ThermalResult(enthalpy / heatCapacityOf(currentElementId), currentElementId);
}
```

- [ ] **Step 4** Replace `enthalpyForNewElement` with the generic inverse (mirrors `thermal.ts` `enthalpyForTemperature`):

```wgsl
fn enthalpyForNewElement(temperature: f32, targetElementId: u32) -> f32 {
  let count = chainCountOf(targetElementId);
  if (count == 0u) {
    return temperature * heatCapacityOf(targetElementId);
  }
  let start = chainStartOf(targetElementId);
  var prevBoundaryTemp = 0.0;
  var enthalpyAtPrev = 0.0;
  for (var i = 0u; i < count; i = i + 1u) {
    let seg = chains[start + i];
    let segCap = seg.y;
    if (i < count - 1u) {
      let boundaryTemp = seg.z;
      let latent = seg.w;
      if (temperature <= boundaryTemp) {
        return enthalpyAtPrev + segCap * (temperature - prevBoundaryTemp);
      }
      let plateauStart = enthalpyAtPrev + segCap * (boundaryTemp - prevBoundaryTemp);
      prevBoundaryTemp = boundaryTemp;
      enthalpyAtPrev = plateauStart + latent;
    } else {
      return enthalpyAtPrev + segCap * (temperature - prevBoundaryTemp);
    }
  }
  return temperature * heatCapacityOf(targetElementId);
}
```

- [ ] **Step 5** DELETE the now-dead hand-unrolled code: `isWaterFamily`, `isLavaFamily`, `waterChainFromEnthalpy`, `lavaChainFromEnthalpy`, `waterChainEnthalpyForTemperature`, `lavaChainEnthalpyForTemperature`, and the consts `ICE_WATER_BOUNDARY`, `ICE_WATER_LATENT`, `WATER_STEAM_BOUNDARY`, `WATER_STEAM_LATENT`, `STONE_LAVA_BOUNDARY`, `STONE_LAVA_LATENT`. Keep the element-id consts (ICE/WATER/STEAM/STONE/LAVA/etc.) and the `ThermalResult` struct. After deleting, grep to confirm none of the deleted names are still referenced.

- [ ] **Step 6** Verify `npm run typecheck` + `npm run build`, then **drive in headed Chrome** (controller does this): existing transitions unchanged (heat Ice → melts to Water → boils to Steam; heat Stone/near Lava → melts to Lava; low ambient → Water freezes to Ice), Wax heated past 60 °C melts to Molten Wax (flows) and resolidifies when cooled, soak/corrode/flammability still work (they use `enthalpyForNewElement`), no console errors ("Invalid ComputePipeline" would mean a WGSL bug).

- [ ] **Step 7: Commit**

```bash
git add src/shaders/simulate.wgsl
git commit -m "Generic data-driven thermal chain-walk in simulate.wgsl"
```

---

### Task 5: Generic temperature decode in `render.wgsl`

**Files:** Modify `src/shaders/render.wgsl`

- [ ] **Step 1** Read `src/shaders/render.wgsl` — the `@group(0) @binding(3) ... materials` line, `heatCapacityOf` (already `materials[id*3u].z`), `waterChainTemp`, `lavaChainTemp`, `temperatureFromEnthalpy`, and the phase consts.

- [ ] **Step 2** Add the chains binding after `@group(0) @binding(3) ... materials ...`:

```wgsl
@group(0) @binding(4) var<storage, read> chains: array<vec4<f32>>;
```

- [ ] **Step 3** Add the chain accessors and replace `temperatureFromEnthalpy` with the generic (temperature-only) walk:

```wgsl
fn chainStartOf(id: u32) -> u32 { return u32(materials[id * 3u + 2u].z); }
fn chainCountOf(id: u32) -> u32 { return u32(materials[id * 3u + 2u].w); }

fn temperatureFromEnthalpy(elementId: u32, enthalpy: f32) -> f32 {
  let count = chainCountOf(elementId);
  if (count == 0u) { return enthalpy / heatCapacityOf(elementId); }
  let start = chainStartOf(elementId);
  var prevBoundaryTemp = 0.0;
  var enthalpyAtPrev = 0.0;
  for (var i = 0u; i < count; i = i + 1u) {
    let seg = chains[start + i];
    let segCap = seg.y;
    if (i < count - 1u) {
      let boundaryTemp = seg.z;
      let latent = seg.w;
      let plateauStart = enthalpyAtPrev + segCap * (boundaryTemp - prevBoundaryTemp);
      let plateauEnd = plateauStart + latent;
      if (enthalpy < plateauStart) { return prevBoundaryTemp + (enthalpy - enthalpyAtPrev) / segCap; }
      if (enthalpy < plateauEnd) { return boundaryTemp; }
      prevBoundaryTemp = boundaryTemp;
      enthalpyAtPrev = plateauEnd;
    } else {
      return prevBoundaryTemp + (enthalpy - enthalpyAtPrev) / segCap;
    }
  }
  return enthalpy / heatCapacityOf(elementId);
}
```

- [ ] **Step 4** DELETE the dead `waterChainTemp`, `lavaChainTemp`, and the phase consts (`ICE_WATER_BOUNDARY`, `ICE_WATER_LATENT`, `WATER_STEAM_BOUNDARY`, `WATER_STEAM_LATENT`, `STONE_LAVA_BOUNDARY`, `STONE_LAVA_LATENT`) from `render.wgsl`. Grep to confirm no remaining references.

- [ ] **Step 5** In `src/webgpu/simulation.ts` — confirm the render bind group already includes binding 4 = chains (added in Task 3). (No change if Task 3 did it; otherwise add it.)

- [ ] **Step 6** Verify `npm run typecheck` + `npm run build`, then **drive in headed Chrome**: toggle the heat map — existing elements' temperatures render as before (water/steam/lava plateaus flat), and Wax shows a flat plateau at 60 °C while melting. No console errors.

- [ ] **Step 7: Commit**

```bash
git add src/shaders/render.wgsl
git commit -m "Generic data-driven temperature decode in render.wgsl"
```

---

# PART C — End-to-end coverage

### Task 6: e2e — phase transitions + Wax melt

**Files:** Modify `e2e/smoke.spec.ts`

- [ ] **Step 1** Append a test (guarded to skip on no-GPU; Wax/Molten Wax are `physical` family with no formula, so `exact: true` works; Lava has no formula too):

```ts
test('phase transitions: wax melts near lava — no errors', async ({ page }) => {
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
  const dab = async (name: string, fx: number, fy: number) => {
    await page.getByRole('button', { name, exact: true }).click();
    const p = at(fx, fy); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 15, p.y); await page.mouse.up();
  };

  await dab('Lava', 0.5, 0.55);   // sustained heat
  await dab('Wax', 0.5, 0.45);    // wax on top melts to Molten Wax
  await dab('Ice', 0.25, 0.4);    // existing chain still works
  await page.waitForTimeout(2500);

  expect(pageErrors, `page errors: ${pageErrors.join('; ')}`).toEqual([]);
  expect(consoleErrors, `console errors: ${consoleErrors.join('; ')}`).toEqual([]);
});
```

- [ ] **Step 2** Run `npm run typecheck && npm test && npm run test:e2e` — typecheck clean, all unit green, Playwright passes or skips on no-GPU. Report honestly.

- [ ] **Step 3: Commit**

```bash
git add e2e/smoke.spec.ts
git commit -m "Add e2e for data-driven phase transitions and wax melt"
```

---

## Final verification

- [ ] `npm run typecheck` clean; `npm test` all green (elements, phaseTransitions, chains, plus existing); `npm run test:e2e` passes/skips.
- [ ] `npm run dev` in Chrome: Ice→Water→Steam and Stone→Lava melt/boil exactly as before; Water freezes to Ice at low ambient; Wax melts to Molten Wax near heat and resolidifies when cooled (a new material added with NO shader edits — proving the data-drive); the heat map shows flat plateaus during transitions (including Wax's); soak/corrode/flammability enthalpy carry-over unchanged; no console errors.
