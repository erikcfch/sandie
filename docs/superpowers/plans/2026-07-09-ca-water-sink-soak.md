# CA Water with Sink & Soak — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the weak block-CA water with fast-leveling CA water, make sand sink through it, and add a graded wet-sand ("soak") mechanic — all on the existing discrete grid, no fluid field.

**Architecture:** Water stays a normal CA liquid moved by the Margolus block-CA. Fast leveling comes from running a water-only movement pass many substeps per frame. Sink falls out of the existing density-swap rules. Soak is a ladder of wet-sand element tiers (Damp/Wet/Saturated): **drying** is pure threshold-reaction data (no shader code), **cohesion** is a wetness-keyed gate on diagonal sliding in the movement pass, and **absorb/drip** are a new race-free block-CA `soak` pass. New rule logic is unit-tested in a pure-TS mirror (`src/wetSand.ts`) following the repo's `thermal.ts`↔shader pattern; GPU wiring is verified by typecheck/build/e2e.

**Tech Stack:** TypeScript, WebGPU (WGSL compute), Vite, Vitest, Playwright.

**Reference spec:** `docs/superpowers/specs/2026-07-09-ca-water-sink-soak-design.md`

---

## Locked conventions (read before starting)

**New element ids** (extend `src/elements.ts`; ids must stay contiguous after 18):
- `19` Damp Sand, `20` Wet Sand, `21` Saturated Sand.

**Wet-sand tier ladder** (dry → wettest): `[Sand(2), Damp(19), Wet(20), Saturated(21)]`.

**`src/wetSand.ts` public API** (later tasks depend on these exact names):
```ts
export const SAND_TIER_LADDER = [2, 19, 20, 21]; // index 0..3 = dry..saturated
export function wetTierIndex(elementId: number): number;      // 0..3, or -1 if not a sand tier
export function isSandTier(elementId: number): boolean;
export function wetterTier(elementId: number): number;        // one wetter; unchanged if already saturated or not a tier
export function drierTier(elementId: number): number;         // one drier; unchanged if already dry or not a tier
export function diagonalSlideChance(elementId: number): number; // cohesion: 1 dry .. low when wet; 1 for non-tiers
export function absorbDecision(elementId: number, hasWaterNeighbor: boolean, roll: number, chance: number):
  { newElementId: number; consumesWater: boolean };
export function dripDecision(elementId: number, hasEmptyBelow: boolean, roll: number, chance: number):
  { newElementId: number; releasesWater: boolean };
```

**Cohesion values** (`diagonalSlideChance`): Sand 1.0, Damp 0.6, Wet 0.3, Saturated 0.12. Non-tiers 1.0.

**Absorb/drip chances** (config): `ABSORB_CHANCE = 0.08`, `DRIP_CHANCE = 0.10`.

---

# PART A — Pure wet-sand logic (TS, unit-tested)

### Task 1: `wetSand.ts` tier helpers

**Files:**
- Create: `src/wetSand.ts`
- Test: `src/wetSand.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/wetSand.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SAND_TIER_LADDER, wetTierIndex, isSandTier, wetterTier, drierTier, diagonalSlideChance } from './wetSand';

describe('wet-sand tiers', () => {
  it('ladder is dry..saturated', () => {
    expect(SAND_TIER_LADDER).toEqual([2, 19, 20, 21]);
  });
  it('classifies tiers', () => {
    expect(isSandTier(2)).toBe(true);
    expect(isSandTier(21)).toBe(true);
    expect(isSandTier(3)).toBe(false); // Water
    expect(wetTierIndex(20)).toBe(2);
    expect(wetTierIndex(3)).toBe(-1);
  });
  it('steps wetter and drier, clamped at the ends', () => {
    expect(wetterTier(2)).toBe(19);
    expect(wetterTier(21)).toBe(21); // saturated stays
    expect(drierTier(21)).toBe(20);
    expect(drierTier(2)).toBe(2);    // dry stays
    expect(wetterTier(3)).toBe(3);   // non-tier unchanged
  });
  it('cohesion falls as sand gets wetter', () => {
    expect(diagonalSlideChance(2)).toBeCloseTo(1);
    expect(diagonalSlideChance(19)).toBeCloseTo(0.6);
    expect(diagonalSlideChance(21)).toBeCloseTo(0.12);
    expect(diagonalSlideChance(3)).toBeCloseTo(1); // non-tier: no cohesion gate
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- src/wetSand.test.ts`
Expected: FAIL — `./wetSand` not found.

- [ ] **Step 3: Implement** — create `src/wetSand.ts`:

```ts
export const SAND_TIER_LADDER = [2, 19, 20, 21]; // dry, damp, wet, saturated

const COHESION = new Map<number, number>([
  [2, 1.0],
  [19, 0.6],
  [20, 0.3],
  [21, 0.12],
]);

export function wetTierIndex(elementId: number): number {
  return SAND_TIER_LADDER.indexOf(elementId);
}

export function isSandTier(elementId: number): boolean {
  return wetTierIndex(elementId) !== -1;
}

export function wetterTier(elementId: number): number {
  const i = wetTierIndex(elementId);
  if (i === -1) return elementId;
  return SAND_TIER_LADDER[Math.min(i + 1, SAND_TIER_LADDER.length - 1)];
}

export function drierTier(elementId: number): number {
  const i = wetTierIndex(elementId);
  if (i === -1) return elementId;
  return SAND_TIER_LADDER[Math.max(i - 1, 0)];
}

export function diagonalSlideChance(elementId: number): number {
  return COHESION.get(elementId) ?? 1.0;
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm test -- src/wetSand.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/wetSand.ts src/wetSand.test.ts
git commit -m "Add wet-sand tier ladder and cohesion helpers"
```

---

### Task 2: Absorb & drip decision logic

**Files:**
- Modify: `src/wetSand.ts`, `src/wetSand.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/wetSand.test.ts`:

```ts
import { absorbDecision, dripDecision } from './wetSand';

describe('absorb decision', () => {
  it('wets one tier and consumes water when it fires', () => {
    const r = absorbDecision(2, true, 0.0, 0.08); // roll below chance -> fires
    expect(r).toEqual({ newElementId: 19, consumesWater: true });
  });
  it('does nothing without a water neighbor', () => {
    expect(absorbDecision(2, false, 0.0, 0.08)).toEqual({ newElementId: 2, consumesWater: false });
  });
  it('does nothing when the roll misses', () => {
    expect(absorbDecision(2, true, 0.5, 0.08)).toEqual({ newElementId: 2, consumesWater: false });
  });
  it('saturated sand cannot absorb more', () => {
    expect(absorbDecision(21, true, 0.0, 0.08)).toEqual({ newElementId: 21, consumesWater: false });
  });
});

describe('drip decision', () => {
  it('saturated over empty releases one water and drops a tier', () => {
    expect(dripDecision(21, true, 0.0, 0.10)).toEqual({ newElementId: 20, releasesWater: true });
  });
  it('only saturated drips', () => {
    expect(dripDecision(20, true, 0.0, 0.10)).toEqual({ newElementId: 20, releasesWater: false });
  });
  it('needs an empty cell below', () => {
    expect(dripDecision(21, false, 0.0, 0.10)).toEqual({ newElementId: 21, releasesWater: false });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- src/wetSand.test.ts`
Expected: FAIL — `absorbDecision`/`dripDecision` not exported.

- [ ] **Step 3: Implement** — append to `src/wetSand.ts`:

```ts
const SATURATED = 21;

export function absorbDecision(
  elementId: number,
  hasWaterNeighbor: boolean,
  roll: number,
  chance: number,
): { newElementId: number; consumesWater: boolean } {
  const i = wetTierIndex(elementId);
  const canAbsorb = i !== -1 && i < SAND_TIER_LADDER.length - 1;
  if (canAbsorb && hasWaterNeighbor && roll < chance) {
    return { newElementId: wetterTier(elementId), consumesWater: true };
  }
  return { newElementId: elementId, consumesWater: false };
}

export function dripDecision(
  elementId: number,
  hasEmptyBelow: boolean,
  roll: number,
  chance: number,
): { newElementId: number; releasesWater: boolean } {
  if (elementId === SATURATED && hasEmptyBelow && roll < chance) {
    return { newElementId: drierTier(elementId), releasesWater: true };
  }
  return { newElementId: elementId, releasesWater: false };
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm test -- src/wetSand.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/wetSand.ts src/wetSand.test.ts
git commit -m "Add wet-sand absorb and drip decision logic"
```

---

# PART B — Elements, densities, and drying data

### Task 3: Add the three wet-sand elements

**Files:**
- Modify: `src/elements.ts`, `src/elements.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/elements.test.ts`:

```ts
import { getElementByName } from './elements';

describe('wet-sand tiers', () => {
  it('exist with ascending density and are powders', () => {
    const sand = getElementByName('Sand');
    const damp = getElementByName('Damp Sand');
    const wet = getElementByName('Wet Sand');
    const sat = getElementByName('Saturated Sand');
    expect([damp.id, wet.id, sat.id]).toEqual([19, 20, 21]);
    // Denser than water (so they sink through it) and increasing with wetness.
    const water = getElementByName('Water');
    for (const e of [sand, damp, wet, sat]) expect(e.density).toBeGreaterThan(water.density);
    expect(sand.density).toBeLessThan(damp.density);
    expect(damp.density).toBeLessThan(wet.density);
    expect(wet.density).toBeLessThan(sat.density);
    for (const e of [damp, wet, sat]) expect(e.category).toBe('powder');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- src/elements.test.ts`
Expected: FAIL — `Unknown element name: Damp Sand`.

- [ ] **Step 3: Implement** — in `src/elements.ts`, append these three entries to the `ELEMENTS` array (after id 18, keeping the array index === id):

```ts
  { id: 19, name: 'Damp Sand', category: 'powder', density: 63, color: [150, 135, 95], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.35, heatCapacity: 1.5, family: 'physical' },
  { id: 20, name: 'Wet Sand', category: 'powder', density: 66, color: [120, 105, 72], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.4, heatCapacity: 2.5, family: 'physical' },
  { id: 21, name: 'Saturated Sand', category: 'powder', density: 70, color: [90, 78, 52], defaultTemp: AMBIENT_TEMP, thermalConductivity: 0.45, heatCapacity: 3.5, family: 'physical' },
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm test -- src/elements.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/elements.ts src/elements.test.ts
git commit -m "Add Damp/Wet/Saturated Sand elements"
```

---

### Task 4: Drying as threshold-reaction data

Drying needs no shader code: it's a temperature-gated stochastic one-way transition, exactly what `THRESHOLD_REACTIONS` expresses. Each wet tier gets a slow always-on dry row and a fast hot dry row. Water simply evaporates (the tier drops; no cell is spawned) — genuine evaporation, mass leaves the system only through heat.

**Files:**
- Modify: `src/thresholdReactions.ts`, `src/thresholdReactions.test.ts`

- [ ] **Step 1: Read `src/thresholdReactions.ts`** to confirm the `ThresholdReaction` shape (`reactant`, `minTemperature`, `product`, `chance`) and the `THRESHOLD_REACTIONS` array + `thresholdReactionData()` serializer.

- [ ] **Step 2: Write the failing test** — append to `src/thresholdReactions.test.ts`:

```ts
import { getElementByName } from './elements';
import { THRESHOLD_REACTIONS } from './thresholdReactions';

describe('wet-sand drying', () => {
  const rowsFor = (name: string) =>
    THRESHOLD_REACTIONS.filter((r) => r.reactant === getElementByName(name).id);

  it('every wet tier can dry one step (slow ambient + fast hot)', () => {
    for (const [wet, drier] of [['Damp Sand', 'Sand'], ['Wet Sand', 'Damp Sand'], ['Saturated Sand', 'Wet Sand']] as const) {
      const rows = rowsFor(wet);
      expect(rows.length).toBeGreaterThanOrEqual(2);
      for (const r of rows) expect(r.product).toBe(getElementByName(drier).id);
      // one always-on slow row, one hot fast row
      expect(rows.some((r) => r.minTemperature <= 0 && r.chance < 0.01)).toBe(true);
      expect(rows.some((r) => r.minTemperature >= 60 && r.chance >= 0.02)).toBe(true);
    }
  });
});
```

(If the `ThresholdReaction` field is optional/named differently, adapt the assertions to the real shape — the intent is: each wet tier → one drier tier, with a low-chance any-temperature row and a higher-chance hot row.)

- [ ] **Step 3: Run it to confirm it fails**

Run: `npm test -- src/thresholdReactions.test.ts`
Expected: FAIL — no drying rows yet.

- [ ] **Step 4: Implement** — add six rows to `THRESHOLD_REACTIONS` in `src/thresholdReactions.ts` (use the file's existing row shape; `minTemperature` very low = always applies):

```ts
  // Wet sand dries back toward dry Sand: a slow trickle at any temperature,
  // and a fast pass near heat (the absorbed water evaporates - no cell spawned).
  { reactant: getElementByName('Damp Sand').id, minTemperature: -273, product: getElementByName('Sand').id, chance: 0.0008 },
  { reactant: getElementByName('Damp Sand').id, minTemperature: 60, product: getElementByName('Sand').id, chance: 0.03 },
  { reactant: getElementByName('Wet Sand').id, minTemperature: -273, product: getElementByName('Damp Sand').id, chance: 0.0006 },
  { reactant: getElementByName('Wet Sand').id, minTemperature: 60, product: getElementByName('Damp Sand').id, chance: 0.03 },
  { reactant: getElementByName('Saturated Sand').id, minTemperature: -273, product: getElementByName('Wet Sand').id, chance: 0.0005 },
  { reactant: getElementByName('Saturated Sand').id, minTemperature: 60, product: getElementByName('Wet Sand').id, chance: 0.03 },
```

Adjust the test in Step 2 to match the real `ThresholdReaction` shape if needed, then re-run.

- [ ] **Step 5: Run it to confirm it passes**

Run: `npm test -- src/thresholdReactions.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/thresholdReactions.ts src/thresholdReactions.test.ts
git commit -m "Add wet-sand drying as threshold reactions"
```

---

# PART C — Shader + dispatch integration

> Part C is verified by `npm run typecheck`, `npm run build`, `npm test` staying green, and the e2e in Part D. After each task, run the app (`npm run dev`) and confirm no console errors before committing. The WGSL mirrors the unit-tested logic from Parts A–B exactly.

### Task 5: Register new element ids + make wet sand fall in the shader

**Files:**
- Modify: `src/shaders/simulate.wgsl`

- [ ] **Step 1** Update the element-id comment block at the top to include `19=Damp Sand 20=Wet Sand 21=Saturated Sand`. Add the constants after `SULFUR_DIOXIDE`:

```wgsl
const DAMP_SAND: u32 = 19u;
const WET_SAND: u32 = 20u;
const SATURATED_SAND: u32 = 21u;
```

- [ ] **Step 2** Make the wet tiers behave as powders (fall + sink by density) by adding them to `isPowderOrLiquid`:

```wgsl
fn isPowderOrLiquid(id: u32) -> bool {
  return id == SAND || id == WATER || id == LAVA || id == ACID || id == COPPER_SULFATE
      || id == ACID_VERY_DILUTE || id == ACID_CONCENTRATED || id == ACID_FUMING
      || id == DAMP_SAND || id == WET_SAND || id == SATURATED_SAND;
}
```

- [ ] **Step 3** Verify `npm run typecheck` (clean) and `npm run build` (succeeds). Run `npm run dev`: paint Damp/Wet/Saturated Sand (they appear in the toolbar automatically) — they fall and pile like sand, and sink through water. No console errors.

- [ ] **Step 4: Commit**

```bash
git add src/shaders/simulate.wgsl
git commit -m "Register wet-sand ids and make them fall as powders"
```

---

### Task 6: Cohesion — wetter sand slides diagonally less

The movement pass's diagonal step (`shouldSwapVertical(a,d)` / `(b,c)`) is what lets a powder slide off a pile. Gate that diagonal step by the moving cell's wetness so wet sand piles steeper. Mirrors `wetSand.ts diagonalSlideChance`.

**Files:**
- Modify: `src/shaders/simulate.wgsl`

- [ ] **Step 1** Add a cohesion helper (mirror of `diagonalSlideChance`):

```wgsl
// Cohesion: wetter sand resists sliding diagonally off a pile (mirrors
// src/wetSand.ts diagonalSlideChance). 1.0 = always slides (dry/other).
fn diagonalSlideChance(id: u32) -> f32 {
  if (id == DAMP_SAND) { return 0.6; }
  if (id == WET_SAND) { return 0.3; }
  if (id == SATURATED_SAND) { return 0.12; }
  return 1.0;
}
```

- [ ] **Step 2** In `movement`, gate the two diagonal swaps by a per-cell roll against the moving cell's cohesion. Replace the diagonal block (the section labelled "2. Diagonal, only for a column that didn't just resolve straight down"):

```wgsl
  // 2. Diagonal, only for a column that didn't just resolve straight down
  // (so a cell moves at most once per tick), gated by cohesion so wet sand
  // clumps instead of sliding.
  let rollAD = f32(hash(u32(blockX), u32(blockY), params.frame) & 0xffffu) / 65536.0;
  if (!movedLeft && shouldSwapVertical(a.elementId, d.elementId) && rollAD < diagonalSlideChance(a.elementId)) {
    let tmp = a; a = d; d = tmp;
  }
  let rollBC = f32(hash(u32(blockX + 1), u32(blockY), params.frame) & 0xffffu) / 65536.0;
  if (!movedRight && shouldSwapVertical(b.elementId, c.elementId) && rollBC < diagonalSlideChance(b.elementId)) {
    let tmp = b; b = c; c = tmp;
  }
```

- [ ] **Step 3** Verify typecheck + build. `npm run dev`: pour dry Sand → shallow pile; the wetter tiers pile visibly steeper. No console errors.

- [ ] **Step 4: Commit**

```bash
git add src/shaders/simulate.wgsl
git commit -m "Add wet-sand cohesion: wetter sand piles steeper"
```

---

### Task 6b: Natural gas dispersion

Fixes a pre-existing baseline issue (diagnosed via in-browser testing): a rising gas blob splits into two symmetric streams that diverge to the corners instead of rising as a plume. Cause — the crossed-diagonal swap that makes falling powder *converge* into a pile makes rising gas *diverge*; the fully-deterministic diagonal makes the split perfectly symmetric, and horizontal spread (every tick) outpaces the alignment-gated rise. Fix: randomize the gas diagonal rise (50%) so it doesn't split symmetrically, and gate gas horizontal spread by a probability so gas rises before it fans out. Non-gas movement is unchanged. This modifies the diagonal step Task 6 just edited and the horizontal step below it.

**Files:**
- Modify: `src/shaders/simulate.wgsl`

- [ ] **Step 1** Add the tuning constant near the top consts:

```wgsl
// Per-tick chance a gas cell spreads sideways. < 1 so gas rises as a plume
// instead of fanning flat every tick. Tune visually (see Step 4).
const GAS_DISPERSE_CHANCE: f32 = 0.25;
```

- [ ] **Step 2** In `movement`, replace the diagonal step (the version Task 6 produced, with the `rollAD`/`rollBC` cohesion gates) with one that also randomizes gas rising to 50%:

```wgsl
  // 2. Diagonal, gated: wet sand by its cohesion chance; a gas cell rising
  // diagonally by 50% so a gas blob doesn't split into two symmetric diverging
  // streams; everything else slides freely.
  let rollAD = f32(hash(u32(blockX), u32(blockY), params.frame) & 0xffffu) / 65536.0;
  let gateAD = select(diagonalSlideChance(a.elementId), 0.5, isGas(d.elementId) && a.elementId == EMPTY);
  if (!movedLeft && shouldSwapVertical(a.elementId, d.elementId) && rollAD < gateAD) {
    let tmp = a; a = d; d = tmp;
  }
  let rollBC = f32(hash(u32(blockX + 1), u32(blockY), params.frame) & 0xffffu) / 65536.0;
  let gateBC = select(diagonalSlideChance(b.elementId), 0.5, isGas(c.elementId) && b.elementId == EMPTY);
  if (!movedRight && shouldSwapVertical(b.elementId, c.elementId) && rollBC < gateBC) {
    let tmp = b; b = c; c = tmp;
  }
```

- [ ] **Step 3** Replace the horizontal step (step 3) so gas spreads sideways only with probability `GAS_DISPERSE_CHANCE`, leaving liquids/others every-tick:

```wgsl
  // 3. Horizontal spread. Gas disperses sideways only occasionally so it rises
  // as a plume; liquids and other spreads are unchanged.
  let hRollAB = f32(hash(u32(blockX + 31u), u32(blockY + 17u), params.frame) & 0xffffu) / 65536.0;
  let gasAB = isGas(a.elementId) || isGas(b.elementId);
  if ((!gasAB || hRollAB < GAS_DISPERSE_CHANCE) && shouldSwapHorizontal(a.elementId, b.elementId)) {
    let tmp = a; a = b; b = tmp;
  }
  let hRollCD = f32(hash(u32(blockX + 53u), u32(blockY + 71u), params.frame) & 0xffffu) / 65536.0;
  let gasCD = isGas(c.elementId) || isGas(d.elementId);
  if ((!gasCD || hRollCD < GAS_DISPERSE_CHANCE) && shouldSwapHorizontal(c.elementId, d.elementId)) {
    let tmp = c; c = d; d = tmp;
  }
```

- [ ] **Step 4** Verify `npm run typecheck` + `npm run build`, then **verify visually in Chrome** (this is aesthetic — the acceptance test is the look): `npm run dev`, paint a dense Smoke blob (max the flow-rate slider), and confirm it now rises as a coherent, gradually-dispersing plume instead of splitting into two streams that fly to the corners. If it still fans too much, lower `GAS_DISPERSE_CHANCE` (e.g. 0.15); if it rises in too thin a column, raise it. No console errors.

- [ ] **Step 5: Commit**

```bash
git add src/shaders/simulate.wgsl
git commit -m "Fix gas dispersion: rising gas rises as a plume, not a diverging split"
```

---

### Task 7: Water-only movement pass (fast leveling substeps)

Add a `waterMovement` entry point: a Margolus block-CA that moves **only Water** — into empty/gas below and sideways into empty — leaving all other elements put. Running it many times per frame disperses water fast (sink through sand stays in the general `movement` pass so sand doesn't fall N× faster).

**Files:**
- Modify: `src/shaders/simulate.wgsl`

- [ ] **Step 1** Add water-only swap predicates and the entry point (reuses the block-alignment boilerplate from `movement` — copy that structure exactly, changing only the swap decisions). Append to `simulate.wgsl`:

```wgsl
// Water-only vertical swap: water sinks into empty or gas directly below.
fn waterShouldSwapV(topVal: u32, bottomVal: u32) -> bool {
  return topVal == WATER && (bottomVal == EMPTY || isGas(bottomVal));
}
// Water-only horizontal swap: water spreads into adjacent empty space.
fn waterShouldSwapH(leftVal: u32, rightVal: u32) -> bool {
  return (leftVal == WATER && rightVal == EMPTY) || (rightVal == WATER && leftVal == EMPTY);
}

@compute @workgroup_size(8, 8)
fn waterMovement(@builtin(global_invocation_id) gid: vec3<u32>) {
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

  let movedLeft = waterShouldSwapV(a.elementId, c.elementId);
  if (movedLeft) { let t = a; a = c; c = t; }
  let movedRight = waterShouldSwapV(b.elementId, d.elementId);
  if (movedRight) { let t = b; b = d; d = t; }
  if (!movedLeft && waterShouldSwapV(a.elementId, d.elementId)) { let t = a; a = d; d = t; }
  if (!movedRight && waterShouldSwapV(b.elementId, c.elementId)) { let t = b; b = c; c = t; }
  if (waterShouldSwapH(a.elementId, b.elementId)) { let t = a; a = b; b = t; }
  if (waterShouldSwapH(c.elementId, d.elementId)) { let t = c; c = d; d = t; }

  writeBuf[idxA] = a; writeBuf[idxB] = b; writeBuf[idxC] = c; writeBuf[idxD] = d;
}
```

- [ ] **Step 2** Verify `npm run typecheck` + `npm run build` (this only adds an entry point; it isn't dispatched until Task 9). No console errors on `npm run dev` (behaviour unchanged yet).

- [ ] **Step 3: Commit**

```bash
git add src/shaders/simulate.wgsl
git commit -m "Add water-only movement pass for fast leveling substeps"
```

---

### Task 8: Soak pass — absorb & drip (race-free block-CA)

A new `soak` block-CA pass does the two-cell transforms the reaction engine can't: **absorb** (a sand-tier cell orthogonally adjacent to Water climbs a tier and the Water becomes Empty) and **drip** (Saturated Sand with Empty directly below drops to Wet and the Empty becomes Water). Block-owned resolution keeps both cells' writes race-free. At most one absorb and one drip per block per tick. Mirrors `wetSand.ts` `absorbDecision`/`dripDecision`.

**Files:**
- Modify: `src/shaders/simulate.wgsl`

- [ ] **Step 1** Append constants + the pass. (`ABSORB_CHANCE`/`DRIP_CHANCE` match the config in Task 9.)

```wgsl
const ABSORB_CHANCE: f32 = 0.08;
const DRIP_CHANCE: f32 = 0.10;

fn isSandTier(id: u32) -> bool {
  return id == SAND || id == DAMP_SAND || id == WET_SAND || id == SATURATED_SAND;
}
fn wetterTier(id: u32) -> u32 {
  if (id == SAND) { return DAMP_SAND; }
  if (id == DAMP_SAND) { return WET_SAND; }
  if (id == WET_SAND) { return SATURATED_SAND; }
  return id; // saturated stays
}

// Absorb one adjacent Water into a sand-tier cell (Water->Empty, sand->wetter),
// and let Saturated Sand drip one Water into an Empty cell below. Both are
// two-cell transforms, so they run in this block-owned pass rather than the
// per-cell heat() reaction loop. Enthalpy carries with each cell unchanged.
@compute @workgroup_size(8, 8)
fn soak(@builtin(global_invocation_id) gid: vec3<u32>) {
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

  // --- Absorb: at most one sand<->water pair in this block (a-b, a-c, b-d, c-d).
  if (roll < ABSORB_CHANCE) {
    if (isSandTier(a.elementId) && a.elementId != SATURATED_SAND && b.elementId == WATER) {
      a.elementId = wetterTier(a.elementId); b = Cell(EMPTY, b.enthalpy);
    } else if (isSandTier(b.elementId) && b.elementId != SATURATED_SAND && a.elementId == WATER) {
      b.elementId = wetterTier(b.elementId); a = Cell(EMPTY, a.enthalpy);
    } else if (isSandTier(a.elementId) && a.elementId != SATURATED_SAND && c.elementId == WATER) {
      a.elementId = wetterTier(a.elementId); c = Cell(EMPTY, c.enthalpy);
    } else if (isSandTier(c.elementId) && c.elementId != SATURATED_SAND && a.elementId == WATER) {
      c.elementId = wetterTier(c.elementId); a = Cell(EMPTY, a.enthalpy);
    } else if (isSandTier(b.elementId) && b.elementId != SATURATED_SAND && d.elementId == WATER) {
      b.elementId = wetterTier(b.elementId); d = Cell(EMPTY, d.enthalpy);
    } else if (isSandTier(d.elementId) && d.elementId != SATURATED_SAND && b.elementId == WATER) {
      d.elementId = wetterTier(d.elementId); b = Cell(EMPTY, b.enthalpy);
    } else if (isSandTier(c.elementId) && c.elementId != SATURATED_SAND && d.elementId == WATER) {
      c.elementId = wetterTier(c.elementId); d = Cell(EMPTY, d.enthalpy);
    } else if (isSandTier(d.elementId) && d.elementId != SATURATED_SAND && c.elementId == WATER) {
      d.elementId = wetterTier(d.elementId); c = Cell(EMPTY, c.enthalpy);
    }
  }

  // --- Drip: saturated sand over an empty cell (a over c, b over d) releases water.
  let dripRoll = f32(hash(u32(blockX + 7u), u32(blockY + 13u), params.frame) & 0xffffu) / 65536.0;
  if (dripRoll < DRIP_CHANCE) {
    if (a.elementId == SATURATED_SAND && c.elementId == EMPTY) {
      a.elementId = WET_SAND; c = Cell(WATER, c.enthalpy);
    } else if (b.elementId == SATURATED_SAND && d.elementId == EMPTY) {
      b.elementId = WET_SAND; d = Cell(WATER, d.enthalpy);
    }
  }

  writeBuf[idxA] = a; writeBuf[idxB] = b; writeBuf[idxC] = c; writeBuf[idxD] = d;
}
```

- [ ] **Step 2** Verify `npm run typecheck` + `npm run build`. (Not dispatched until Task 9.)

- [ ] **Step 3: Commit**

```bash
git add src/shaders/simulate.wgsl
git commit -m "Add soak pass: wet-sand absorb and drip (two-cell, race-free)"
```

---

### Task 9: Dispatch the new passes + config

Wire the `soak` and `waterMovement` passes into the frame. Two correctness constraints: (1) every block-CA dispatch needs its **own `frame` value** so the Margolus alignment cycles across the substeps — otherwise all substeps use one fixed 2×2 partitioning and water can't cross block boundaries; (2) the frame must end with the latest grid back in **buffer A** (what render/paint read).

**Files:**
- Modify: `src/config.ts`, `src/webgpu/simulation.ts`

- [ ] **Step 1: Read `render()` and the constructor first** to confirm: the `simParamsBuffer` is sized `paramsStride * TICKS_PER_FRAME` and render() pre-writes one SimParams slot per tick (frame = `this.frame + tick`) selected via dynamic offset; `movementBindGroup` binds (readBuf=A, writeBuf=B) and `heatBindGroup` binds (readBuf=B, writeBuf=A); after the movement/heat tick loop the latest grid is in A.

- [ ] **Step 2** Add config to `src/config.ts`:

```ts
/** Extra water-only movement substeps per frame for fast leveling. Chosen so
 * that (1 soak pass + WATER_SUBSTEPS) is even, leaving the grid back in buffer A. */
export const WATER_SUBSTEPS = 13;
```

- [ ] **Step 3** Expand the SimParams slot count so soak + every substep get a distinct frame. In `src/webgpu/simulation.ts`, add near the other constants:

```ts
// One SimParams slot per block-CA dispatch that needs its own frame value:
// TICKS_PER_FRAME movement/heat ticks (movement+heat within a tick share a
// slot) + 1 soak pass + WATER_SUBSTEPS water-leveling passes.
const SIM_SLOTS = TICKS_PER_FRAME + 1 + WATER_SUBSTEPS;
```

Change the `simParamsBuffer` allocation size from `this.paramsStride * TICKS_PER_FRAME` to `this.paramsStride * SIM_SLOTS`. Import `WATER_SUBSTEPS`.

- [ ] **Step 4** Create the two pipelines alongside movement/heat:

```ts
this.waterMovementPipeline = device.createComputePipeline({
  layout: simPipelineLayout,
  compute: { module: simModule, entryPoint: 'waterMovement' },
});
this.soakPipeline = device.createComputePipeline({
  layout: simPipelineLayout,
  compute: { module: simModule, entryPoint: 'soak' },
});
```

Declare `private readonly waterMovementPipeline: GPUComputePipeline;` and `private readonly soakPipeline: GPUComputePipeline;`.

- [ ] **Step 5** In `render()`, change the SimParams pre-write loop to fill all `SIM_SLOTS` slots, each slot `i` with `frame = this.frame + i` (copy the other fields — width, height, ambientTemp, reaction counts — from the existing per-slot writes). Then, after the existing movement/heat tick loop (which ends in A) and before advancing the frame, append the soak + substep dispatches, and change the frame advance:

```ts
// Buffer A holds the latest grid here. soak reads A->writes B, then each
// water substep flips direction. movementBindGroup = A->B, heatBindGroup = B->A.
let readA = true;
const dispatchSim = (pipeline: GPUComputePipeline, slot: number) => {
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, readA ? this.movementBindGroup : this.heatBindGroup, [slot * this.paramsStride]);
  pass.dispatchWorkgroups(WORKGROUPS_X, WORKGROUPS_Y);
  readA = !readA;
};
dispatchSim(this.soakPipeline, TICKS_PER_FRAME);
for (let s = 0; s < WATER_SUBSTEPS; s++) {
  dispatchSim(this.waterMovementPipeline, TICKS_PER_FRAME + 1 + s);
}
```

Replace `this.frame += TICKS_PER_FRAME;` with `this.frame += SIM_SLOTS;` so alignment keeps advancing across frames.

Parity check: 1 (soak) + 13 (substeps) = 14 dispatches, starting from A with `readA=true` → the 14th write lands in A (even count). If you change `WATER_SUBSTEPS` to an even number, add `encoder.copyBufferToBuffer(this.gridBufferB, 0, this.gridBufferA, 0, GRID_BYTES)` after `pass.end()`.

- [ ] **Step 6** Verify `npm run typecheck` + `npm run build`. Run `npm run dev`:
  - Paint a Water column → it now levels fast and flat (the substeps).
  - Drop Sand into a pool → it sinks; water rises.
  - Pour Water onto a Sand pile → sand darkens through the tiers (absorb) and the pool drains into it; a saturated pile drips water from its underside.
  - Toggle the profiler (backtick) and confirm framerate is acceptable; if heavy, lower `WATER_SUBSTEPS` (keep it odd).
  - No console errors.

- [ ] **Step 7: Commit**

```bash
git add src/config.ts src/webgpu/simulation.ts
git commit -m "Dispatch soak and water-leveling substep passes"
```

---

# PART D — End-to-end coverage

### Task 10: e2e — leveling, sink, soak

**Files:**
- Modify: `e2e/smoke.spec.ts`

- [ ] **Step 1** Append a test (guarded on WebGPU like the existing smoke test, so it skips where there's no GPU adapter):

```ts
test('water levels, sand sinks, sand soaks — no errors', async ({ page }) => {
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

  // Sand pile, then water poured on top: exercises fall, sink, and soak paths.
  await page.getByRole('button', { name: 'Sand' }).click();
  let p = at(0.5, 0.5); await page.mouse.move(p.x, p.y); await page.mouse.down();
  for (let f = 0.45; f <= 0.55; f += 0.02) { const q = at(f, 0.5); await page.mouse.move(q.x, q.y); }
  await page.mouse.up();

  await page.getByRole('button', { name: 'Water' }).click();
  p = at(0.5, 0.25); await page.mouse.move(p.x, p.y); await page.mouse.down();
  await page.mouse.move(p.x + 15, p.y); await page.mouse.up();

  await page.waitForTimeout(2000); // let it fall, level, sink, and soak

  expect(pageErrors, `page errors: ${pageErrors.join('; ')}`).toEqual([]);
  expect(consoleErrors, `console errors: ${consoleErrors.join('; ')}`).toEqual([]);
});
```

- [ ] **Step 2** Run the full suite:

Run: `npm run typecheck && npm test && npm run test:e2e`
Expected: typecheck clean, all Vitest green, Playwright green or skipped (no-GPU CI).

- [ ] **Step 3: Commit**

```bash
git add e2e/smoke.spec.ts
git commit -m "Add e2e for CA water leveling, sink, and soak"
```

---

## Final verification

- [ ] `npm run typecheck` — clean.
- [ ] `npm test` — all unit tests (wetSand, elements, thresholdReactions, plus existing) pass.
- [ ] `npm run test:e2e` — passes or skips on no-GPU.
- [ ] `npm run dev` in Chrome: water pooled in a Stone basin levels flat; Sand dropped in sinks; Water poured on a Sand pile soaks through Damp→Wet→Saturated and drains; a saturated pile drips; near Fire, wet sand dries out. Check the profiler frame time and tune `WATER_SUBSTEPS` if needed.
