# Material Library: Metals (Phase 3d-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four conductive metals (Iron, Molten Iron, Gold, Aluminium) with rust/thermite chemistry and an iron melt chain — as pure data on the existing generic engine.

**Architecture:** New `ElementDef` rows in `src/elements.ts`, one `PHASE_TRANSITIONS` row in `src/phaseTransitions.ts`, two `CONTACT_REACTIONS` rows in `src/reactions.ts`. **Zero shader edits.** The generic electricity pass (conductive bit), the contact-reaction loop in `heat()` (chain-safe — it walks chains for the product enthalpy), and the phase-chain solver already handle everything. Metals are `conductive`, so they wire up 3c circuits exactly like Copper.

**Tech Stack:** TypeScript, Vitest (unit), Playwright + headed Chrome WebGPU (e2e/in-browser).

## Global Constraints

- **Ids 38–41, contiguous, in this order:** Iron 38, Molten Iron 39, Gold 40, Aluminium 41. (Methane 37 is currently the last element.)
- The three **solid** metals (Iron, Gold, Aluminium) are `family: 'chem'` with a `formula` (`Fe` / `Au` / `Al`), `metallic: 'metal'`, `origin: 'inorganic'`, `conductive: true`, `form: 'static'`. Molten Iron is `family: 'chem'` with **no formula** (molten form inherits its parent's family, like Molten Wax under Wax), `form: 'liquid'`, `metallic: 'metal'`, and is **not** `conductive` (a transient hot liquid; the solid carries current).
- **Gold has the highest `thermalConductivity` of any conductive element** (0.95 > Copper's 0.9).
- **Iron melt boundary is 1500 °C, strictly above Lava's `defaultTemp` (800 °C)** — so a lava cell cannot drive iron to its melt point; thermite is the melt path.
- **Thermite `enthalpyDelta` must keep the product molten.** The Iron↔Molten Iron chain's plateau starts at enthalpy 675 (= Iron cₚ 0.45 × 1500). At the 300 °C reaction gate the temperature carry-over is 0.45 × 300 = 135, so `enthalpyDelta` must be ≥ 540 for the fresh Molten Iron not to resolidify on the next heat tick. This plan uses **1000** (≈1756 °C fresh — superheated, self-sustaining). It is the one in-browser tune point.
- **Never push to origin.** Origin intentionally lags local master; merges are local-only unless the user explicitly asks to push.
- All existing tests must stay green. Note: the flammable-enumeration test in `src/elements.test.ts` (`['Wood','TNT','Oil','Gasoline','Gasoline Vapor','Alcohol','Coal','Methane']`) is **unchanged** — metals are not flammable, so do not touch it.

---

### Task 1: Add the four metal element rows

**Files:**
- Modify: `src/elements.ts` (append rows to the `ELEMENTS` array, after Methane id 37)
- Test: `src/elements.test.ts` (add a `describe('metals (3d-2)')` block)

**Interfaces:**
- Consumes: the existing `ElementDef` interface and `ELEMENTS` array in `src/elements.ts`; `simDensity` from `src/density.ts`; `getElementByName` from `src/elements.ts`.
- Produces: `getElementByName('Iron' | 'Molten Iron' | 'Gold' | 'Aluminium')` resolving to ids 38–41. Later tasks reference these ids in `PHASE_TRANSITIONS` and `CONTACT_REACTIONS`.

- [ ] **Step 1: Write the failing test**

Add this block at the end of `src/elements.test.ts` (before the file's final line):

```ts
describe('metals (3d-2)', () => {
  const byName = (n: string) => getElementByName(n);
  it('adds Iron, Molten Iron, Gold, Aluminium at ids 38-41', () => {
    expect([
      byName('Iron').id, byName('Molten Iron').id, byName('Gold').id, byName('Aluminium').id,
    ]).toEqual([38, 39, 40, 41]);
  });
  it('makes the solid metals conductive chem metals with a formula', () => {
    for (const n of ['Iron', 'Gold', 'Aluminium']) {
      const e = byName(n);
      expect(e.family).toBe('chem');
      expect(e.formula).toBeTruthy();
      expect(e.metallic).toBe('metal');
      expect(e.origin).toBe('inorganic');
      expect(e.conductive).toBe(true);
      expect(e.form).toBe('static');
    }
  });
  it('makes Molten Iron a metal liquid with no formula, not flagged conductive', () => {
    const m = byName('Molten Iron');
    expect(m.form).toBe('liquid');
    expect(m.metallic).toBe('metal');
    expect(m.formula).toBeUndefined();
    expect(m.conductive).toBeFalsy();
    expect(m.viscosityRefLog10).toBeGreaterThan(0); // has a viscosity curve (it flows)
  });
  it('gives Gold the highest thermalConductivity of any conductive element', () => {
    const conductors = ELEMENTS.filter((e) => e.conductive);
    const maxCond = Math.max(...conductors.map((e) => e.thermalConductivity));
    expect(byName('Gold').thermalConductivity).toBe(maxCond);
    expect(byName('Gold').thermalConductivity).toBeGreaterThan(byName('Copper').thermalConductivity);
  });
  it('records real reference densities (gold densest, aluminium light, iron heavy)', () => {
    expect(byName('Gold').realDensity).toBeGreaterThan(byName('Iron').realDensity);
    expect(byName('Iron').realDensity).toBeGreaterThan(byName('Aluminium').realDensity);
    expect(byName('Gold').realDensity).toBe(Math.max(...ELEMENTS.map((e) => e.realDensity)));
  });
  it('keeps solid metals as static barriers (denser than every movable in sim terms)', () => {
    const sim = (n: string) => simDensity(byName(n).form, byName(n).realDensity);
    for (const s of ['Iron', 'Gold', 'Aluminium']) {
      for (const m of ['Sand', 'Water', 'Lava', 'Rust', 'Molten Iron']) {
        expect(sim(s)).toBeGreaterThan(sim(m));
      }
    }
  });
  it('packs the metal flag (bit 7) and conductive flag (bit 5) for the solid metals', () => {
    const flags = materialFlags();
    for (const n of ['Iron', 'Gold', 'Aluminium']) {
      expect((flags[byName(n).id] >> 7) & 1).toBe(1); // metal
      expect((flags[byName(n).id] >> 5) & 1).toBe(1); // conductive
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/elements.test.ts`
Expected: FAIL — `getElementByName('Iron')` throws `Unknown element name: Iron` (and the id/flag assertions fail).

- [ ] **Step 3: Add the four element rows**

In `src/elements.ts`, append these four rows to the `ELEMENTS` array immediately after the Methane row (`id: 37`), before the closing `];`:

```ts
  { id: 38, name: 'Iron', category: 'static', color: [120, 122, 130], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.7, family: 'chem', formula: 'Fe', form: 'static', phase: 'solid', origin: 'inorganic', metallic: 'metal', conductive: true, realDensity: 7.87, specificHeat: 0.45, meltingPoint: 1538 },
  { id: 39, name: 'Molten Iron', category: 'liquid', color: [255, 145, 50], defaultTemp: 1550, thermalConductivity: 0.6, family: 'chem', form: 'liquid', phase: 'liquid', origin: 'inorganic', metallic: 'metal', realDensity: 7.0, specificHeat: 0.82, meltingPoint: 1538, viscosityRefLog10: 0.5 },
  { id: 40, name: 'Gold', category: 'static', color: [235, 195, 60], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.95, family: 'chem', formula: 'Au', form: 'static', phase: 'solid', origin: 'inorganic', metallic: 'metal', conductive: true, realDensity: 19.3, specificHeat: 0.13, meltingPoint: 1064 },
  { id: 41, name: 'Aluminium', category: 'static', color: [196, 200, 206], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.8, family: 'chem', formula: 'Al', form: 'static', phase: 'solid', origin: 'inorganic', metallic: 'metal', conductive: true, realDensity: 2.7, specificHeat: 0.90, meltingPoint: 660 },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/elements.test.ts`
Expected: PASS (all metals-3d-2 assertions plus the unchanged existing suites — id contiguity, taxonomy, barrier density).

- [ ] **Step 5: Commit**

```bash
git add src/elements.ts src/elements.test.ts
git commit -m "feat(3d-2): add Iron/Molten Iron/Gold/Aluminium element rows"
```

---

### Task 2: Add the Iron ↔ Molten Iron phase transition

**Files:**
- Modify: `src/phaseTransitions.ts` (append a row to `PHASE_TRANSITIONS`)
- Test: `src/phaseTransitions.test.ts` (add a `describe('iron melt chain')` block)

**Interfaces:**
- Consumes: `PHASE_TRANSITIONS` and `getChain` from `src/phaseTransitions.ts`; the Iron/Molten Iron elements from Task 1.
- Produces: a two-segment chain `[Iron, Molten Iron]` discoverable via `getChain(Iron)`/`getChain('Molten Iron')`, which the heat pass uses to melt/resolidify iron and which Task 3's thermite relies on to keep its product molten.

- [ ] **Step 1: Write the failing test**

Add to `src/phaseTransitions.test.ts` (after the `wax melt chain` describe block):

```ts
describe('iron melt chain', () => {
  it('Iron melts to Molten Iron at a boundary above Lava temperature, and resolidifies when cooled', () => {
    const iron = getElementByName('Iron').id;
    const molten = getElementByName('Molten Iron').id;
    const t = PHASE_TRANSITIONS.find((tr) => tr.lowElementId === iron);
    expect(t).toBeDefined();
    expect(t!.highElementId).toBe(molten);
    expect(t!.latentHeat).toBeGreaterThan(0);
    // Lava (800C) must not be able to drive iron to its melt point.
    expect(t!.boundaryTemp).toBeGreaterThan(getElementByName('Lava').defaultTemp);

    const chain = getChain(iron)!;
    expect(chain.segments.map((s) => s.elementId)).toEqual([iron, molten]);
    const hot = enthalpyForTemperature(1650, molten);
    expect(temperatureAndElementFromEnthalpy(iron, hot).elementId).toBe(molten);
    const cold = enthalpyForTemperature(20, iron);
    expect(temperatureAndElementFromEnthalpy(molten, cold).elementId).toBe(iron);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/phaseTransitions.test.ts`
Expected: FAIL — no `PHASE_TRANSITIONS` row has `lowElementId === Iron` (`t` is undefined).

- [ ] **Step 3: Add the phase-transition row**

In `src/phaseTransitions.ts`, append to the `PHASE_TRANSITIONS` array (after the Wax↔Molten Wax row), before the closing `];`:

```ts
  { lowElementId: getElementByName('Iron').id, highElementId: getElementByName('Molten Iron').id, boundaryTemp: 1500, latentHeat: 250 },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/phaseTransitions.test.ts`
Expected: PASS (iron melt chain plus the existing Ice/Water/Steam, Stone/Lava, Wax chains).

- [ ] **Step 5: Commit**

```bash
git add src/phaseTransitions.ts src/phaseTransitions.test.ts
git commit -m "feat(3d-2): Iron<->Molten Iron phase transition at 1500C"
```

---

### Task 3: Add iron-rusting and thermite contact reactions

**Files:**
- Modify: `src/reactions.ts` (append two rows to `CONTACT_REACTIONS`)
- Test: `src/reactions.test.ts` (add a `describe('metal reactions (3d-2)')` block)

**Interfaces:**
- Consumes: `CONTACT_REACTIONS`, `getReactionsFor` from `src/reactions.ts`; `getElementByName` for Iron/Rust/Water/Aluminium/Molten Iron.
- Produces: two new contact reactions. The shader's `heat()` loop applies them: `product` enthalpy is `enthalpyForNewElement(reactantTemp, product) + enthalpyDelta` (simulate.wgsl:827), which is chain-aware, so Molten Iron as a product is valid.

- [ ] **Step 1: Write the failing test**

Add to `src/reactions.test.ts` (after the `reactionData` describe block):

```ts
describe('metal reactions (3d-2)', () => {
  const IRON = getElementByName('Iron').id;
  const RUST = getElementByName('Rust').id;
  const WATER_ID = getElementByName('Water').id;
  const ALUMINIUM = getElementByName('Aluminium').id;
  const MOLTEN_IRON = getElementByName('Molten Iron').id;

  it('rusts Iron in contact with Water, slowly, at any temperature', () => {
    const r = CONTACT_REACTIONS.find((x) => x.reactant === IRON && x.catalystNeighbor === WATER_ID);
    expect(r).toBeDefined();
    expect(r!.product).toBe(RUST);
    expect(r!.minTemperature).toBeUndefined(); // any temperature
    expect(r!.chance).toBeLessThan(0.01);       // slow
  });

  it('thermite: hot Rust next to Aluminium becomes Molten Iron with a large exothermic kick', () => {
    const r = CONTACT_REACTIONS.find((x) => x.reactant === RUST && x.catalystNeighbor === ALUMINIUM);
    expect(r).toBeDefined();
    expect(r!.product).toBe(MOLTEN_IRON);
    expect(r!.minTemperature).toBe(300);
    // Must clear the Iron<->Molten Iron plateau start (675) from the 300C gate
    // carry-over (0.45*300=135) so the product does not resolidify next tick.
    expect(135 + r!.enthalpyDelta).toBeGreaterThan(675);
  });

  it('treats Aluminium as a catalyst only (not itself a reactant)', () => {
    expect(getReactionsFor(ALUMINIUM)).toHaveLength(0);
    expect(getReactionsFor(IRON)).toHaveLength(1); // rusting
    expect(getReactionsFor(RUST)).toHaveLength(1); // thermite
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/reactions.test.ts`
Expected: FAIL — no reaction has Iron or Rust as reactant with these catalysts (`r` undefined).

- [ ] **Step 3: Add the two reaction rows**

In `src/reactions.ts`, append to the `CONTACT_REACTIONS` array (after the last Fuming-acid row), before the closing `];`:

```ts
  // Iron slowly rusts wherever it touches Water (Fe + O2/H2O -> Fe2O3): any
  // temperature, very low per-tick chance, no thermal kick.
  {
    reactant: getElementByName('Iron').id,
    catalystNeighbor: getElementByName('Water').id,
    product: getElementByName('Rust').id,
    chance: 0.002,
    enthalpyDelta: 0,
  },
  // Thermite: hot rust (Fe2O3) reduced by adjacent aluminium releases intense
  // heat and molten iron (2Al + Fe2O3 -> 2Fe + Al2O3). Aluminium is modelled as
  // the catalyst (a simplification - real thermite consumes it). The large
  // enthalpyDelta pushes the Molten Iron product past its 675 plateau start (from
  // the 300C gate's 135 carry-over) to ~1756C, so it stays molten and conducts
  // heat into neighbouring rust to sustain the reaction.
  {
    reactant: getElementByName('Rust').id,
    catalystNeighbor: getElementByName('Aluminium').id,
    product: getElementByName('Molten Iron').id,
    chance: 0.08,
    enthalpyDelta: 1000,
    minTemperature: 300,
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/reactions.test.ts`
Expected: PASS (metal reactions plus the existing Lava/Obsidian and Copper/acid suites, including the `chance` 0–1 and non-negative `enthalpyDelta` invariants).

- [ ] **Step 5: Commit**

```bash
git add src/reactions.ts src/reactions.test.ts
git commit -m "feat(3d-2): iron rusting + thermite contact reactions"
```

---

### Task 4: Metals e2e smoke test + full-suite verification

**Files:**
- Modify: `e2e/smoke.spec.ts` (add one test)

**Interfaces:**
- Consumes: the whole feature (elements, phase transition, reactions) plus the running dev server. Solid-metal buttons carry a formula → **non-exact** name match; Molten Iron has no formula → exact match works but this test paints only the solid metals + a thermite setup.

- [ ] **Step 1: Write the e2e test**

Add to the end of `e2e/smoke.spec.ts`:

```ts
test('metals: a battery-iron-ground circuit and a thermite flare — no errors', async ({ page }) => {
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
  // Iron/Aluminium carry a formula on their button -> substring (non-exact) match.
  const stroke = async (name: string, fx0: number, fx1: number, fy: number, exact = true) => {
    await page.getByRole('button', { name, exact }).first().click();
    const a = at(fx0, fy); await page.mouse.move(a.x, a.y); await page.mouse.down();
    const b = at(fx1, fy); await page.mouse.move(b.x, b.y); await page.mouse.up();
  };

  // Circuit: Battery -> Iron wire -> Ground (metal conducts like Copper).
  await stroke('Iron', 0.38, 0.56, 0.4, false);
  await stroke('Battery', 0.35, 0.38, 0.4);
  await stroke('Ground', 0.56, 0.59, 0.4);

  // Thermite: rust + aluminium, ignited by lava, flares to molten iron.
  await stroke('Rust', 0.40, 0.60, 0.7, false);
  await stroke('Aluminium', 0.40, 0.60, 0.72, false);
  await stroke('Lava', 0.44, 0.56, 0.66);
  await page.waitForTimeout(3000);

  expect(pageErrors, `page errors: ${pageErrors.join('; ')}`).toEqual([]);
  expect(consoleErrors, `console errors: ${consoleErrors.join('; ')}`).toEqual([]);
});
```

- [ ] **Step 2: Typecheck and build**

Run: `npx tsc --noEmit`
Expected: PASS (no type errors).

Run: `npm run build`
Expected: PASS (production build succeeds).

- [ ] **Step 3: Run the full unit suite**

Run: `npx vitest run`
Expected: PASS — all suites green (metals, iron chain, metal reactions, and every pre-existing test).

- [ ] **Step 4: Run the e2e smoke suite**

Run: `npx playwright test e2e/smoke.spec.ts`
Expected: PASS, or the WebGPU tests self-`skip()` if headless Chrome lacks WebGPU. If a port conflict from a concurrent dev server blocks it, note it in the report rather than forcing the port.

- [ ] **Step 5: Commit**

```bash
git add e2e/smoke.spec.ts
git commit -m "test(3d-2): metals circuit + thermite e2e smoke"
```

---

## In-browser verification (controller, after Task 4)

Authoritative check in headed Chrome (`--enable-unsafe-webgpu`), fresh dev server per shader-free run:

1. **Electricity payoff:** paint `Battery — Iron — Ground` (also try Gold and Aluminium as the wire). The metal wire lights up (cyan charge) and warms — same as Copper. Gold conducts best.
2. **Iron rusting:** paint Iron, drop Water on it, wait — patches slowly turn to Rust (very slow; low chance).
3. **Thermite (the tune point):** paint a Rust bed with Aluminium touching it, then ignite with Lava/Fire so the rust passes 300 °C → it flares to bright Molten Iron, dumps heat, and the reaction creeps along the rust. If it does **not** self-sustain (each cell converts but the front dies), raise the thermite `enthalpyDelta` (try 1400–1800) and/or Aluminium/Iron `thermalConductivity`; if it runs away destroying too much, lower `enthalpyDelta`. This is the sole tunable — mirror the coal-ash tune discipline from 3d-1.
4. **Molten iron cools:** paint Molten Iron directly — it oozes (thin), flows, and freezes back into solid Iron as it cools. Lava (800 °C) next to solid Iron does **not** melt it (1500 boundary).
5. **Stone-bowl corruption detector:** build a stone bowl, run the above inside — no grid wipe, heat map sane, **zero console errors**.

## Self-review notes (author)

- **Spec coverage:** roster (Task 1), thermite + rusting (Task 3), iron melt chain (Task 2), electricity tie (conductive flag in Task 1, exercised in Task 4), testing (unit per task + e2e + in-browser). All spec sections map to a task.
- **Type consistency:** every row uses the exact `ElementDef` field names read from `src/elements.ts`; reaction/transition rows use `getElementByName(...).id`, matching the existing arrays.
- **No placeholders:** every step carries the literal code/command/expected result.
- **The one risk** (thermite self-sustain) is quantified against the chain math in Global Constraints and given an explicit in-browser tune procedure with a fallback direction — not left vague.
