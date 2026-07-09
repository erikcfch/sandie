# Material System — Design Spec

**Date:** 2026-07-09
**Status:** Approved architecture; Phase 1 scoped for implementation
**Branch:** `material-system` (off `master`)

## Motivation

sandie's element model has a good *property* foundation but a weak
*classification* one, which blocks introducing materials at scale.

- **Properties are data-driven.** `density`, `thermalConductivity`,
  `heatCapacity` (and reactions, phase-transition chains) are data, packed into
  GPU buffers and read generically. Adding a reaction is a table row.
- **Classification is not.** `ElementCategory` (`static/powder/liquid/gas`) is
  *metadata only* — the simulation never reads it. Movement behavior is
  hardcoded in the shader as element-id lists: `isPowderOrLiquid(id) → id ==
  SAND || id == WATER || …`, plus `isLiquid`, `isGas`. Behavioral thresholds are
  hardcoded too (`WOOD_IGNITE_POINT = 300`). `ElementFamily` (`physical/chem`)
  is purely toolbar grouping.

**Consequence:** adding "Oil" (a flammable liquid) means editing `elements.ts`
*and* `isLiquid`/`isPowderOrLiquid` in the shader *and* adding a bespoke
ignition rule. There is no taxonomy (organic/inorganic, metal/nonmetal,
flammable, corrosive, soluble) and the property values are eyeballed, not
sourced.

This project builds a proper **material system**: a data-driven schema with
orthogonal taxonomy axes, capability flags, and behavior params; real-but-
normalized property values; and a generic, flag-driven interaction engine with a
thin explicit-override table for irreducible chemistry. The classification then
*drives* the sim, so new materials are pure data.

## Design decisions (settled)

- **Accuracy:** real physical values, normalized for the sim. Real densities,
  melting/boiling points, specific heats are the source of truth; density is
  mapped through a monotonic (log-based) normalization into the game's movement
  range so ordering is correct without extreme ratios breaking gameplay.
  Melting/boiling points (°C) are used directly.
- **Representation:** a hybrid of orthogonal taxonomy axes + capability flags +
  typed behavior params, packed into GPU buffers the shader reads (no hardcoded
  id-lists).
- **Interactions:** fully generic / emergent — universal rules driven by flags,
  with specificity carried in each material's params (`ignitionTemp`,
  `burnProduct`, `dissolvedProduct`, …) — plus a **thin explicit-override
  table** for the handful of irreducible reactions (multi-product, multi-gate
  stoichiometry like Copper + Concentrated Acid → CuSO₄ + SO₂ + H₂O).

## Target Architecture

### The `MaterialDef` schema

Replaces today's `ElementDef`. Four kinds of field:

```ts
export type Form = 'static' | 'powder' | 'liquid' | 'gas'; // movement behavior (drives the sim)
export type Phase = 'solid' | 'liquid' | 'gas';            // scientific state of matter
export type Origin = 'inorganic' | 'organic';
export type Metallic = 'metal' | 'nonmetal';

export interface MaterialDef {
  id: number;
  name: string;
  formula?: string;
  color: [number, number, number];
  defaultTemp: number;

  // --- Taxonomy axes (orthogonal) ---
  form: Form;          // static/powder/liquid/gas — drives movement
  phase: Phase;        // solid/liquid/gas — scientific state (solid = static or powder)
  origin: Origin;      // organic/inorganic
  metallic: Metallic;  // metal/nonmetal

  // --- Physical properties (real values; simDensity derived) ---
  density: number;              // real g/cm³ (source of truth)
  specificHeat: number;         // real J/(g·K); scaled to heatCapacity
  thermalConductivity: number;  // 0..1 normalized
  meltingPoint?: number;        // °C (omit if no melt transition in game range)
  boilingPoint?: number;        // °C
  viscosity?: number;           // 0..1 liquid flow resistance (water low, honey high)

  // --- Capability flags ---
  flammable?: boolean;
  corrosive?: boolean;
  soluble?: boolean;    // dissolvable by corrosives
  conductive?: boolean; // electrical (future use)

  // --- Behavior params (drive the generic rules) ---
  ignitionTemp?: number;      // °C — flammable ignites above this
  burnProduct?: number;       // element id it becomes when it ignites (e.g. Fire)
  burnRate?: number;          // per-tick conversion chance
  corrosiveStrength?: number; // how aggressively it dissolves solubles
  solubility?: number;        // how readily a corrosive dissolves it
  dissolvedProduct?: number;  // what a soluble becomes when dissolved
}
```

Toolbar grouping derives from taxonomy (e.g. group by `origin`/`phase`) instead
of the ad-hoc `family` field, which is removed.

### Density normalization

Real densities span ~5 orders of magnitude. Store the real value as source of
truth; derive a `simDensity` for the movement comparison via a monotonic
log-map, e.g. `simDensity = clamp(K·log10(density / DENSITY_REF) + OFFSET, LO,
HI)`, tuned so the existing orderings are preserved and the game range (~0–100)
is filled. Because the map is monotonic, buoyancy ordering matches reality
(ice < water → ice floats; sand > water → sand sinks). Only `simDensity` goes
into the movement buffer; the movement rules are otherwise unchanged.

### Data-driven shader

The single `vec4` per material (density, conductivity, heatCapacity) expands to a
few `vec4`s of numeric params, plus a **separate `materialFlags: array<u32>`
buffer** holding a packed bitfield of the taxonomy axes + capability flags. The
shader reads them instead of comparing ids:

- `isPowderOrLiquid`/`isLiquid`/`isGas` → read the 2-bit `form` field from
  `materialFlags[id]`.
- `WOOD_IGNITE_POINT` bespoke rule → generic: "a `flammable` cell whose
  temperature exceeds its `ignitionTemp` becomes its `burnProduct` at
  `burnRate`."
- Buoyancy → `simDensity` comparison (unchanged logic, data-sourced value).

A packed `u32` (e.g. bits 0–1 `form`, bit 2 flammable, bit 3 corrosive, bit 4
soluble, bit 5 organic, bit 6 metal, …) is built CPU-side from the schema and
read with bit tests in WGSL. Numeric params come from the expanded float buffer.

### Generic engine + explicit-override table

Generic flag/param rules handle broad behaviors: movement (form), buoyancy
(simDensity), thermal (conductivity/heatCapacity), flammability
(flammable/ignitionTemp/burnProduct), corrosion/dissolving
(corrosive/soluble/products), and phase change (melting/boiling points +
targets). The existing `CONTACT_REACTIONS`/`THRESHOLD_REACTIONS` tables remain as
an **override** for irreducible chemistry, evaluated with priority over the
generic rules so specific authored reactions win.

## Phasing

The spec documents the whole architecture; implementation ships in order, each
phase producing working, tested software.

### Phase 1 — Data-driven framework (this spec's implementation scope)

The enabler. Same observable behavior, now fully data-driven.

- Define the `MaterialDef` schema (taxonomy axes; the `flammable` flag +
  `ignitionTemp`/`burnProduct`/`burnRate` params; and real scientific reference
  values — `realDensity`, `specificHeat`, `meltingPoint`/`boilingPoint`,
  `viscosity`) and the flag-bitfield packing.
- Expand the GPU buffers: `materials` gains the flammability params + a new
  `materialFlags: u32` bitfield buffer.
- Rewrite the shader's movement class predicates (`isPowderOrLiquid`/`isLiquid`/
  `isGas`) to read `form` from `materialFlags`, and replace the bespoke
  `WOOD_IGNITE_POINT` ignition with the generic flammable rule.
- Migrate the existing 22 materials to the schema: correct taxonomy/flags (Wood
  becomes `flammable`, ignitionTemp 300, burnProduct Fire, organic; metals get
  `metal`/`conductive`; etc.) and record real reference values.
- **Behavior-identical:** the values the sim actually *uses* — `density`,
  `thermalConductivity`, `heatCapacity`, and each element's `form` (= today's
  `category`) — are kept exactly as today, so this is a pure data-driven refactor
  with no observable change. The real scientific values are recorded as
  reference; *adopting* them into the sim (normalized `simDensity` into movement,
  `specificHeat` into thermal) is a deliberate, separately-verified step in a
  later phase, not bundled into this framework refactor. The CA water / sink /
  soak / cohesion / gas behavior, phase chains, and explicit reaction tables are
  untouched.

**Outcome:** identical behavior (verified), but adding a liquid/gas/powder/
flammable material is now pure data — no shader edits — and every material now
carries its real scientific properties as the basis for later phases.

### Phase 2 — Generic interaction engine (separate spec/plan)

Generic corrosion/dissolving from flags+params; fully data-driven phase
transitions (retire the hand-unrolled water/lava chains); fold the generalizable
acid behavior into generic rules while keeping the irreducible bits in the
override table; viscosity-driven per-liquid flow.

### Phase 3 — Material library (separate spec/plan)

Add many new scientifically-grounded materials (oil, salt, various metals,
organics, gases…) — pure data. The payoff.

## Testing (Phase 1)

Follows the repo's pure-TS-mirror pattern (`thermal.ts`/`wetSand.ts` ↔ shader):

- **Unit (vitest):** the density-normalization function (monotonic; preserves
  the existing orderings; fills the range); the flag-bitfield packing
  (`buildMaterialFlags` produces the right bits per material); the migrated
  material table (every material has a valid form/phase/origin; flammables have
  ignitionTemp+burnProduct; the buffer serializers emit the expected layout).
  The WGSL bit/param decoding mirrors these.
- **e2e (Playwright) + in-browser:** existing scenarios behave identically —
  sand falls, water levels/sinks/soaks, gas plumes, Wood ignites near Fire/Lava
  and turns to Fire (now via the generic rule). No console errors. Because the
  shader is edited, drive it in a real browser (headed `channel:'chrome'`;
  headless has no adapter) and confirm no "Invalid ComputePipeline".

## Risks

1. **Behavior drift from new density values.** Real-normalized `simDensity` must
   preserve the existing sink/float orderings (sand sinks in water, wet-sand
   tiers ordered, acid/lava/copper-sulfate denser than water). The normalization
   is tuned and unit-tested against these orderings; verify in-browser.
2. **Buffer-layout change is invasive.** It touches `simulation.ts` buffer
   allocation + every shader property read (`density`/`conductivityOf`/
   `heatCapacityOf`) and adds the flags buffer/bind. Do it as a careful,
   behavior-preserving refactor; the e2e + in-browser check is the guard.
3. **WGSL has no compile-time validation** (typecheck/build don't catch it) —
   bit-field decoding and the new buffer bindings must be verified in a real
   browser, watching the console for "Invalid ComputePipeline / CommandBuffer".
4. **Must not regress the merged CA water / soak / gas work.** Phase 1 changes
   only the class predicates + flammability; the water-substep, soak, cohesion,
   and gas-gate logic stay byte-for-byte. Verify all still work.

## Relationship to prior work

Builds directly on `master` (the CA water + sink + soak + gas-plume work). The
material buffer already exists (`materialProperties()` → `materials`); Phase 1
expands it and adds the flags buffer. The reaction/threshold tables and
phase-transition chains are the model the override table and Phase 2's generic
engine extend.
