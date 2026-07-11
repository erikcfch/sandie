# Phase 3b — Explosions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a blast primitive — a diffusing pressure field that detonates explosives, destroys terrain, ignites/chain-detonates what it touches (each material yielding its own product), and flings loose material outward — proven by one demo material, TNT.

**Architecture:** A new `pressure: array<f32>` field (canonical buffer `pressureField` + scratch `pressureNext`, copied back each frame). A new **in-place** `blast` compute pass (its own bind-group layout: a single read-write grid buffer, `pressureField` read-only, `pressureNext` write) runs once per frame after the existing pass chain — because it writes only its own cell it needs no grid ping-pong, so the existing chain's buffer parity is untouched. `blast` detonates (proxy-temp trigger), diffuses+decays pressure, and applies destroy/ignite/chain effects. `movement` gains a read-only `pressureField` binding and a pressure-gradient bias that flings loose cells down-gradient using the existing race-free Margolus block swaps. Detonation uses the **proxy temperature** `enthalpy/heatCapacityOf(id)` and all product enthalpies use `enthalpyForNewElement(FIXED_TEMP, chainlessProduct)` — never the chain-walk `thermalFromEnthalpy` — to avoid the Dawn/WGSL codegen grid-wipe.

**Tech Stack:** TypeScript, WebGPU/WGSL compute shaders, Vitest (unit), Vite, Playwright + headed Chrome (authoritative in-browser verification).

## Global Constraints

- **Dawn/WGSL codegen hazard** (`project_wgsl_chainwalk_codegen_bug`): the `blast` pass MUST NOT call `thermalFromEnthalpy` or `preserveTempEnthalpy` (chain-walk loops). Detonation temperature uses the proxy `enthalpy/heatCapacityOf(id)`. Product enthalpy uses `enthalpyForNewElement(temp, product)` ONLY for **chainless** products (Fire, Smoke, Empty, and any `burnProduct` — all chainless), where it early-returns `temp*heatCapacity` with no loop. Build incrementally; the Stone-bowl test (static Stone that vanishes = corruption) is the wipe detector.
- **WGSL is not validated by build/typecheck.** Every behavioral claim is verified in headed Chrome (`channel:'chrome'`, `--enable-unsafe-webgpu`; headless has no GPU adapter). Restart the dev server fresh per observation (HMR unreliable across edits; ports 5173–5175 often taken → 5176). Verification is the controller's job (steps labeled **[controller]**), not the implementer's.
- **Pressure is location-indexed**, never travels with a swapped cell. It lives in its own buffers; `movement` reads it but does not write it. Only `blast` evolves it.
- **Explosive flag:** `materialFlags` bit 8 = `256u` (`EXPLOSIVE_BIT`). Bits 0–7 are taken (form 0–1, flammable 2, corrosive 3, soluble 4, conductive 5, organic 6, metal 7).
- **Blast params:** `materials` buffer free slots 14/15 = `materials[id*4u+3u].z` (detonationTemp), `.w` (blastStrength). Buffer stays 16 floats/element.
- **Fire is only ever combustion.** Explosive/flammable → their own `burnProduct`; inert destroyed → Smoke (dust). Never blanket-convert to Fire.
- **Branch:** `material-explosions` off `master`. Frequent commits; `--no-ff` merge at the end (separate finishing step).
- **Buffer/pass wiring (reference):** `src/webgpu/simulation.ts` owns buffers, the shared `simBindGroupLayout` (bindings 0 params, 1 readBuf, 2 writeBuf, 3 materials, 4 reactions, 5 thresholdReactions, 6 materialFlags, 7 chains), the `movement`/`heat` bind groups, and the per-frame dispatch. `SIM_SLOTS` sizes the per-dispatch frame-value slots.

---

## Task 1: Explosive data — flag, params, TNT (TS-only, pure)

**Files:**
- Modify: `src/elements.ts` (ElementDef: add `explosive`, `detonationTemp`, `blastStrength`; `materialProperties` slots 14/15; `materialFlags` bit 8; add TNT row)
- Modify: `src/elements.test.ts`

**Interfaces:**
- Produces: `ElementDef.explosive?: boolean`, `detonationTemp?: number`, `blastStrength?: number`. TNT element (new id = current `ELEMENTS.length`, i.e. 28). `materialProperties()` writes `detonationTemp` at `offset+14`, `blastStrength` at `offset+15`. `materialFlags()` sets bit 8 for explosives.

- [ ] **Step 1: Write the failing test**

In `src/elements.test.ts`, add:

```ts
describe('explosives', () => {
  it('adds TNT as a static, explosive, flammable material with blast params', () => {
    const tnt = getElementByName('TNT');
    expect(tnt.form).toBe('static');
    expect(tnt.explosive).toBe(true);
    expect(tnt.flammable).toBe(true);
    expect(tnt.detonationTemp).toBeGreaterThan(0);
    expect(tnt.blastStrength).toBeGreaterThan(0);
    expect(tnt.burnProduct).toBe(getElementByName('Fire').id);
  });

  it('packs the explosive flag at bit 8 and blast params at slots 14/15', () => {
    const flags = materialFlags();
    const tnt = getElementByName('TNT');
    expect((flags[tnt.id] >> 8) & 1).toBe(1);
    expect((flags[getElementByName('Sand').id] >> 8) & 1).toBe(0);
    const data = materialProperties();
    const o = tnt.id * 16;
    expect(data[o + 14]).toBe(tnt.detonationTemp);
    expect(data[o + 15]).toBe(tnt.blastStrength);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/elements.test.ts`
Expected: FAIL — no `TNT`, no `explosive`/`detonationTemp`/`blastStrength`.

- [ ] **Step 3: Extend `ElementDef` and the serializers**

In `src/elements.ts` `ElementDef`, add after `conductive?: boolean;`:
```ts
  explosive?: boolean;
```
and in the behavior params block:
```ts
  /** Temperature (°C, proxy scale) at/above which an explosive detonates. */
  detonationTemp?: number;
  /** Peak pressure injected into the pressure field on detonation (higher = bigger blast). */
  blastStrength?: number;
```

In `materialProperties()`, replace the two reserved zeros at offsets 14/15:
```ts
    data[offset + 14] = element.detonationTemp ?? 0;
    data[offset + 15] = element.blastStrength ?? 0;
```

In `materialFlags()`, add before `data[element.id] = f >>> 0;`:
```ts
    if (element.explosive) f |= 1 << 8;
```

- [ ] **Step 4: Add the TNT element**

Append to `ELEMENTS` (id = 28; keep the array contiguous). Values are game-tuned starting points:
```ts
  { id: 28, name: 'TNT', category: 'static', color: [180, 60, 50], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.15, family: 'physical', form: 'static', phase: 'solid', origin: 'organic', metallic: 'nonmetal', flammable: true, explosive: true, ignitionTemp: 240, burnProduct: 9, burnRate: 0.4, detonationTemp: 300, blastStrength: 40, realDensity: 1.6, specificHeat: 1.2 },
```
(id 9 = Fire. `burnProduct: 9` keeps it explicit like other rows.)

- [ ] **Step 5: Run the full unit suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/elements.ts src/elements.test.ts
git commit -m "Add explosive flag + blast params + TNT (Phase 3b data)"
```

---

## Task 2: Pressure buffers + inert `blast` pass wiring

Add the pressure field, its own `blast` bind-group layout, a no-op `blast` pass, the dispatch + copy-back, `movement`'s read-only pressure binding, and reset. Prove **nothing changes** in-browser (pressure inert), no wipe.

**Files:**
- Modify: `src/shaders/simulate.wgsl` (declare pressure globals; add `blast` entry point as a pass-through; add `pressureField` read-only global for `movement`)
- Modify: `src/webgpu/simulation.ts` (buffers, layouts, bind groups, dispatch, copy-back, reset, SIM_SLOTS)
- Modify: `src/config.ts` if a blast constant module is preferred (optional; constants can live in the shader for now)

**Interfaces:**
- Produces: `pressureFieldBuffer`, `pressureNextBuffer` (each `CELL_COUNT * 4` bytes); a `blastPipeline` + `blastBindGroup` on a new `blastBindGroupLayout`; `SIM_SLOTS` grows by 1; `blast` slot = `TICKS_PER_FRAME + 2`.

- [ ] **Step 1: Declare the pressure field + a no-op `blast` in the shader**

In `src/shaders/simulate.wgsl`, after the `chains` binding (line ~76) add a shared read-only pressure binding used by `movement`:
```wgsl
// Blast pressure field (location-indexed), evolved only by the `blast` pass;
// `movement` reads it to fling loose cells down-gradient. See Phase 3b.
@group(0) @binding(8) var<storage, read> pressureField: array<f32>;
```

At the end of the file add the `blast` pass with its OWN bindings (separate layout — a single in-place grid buffer, pressure read + write). Keep it a pure pass-through for now:
```wgsl
// ---- Blast pass (Phase 3b) — its own bind group layout ----
@group(0) @binding(0) var<uniform> blastParams: SimParams;
@group(0) @binding(1) var<storage, read_write> blastGrid: array<Cell>;
@group(0) @binding(2) var<storage, read> blastPressureIn: array<f32>;
@group(0) @binding(3) var<storage, read_write> blastPressureOut: array<f32>;
@group(0) @binding(4) var<storage, read> blastMaterials: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read> blastFlags: array<u32>;

@compute @workgroup_size(8, 8)
fn blast(@builtin(global_invocation_id) gid: vec3<u32>) {
  let width = i32(blastParams.width);
  let height = i32(blastParams.height);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= width || y >= height) { return; }
  let idx = cellIndex(x, y, width);
  // Task 2: inert — carry pressure through, leave the grid untouched.
  blastPressureOut[idx] = blastPressureIn[idx];
}
```
Note: `blast` is a SEPARATE bind group layout from the shared sim layout, so `blastParams`/`blastGrid`/etc. are its own `@group(0)` bindings and do not clash with the shared layout's globals used by `movement`/`heat`. WGSL resolves each entry point against the pipeline layout it is created with.

- [ ] **Step 2: Add pressure binding 8 to the shared sim layout + bind groups**

In `src/webgpu/simulation.ts` `simBindGroupLayout.entries`, append:
```ts
        { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
```
Create the buffers in the constructor (after `gridBufferB`):
```ts
    this.pressureFieldBuffer = device.createBuffer({
      label: 'pressure-field', size: CELL_COUNT * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    this.pressureNextBuffer = device.createBuffer({
      label: 'pressure-next', size: CELL_COUNT * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
```
(Declare both as `private readonly` fields.) Add `binding: 8` to BOTH `movementBindGroup` and `heatBindGroup` entries:
```ts
        { binding: 8, resource: { buffer: this.pressureFieldBuffer } },
```

- [ ] **Step 3: Create the blast layout, pipeline, and bind group**

Add the layout + pipeline + bind group in the constructor:
```ts
    const blastBindGroupLayout = device.createBindGroupLayout({
      label: 'blast-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform', hasDynamicOffset: true } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      ],
    });
    const blastPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [blastBindGroupLayout] });
    this.blastPipeline = device.createComputePipeline({
      layout: blastPipelineLayout, compute: { module: simModule, entryPoint: 'blast' },
    });
    this.blastBindGroup = device.createBindGroup({
      layout: blastBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.simParamsBuffer, offset: 0, size: SIM_PARAMS_BYTES } },
        { binding: 1, resource: { buffer: this.gridBufferA } },
        { binding: 2, resource: { buffer: this.pressureFieldBuffer } },
        { binding: 3, resource: { buffer: this.pressureNextBuffer } },
        { binding: 4, resource: { buffer: this.materialsBuffer } },
        { binding: 5, resource: { buffer: this.materialFlagsBuffer } },
      ],
    });
```
(Declare `blastPipeline`/`blastBindGroup` as `private readonly` fields.)

- [ ] **Step 4: Grow SIM_SLOTS and dispatch blast + copy-back**

Change:
```ts
const SIM_SLOTS = TICKS_PER_FRAME + 3 + LIQUID_SUBSTEPS;
```
In `render()`, the liquid substep slots shift to `TICKS_PER_FRAME + 3 + s`:
```ts
        for (let s = 0; s < LIQUID_SUBSTEPS; s++) {
          dispatchSim(this.liquidMovementPipeline, TICKS_PER_FRAME + 3 + s);
        }
```
After the liquid loop (grid canonical in A), dispatch blast in place on A, then flip pressure via copy after the pass:
```ts
        pass.setPipeline(this.blastPipeline);
        pass.setBindGroup(0, this.blastBindGroup, [(TICKS_PER_FRAME + 2) * this.paramsStride]);
        pass.dispatchWorkgroups(WORKGROUPS_X, WORKGROUPS_Y);

        this.frame += SIM_SLOTS;
```
After `pass.end();` (still inside `if (didRunComputePass)`), copy the diffused pressure back to canonical:
```ts
      if (simulate) {
        encoder.copyBufferToBuffer(this.pressureNextBuffer, 0, this.pressureFieldBuffer, 0, CELL_COUNT * 4);
      }
```

- [ ] **Step 5: Zero pressure on reset**

In `reset()`, after writing the grid buffers:
```ts
    const zeros = new Float32Array(CELL_COUNT);
    this.device.queue.writeBuffer(this.pressureFieldBuffer, 0, zeros);
    this.device.queue.writeBuffer(this.pressureNextBuffer, 0, zeros);
```

- [ ] **Step 6: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors (WGSL compiles at runtime — the browser step catches shader errors).

- [ ] **Step 7: Commit**

```bash
git add src/shaders/simulate.wgsl src/webgpu/simulation.ts
git commit -m "Wire inert pressure field + no-op blast pass (Phase 3b)"
```

- [ ] **Step 8: [controller] Verify nothing changed in headed Chrome**

Restart the dev server fresh. In headed Chrome, confirm: all prior behavior identical (movement, water, wood ignite, corrosion, phase chains, viscosity); Stone-bowl static; **no grid wipe**; zero console errors. (Pressure is written but unread; the grid pass-through must be invisible.) If the grid wipes, the wiring/parity is wrong — bisect before proceeding.

---

## Task 3: Detonation + pressure injection + debug tint

Make an `explosive` cell over its `detonationTemp` (proxy temp) become its `burnProduct` and inject `blastStrength` into pressure. Add a debug pressure tint to the renderer to see the field.

**Files:**
- Modify: `src/shaders/simulate.wgsl` (`blast` detonation + injection; add `isExplosive`, `detonationTempOf`, `blastStrengthOf`)
- Modify: `src/shaders/render.wgsl` (debug pressure tint) + `src/webgpu/simulation.ts` (bind `pressureFieldBuffer` to render)

**Interfaces:**
- Consumes: `blastGrid`, `blastPressureIn/Out`, `blastFlags`, `blastMaterials`.
- Produces: detonation writes `burnProduct` + `blastStrength` into `blastPressureOut`.

- [ ] **Step 1: Add the detonation logic to `blast` (self-contained, no shared bindings)**

The `blast` pass reads ONLY its own bindings (`blastGrid`/`blastPressureIn/Out`/`blastMaterials`/`blastFlags`) — it must NOT call `enthalpyForNewElement`/`heatCapacityOf`/`isExplosive`/etc., because those reference the shared `materials`(3)/`materialFlags`(6)/`chains`(7) bindings that the blast layout does not provide. Instead it uses a local, chainless product-enthalpy helper (valid because every blast product — Fire, Smoke, any `burnProduct` — is chainless, so the enthalpy is simply `temp * heatCapacity`, which is also inherently Dawn-safe: no loop, no chain walk).

Add near the top constants:
```wgsl
const FIRE_TEMP: f32 = 400.0;
const SMOKE_TEMP: f32 = 80.0;
```
Add a blast-local helper (uses `blastMaterials`, not the shared `materials`):
```wgsl
// Enthalpy for a CHAINLESS product (Fire/Smoke/burnProduct) at a fixed temp.
// Chainless => enthalpy = temp * heatCapacity (no chain walk => Dawn-safe).
fn blastProductEnthalpy(product: u32, temp: f32) -> f32 {
  return temp * blastMaterials[product * 4u].z; // heatCapacity at .z
}
```
Rewrite the `blast` body:
```wgsl
@compute @workgroup_size(8, 8)
fn blast(@builtin(global_invocation_id) gid: vec3<u32>) {
  let width = i32(blastParams.width);
  let height = i32(blastParams.height);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= width || y >= height) { return; }
  let idx = cellIndex(x, y, width);

  var cell = blastGrid[idx];
  let id = cell.elementId;
  var pressure = blastPressureIn[idx];

  // Detonation: explosive hot enough (proxy temp — NOT the chain walk).
  let isExp = (blastFlags[id] & 256u) != 0u; // EXPLOSIVE_BIT = 1u<<8u
  if (isExp) {
    let proxyTemp = cell.enthalpy / blastMaterials[id * 4u].z; // heatCapacity at .z
    let detTemp = blastMaterials[id * 4u + 3u].z;              // detonationTemp at slot 14
    if (proxyTemp >= detTemp) {
      let product = u32(blastMaterials[id * 4u + 1u].x);       // burnProduct at slot 4
      cell = Cell(product, blastProductEnthalpy(product, FIRE_TEMP));
      pressure = pressure + blastMaterials[id * 4u + 3u].w;    // + blastStrength at slot 15
    }
  }

  blastGrid[idx] = cell;
  blastPressureOut[idx] = pressure;
}
```

- [ ] **Step 2: Add a debug pressure tint to the renderer**

In `src/shaders/render.wgsl`, add a `@binding(5) pressureField` read-only storage buffer, and in the fragment shader blend a faint magenta by `pressureField[idx]` (clamped) over the material colour so the blast is visible. (Exact binding index = next free; match `render.wgsl`'s existing layout.) In `simulation.ts` add `pressureFieldBuffer` to `renderBindGroupLayout` + `renderBindGroup` at that binding, and to the render params if a scale is needed.

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`

- [ ] **Step 4: Commit**

```bash
git add src/shaders/simulate.wgsl src/shaders/render.wgsl src/webgpu/simulation.ts
git commit -m "Blast detonation + pressure injection + debug tint (Phase 3b)"
```

- [ ] **Step 5: [controller] Verify detonation in headed Chrome**

Paint TNT, drop Fire/Lava on it. Confirm: TNT reaches detonation temp → becomes Fire; a pressure blob (debug tint) appears at that cell; Stone-bowl static; no wipe; no console errors.

---

## Task 4: Pressure diffusion + decay

Make injected pressure spread to neighbours and fall to zero over a few ticks. Add a pure `blast.ts` mirror for the update math.

**Files:**
- Create: `src/blast.ts`, `src/blast.test.ts`
- Modify: `src/shaders/simulate.wgsl` (`blast` diffusion + decay)

**Interfaces:**
- Produces: `nextPressure(here, up, down, left, right, injected): number` and constants `BLAST_DECAY`, `BLAST_DIFFUSE` in `src/blast.ts`, mirrored exactly in the shader.

- [ ] **Step 1: Write the failing test**

`src/blast.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { BLAST_DECAY, nextPressure } from './blast';

describe('pressure field update', () => {
  it('an isolated pressure cell decays toward zero', () => {
    let p = 40;
    for (let i = 0; i < 30; i++) p = nextPressure(p, 0, 0, 0, 0, 0);
    expect(p).toBeLessThan(0.5);
  });
  it('pressure spreads to neighbours (a zero cell beside a hot one gains pressure)', () => {
    expect(nextPressure(0, 40, 0, 0, 0, 0)).toBeGreaterThan(0);
  });
  it('injection adds on top of the decayed/diffused value', () => {
    expect(nextPressure(0, 0, 0, 0, 0, 40)).toBeGreaterThanOrEqual(40 * BLAST_DECAY);
  });
  it('is monotonic in injection', () => {
    expect(nextPressure(10, 0, 0, 0, 0, 20)).toBeGreaterThan(nextPressure(10, 0, 0, 0, 0, 0));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/blast.test.ts`
Expected: FAIL — no `./blast`.

- [ ] **Step 3: Implement `src/blast.ts`**

```ts
/** Fraction of pressure retained per tick (< 1 → a blast fades to zero). */
export const BLAST_DECAY = 0.72;
/** Share of the local pressure that mixes with the 4-neighbour average. */
export const BLAST_DIFFUSE = 0.5;

/** One explicit diffusion+decay step of the pressure field, plus injection.
 * Mirrored verbatim in simulate.wgsl's blast pass. */
export function nextPressure(
  here: number, up: number, down: number, left: number, right: number, injected: number,
): number {
  const neighbourAvg = (up + down + left + right) / 4;
  const mixed = here * (1 - BLAST_DIFFUSE) + neighbourAvg * BLAST_DIFFUSE;
  return mixed * BLAST_DECAY + injected;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/blast.test.ts`
Expected: PASS.

- [ ] **Step 5: Mirror diffusion+decay in the `blast` pass**

In `simulate.wgsl`'s `blast`, replace the plain carry-through with the diffusion+decay (read 4 neighbour pressures, clamp at edges by treating off-grid as 0), then add injection. Constants as WGSL `const BLAST_DECAY: f32 = 0.72; const BLAST_DIFFUSE: f32 = 0.5;`. Compute `injected` = `blastStrength` only when this cell detonates this tick (from Task 3), else 0. Set `blastPressureOut[idx] = mixed * BLAST_DECAY + injected;`.

- [ ] **Step 6: Typecheck + build + commit**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
```bash
git add src/blast.ts src/blast.test.ts src/shaders/simulate.wgsl
git commit -m "Blast pressure diffusion + decay (Phase 3b)"
```

- [ ] **Step 7: [controller] Verify the shockwave in headed Chrome**

Detonate TNT; confirm (debug tint) the pressure blob expands outward then fades to nothing within a second. No wipe, no errors.

---

## Task 5: Blast effects — destroy, ignite, chain-detonate

Apply pressure to matter: destroy (inert → Smoke, flammable → its `burnProduct`), ignite flammables, chain-detonate other explosives. Extend `blast.ts` with the pure product-decision.

**Files:**
- Modify: `src/blast.ts`, `src/blast.test.ts` (product decision)
- Modify: `src/shaders/simulate.wgsl` (`blast` effects)

**Interfaces:**
- Produces: `blastEffect(pressure, {flammable, explosive, inertLoose}): 'none'|'destroy'|'ignite'|'detonate'` + thresholds `DESTROY_PRESSURE`, `IGNITE_PRESSURE`, `CHAIN_PRESSURE` in `blast.ts`, mirrored in the shader.

- [ ] **Step 1: Write the failing test**

Append to `src/blast.test.ts`:
```ts
import { blastEffect, CHAIN_PRESSURE, DESTROY_PRESSURE, IGNITE_PRESSURE } from './blast';

describe('blast effect selection', () => {
  it('below all thresholds does nothing', () => {
    expect(blastEffect(0, { flammable: false, explosive: false })).toBe('none');
  });
  it('an explosive over the chain threshold detonates', () => {
    expect(blastEffect(CHAIN_PRESSURE, { flammable: false, explosive: true })).toBe('detonate');
  });
  it('a flammable over the ignite threshold ignites', () => {
    expect(blastEffect(IGNITE_PRESSURE, { flammable: true, explosive: false })).toBe('ignite');
  });
  it('anything over the destroy threshold is destroyed', () => {
    expect(blastEffect(DESTROY_PRESSURE, { flammable: false, explosive: false })).toBe('destroy');
  });
  it('thresholds are ordered destroy >= chain >= ignite > 0', () => {
    expect(DESTROY_PRESSURE).toBeGreaterThanOrEqual(CHAIN_PRESSURE);
    expect(CHAIN_PRESSURE).toBeGreaterThanOrEqual(IGNITE_PRESSURE);
    expect(IGNITE_PRESSURE).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/blast.test.ts`
Expected: FAIL — no `blastEffect`.

- [ ] **Step 3: Implement the decision in `blast.ts`**

```ts
export const DESTROY_PRESSURE = 12;
export const CHAIN_PRESSURE = 8;
export const IGNITE_PRESSURE = 4;

export function blastEffect(
  pressure: number, cell: { flammable: boolean; explosive: boolean },
): 'none' | 'destroy' | 'ignite' | 'detonate' {
  if (cell.explosive && pressure >= CHAIN_PRESSURE) return 'detonate';
  if (pressure >= DESTROY_PRESSURE) return 'destroy';
  if (cell.flammable && pressure >= IGNITE_PRESSURE) return 'ignite';
  return 'none';
}
```
(Note: a flammable at destroy pressure still yields its `burnProduct`, applied in the shader — `destroy` for a flammable routes to `burnProduct`, for inert routes to Smoke. The shader picks the product by flag; the decision here selects the branch.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/blast.test.ts`
Expected: PASS.

- [ ] **Step 5: Apply effects in the `blast` pass**

After computing `newPressure` for the cell, decide + apply (all products chainless → `blastProductEnthalpy` from Task 3; use a stochastic `hash` roll for gradualness so a wide front converts over a few ticks):
```wgsl
  // use blast* bindings only; blastProductEnthalpy defined in Task 3
  let flammable = (blastFlags[id] & 4u) != 0u;   // FLAMMABLE_BIT
  let explosive = (blastFlags[id] & 256u) != 0u; // EXPLOSIVE_BIT
  let product = u32(blastMaterials[id * 4u + 1u].x); // burnProduct
  let roll = f32(hash(u32(x), u32(y), blastParams.frame) & 0xffffu) / 65536.0;
  if (explosive && newPressure >= CHAIN_PRESSURE) {
    cell = Cell(product, blastProductEnthalpy(product, FIRE_TEMP));
    newPressure = newPressure + blastMaterials[id * 4u + 3u].w; // chain injects its own strength
  } else if (newPressure >= DESTROY_PRESSURE && roll < 0.6) {
    if (flammable) {
      cell = Cell(product, blastProductEnthalpy(product, FIRE_TEMP));
    } else if (id != EMPTY) {
      cell = Cell(SMOKE, blastProductEnthalpy(SMOKE, SMOKE_TEMP)); // inert → dust
    }
  } else if (flammable && newPressure >= IGNITE_PRESSURE && roll < 0.5) {
    cell = Cell(product, blastProductEnthalpy(product, FIRE_TEMP));
  }
```
Keep detonation-by-heat (Task 3) as the first branch (before pressure effects) so a heated TNT still detonates even at low local pressure. Ensure a cell isn't transformed twice in one tick (guard with the branch structure). Do NOT destroy `EMPTY`. Static solids ARE destroyed (destructible terrain) — no form guard on `destroy` beyond `id != EMPTY`.

- [ ] **Step 6: Typecheck + build + commit**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
```bash
git add src/blast.ts src/blast.test.ts src/shaders/simulate.wgsl
git commit -m "Blast effects: destroy/ignite/chain-detonate (Phase 3b)"
```

- [ ] **Step 7: [controller] Verify effects in headed Chrome**

Scene: a Stone floor, a Sand pile, a Wood block, two adjacent TNT clusters; light one TNT with Fire. Confirm: it detonates → Fire; the shock destroys nearby Sand/Stone → **Smoke** (not Fire); Wood **ignites** (→ Fire via its burnProduct); the adjacent TNT **chain-detonates**; a crater remains; Stone-bowl elsewhere static; **no wipe**; heat map sane; no console errors.

---

## Task 6: Displacement — `movement` pressure-gradient fling

Bias `movement`'s block swaps so a loose cell in a pressure gradient moves down-gradient (outward), on top of gravity. Built last, verified carefully.

**Files:**
- Modify: `src/shaders/simulate.wgsl` (`movement`)

**Interfaces:**
- Consumes: `pressureField` (binding 8, read-only). No new writes (pressure stays put).

- [ ] **Step 1: Add a pressure-directed swap to the block resolution**

In `movement`, after reading `a/b/c/d` and their positions, read the 4 pressures `pA/pB/pC/pD = pressureField[idxA..D]`. Add, BEFORE the gravity/diagonal/horizontal rules, a pressure-fling for each adjacent pair: if the higher-pressure side holds a loose cell (`isPowderOrLiquid`) and the pressure difference exceeds `FLING_PRESSURE`, swap that cell toward the lower-pressure side (out of the blast), gated by a `hash` roll so it scatters rather than teleports. Concrete, for the vertical pair (a top / c bottom):
```wgsl
const FLING_PRESSURE: f32 = 3.0;
// ...
var flungAC = false;
if (abs(pA - pC) > FLING_PRESSURE) {
  // push the loose cell from the high-pressure side to the low-pressure side
  if (pA > pC && isPowderOrLiquid(a.elementId)) { let t = a; a = c; c = t; flungAC = true; }
  else if (pC > pA && isPowderOrLiquid(c.elementId) && (a.elementId == EMPTY || isGas(a.elementId))) { let t = c; c = a; a = t; flungAC = true; }
}
```
Apply the analogous fling to the horizontal pairs (a/b and c/d) using `pA,pB` / `pC,pD`, and skip the normal gravity swap for a pair that was flung this tick (like the existing `movedLeft`/`movedRight` guards) so a cell moves at most once. The exact thresholds/gates are tuned in-browser (Step 3).

- [ ] **Step 2: Typecheck + build + commit**

Run: `npx tsc --noEmit && npm run build`
```bash
git add src/shaders/simulate.wgsl
git commit -m "Movement pressure-gradient displacement — the fling (Phase 3b)"
```

- [ ] **Step 3: [controller] Verify + tune the fling in headed Chrome**

Detonate TNT in a Sand bed. Confirm: Sand is flung **outward/upward** from the blast, not just craters; when no blast is active, Sand/Water fall by gravity exactly as before (paint a plain sand pile — it must behave identically, no drift). Tune `FLING_PRESSURE` and the roll gates so the fling reads well without making idle material jitter. Stone-bowl static when no blast; **no wipe**; no console errors.

---

## Task 7: Regression, tuning, e2e, docs

**Files:**
- Modify: `src/shaders/render.wgsl` (remove or gate the debug tint behind a flag, if not wanted in the shipped look)
- Modify: `e2e/smoke.spec.ts` (add a TNT smoke test)
- Modify: `docs/superpowers/specs/2026-07-10-explosions-phase3b-design.md` (mark done + record tuned constants)

- [ ] **Step 1: Full unit suite + typecheck + build**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: all green.

- [ ] **Step 2: [controller] Full regression sweep in headed Chrome**

Restart fresh. Exercise every prior behavior once (movement/buoyancy/barriers, water sink/soak, wet-sand, corrosion, contact reactions, viscosity flow, phase chains + heat map) AND the full explosion scene. No grid wipe, no console errors.

- [ ] **Step 3: Decide the debug tint**

Either remove the render pressure tint or gate it behind a toolbar/debug flag so the shipped render is clean. Keep the `pressureField` render binding only if the tint stays.

- [ ] **Step 4: Add an e2e smoke test**

In `e2e/smoke.spec.ts`, add a test that paints TNT + Fire and asserts no console/page errors after a wait (match TNT's button name; TNT has no formula so exact match works).

- [ ] **Step 5: Update the design spec status + commit**

Mark 3b **DONE** in the design spec; record the tuned constants (`BLAST_DECAY`, thresholds, `FLING_PRESSURE`, TNT params) and any deviations.
```bash
git add -A
git commit -m "Phase 3b regression, e2e, tuning, docs"
```

(Merging `material-explosions` → `master` is a separate finishing step via finishing-a-development-branch.)

---

## Self-review notes

- **Spec coverage:** pressure field + diffusion/decay (Task 4), detonation via proxy temp (Task 3), destroy/ignite/chain with material-driven products (Task 5), displacement (Task 6), TNT demo (Task 1), incremental Stone-bowl-verified order (Tasks 2→6) — all mapped to the spec.
- **Dawn safety:** the `blast` pass uses only the proxy temp and `enthalpyForNewElement` on chainless products — no `thermalFromEnthalpy`/`preserveTempEnthalpy`. Called out in Global Constraints and each shader step.
- **Parity safety:** `blast` is an in-place pass on `gridBufferA` with its own layout; it does NOT participate in the grid ping-pong, so the existing chain's end-in-A invariant is preserved (verified inert in Task 2 before any effect is added).
- **Type consistency:** `nextPressure`/`blastEffect` signatures + constant names (`BLAST_DECAY`, `DESTROY_PRESSURE`, `CHAIN_PRESSURE`, `IGNITE_PRESSURE`, `FLING_PRESSURE`) are used identically in `blast.ts` (def) and the shader (mirror).
- **Tuning honesty:** all threshold/decay/param values are game-balance starting points explicitly tuned in the labelled [controller] browser steps; the plan states this rather than pretending they are final.
