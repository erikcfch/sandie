# Phase 3a — Values Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the sim derive movement `density` and thermal `heatCapacity` from each material's real scientific values (`realDensity`, `specificHeat`) instead of hand-tuned game numbers, so Phase 3 materials specify only real values.

**Architecture:** A new pure leaf `src/density.ts` maps `realDensity` (g/cm³) → the movement band via a monotonic log function; a per-element rule keeps **static solids as immovable barriers** (a sentinel above every movable material) while movable materials (powder/liquid/gas) use the log-mapped value, and Empty stays 0. `heatCapacity` is retired in favor of the already-present `specificHeat`. This is a **TS-only** change — the shader still reads `density(id)` / `heatCapacityOf(id)` from the `materials` buffer exactly as today; only the numbers written into the buffer change. No new WGSL control flow, so it is **not** exposed to the Dawn codegen/grid-wipe hazard; the only risk is behavioral regression, verified in headed Chrome.

**Tech Stack:** TypeScript, Vitest (unit), WebGPU/WGSL (unchanged), Vite, Playwright + headed Chrome (in-browser verification).

## Global Constraints

- **Values source of truth:** `realDensity` (g/cm³) and `specificHeat` (J/g·K) on each `ElementDef`. After this phase there is no hand-tuned `density`/`heatCapacity` field — those are derived (`density`) or renamed-away (`heatCapacity` → `specificHeat`).
- **Density is comparison-only.** The shader uses `density()` solely in `>` comparisons (simulate.wgsl:175, 192, 195); absolute scale is irrelevant, only ordering. Gases never compare density (gas rise is form-based), so gas density values are behaviorally inert.
- **Static solids are barriers.** A static solid must stay denser than every movable material or powders/liquids sink through it (wood/ice) and lava leaks through stone. Enforce via a `BARRIER_DENSITY` sentinel, NOT real density.
- **Normalization constants (exact):** `SIM_DENSITY_LO = 1`, `SIM_DENSITY_HI = 95`, `DENSITY_LOG_MIN = -4.1`, `DENSITY_LOG_MAX = 1.3`, `BARRIER_DENSITY = 100`.
- **No rounding.** Sim density stays a float so near-equal real densities stay strictly ordered (no ties).
- **WGSL is not validated by build/typecheck.** Every behavioral claim is verified in headed Chrome (`channel:'chrome'`, `--enable-unsafe-webgpu`; headless has no GPU adapter). Restart the dev server fresh per observation (HMR is unreliable across checkouts; ports 5173–5175 are usually taken → 5176). The Stone-bowl test is the grid-corruption detector.
- **Branch:** `material-values` off `master`. Frequent commits; `--no-ff` merge at the end (separate finishing step, not in this plan).

---

## Golden derived sim densities (movable materials)

Computed from the constants above (`simDensity(form, realDensity)`). Static solids → `BARRIER_DENSITY` (100); Empty → 0. Unit tests assert these (via `toBeCloseTo`, 3 dp).

| Material | form | realDensity | sim density |
|----------|------|-------------|-------------|
| Hydrogen | gas | 0.00009 | 1.9442 |
| Fire | gas | 0.0003 | 11.0462 |
| Steam | gas | 0.0006 | 16.2863 |
| Smoke | gas | 0.0012 | 21.5265 |
| CO₂ | gas | 0.00198 | 25.3123 |
| Sulfur Dioxide | gas | 0.0026 | 27.3718 |
| Molten Wax | liquid | 0.8 | 70.6834 |
| Water | liquid | 1.0 | 72.3704 |
| Sulfuric Acid (Very Dilute) | liquid | 1.05 | 72.7392 |
| Sulfuric Acid (Dilute) | liquid | 1.1 | 73.0909 |
| Sand | powder | 1.6 | 75.9236 |
| Damp Sand | powder | 1.8 | 76.8140 |
| Sulfuric Acid (Concentrated) | liquid | 1.83 | 76.9390 |
| Sulfuric Acid (Fuming) | liquid | 1.90 | 77.2227 |
| Wet Sand | powder | 1.95 | 77.4191 |
| Saturated Sand | powder | 2.08 | 77.9070 |
| Salt | powder | 2.17 | 78.2273 |
| Limestone | powder | 2.71 | 79.9072 |
| Lava | liquid | 2.9 | 80.4195 |
| Copper Sulfate | powder | 3.6 | 82.0542 |
| Rust | powder | 5.24 | 84.8921 |

**Statics → 100:** Stone, Wood, Ice, Obsidian, Copper, Wax. **Empty → 0.**

### Behavior changes this produces (the regression surface to verify in browser)

Preserved: wet-sand ladder (Sand<Damp<Wet<Sat), all movables sink through gases, all statics block all movables (barrier integrity: max movable 84.89 < 100).

Intended flips (movable-vs-movable), all more realistic:
- **Sand floats on Concentrated/Fuming acid** (dense acid) — was: sand sinks.
- **Molten Wax floats on Water / Very-Dilute acid** — was: wax sinks.
- **Powders (Sand/Damp/Wet/Sat/Salt/Limestone) float ON Lava** instead of sinking in — molten rock is denser. **This one is the user's judgment call:** during Task 2 verification, show sand-on-lava and let the user accept (default) or request a Lava override (a follow-up, not in this plan).
- Minor powder reorderings (Salt now denser than wet-sand tiers; Limestone denser than wet/sat sand).

---

## Task 1: `density.ts` normalization leaf (pure)

**Files:**
- Create: `src/density.ts`
- Test: `src/density.test.ts`

**Interfaces:**
- Consumes: `Form` (type-only) from `./elements`.
- Produces:
  - `normalizedDensity(realDensity: number): number` — monotonic log-map into `[SIM_DENSITY_LO, SIM_DENSITY_HI]`; returns 0 for `realDensity <= 0`.
  - `simDensity(form: Form, realDensity: number): number` — the per-element rule: static → `BARRIER_DENSITY` (or 0 if `realDensity <= 0`, i.e. Empty); movable → `normalizedDensity(realDensity)`.
  - Constants `SIM_DENSITY_LO`, `SIM_DENSITY_HI`, `DENSITY_LOG_MIN`, `DENSITY_LOG_MAX`, `BARRIER_DENSITY`.

- [ ] **Step 1: Write the failing test**

Create `src/density.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  BARRIER_DENSITY,
  DENSITY_LOG_MAX,
  SIM_DENSITY_HI,
  SIM_DENSITY_LO,
  normalizedDensity,
  simDensity,
} from './density';

describe('normalizedDensity', () => {
  it('maps non-positive density to 0', () => {
    expect(normalizedDensity(0)).toBe(0);
    expect(normalizedDensity(-1)).toBe(0);
  });

  it('is monotonic increasing in real density', () => {
    const samples = [0.0001, 0.001, 0.8, 1.0, 1.6, 2.9, 5.24, 8.96];
    for (let i = 1; i < samples.length; i++) {
      expect(normalizedDensity(samples[i])).toBeGreaterThan(normalizedDensity(samples[i - 1]));
    }
  });

  it('clamps into [LO, HI]', () => {
    expect(normalizedDensity(1e-9)).toBeGreaterThanOrEqual(SIM_DENSITY_LO);
    expect(normalizedDensity(10 ** (DENSITY_LOG_MAX + 5))).toBe(SIM_DENSITY_HI);
  });

  it('matches the golden derived values (3 dp)', () => {
    expect(normalizedDensity(1.0)).toBeCloseTo(72.3704, 3); // Water
    expect(normalizedDensity(1.6)).toBeCloseTo(75.9236, 3); // Sand
    expect(normalizedDensity(2.9)).toBeCloseTo(80.4195, 3); // Lava
    expect(normalizedDensity(5.24)).toBeCloseTo(84.8921, 3); // Rust
    expect(normalizedDensity(0.0003)).toBeCloseTo(11.0462, 3); // Fire
  });
});

describe('simDensity', () => {
  it('gives static solids the barrier sentinel', () => {
    expect(simDensity('static', 2.6)).toBe(BARRIER_DENSITY); // Stone
    expect(simDensity('static', 0.7)).toBe(BARRIER_DENSITY); // Wood (lighter than sand, still a barrier)
  });

  it('gives Empty (static, zero real density) 0', () => {
    expect(simDensity('static', 0)).toBe(0);
  });

  it('derives movable densities from real density', () => {
    expect(simDensity('powder', 1.6)).toBeCloseTo(75.9236, 3);
    expect(simDensity('liquid', 2.9)).toBeCloseTo(80.4195, 3);
    expect(simDensity('gas', 0.0012)).toBeCloseTo(21.5265, 3);
  });

  it('keeps every movable strictly below the barrier sentinel', () => {
    for (const r of [1.0, 1.6, 2.9, 5.24, 8.96]) {
      expect(simDensity('powder', r)).toBeLessThan(BARRIER_DENSITY);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/density.test.ts`
Expected: FAIL — cannot resolve `./density`.

- [ ] **Step 3: Write minimal implementation**

Create `src/density.ts`:

```ts
import type { Form } from './elements';

/** Bottom of the movement band (a real gas maps near here). */
export const SIM_DENSITY_LO = 1;
/** Top of the movement band for movable materials (kept below BARRIER_DENSITY). */
export const SIM_DENSITY_HI = 95;
/** log10(g/cm³) mapped to LO (covers Hydrogen ≈ 9e-5). */
export const DENSITY_LOG_MIN = -4.1;
/** log10(g/cm³) mapped to HI (headroom above Gold ≈ 19.3 for future materials). */
export const DENSITY_LOG_MAX = 1.3;
/** Static solids get this sentinel so they stay denser than every movable material. */
export const BARRIER_DENSITY = 100;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Monotonic log-map of real density (g/cm³) into [SIM_DENSITY_LO, SIM_DENSITY_HI].
 * Non-positive density → 0 (Empty). */
export function normalizedDensity(realDensity: number): number {
  if (realDensity <= 0) return 0;
  const t = (Math.log10(realDensity) - DENSITY_LOG_MIN) / (DENSITY_LOG_MAX - DENSITY_LOG_MIN);
  return clamp(SIM_DENSITY_LO + t * (SIM_DENSITY_HI - SIM_DENSITY_LO), SIM_DENSITY_LO, SIM_DENSITY_HI);
}

/** Sim density used for movement swaps. Static solids are immovable barriers
 * (a sentinel above every movable material), except Empty (real density 0 → 0).
 * Movable materials (powder/liquid/gas) derive from real density. */
export function simDensity(form: Form, realDensity: number): number {
  if (form === 'static') return realDensity > 0 ? BARRIER_DENSITY : 0;
  return normalizedDensity(realDensity);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/density.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/density.ts src/density.test.ts
git commit -m "Add pure real-density normalization leaf (density.ts)"
```

---

## Task 2: Adopt derived density into the sim

Route `materialProperties()`'s density slot through `simDensity`, delete the hand-tuned `density` field, and update the ordering tests to the new derived reality. Then verify movement + barriers in headed Chrome (including the Lava-powder judgment call).

**Files:**
- Modify: `src/elements.ts` (ElementDef interface; remove `density` from all 28 rows; `materialProperties()` line 117; make `realDensity` required)
- Modify: `src/elements.test.ts` (density assertions)

**Interfaces:**
- Consumes: `simDensity(form, realDensity)` from `./density` (Task 1).
- Produces: `materialProperties()` unchanged signature (`Float32Array`, 16 floats/element); offset 0 now `simDensity(element.form, element.realDensity)`. `ElementDef` no longer has `density`; `realDensity` is now required (`number`).

- [ ] **Step 1: Update the failing tests first (density assertions)**

In `src/elements.test.ts`, add the import:

```ts
import { simDensity } from './density';
```

Add a helper near the top of the file (after imports):

```ts
const sim = (name: string) => {
  const e = getElementByName(name);
  return simDensity(e.form, e.realDensity);
};
```

Replace the density-reading assertions as follows (each shown old → new):

`'gives Empty the "empty" category and zero density'` (line ~13):
```ts
    expect(sim('Empty')).toBe(0);
```

`'gives Sand a higher density than Water…'` (line ~34):
```ts
    expect(sim('Sand')).toBeGreaterThan(sim('Water'));
```

`'gives Water a higher density than Smoke…'` (line ~38):
```ts
    expect(sim('Water')).toBeGreaterThan(sim('Smoke'));
```

Replace the whole `'gives Lava a density between Sand and Water…'` test (lines ~48-51) with the new reality (real densities: Lava is denser than both, so it sinks below water AND powders float on it):
```ts
  it('gives Lava a real density above Water and above powders, so lava sinks below water and dense powders rest on it', () => {
    expect(sim('Lava')).toBeGreaterThan(sim('Water'));
    expect(sim('Lava')).toBeGreaterThan(sim('Sand'));
  });
```

Replace `'gives Ice a density high enough to block powder/liquid…'` (lines ~81-83) — Ice is now a barrier by form, not by real density:
```ts
  it('gives static solids a barrier density above every movable, so powders/liquids cannot sink through them', () => {
    for (const s of ['Ice', 'Stone', 'Wood', 'Obsidian', 'Copper']) {
      for (const m of ['Sand', 'Water', 'Lava', 'Rust']) {
        expect(sim(s)).toBeGreaterThan(sim(m));
      }
    }
  });
```

In `materialProperties` describe, `'places each element density, thermalConductivity, and heatCapacity at its id offset'` (line ~174):
```ts
    expect(props[offset]).toBeCloseTo(simDensity(water.form, water.realDensity));
```

In `'gives Dilute Sulfuric Acid a density between Water and Lava'` (lines ~223-225):
```ts
    expect(sim('Sulfuric Acid (Dilute)')).toBeGreaterThan(sim('Water'));
    expect(sim('Sulfuric Acid (Dilute)')).toBeLessThan(sim('Lava'));
```

In `'increases acid density with concentration…'` (lines ~229-232):
```ts
    const veryDilute = sim('Sulfuric Acid (Very Dilute)');
    const dilute = sim('Sulfuric Acid (Dilute)');
    const concentrated = sim('Sulfuric Acid (Concentrated)');
    const fuming = sim('Sulfuric Acid (Fuming)');
```

In `'exist with ascending density and are powders'` (wet-sand, lines ~272-276):
```ts
    const water = getElementByName('Water');
    for (const e of [sand, damp, wet, sat]) expect(sim(e.name)).toBeGreaterThan(sim('Water'));
    expect(sim('Sand')).toBeLessThan(sim('Damp Sand'));
    expect(sim('Damp Sand')).toBeLessThan(sim('Wet Sand'));
    expect(sim('Wet Sand')).toBeLessThan(sim('Saturated Sand'));
```
(`water` may now be unused there — delete the `const water` line if so.)

In `'materials buffer is 12 floats/element…'` (line ~328):
```ts
    expect(data[o + 0]).toBeCloseTo(simDensity(wood.form, wood.realDensity));
```

In `'is 12 floats/element with corrosion params…'` (line ~386):
```ts
    expect(data[o + 0]).toBeCloseTo(simDensity(conc.form, conc.realDensity));
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/elements.test.ts`
Expected: FAIL — `simDensity` referenced but `element.density` still drives `materialProperties`, and `ElementDef.density` still exists (some assertions may pass, the offset-0 ones and Lava/Ice ones fail).

- [ ] **Step 3: Wire `simDensity` into `materialProperties` and make `realDensity` required**

In `src/elements.ts`, add the import at the top:
```ts
import { simDensity } from './density';
```

In the `ElementDef` interface, delete the `density: number;` line, and change `realDensity?: number;` to be required:
```ts
  /** Real density in g/cm³ — the source of truth for sim movement density. */
  realDensity: number;
```

In `materialProperties()`, change line ~117 from `data[offset + 0] = element.density;` to:
```ts
    data[offset + 0] = simDensity(element.form, element.realDensity);
```

- [ ] **Step 4: Delete the `density` field from all 28 element rows**

In the `ELEMENTS` array, remove the `density: <n>,` key from every row (all 28). Every row already has `realDensity`. Example (Sand, id 2) before/after:
```ts
// before: { id: 2, name: 'Sand', category: 'powder', density: 60, color: [...], ... realDensity: 1.6, specificHeat: 0.83 },
// after:  { id: 2, name: 'Sand', category: 'powder', color: [...], ... realDensity: 1.6, specificHeat: 0.83 },
```

- [ ] **Step 5: Run the full unit suite**

Run: `npx vitest run`
Expected: PASS. If any density assertion fails, reconcile against the golden table above (do not change golden values; fix the row/realDensity).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (If `realDensity!` non-null assertions in tests now warn as unnecessary, drop the `!` at lines ~316-318.)

- [ ] **Step 7: Commit**

```bash
git add src/elements.ts src/elements.test.ts
git commit -m "Derive sim density from realDensity; static solids stay barriers (Phase 3a)"
```

- [ ] **Step 8: Verify movement + barriers in headed Chrome**

Restart the dev server fresh (`npm run dev`; note the port, usually 5176). In headed Chrome (`channel:'chrome'`, `--enable-unsafe-webgpu`), verify and report to the controller:
1. **Barrier integrity (critical):** a Stone bowl holds Water and Lava (no leak-through); Sand piled on Wood/Ice does NOT sink through; Lava in a Stone container does not sink through the floor.
2. **Preserved buoyancy:** Sand sinks through Water; gases rise through everything; wet-sand tiers still stratify.
3. **Intended flips:** Sand floats on Concentrated acid; Molten Wax floats on Water.
4. **Lava-powder judgment call:** paint Sand onto a Lava pool and show the controller whether sand rests on top (expected under real density). The controller/user decides: accept (default) or request a Lava override (out of scope here — a follow-up task).
5. Stone-bowl detector: no grid wipe, no console errors.

---

## Task 3: Adopt `specificHeat` as the thermal capacity

Retire the hand-tuned `heatCapacity` element field; read `specificHeat` everywhere the element's thermal capacity is needed. The `materials` buffer offset 2 and the `chains` buffer segment capacities then carry real specific heats. Verify thermal chains in headed Chrome.

**Files:**
- Modify: `src/elements.ts` (ElementDef: remove `heatCapacity`, make `specificHeat` required; `materialProperties()` line 119; remove `heatCapacity` from 28 rows)
- Modify: `src/thermal.ts` (lines 42, 78: `.heatCapacity` → `.specificHeat`)
- Modify: `src/phaseTransitions.ts` (lines 57, 64: `.heatCapacity` → `.specificHeat`)
- Modify: `src/elements.test.ts`, `src/thermal.test.ts`, `src/phaseTransitions.test.ts` (heatCapacity assertions)

**Interfaces:**
- Consumes: `ElementDef.specificHeat` (now required `number`).
- Produces: `ElementDef` no longer has `heatCapacity`. `ChainSegment.heatCapacity` (in phaseTransitions.ts) keeps its name but is sourced from `specificHeat`. `materialProperties()` offset 2 now `element.specificHeat`.

- [ ] **Step 1: Update the failing tests first (heatCapacity assertions)**

In `src/elements.test.ts`:

`'gives every element a positive thermalConductivity and heatCapacity'` (lines ~85-89) → read `specificHeat`:
```ts
      expect(element.specificHeat).toBeGreaterThan(0);
```
(keep the `thermalConductivity` assertion; change the `heatCapacity` one.)

`'gives Water a much higher heatCapacity than Stone…'` (line ~93):
```ts
    expect(getElementByName('Water').specificHeat).toBeGreaterThan(getElementByName('Stone').specificHeat * 2);
```

`'categorizes Obsidian as a static solid sharing Stone's thermal properties'` (line ~104):
```ts
    expect(obsidian.specificHeat).toBe(stone.specificHeat);
```

`materialProperties` `'places each element density, thermalConductivity, and heatCapacity…'` (line ~176):
```ts
    expect(props[offset + 2]).toBeCloseTo(water.specificHeat);
```

`'decreases acid heatCapacity with concentration…'` (lines ~239-242):
```ts
    const veryDilute = getElementByName('Sulfuric Acid (Very Dilute)').specificHeat;
    const dilute = getElementByName('Sulfuric Acid (Dilute)').specificHeat;
    const concentrated = getElementByName('Sulfuric Acid (Concentrated)').specificHeat;
    const fuming = getElementByName('Sulfuric Acid (Fuming)').specificHeat;
```

`'materials buffer is 12 floats/element…'` (line ~330):
```ts
    expect(data[o + 2]).toBeCloseTo(wood.specificHeat);
```

In `src/thermal.test.ts` (line ~22):
```ts
    const cap = getElementByName('Sand').specificHeat;
```

In `src/phaseTransitions.test.ts` (line ~61):
```ts
    expect(waterSegment.heatCapacity).toBe(getElementByName('Water').specificHeat);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/elements.test.ts src/thermal.test.ts src/phaseTransitions.test.ts`
Expected: FAIL/typecheck error — `specificHeat` is still optional and `heatCapacity` still drives the buffer.

- [ ] **Step 3: Repoint the element-field reads to `specificHeat`**

In `src/thermal.ts`, line 42:
```ts
    return temperature * getElement(elementId).specificHeat;
```
and line 78:
```ts
      return { temperature: enthalpy / getElement(currentElementId).specificHeat, elementId: currentElementId };
```
(Leave the `segment.heatCapacity` references — they read from `ChainSegment`, not the element.)

In `src/phaseTransitions.ts`, line 57:
```ts
  const segments: ChainSegment[] = [{ elementId: coldest, heatCapacity: getElement(coldest).specificHeat }];
```
and line 64:
```ts
    segments.push({ elementId: current, heatCapacity: getElement(current).specificHeat });
```

- [ ] **Step 4: Update `elements.ts` — remove `heatCapacity`, make `specificHeat` required, fix the serializer**

In the `ElementDef` interface, delete the `heatCapacity: number;` line, and change `specificHeat?: number;` to:
```ts
  /** Real specific heat J/(g·K) — the source of truth for the sim's thermal capacity. */
  specificHeat: number;
```

In `materialProperties()`, change line ~119 from `data[offset + 2] = element.heatCapacity;` to:
```ts
    data[offset + 2] = element.specificHeat;
```

- [ ] **Step 5: Delete the `heatCapacity` field from all 28 element rows**

Remove the `heatCapacity: <n>,` key from every row. Every row already has `specificHeat`. Example (Water, id 3):
```ts
// before: { ..., thermalConductivity: 0.25, heatCapacity: 4.0, ..., specificHeat: 4.18, ... },
// after:  { ..., thermalConductivity: 0.25, ..., specificHeat: 4.18, ... },
```

- [ ] **Step 6: Run the full unit suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/elements.ts src/thermal.ts src/phaseTransitions.ts src/elements.test.ts src/thermal.test.ts src/phaseTransitions.test.ts
git commit -m "Adopt specificHeat as the sim thermal capacity, retire heatCapacity (Phase 3a)"
```

- [ ] **Step 8: Verify thermal in headed Chrome**

Restart the dev server fresh. In headed Chrome, with the heat map on, verify and report:
1. **Phase chains intact:** Ice→Water→Steam (melt at 0, boil at 100), Stone↔Lava, Wax↔Molten Wax all still transition at the right temperatures (the boundary temps are data, unchanged; only heating pace shifts).
2. **Coolant still works:** Water absorbs heat and buffers (specificHeat 4.18).
3. **Watch items (report if they feel wrong):** Hydrogen now barely heats (specificHeat 14.3); Fire/Smoke thermal doubled (0.5→1.0); Wet/Saturated Sand now heat faster (game 2.5/3.5 → real 1.5/1.8). If any reads as broken, flag for a per-value nudge decision.
4. Stone-bowl detector: no grid wipe, no console errors.

---

## Task 4: Full regression sweep, docs, and status

**Files:**
- Modify: `docs/superpowers/specs/2026-07-10-material-library-phase3-design.md` (mark 3a done)

- [ ] **Step 1: Full unit suite + typecheck + build**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: all green.

- [ ] **Step 2: Full behavior regression sweep in headed Chrome**

Restart the dev server fresh. Exercise every prior-phase behavior once and report: powder/liquid/gas movement + buoyancy; CA water sink/soak; wet-sand cycle; corrosion (acid dissolves Salt/Limestone/Rust); contact reactions (Lava+Water→Obsidian, Copper+Acid); viscosity flow (water levels, molten wax oozes, lava mounds/cools); phase chains + heat map. No grid wipe, no console errors.

- [ ] **Step 3: Update the Phase 3 design spec status**

In `docs/superpowers/specs/2026-07-10-material-library-phase3-design.md`, under sub-phase 3a, add a short **DONE** note recording: the static-barrier rule, the normalization constants, and any Lava/thermal nudge decisions the user made during verification.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-07-10-material-library-phase3-design.md
git commit -m "Record Phase 3a (values adoption) as complete"
```

(Merging `material-values` → `master` is a separate finishing step via the finishing-a-development-branch skill, not part of this plan.)

---

## Self-review notes

- **Spec coverage:** 3a's spec goals — derive density from realDensity (Task 2), derive thermal from specificHeat (Task 3), preserve barriers (static rule, Task 1+2), re-verify all 28 (Tasks 2/3/4) — all mapped.
- **Type consistency:** `simDensity(form, realDensity)` / `normalizedDensity(realDensity)` names used identically in Task 1 (def) and Task 2 (use). `ChainSegment.heatCapacity` field name is intentionally kept (segment property) while its *source* becomes `specificHeat` — not renamed, so `chains.ts` and `thermal.ts`'s `segment.heatCapacity` reads are untouched.
- **No placeholders:** every edit shows the exact replacement code; the golden table gives exact expected values.
- **Risk isolation:** density (Task 2) and thermal (Task 3) are separate commits with separate browser verifications, so a regression bisects to one axis.
