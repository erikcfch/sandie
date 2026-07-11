# Phase 3c — Electricity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate the `conductive` flag: current flows through conductors on a complete Battery→Ground circuit, heats the live wire (ohmic), and thereby ignites flammables and detonates explosives (emergent, via the existing thermal + 3b blast rules); a glow shows the powered path. Demo materials: Battery, Ground (Copper is the wire).

**Architecture:** Two decaying-reachability scalar fields per cell — `srcReach` (floods from Batteries through conductors) and `gndReach` (floods from Grounds) — packed as one `charge: array<vec2<f32>>` field (canonical buffer + scratch + per-frame copy-back). A new IN-PLACE `electricity` compute pass (its own bind-group layout, dispatched outside the ping-pong on `gridBufferA`) propagates both fields, injects MAX at Battery/Ground, and adds ohmic heat where a cell is LIVE (`srcReach≥τ && gndReach≥τ`). This is the exact pattern already proven by the merged 3b `blast` pass — mirror it. Ohmic heat is a bare `enthalpy +=` (Dawn-safe, no chain-walk). Ignite/detonate emerge from the existing `heat`/`blast` passes; glow is render-only.

**Tech Stack:** TypeScript, WebGPU/WGSL compute shaders, Vitest (unit), Vite, Playwright + headed Chrome (authoritative verification).

## Global Constraints

- **Dawn/WGSL codegen hazard** (`project_wgsl_chainwalk_codegen_bug`): the `electricity` pass MUST NOT call `thermalFromEnthalpy`/`preserveTempEnthalpy`/`enthalpyForNewElement`. Ohmic heat is `enthalpy += OHMIC_HEAT`; the hot-cap uses the PROXY temperature `enthalpy/heatCapacityOf(id)` (a division, no loop). Build incrementally; the Stone-bowl test is the wipe detector.
- **WGSL is not validated by build/typecheck** — every behavioral claim is verified in headed Chrome (`channel:'chrome'`, `--enable-unsafe-webgpu`; headless has no adapter). Restart the dev server fresh per observation (HMR unreliable across edits; ports 5173–5175 often taken → 5176). Verification is the controller's job (steps labelled **[controller]**), not the implementer's.
- **Reference implementation:** the merged **3b `blast` pass** is the template for every piece here — the pressure field buffers (`pressureField`/`pressureNext` in `simulation.ts`), the separate in-place bind-group layout + pipeline, the dispatch after the pass chain, the `copyBufferToBuffer` back, the reset zeroing, and the `render.wgsl` pressure tint. Read those and mirror them for `charge`/`electricity`/glow.
- **Flags:** `source` (Battery) = `materialFlags` bit 9 (`1<<9`=512); `ground` (Ground) = bit 10 (`1<<10`=1024). `conductive` (bit 5) already exists. Bit 8 = explosive (3b).
- **Charge field:** `charge` is `vec2<f32>` per cell = `(srcReach, gndReach)`, `CELL_COUNT * 8` bytes; canonical `chargeFieldBuffer` + scratch `chargeNextBuffer`, copy-back after the compute pass, both zeroed on reset.
- **Reachability rule (per field), mirrored exactly in `electricity.ts` and the shader:** source→`REACH_MAX`; non-conductive→0; else if `maxNeighbourReach ≥ REACH_TAU`→`REACH_MAX`; else `max(0, selfReach - REACH_DECAY)`. **LIVE = `srcReach ≥ REACH_TAU && gndReach ≥ REACH_TAU`.**
- **Constants (initial; tuned in-browser):** `REACH_MAX=100`, `REACH_TAU=0.5`, `REACH_DECAY=20`, `OHMIC_HEAT=5`, `HOT_CAP=600` (stop adding ohmic heat above this proxy temp so a wire plateaus).
- **Branch:** `material-electricity` off `master`. Frequent commits; `--no-ff` merge at the end (separate finishing step).

---

## Task 1: Electricity data — source/ground flags + Battery/Ground materials (TS-only)

**Files:**
- Modify: `src/elements.ts` (ElementDef: add `source`/`ground`; `materialFlags` bits 9/10; add Battery id 29, Ground id 30)
- Modify: `src/elements.test.ts`

**Interfaces:**
- Produces: `ElementDef.source?: boolean`, `ElementDef.ground?: boolean`. Battery (id = current `ELEMENTS.length` = 29): `conductive` + `source`. Ground (id 30): `conductive` + `ground`. `materialFlags()` sets bit 9 for `source`, bit 10 for `ground`.

- [ ] **Step 1: Write the failing test**

In `src/elements.test.ts`, add:
```ts
describe('electricity', () => {
  it('adds Battery (source) and Ground (sink), both conductive', () => {
    const bat = getElementByName('Battery');
    const gnd = getElementByName('Ground');
    expect(bat.source).toBe(true);
    expect(bat.conductive).toBe(true);
    expect(gnd.ground).toBe(true);
    expect(gnd.conductive).toBe(true);
    expect([bat.id, gnd.id]).toEqual([29, 30]);
  });
  it('packs source at bit 9 and ground at bit 10', () => {
    const flags = materialFlags();
    expect((flags[getElementByName('Battery').id] >> 9) & 1).toBe(1);
    expect((flags[getElementByName('Ground').id] >> 10) & 1).toBe(1);
    expect((flags[getElementByName('Copper').id] >> 9) & 1).toBe(0); // conductive but not a source
    expect((flags[getElementByName('Copper').id] >> 5) & 1).toBe(1); // Copper still conductive
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/elements.test.ts`
Expected: FAIL — no Battery/Ground, no `source`/`ground`.

- [ ] **Step 3: Extend `ElementDef` and `materialFlags`**

In `ElementDef`, add after `conductive?: boolean;`:
```ts
  source?: boolean;
  ground?: boolean;
```
In `materialFlags()`, add after the `explosive` line:
```ts
    if (element.source) f |= 1 << 9;
    if (element.ground) f |= 1 << 10;
```

- [ ] **Step 4: Add the Battery and Ground elements**

Append to `ELEMENTS` (ids 29, 30; keep contiguous). Game-tuned values:
```ts
  { id: 29, name: 'Battery', category: 'static', color: [70, 200, 90], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.3, family: 'physical', form: 'static', phase: 'solid', origin: 'inorganic', metallic: 'nonmetal', conductive: true, source: true, realDensity: 2.5, specificHeat: 0.8 },
  { id: 30, name: 'Ground', category: 'static', color: [60, 60, 70], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.3, family: 'physical', form: 'static', phase: 'solid', origin: 'inorganic', metallic: 'nonmetal', conductive: true, ground: true, realDensity: 2.5, specificHeat: 0.8 },
```

- [ ] **Step 5: Run the full unit suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/elements.ts src/elements.test.ts
git commit -m "Add source/ground flags + Battery/Ground materials (Phase 3c data)"
```

---

## Task 2: Charge field buffers + inert `electricity` pass

Mirror 3b's Task 2. Add the `charge` (vec2) buffers, a separate in-place `electricity` bind-group layout + pipeline + bind group, dispatch it after the pass chain, copy the scratch back, zero on reset — with the pass body INERT (carry charge through, grid untouched). Prove nothing changed.

**Files:**
- Modify: `src/shaders/simulate.wgsl` (declare `electricity` entry point + its own bindings; a shared read-only `chargeField` for later render/other use is NOT needed — only the electricity pass touches charge)
- Modify: `src/webgpu/simulation.ts` (buffers, layout, pipeline, bind group, dispatch, copy-back, reset, SIM_SLOTS)

**Interfaces:**
- Produces: `chargeFieldBuffer`, `chargeNextBuffer` (each `CELL_COUNT * 8` bytes, `STORAGE | COPY_DST` on field / `+ COPY_SRC` on scratch — match how 3b set pressure usage flags: scratch is the copy SOURCE, field the DESTINATION); an `electricityPipeline` + `electricityBindGroup` on a new `electricity-bgl`; `SIM_SLOTS` grows by 1; electricity slot = the next free slot after blast (`TICKS_PER_FRAME + 3`), liquid substep base shifts to `TICKS_PER_FRAME + 4 + s`.

- [ ] **Step 1: Add the inert `electricity` pass to the shader**

In `src/shaders/simulate.wgsl`, at the end (after `blast`), add its own-layout bindings + a pass-through body (mirror the blast pass's separate-layout style):
```wgsl
// ---- Electricity pass (Phase 3c) — its own bind group layout ----
@group(0) @binding(0) var<uniform> elecParams: SimParams;
@group(0) @binding(1) var<storage, read_write> elecGrid: array<Cell>;
@group(0) @binding(2) var<storage, read> elecChargeIn: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read_write> elecChargeOut: array<vec2<f32>>;
@group(0) @binding(4) var<storage, read> elecMaterials: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read> elecFlags: array<u32>;

@compute @workgroup_size(8, 8)
fn electricity(@builtin(global_invocation_id) gid: vec3<u32>) {
  let width = i32(elecParams.width);
  let height = i32(elecParams.height);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= width || y >= height) { return; }
  let idx = cellIndex(x, y, width);
  // Task 2: inert — carry charge through, leave the grid untouched.
  elecChargeOut[idx] = elecChargeIn[idx];
}
```
(These `@binding` numbers reuse 0–5 but belong to the electricity pipeline's SEPARATE layout — legal because `electricity`'s only helper is the pure `cellIndex`, touching no shared global binding. This is exactly how the blast pass works.)

- [ ] **Step 2: Wire buffers + layout + pipeline + bind group + dispatch + copy-back + reset in `simulation.ts`**

Mirror the blast wiring exactly (read the existing `pressureFieldBuffer`/`blastBindGroupLayout`/`blastPipeline`/`blastBindGroup`/dispatch/`copyBufferToBuffer`/reset blocks and copy their shape):
- Create `chargeFieldBuffer` + `chargeNextBuffer` (`CELL_COUNT * 8` bytes; field = `STORAGE|COPY_DST`, scratch = `STORAGE|COPY_DST|COPY_SRC`).
- `electricityBindGroupLayout` (6 entries: uniform+dynamic, storage grid, read-only-storage chargeIn, storage chargeOut, read-only-storage materials, read-only-storage flags); `electricityPipeline` (entryPoint `electricity`); `electricityBindGroup` (binding 1 = `gridBufferA`, 2 = `chargeFieldBuffer`, 3 = `chargeNextBuffer`, 4 = `materialsBuffer`, 5 = `materialFlagsBuffer`).
- `SIM_SLOTS = TICKS_PER_FRAME + 4 + LIQUID_SUBSTEPS`; shift the liquid loop slot base to `TICKS_PER_FRAME + 4 + s`.
- After the blast dispatch, dispatch electricity in place on A with slot `TICKS_PER_FRAME + 3`:
```ts
        pass.setPipeline(this.electricityPipeline);
        pass.setBindGroup(0, this.electricityBindGroup, [(TICKS_PER_FRAME + 3) * this.paramsStride]);
        pass.dispatchWorkgroups(WORKGROUPS_X, WORKGROUPS_Y);
```
- After `pass.end()`, alongside the pressure copy-back, add:
```ts
        encoder.copyBufferToBuffer(this.chargeNextBuffer, 0, this.chargeFieldBuffer, 0, CELL_COUNT * 8);
```
- In `reset()`, zero both charge buffers (`new Float32Array(CELL_COUNT * 2)`).

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/shaders/simulate.wgsl src/webgpu/simulation.ts
git commit -m "Wire inert charge field + no-op electricity pass (Phase 3c)"
```

- [ ] **Step 5: [controller] Verify nothing changed in headed Chrome**

Restart the dev server fresh. Confirm all prior behavior identical (movement, water, ignite, corrosion, phase chains, viscosity, and a TNT-in-lava blast); Stone-bowl static; **no grid wipe**; zero console errors. (Charge is written but unread; the pass-through must be invisible.) If the grid wipes, the wiring/parity is wrong — bisect before proceeding.

---

## Task 3: Reachability propagation + injection + debug glow

Make both fields flood through conductors from Battery/Ground and decay-retract. Add a pure `electricity.ts` mirror + a render glow tint.

**Files:**
- Create: `src/electricity.ts`, `src/electricity.test.ts`
- Modify: `src/shaders/simulate.wgsl` (`electricity` propagation)
- Modify: `src/shaders/render.wgsl` + `src/webgpu/simulation.ts` (glow tint: bind `chargeFieldBuffer` to render at the next free binding = 6)

**Interfaces:**
- Produces: `reachUpdate(selfReach, neighbourMax, isConductive, isSource): number` and `isLive(src, gnd): boolean` + constants `REACH_MAX`, `REACH_TAU`, `REACH_DECAY` in `src/electricity.ts`, mirrored verbatim in the shader.

- [ ] **Step 1: Write the failing test**

`src/electricity.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { REACH_MAX, REACH_TAU, isLive, reachUpdate } from './electricity';

describe('reachability update', () => {
  it('a source is always MAX', () => {
    expect(reachUpdate(0, 0, true, true)).toBe(REACH_MAX);
  });
  it('a non-conductor is always 0', () => {
    expect(reachUpdate(REACH_MAX, REACH_MAX, false, false)).toBe(0);
  });
  it('a conductor next to a reachable neighbour resets to MAX', () => {
    expect(reachUpdate(0, REACH_MAX, true, false)).toBe(REACH_MAX);
  });
  it('a conductor cut off from any reachable neighbour decays toward 0', () => {
    let r = REACH_MAX;
    for (let i = 0; i < 20; i++) r = reachUpdate(r, 0, true, false);
    expect(r).toBe(0);
    // and strictly decreases while positive
    expect(reachUpdate(REACH_MAX, 0, true, false)).toBeLessThan(REACH_MAX);
  });
  it('LIVE requires both reaches at/above tau (open circuit is dead)', () => {
    expect(isLive(REACH_MAX, REACH_MAX)).toBe(true);
    expect(isLive(REACH_MAX, 0)).toBe(false); // source but no ground path
    expect(isLive(0, REACH_MAX)).toBe(false);
    expect(isLive(REACH_TAU, REACH_TAU)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/electricity.test.ts`
Expected: FAIL — no `./electricity`.

- [ ] **Step 3: Implement `src/electricity.ts`**

```ts
/** Reachability saturates here; LIVE threshold is REACH_TAU below it. */
export const REACH_MAX = 100;
/** A cell counts as reachable (LIVE-eligible) at/above this. */
export const REACH_TAU = 0.5;
/** Per-tick retraction when a cell has no reachable neighbour (cut wire fades). */
export const REACH_DECAY = 20;

/** One reachability step for one field. `neighbourMax` = max reach among the 4
 * orthogonal neighbours. Mirrored verbatim in simulate.wgsl's electricity pass. */
export function reachUpdate(
  selfReach: number, neighbourMax: number, isConductive: boolean, isSource: boolean,
): number {
  if (isSource) return REACH_MAX;
  if (!isConductive) return 0;
  if (neighbourMax >= REACH_TAU) return REACH_MAX;
  return Math.max(0, selfReach - REACH_DECAY);
}

/** A conductor is live (carries current) only when reachable from BOTH a source
 * and a ground — an open circuit is dead. */
export function isLive(srcReach: number, gndReach: number): boolean {
  return srcReach >= REACH_TAU && gndReach >= REACH_TAU;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/electricity.test.ts`
Expected: PASS.

- [ ] **Step 5: Mirror propagation in the `electricity` pass**

In `simulate.wgsl`'s `electricity`, replace the pass-through with: read `self` charge + the 4 neighbours' charges (off-grid → `vec2(0,0)`, bounds-guarded like the blast/heat passes); compute `newSrc`/`newGnd` per the reachability rule using this cell's flags (`elecFlags[id] & 32u` conductive bit 5; `& 512u` source bit 9; `& 1024u` ground bit 10) — source-field source = the source bit, ground-field source = the ground bit; write `elecChargeOut[idx] = vec2(newSrc, newGnd)`. Add WGSL consts `REACH_MAX: f32 = 100.0; REACH_TAU: f32 = 0.5; REACH_DECAY: f32 = 20.0;` matching `electricity.ts`. Grid still untouched this task.

- [ ] **Step 6: Add a debug glow tint to the renderer**

In `render.wgsl`, add `@binding(6) chargeField: array<vec2<f32>>` (read-only), and after the pressure tint blend a bright electric colour (e.g. cyan/yellow) by `live = f32(charge.x >= REACH_TAU && charge.y >= REACH_TAU)` — subtle, so it shows the powered path. In `simulation.ts` add `chargeFieldBuffer` to `renderBindGroupLayout` + `renderBindGroup` at binding 6.

- [ ] **Step 7: Typecheck + build + commit**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
```bash
git add src/electricity.ts src/electricity.test.ts src/shaders/simulate.wgsl src/shaders/render.wgsl src/webgpu/simulation.ts
git commit -m "Electricity reachability propagation + injection + glow (Phase 3c)"
```

- [ ] **Step 8: [controller] Verify propagation in headed Chrome**

Restart fresh. Paint `Battery — Copper wire — Ground`: confirm the whole connected wire lights up (glow) source→ground. Paint a Battery + Copper wire that does NOT reach a Ground: confirm it stays **dark** (open circuit dead). Break a live wire mid-run: confirm the downstream part **goes dark** within a few ticks (retraction). Stone-bowl static; no wipe; no console errors.

---

## Task 4: LIVE detection + ohmic heat (→ emergent ignite/detonate)

Make a LIVE cell heat up; ignite/detonate emerge from the existing rules.

**Files:**
- Modify: `src/shaders/simulate.wgsl` (`electricity`: add ohmic heat)

- [ ] **Step 1: Add ohmic heat to the `electricity` pass**

After computing `newSrc`/`newGnd`, if `isLive(newSrc, newGnd)` and the cell's proxy temp is below the cap, add ohmic heat to the grid cell (Dawn-safe — bare add, proxy temp only):
```wgsl
  var cell = elecGrid[idx];
  if (newSrc >= REACH_TAU && newGnd >= REACH_TAU) {
    let proxyTemp = cell.enthalpy / elecMaterials[cell.elementId * 4u].z; // heatCapacity
    if (proxyTemp < HOT_CAP) { cell.enthalpy = cell.enthalpy + OHMIC_HEAT; }
  }
  elecGrid[idx] = cell;
  elecChargeOut[idx] = vec2<f32>(newSrc, newGnd);
```
Add WGSL consts `OHMIC_HEAT: f32 = 5.0; HOT_CAP: f32 = 600.0;`. Note ignite/detonate are NOT coded here — a hot wire raises adjacent Wood/TNT via the existing `heat`/`blast` passes.

- [ ] **Step 2: Typecheck + build + commit**

Run: `npx tsc --noEmit && npm run build`
```bash
git add src/shaders/simulate.wgsl
git commit -m "Electricity ohmic heating on live conductors (Phase 3c)"
```

- [ ] **Step 3: [controller] Verify effects in headed Chrome**

Restart fresh. `Battery — Copper — Ground` with the heat map on: confirm the live wire **warms** (not the dead/open wire). Run the live wire adjacent to **Wood**: it **ignites** (→ Fire). Wire the live circuit to a **TNT**: it **electric-detonates** (3b blast fires). Confirm an OPEN wire (no ground) does none of these. Stone-bowl static; heat map sane; **no wipe**; no console errors. Tune `OHMIC_HEAT`/`HOT_CAP`/`REACH_DECAY` for good feel.

---

## Task 5: Regression, e2e, tuning, docs

**Files:**
- Modify: `e2e/smoke.spec.ts` (Battery/Copper/Ground smoke test)
- Modify: `docs/superpowers/specs/2026-07-11-electricity-phase3c-design.md` (mark done + tuned constants)

- [ ] **Step 1: Full unit suite + typecheck + build**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: all green.

- [ ] **Step 2: [controller] Full regression sweep in headed Chrome**

Restart fresh. Exercise every prior behavior once (movement/buoyancy/barriers, water sink/soak, wet-sand, corrosion, contact reactions, viscosity, phase chains + heat map, a TNT blast) AND the full electricity scene. No grid wipe, no console errors.

- [ ] **Step 3: Decide the glow/tint**

Keep the electricity glow (it's the powered-path feedback). Optionally gate the 3b pressure tint + this glow behind a debug flag if the shipped render feels busy; otherwise keep both (each is invisible at rest).

- [ ] **Step 4: Add an e2e smoke test**

In `e2e/smoke.spec.ts`, add a test that paints a Battery—Copper—Ground circuit (and a TNT wired to it) and asserts no console/page errors after a wait (Battery/Ground/Copper have no formula → exact match).

- [ ] **Step 5: Update the design spec status + commit**

Mark 3c **DONE** in the design spec; record the tuned constants (`REACH_*`, `OHMIC_HEAT`, `HOT_CAP`) and any deviations.
```bash
git add -A
git commit -m "Phase 3c regression, e2e, tuning, docs"
```

(Merging `material-electricity` → `master` is a separate finishing step via finishing-a-development-branch.)

---

## Self-review notes

- **Spec coverage:** two reachability fields + decay-retraction (Task 3), Battery/Ground source-and-ground injection (Tasks 1+3), LIVE = both-reach (Task 3/4), ohmic heat with emergent ignite/detonate (Task 4), glow (Task 3), incremental Stone-bowl-verified order (Tasks 2→4) — all mapped to the spec.
- **Dawn safety:** the `electricity` pass uses only `enthalpy +=` and the proxy temp — no chain-walk. Called out in Global Constraints and Task 4.
- **Parity safety:** `electricity` is an in-place pass on `gridBufferA` with its own layout, dispatched outside the ping-pong (like `blast`) — verified inert in Task 2 before propagation/heat land.
- **Type consistency:** `reachUpdate`/`isLive` signatures + constants (`REACH_MAX`/`REACH_TAU`/`REACH_DECAY`/`OHMIC_HEAT`/`HOT_CAP`) are used identically in `electricity.ts` (def) and the shader (mirror).
- **Tuning honesty:** all constants are game-balance starting points explicitly tuned in the labelled [controller] browser steps.
