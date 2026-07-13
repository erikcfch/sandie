# Material Library: Metals — Phase 3d-2 Design Spec

**Date:** 2026-07-12
**Status:** ✅ Built + GPU-verified on branch `material-metals` (see as-built addendum)
**Branch:** `material-metals` (off `master`)
**Parent:** Phase 3 program — `docs/superpowers/specs/2026-07-10-material-library-phase3-design.md` (3d)

## As-built addendum (in-browser verification, 2026-07-13)

The four metals, the Iron↔Molten Iron melt chain, iron-rusting and the electricity
tie all verified in headed Chrome (WebGPU): correct render, metals conduct like
Copper (short wire — the 3c reachability only spans ~100 cells), no grid wipe, no
console errors. Two findings changed the plan's "zero shader edits" scope:

1. **Dawn/WGSL codegen bug — the one shader edit.** Molten Iron is the first
   PHASE-CHAINED element ever used as a contact-reaction product. Assigning a
   chained product to `result.elementId` from *inside* the nested reaction loop in
   `simulate.wgsl heat()` silently miscompiled under Dawn — the grid write no-op'd,
   so thermite never fired (while every prior reaction, all with chainless products,
   worked). Root-caused by shader instrumentation; **fixed by hoisting the product
   assignment out of the loop** (contact + threshold loops both). Same codegen-bug
   family the codebase already dodges with the `fluidityAt` proxy (simulate.wgsl
   ~371). Cross-checked: existing reactions (Copper+Acid) and phase transitions
   (Ice→Water) still fire. Verified: thermite now flares to molten iron.

2. **Thermite `minTemperature` 300 → 160 (tuning).** In-browser, lava cools to
   stone in ~2 s, so it can't sustain-heat the aluminium-adjacent rust near 300;
   160 is reachable where lava touches the mix. 160 stays above `MAX_AMBIENT` (150)
   so a hot source is still required. `chance` also raised 0.08 → 0.15 so the
   cascade builds before the fresh molten iron drips away. Ignition is
   heat-delivery-limited (a well-mixed rust+aluminium pile with lava in good
   contact flares; a thin/sparse mix only smoulders) — the same character as coal
   (3d-1) and TNT (3b).

## Motivation

The second 3d sub-batch: conductive metals that light up 3c electricity circuits,
plus the rust/thermite chemistry. Pure data — new `ElementDef` rows + two
`CONTACT_REACTIONS` rows (iron rusting, thermite) + one `PHASE_TRANSITIONS` row
(iron ↔ molten iron). **Zero shader edits** (the generic electricity, contact-
reaction, and phase-chain engines already handle these). Builds on 3d-1 fuels
(merged); precedes 3d-3 reactive.

## Roster (new `ElementDef` rows, ids from 38)

Iron/Gold/Aluminium are `metal`, `conductive`, `static` → they work as **wires in
3c circuits** (Battery→metal→Ground energises + ohmically heats, exactly like
Copper). Gold is the best conductor. Real reference values; density adopted into
movement (3a).

| Material | id | form | realDensity | specificHeat | thermalConductivity | conductive | notes |
|----------|----|------|-------------|--------------|---------------------|------------|-------|
| Iron | 38 | static | 7.87 | 0.45 | 0.7 | yes | rusts in water; melts → Molten Iron; thermite product |
| Molten Iron | 39 | liquid | 7.0 | 0.82 | 0.6 | no | hot (~1550 °C), oozes, cools → Iron |
| Gold | 40 | static | 19.3 | 0.13 | 0.95 | yes | dense, inert, best conductor |
| Aluminium | 41 | static | 2.7 | 0.90 | 0.8 | yes | thermite: + Rust → Molten Iron |

- Colours (approx): Iron grey-steel `[112,110,116]`; Molten Iron hot orange
  `[255,140,45]`; Gold `[235,195,60]`; Aluminium silver `[196,200,206]`.
- Molten Iron: `phase: 'liquid'`, `defaultTemp` ≈ 1550, a viscosity curve
  (`viscosityRefLog10 ≈ 0.5`, thin liquid metal). It is the hot end of the Iron ↔
  Molten Iron phase chain (below), so it cools back to solid Iron. Left
  **non-conductive** (a transient hot liquid; solid Iron carries current) to avoid
  a moving-conductor edge case in the electricity pass.
- Gold `metallic: 'metal'` + very high `thermalConductivity` (0.95) — the "noble,
  inert, best conductor" contrast. No reactions.
- Family: metals are `family: 'chem'` with a `formula` (Fe / Au / Al) — they fit
  the Chem toolbar group with the acids/copper. **Consequence:** their toolbar
  buttons render as "name (formula)", so e2e/Playwright must **non-exact** match
  them (like Copper). Molten Iron has no formula.

## Reactions & phase (data rows)

- **Iron rusting** (`CONTACT_REACTIONS`): `Iron + Water (catalyst) → Rust`, very
  slow (`chance ≈ 0.002`, no `minTemperature` → any temp), `enthalpyDelta: 0`.
  Iron left in water slowly corrodes to the existing Rust (id 24).
- **Thermite** (`CONTACT_REACTIONS`): `Rust + Aluminium (catalyst) → Molten Iron`,
  **strongly exothermic** (`enthalpyDelta` large, e.g. 300), `minTemperature ≈ 300`
  (needs an ignition source to start), `chance ≈ 0.08`. The classic
  `2Al + Fe₂O₃ → 2Fe + heat`: hot rust next to aluminium reduces to **molten iron**
  and dumps heat, which sustains the reaction and can melt/ignite neighbours.
  Aluminium is modelled as the catalyst (unchanged) — a simplification (real
  thermite consumes it); the headline effect (rust + aluminium + spark → molten
  iron + intense heat) is what matters.
- **Iron ↔ Molten Iron** (`PHASE_TRANSITIONS`): `{ low: Iron, high: Molten Iron,
  boundaryTemp: 1500, latentHeat: 250 }`. Realistic (~1538 °C) — **above Lava's
  800 °C**, so lava does NOT melt solid iron; **thermite is the main path to molten
  iron** (it produces it directly). Molten Iron cools back through the plateau to
  solid Iron. Reuses the 2b chain engine (Molten Iron gets `chainStart`/`chainCount`
  automatically).

## Testing

- **Unit (vitest):** each metal has a valid `form`/`phase`/`origin: 'inorganic'`/
  `metallic: 'metal'`; Iron/Gold/Aluminium are `conductive`; ids 38–41 contiguous;
  the iron-rusting + thermite `CONTACT_REACTIONS` rows exist (correct
  reactant/catalyst/product); the Iron↔Molten Iron `PHASE_TRANSITIONS` row exists
  with `boundaryTemp > Lava's Stone→Lava boundary` (so lava can't melt iron);
  Gold's `thermalConductivity` is the highest among conductors.
- **In-browser (headed Chrome) — authoritative:** wire `Battery — Iron/Gold/
  Aluminium — Ground` and confirm the metal wire **lights up (cyan) and warms**
  like Copper (electricity payoff); leave Iron in Water → it slowly rusts; put
  Aluminium next to Rust and ignite (Lava/Fire) → **thermite flares to molten iron
  + intense heat**; drop Molten Iron and watch it ooze and cool to solid Iron;
  Stone-bowl detector — no grid wipe; heat map sane; zero console errors.
- **e2e (Playwright):** a metals smoke test (a metal circuit + a thermite setup;
  assert no errors) — **non-exact** button names (Iron/Gold/Aluminium carry a
  formula).

## Out of scope for 3d-2

- Reactive materials (gunpowder, sodium, glass, salt water) — **3d-3**.
- Molten Gold / molten aluminium (only iron melts here).
- Electrical resistivity differences between metals beyond `thermalConductivity`
  (the reachability model is boolean LIVE, not per-metal resistance).
- A correct two-product thermite (Iron + slag) — aluminium stays as catalyst.
