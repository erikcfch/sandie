# Chem reaction engine + first Chem-category reaction

## Purpose

The falling-sand sim has exactly one contact reaction today (Lava+Water→Obsidian),
hardcoded as a single `if` branch in `simulate.wgsl`. `src/reactions.ts`'s
`CONTACT_REACTIONS` array is purely decorative — it documents and unit-tests the
same numbers but is never uploaded to the GPU or read by the shader.

The user wants to introduce an actual multi-reactant "chemical reaction" category
(e.g. Sulfuric Acid + Copper → Copper Sulfate + Hydrogen, with an exothermic energy
release) aimed at "serious gamers" who want chemically-authentic elements, as a
distinct **Chem** category alongside the existing physical elements. Since only
one reaction exists today and more are clearly wanted, this is scoped as: build a
real data-driven reaction engine, and land exactly one concrete Chem reaction pair
as the vertical slice that proves it.

## Scope

**In scope:**
- Generalize `CONTACT_REACTIONS` into a GPU-uploaded, data-driven reaction buffer,
  replacing the currently-hardcoded neighbor-catalyzed branches in `simulate.wgsl`.
- Add an `enthalpyDelta` field so reactions can inject extra (exothermic) energy,
  not just carry over pre-reaction temperature.
- Add 4 new elements in a new `chem` family: Sulfuric Acid, Copper, Copper Sulfate,
  Hydrogen.
- Add 2 new reaction rows: Copper+Acid→Copper Sulfate, Acid+Copper→Hydrogen.
- Group the toolbar into "Physical" / "Chem" labeled sections; show each Chem
  element's formula as a subtitle.

**Out of scope (explicitly deferred):**
- Any reaction between Hydrogen and Fire/other elements (e.g. combustion/explosion)
  — natural follow-up, not part of this slice.
- Any additional Chem elements/reactions beyond this one pair.
- A "Chem mode" toggle to hide/show the category (elements are always visible,
  just grouped).
- Real chemical accuracy beyond naming (e.g. this uses dilute-acid-style behavior
  for gameplay purposes; concentrated H₂SO₄+Cu in reality produces SO₂, not H₂ —
  not worth modeling for a sandbox game).

## New elements (`src/elements.ts`)

`ElementDef` gains two fields:
```ts
family: 'physical' | 'chem'; // all 11 existing elements get 'physical'
formula?: string;            // only set for chem-family elements
```

| Name | Formula | Category | Density | Color | defaultTemp | thermalConductivity | heatCapacity |
|---|---|---|---|---|---|---|---|
| Sulfuric Acid | H₂SO₄ | liquid | 45 | `[190, 220, 40]` | AMBIENT_TEMP | 0.25 | 4.0 |
| Copper | Cu | static | 100 | `[184, 115, 51]` | AMBIENT_TEMP | 0.9 | 0.6 |
| Copper Sulfate | CuSO₄ | powder | 70 | `[210, 225, 235]` | AMBIENT_TEMP | 0.3 | 0.8 |
| Hydrogen | H₂ | gas | 1 | `[230, 245, 255]` | AMBIENT_TEMP | 0.05 | 0.5 |

All four get `defaultTemp: AMBIENT_TEMP` — they're inert until they react, unlike
Lava/Ice/Steam/Fire which have extreme starting temperatures.

Movement (density-based Margolus swap) already generalizes across categories from
Phase 1 — no movement-pass changes needed, these just need correct `category`/
`density` data.

## Reaction engine (`src/reactions.ts`, `src/webgpu/simulation.ts`, `src/shaders/simulate.wgsl`)

### Schema change
```ts
export interface ContactReaction {
  reactant: number;
  catalystNeighbor: number;
  product: number;
  chance: number;
  enthalpyDelta: number; // extra enthalpy injected into the product beyond
                          // straight temperature carry-over; 0 = no extra heat
}
```
The existing Lava+Water→Obsidian entry gets `enthalpyDelta: 0` (no behavior
change for it).

### What migrates to the data-driven buffer vs. what stays bespoke
Only genuinely neighbor-catalyzed transforms (reactant + adjacent catalyst →
product) fit this schema:
- Lava+Water→Obsidian — migrates (existing behavior, now data-driven).
- Fire+Water→Steam and Fire+Steam→Steam — migrates, as two rows sharing a
  product (this replaces the current `touchingWaterOrSteam` bool).

These stay as bespoke branches in `heat()` (not contact reactions by this
definition — no catalyst neighbor involved):
- Wood→Fire: triggered by a temperature threshold (`WOOD_IGNITE_POINT`), not a
  neighbor.
- Fire→Smoke: pure stochastic self-decay, no catalyst.

### New Chem reaction rows
```ts
{ reactant: COPPER, catalystNeighbor: ACID, product: COPPER_SULFATE, chance: 0.08, enthalpyDelta: 40 },
{ reactant: ACID, catalystNeighbor: COPPER, product: HYDROGEN, chance: 0.08, enthalpyDelta: 40 },
```
Both reactants transform independently — each is its own row with its own
stochastic roll; no new "both-cells-consumed-together" mechanic is needed, the
existing reactant/catalyst shape is just used symmetrically for both sides of
the same physical event. `enthalpyDelta: 40` is a modest, tunable exothermic
kick (roughly a third of Ice↔Water's latent heat of 80, for scale).

### GPU plumbing
- `reactions.ts` gains a `reactionData()` function (mirrors `materialProperties()`)
  serializing each row as two `vec4<f32>`s: `(reactant, catalystNeighbor, product,
  chance)` then `(enthalpyDelta, 0, 0, 0)`.
- `simulation.ts` uploads this as a new read-only storage buffer, and adds a
  `reactionCount: u32` field to the `SimParams` uniform.
- `simulate.wgsl`'s `heat()` function loops `for (i = 0u; i < params.reactionCount; i++)`:
  for a match (`here.elementId == reactant` and any of the 4 orthogonal
  neighbors has `elementId == catalystNeighbor`), rolls an independent random
  value seeded with the reaction index `i` (so reactions don't share/bias the
  same draw as each other or as other stochastic rules), and on success sets
  `result.elementId = product` and
  `newEnthalpy = enthalpyForNewElement(result.temperature, product) + enthalpyDelta`,
  then `break`s (first-triggered-wins — a cell can't be transformed twice in
  one tick).

## Toolbar UI (`src/ui/toolbar.ts`)

`createToolbar` groups `ELEMENTS` by `family` into two labeled sections,
"Physical" then "Chem", each rendering as a heading followed by its row of
buttons (same button/selection logic reused for both — no `ToolState` changes).
Chem buttons whose element has a `formula` show it as a subtitle, e.g.:
```
Copper Sulfate
   (CuSO₄)
```

## Testing

- `reactions.test.ts`: extend for the new `enthalpyDelta` field and the two new
  rows, following the existing Lava/Obsidian test shape (`getReactionsFor`
  returns them, `chance` is in `(0, 1]`, etc.).
- `elements.test.ts`: extend for the 4 new elements and the `family`/`formula`
  fields; add coverage for `reactionData()` serialization analogous to existing
  `materialProperties()`/`colorPalette()` coverage.
- The generic reaction loop in `simulate.wgsl` (including the migrated Lava/Fire
  branches and the new Acid/Copper rows) is **not unit-tested** — consistent
  with the rest of `simulate.wgsl` today, which has no WGSL test harness;
  correctness is verified by running the app. Manual verification: paint Acid
  next to Copper and confirm Copper Sulfate + Hydrogen appear, temperature
  rises as expected, and the migrated Lava→Obsidian / Fire→Steam behaviors are
  unchanged from before.
- Typecheck, the full vitest suite, and the Playwright smoke test all continue
  to run as regression coverage (the smoke test doesn't exercise reactions
  specifically, but confirms the app still loads/renders with the larger
  element/toolbar set).
