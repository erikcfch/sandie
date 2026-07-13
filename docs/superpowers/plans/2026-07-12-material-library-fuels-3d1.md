# Phase 3d-1 — Fuels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add seven combustion materials — Oil, Gasoline, Gasoline Vapor, Alcohol, Coal, Ash, Methane — as pure data on the existing engine: flammable liquids/gases/powder that float or rise by real density and burn via the existing rule, plus Gasoline→Vapor volatility and Coal→Ash embers.

**Architecture:** Pure data — new `ElementDef` rows in `src/elements.ts` (ids 31–37) + one `THRESHOLD_REACTIONS` row (Gasoline→Vapor). No shader edits, no new mechanism: combustion reuses the flammable rule (`flammable && temp > ignitionTemp && roll < burnRate → burnProduct`), floating reuses 3a's real-density movement, gases rise by form. Coal's `burnProduct` is Ash (ember residue) — verified/tuned in-browser.

**Tech Stack:** TypeScript, Vitest (unit), Vite, Playwright + headed Chrome (authoritative verification). No WGSL.

## Global Constraints

- **Pure data — no shader edits.** The generic combustion + threshold-reaction engines already handle these. If a change to `simulate.wgsl`/`render.wgsl` seems needed, stop and reconsider (it shouldn't be).
- **Ids contiguous from 31:** Oil 31, Gasoline 32, Gasoline Vapor 33, Alcohol 34, Coal 35, Ash 36, Methane 37. Each row's `id` must equal its array index (a pre-existing test guards the whole table).
- **Fuels are `family: 'physical'`, no `formula`** (keeps them in the Physical toolbar group and lets e2e exact-match their button names).
- **Real values (3a):** every row sets `realDensity` + `specificHeat` (required). Oil 0.92 / Gasoline 0.74 / Alcohol 0.79 are < Water 1.0 (float); Coal 1.4 > Water (sinks). Only liquids set a viscosity curve.
- **`burnProduct: 9` = Fire** for the standard fuels; **Coal `burnProduct: 36` = Ash**.
- **Branch:** `material-fuels` off `master`. Frequent commits; `--no-ff` merge at the end (separate finishing step).

---

## Task 1: Add the fuel materials + Gasoline→Vapor threshold reaction

**Files:**
- Modify: `src/elements.ts` (7 new `ELEMENTS` rows)
- Modify: `src/thresholdReactions.ts` (Gasoline→Vapor row)
- Modify: `src/elements.test.ts` (new tests + extend the flammable-enumeration list)

**Interfaces:**
- Produces: elements Oil(31), Gasoline(32), Gasoline Vapor(33), Alcohol(34), Coal(35), Ash(36), Methane(37); a `THRESHOLD_REACTIONS` entry `Gasoline → Gasoline Vapor`.

- [ ] **Step 1: Write the failing tests**

In `src/elements.test.ts`, add a describe block:
```ts
describe('fuels (3d-1)', () => {
  const byName = (n: string) => getElementByName(n);
  it('adds the seven fuel/combustion materials at ids 31-37', () => {
    expect([
      byName('Oil').id, byName('Gasoline').id, byName('Gasoline Vapor').id,
      byName('Alcohol').id, byName('Coal').id, byName('Ash').id, byName('Methane').id,
    ]).toEqual([31, 32, 33, 34, 35, 36, 37]);
  });
  it('makes the fuels flammable and burn to Fire (Coal to Ash)', () => {
    for (const n of ['Oil', 'Gasoline', 'Gasoline Vapor', 'Alcohol', 'Coal', 'Methane']) {
      expect(byName(n).flammable).toBe(true);
      expect(byName(n).ignitionTemp).toBeGreaterThan(0);
    }
    for (const n of ['Oil', 'Gasoline', 'Gasoline Vapor', 'Alcohol', 'Methane'])
      expect(byName(n).burnProduct).toBe(byName('Fire').id);
    expect(byName('Coal').burnProduct).toBe(byName('Ash').id);
    expect(byName('Ash').flammable).toBeFalsy();
  });
  it('floats the light liquid fuels on water and sinks coal', () => {
    const sim = (n: string) => simDensity(byName(n).form, byName(n).realDensity);
    for (const n of ['Oil', 'Gasoline', 'Alcohol']) expect(sim(n)).toBeLessThan(sim('Water'));
    expect(sim('Coal')).toBeGreaterThan(sim('Water'));
  });
  it('classifies Oil/Gasoline/Alcohol as liquids, Vapor/Methane as gases, Coal/Ash as powders', () => {
    for (const n of ['Oil', 'Gasoline', 'Alcohol']) expect(byName(n).form).toBe('liquid');
    for (const n of ['Gasoline Vapor', 'Methane']) expect(byName(n).form).toBe('gas');
    for (const n of ['Coal', 'Ash']) expect(byName(n).form).toBe('powder');
  });
  it('gives Gasoline a threshold reaction that evaporates it to Gasoline Vapor', () => {
    const r = THRESHOLD_REACTIONS.find(
      (t) => t.reactant === byName('Gasoline').id && t.product === byName('Gasoline Vapor').id,
    );
    expect(r).toBeTruthy();
    expect(r!.minTemperature).toBeLessThan(byName('Water').boilingPoint ?? 100);
  });
});
```
Add the imports this needs at the top of the file if missing: `simDensity` from `./density` (already imported for 3a) and `THRESHOLD_REACTIONS` from `./thresholdReactions`:
```ts
import { THRESHOLD_REACTIONS } from './thresholdReactions';
```

Also extend the existing flammable-enumeration assertion (currently `['Wood', 'TNT']`):
```ts
    expect(ELEMENTS.filter((e) => e.flammable).map((e) => e.name)).toEqual(
      ['Wood', 'TNT', 'Oil', 'Gasoline', 'Gasoline Vapor', 'Alcohol', 'Coal', 'Methane'],
    );
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/elements.test.ts`
Expected: FAIL — no Oil/Gasoline/etc., no threshold row.

- [ ] **Step 3: Add the seven `ELEMENTS` rows**

Append to the `ELEMENTS` array (after Ground, id 30), verbatim:
```ts
  { id: 31, name: 'Oil', category: 'liquid', color: [46, 34, 26], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.15, family: 'physical', form: 'liquid', phase: 'liquid', origin: 'organic', metallic: 'nonmetal', flammable: true, ignitionTemp: 200, burnProduct: 9, burnRate: 0.5, realDensity: 0.92, specificHeat: 2.0, viscosityRefLog10: 1.7, viscosityTempCoeff: -0.01 },
  { id: 32, name: 'Gasoline', category: 'liquid', color: [205, 190, 110], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.15, family: 'physical', form: 'liquid', phase: 'liquid', origin: 'organic', metallic: 'nonmetal', flammable: true, ignitionTemp: 150, burnProduct: 9, burnRate: 0.8, realDensity: 0.74, specificHeat: 2.2, viscosityRefLog10: 0.3 },
  { id: 33, name: 'Gasoline Vapor', category: 'gas', color: [190, 185, 140], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.05, family: 'physical', form: 'gas', phase: 'gas', origin: 'organic', metallic: 'nonmetal', flammable: true, ignitionTemp: 120, burnProduct: 9, burnRate: 0.9, realDensity: 0.004, specificHeat: 1.7 },
  { id: 34, name: 'Alcohol', category: 'liquid', color: [200, 215, 230], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.18, family: 'physical', form: 'liquid', phase: 'liquid', origin: 'organic', metallic: 'nonmetal', flammable: true, ignitionTemp: 180, burnProduct: 9, burnRate: 0.7, realDensity: 0.79, specificHeat: 2.4, viscosityRefLog10: 0.1 },
  { id: 35, name: 'Coal', category: 'powder', color: [32, 30, 30], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.1, family: 'physical', form: 'powder', phase: 'solid', origin: 'organic', metallic: 'nonmetal', flammable: true, ignitionTemp: 300, burnProduct: 36, burnRate: 0.15, realDensity: 1.4, specificHeat: 1.3 },
  { id: 36, name: 'Ash', category: 'powder', color: [130, 128, 125], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.3, family: 'physical', form: 'powder', phase: 'solid', origin: 'inorganic', metallic: 'nonmetal', realDensity: 0.6, specificHeat: 0.8 },
  { id: 37, name: 'Methane', category: 'gas', color: [195, 205, 210], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.05, family: 'physical', form: 'gas', phase: 'gas', origin: 'organic', metallic: 'nonmetal', flammable: true, ignitionTemp: 200, burnProduct: 9, burnRate: 0.9, realDensity: 0.0007, specificHeat: 2.2 },
```
(`burnProduct: 9` = Fire; Coal's `36` = Ash — a forward id reference, which is fine since ids are plain numbers.)

- [ ] **Step 4: Add the Gasoline→Vapor threshold reaction**

In `src/thresholdReactions.ts`, add to `THRESHOLD_REACTIONS` (before the closing `]`), grouped with a comment:
```ts
  // Gasoline is volatile: it slowly gives off a flammable vapor even at mild
  // temperatures (one-way, like the acid concentration steps).
  { reactant: getElementByName('Gasoline').id, minTemperature: 35, product: getElementByName('Gasoline Vapor').id, chance: 0.01 },
```

- [ ] **Step 5: Run the full unit suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, no type errors. (If the flammable-enumeration order fails, match ELEMENTS id order: Wood, TNT, Oil, Gasoline, Gasoline Vapor, Alcohol, Coal, Methane — do not reorder ELEMENTS.)

- [ ] **Step 6: Commit**

```bash
git add src/elements.ts src/thresholdReactions.ts src/elements.test.ts
git commit -m "Add fuel materials (oil/gasoline/alcohol/coal/methane + vapor/ash) + gasoline volatility (Phase 3d-1)"
```

---

## Task 2: In-browser verify, tune, e2e, docs

**Files:**
- Modify (only if the coal ember model needs tuning): `src/elements.ts` / `src/reactions.ts`
- Modify: `e2e/smoke.spec.ts` (fuels smoke test)
- Modify: `docs/superpowers/specs/2026-07-12-material-library-fuels-3d1-design.md` (mark done + record the coal-ash outcome)

- [ ] **Step 1: Unit + typecheck + build**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: all green.

- [ ] **Step 2: [controller] Verify the fuels in headed Chrome**

Restart the dev server fresh. In headed Chrome (`channel:'chrome'`, `--enable-unsafe-webgpu`), verify and report:
1. **Float + burn:** pour Oil onto Water (in a Stone bowl) → it floats as a slick; drop Fire/Lava on it → flame spreads across the slick. Alcohol burns fast; Gasoline catches low/fast.
2. **Volatility:** a Gasoline pool warms slightly (ambient) → gives off Gasoline Vapor that rises; when the vapor reaches Fire it flashes.
3. **Gases:** Methane rises; when its cloud meets Fire it deflagrates (fast ignition front).
4. **Coal → Ash (the tune point):** light a coal pile with Fire/Lava. Confirm it burns and leaves a grey **Ash** pile. **If the burn does NOT keep spreading** (ember chain fizzles — coal converts only where directly heated), tune per the spec: raise Coal `ignitionTemp` for hotter ash and/or add a small exothermic `Coal + Fire → Ash` contact reaction (`src/reactions.ts`, positive `enthalpyDelta`); **fallback** — set Coal `burnProduct` to Fire (id 9) so it burns with flames (no ash) if embers prove unworkable. Record the decision.
5. Stone-bowl detector: no grid wipe; heat map sane; zero console errors.

- [ ] **Step 3: Apply any coal tune + re-verify**

If Step 2 required a tune, apply it (data only), re-run `npx vitest run` (update any affected test), and re-verify the coal burn in-browser. Commit:
```bash
git add -A
git commit -m "Tune coal ember/ash combustion (Phase 3d-1)"
```

- [ ] **Step 4: Add a fuels e2e smoke test**

In `e2e/smoke.spec.ts`, add a test that paints Oil on Water, Gasoline, a Coal pile, and Fire/Lava, waits, and asserts no console/page errors (fuels have no formula → exact-match names).

- [ ] **Step 5: Update the design spec status + commit**

Mark 3d-1 **DONE** in the design spec; record the final coal-ash outcome (embers vs. fallback) and any tuned values.
```bash
git add -A
git commit -m "Phase 3d-1 fuels: e2e + docs"
```

(Merging `material-fuels` → `master` is a separate finishing step via finishing-a-development-branch.)

---

## Self-review notes

- **Spec coverage:** all 7 fuels (Task 1), Gasoline→Vapor volatility (Task 1), Coal→Ash with the verify/tune/fallback (Task 2), floating via real density + gases rising (assertions in Task 1, visual in Task 2) — all mapped.
- **No shader edits** — pure data; called out in Global Constraints.
- **Id consistency:** ids 31–37 contiguous; `burnProduct` references (Fire 9, Ash 36) are plain ids.
- **Tuning honesty:** the coal ember model is explicitly a controller browser-step decision with a stated fallback, not asserted as final.
