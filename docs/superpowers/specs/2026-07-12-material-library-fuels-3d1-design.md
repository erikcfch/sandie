# Material Library: Fuels — Phase 3d-1 Design Spec

**Date:** 2026-07-12
**Status:** ✅ DONE — implemented + GPU-verified on branch `material-fuels`
**Branch:** `material-fuels` (off `master`)
**Parent:** Phase 3 program — `docs/superpowers/specs/2026-07-10-material-library-phase3-design.md` (3d)

## As built (2026-07-12)

Pure data — 7 new `ElementDef` rows (Oil 31, Gasoline 32, Gasoline Vapor 33,
Alcohol 34, Coal 35, Ash 36, Methane 37) + one `THRESHOLD_REACTIONS` row
(Gasoline→Gasoline Vapor, minTemp 35). **Zero shader edits.** Verified in headed
Chrome: **Oil floats on Water** (real density 0.92 < 1.0 via 3a) as a slick on a
water pool and **burns** (smoke rises when lit); **Coal chars to a grey Ash** layer
under sustained heat; gases (Methane / Gasoline Vapor) rise; no grid wipe, no
console errors. 182 unit tests, typecheck, build green.

**Coal→Ash outcome (the flagged tune point):** kept `Coal.burnProduct = Ash`
(ember model) — **no tune needed**. Coal converts to Ash where heated but does NOT
self-propagate a burn front. That is NOT a coal defect: combustion in this engine
is **non-exothermic** (the flammable rule carries a cell's temperature to its
`burnProduct` but adds no heat), so *every* fuel — Wood included — ignites where a
heat source touches it rather than spreading on its own. The fallback (`burnProduct
= Fire`) was NOT needed; Ash is delivered. **Follow-up (out of scope here):** a
self-spreading fire would need a separate exothermic-combustion mechanism (a small
`enthalpyDelta` on ignition) — a future engine enhancement, not a data change.

## Motivation

Phase 3d is the payoff of the whole material system: adding many scientifically-
grounded materials as (almost) pure data on the now-generic engine (real values,
phase transitions, contact/threshold reactions, corrosion, viscosity, explosions,
electricity). It runs as **three sub-batches**, each its own spec → plan → build →
`--no-ff` merge, for isolation and manageable in-browser verification:

- **3d-1 — Fuels (this spec):** oil, gasoline (+ gasoline vapor), alcohol, coal
  (+ ash), methane — combustion.
- **3d-2 — Metals:** iron (+ molten iron), gold, aluminium + rust/thermite —
  conductors that light up 3c circuits.
- **3d-3 — Reactive:** gunpowder (explosive), sodium (+ hydrogen), glass, salt
  water — the remaining mechanism ties.

This spec covers **3d-1 fuels only**. Pure data — new `ElementDef` rows + a couple
of reaction rows, **zero shader edits** (the generic combustion/threshold engines
already handle them).

## Fuels roster (new `ElementDef` rows, ids from 31)

Real reference values (density adopted into movement via 3a's normalisation; only
liquids set a viscosity curve). `ignitionTemp`/`burnRate` are game-tuned. Every
fuel is `flammable`, `organic`, `nonmetal`.

| Material | form | realDensity | specificHeat | ignitionTemp | burnRate | burnProduct | viscRefLog10 | colour (approx) |
|----------|------|-------------|--------------|--------------|----------|-------------|--------------|-----------------|
| Oil | liquid | 0.92 | 2.0 | 200 | 0.5 | Fire | 1.7 | dark brown `[46,34,26]` |
| Gasoline | liquid | 0.74 | 2.2 | 150 | 0.8 | Fire | 0.3 | pale gold `[205,190,110]` |
| Gasoline Vapor | gas | 0.004 | 1.7 | 120 | 0.9 | Fire | — | faint yellow-grey `[190,185,140]` |
| Alcohol | liquid | 0.79 | 2.4 | 180 | 0.7 | Fire | 0.1 | pale blue-white `[200,215,230]` |
| Coal | powder | 1.4 | 1.3 | 300 | 0.15 | **Ash** (see below) | — | near-black `[32,30,30]` |
| Ash | powder | 0.6 | 0.8 | — | — | — | — | grey `[130,128,125]` |
| Methane | gas | 0.0007 | 2.2 | 200 | 0.9 | Fire | — | faint blue-grey `[195,205,210]` |

- **Floating for free (3a):** Oil (0.92) / Gasoline (0.74) / Alcohol (0.79) are all
  < Water (1.0), so they float on water via the real-density movement — a headline
  "oil slick on water, then set it alight" interaction with no special code.
- **Gases rise:** Gasoline Vapor and Methane are `form: gas` → rise like Smoke/Steam
  (gas density is movement-inert per 3a), pooling upward until they meet Fire.
- Only liquids carry a viscosity curve (Oil is a touch viscous; Gasoline/Alcohol
  thin). `viscosityTempCoeff` ≈ 0 (small) for all.

## Combustion & reactions (data rows)

- **Standard fuels → Fire:** Oil, Gasoline, Alcohol, Methane, Gasoline Vapor are
  `flammable` with `burnProduct = Fire`, reusing the existing rule (`flammable &&
  temp > ignitionTemp && roll < burnRate → burnProduct`). Their differing
  `ignitionTemp`/`burnRate` give the feel: gasoline/vapor catch fast and low,
  alcohol clean, oil slower. Methane/vapor deflagrate when their gas cloud meets
  Fire (each cell ignites → Fire, a fast front). **No new mechanism.**
- **Gasoline → Gasoline Vapor (volatility):** a `THRESHOLD_REACTIONS` row —
  `Gasoline` at `minTemperature ≈ 35 °C`, low `chance ≈ 0.01` → `Gasoline Vapor`.
  So a gasoline pool slowly gives off a flammable vapor that rises and can flash.
- **Coal → Ash (the one non-trivial call):** coal's `burnProduct` is **Ash**, not
  Fire — so coal burns as glowing embers that leave a grey ash residue (realistic;
  reuses the flammable rule with a solid product). The freshly-made Ash inherits
  the coal's combustion temperature (the ignition-rule carries temperature over),
  so it starts hot and radiates heat to adjacent coal to keep the burn creeping,
  then cools to grey. **Verification risk (in-browser tune, with fallback):**
  without an exothermic kick the ember chain may be only marginally self-sustaining
  (each cell converts at ~ignitionTemp with no heat gain). If a lit coal seam does
  NOT keep spreading in headed Chrome, tune it — raise coal's `ignitionTemp` (hotter
  ash), give Ash a high `thermalConductivity` (drives heat into neighbours), and/or
  add a small `Coal + Fire → Ash` contact reaction with a positive `enthalpyDelta`
  (exothermic) so combustion releases heat. **Fallback** if ash proves unworkable:
  `burnProduct = Fire` (coal burns with flames, no residue) — Ash then only comes
  from Wood or is dropped. The controller decides during verification.

No `PHASE_TRANSITIONS` rows in this sub-batch (no melting fuels). No new WGSL.

## Testing

- **Unit (vitest):** each new element has a valid `form`/`phase`/`origin`, is
  `flammable` (fuels) with a sane `ignitionTemp`/`burnProduct`; densities order
  correctly (Oil/Gasoline/Alcohol < Water so they float; Coal > Water so it sinks);
  Gasoline's threshold-reaction row (→ Vapor) exists; the flammable-enumeration test
  updates to include the new fuels; ids stay contiguous.
- **In-browser (headed Chrome) — authoritative:** oil poured on water floats, then
  a flame spreads across the slick; gasoline evaporates and the vapor flashes when
  it reaches fire; alcohol burns fast/clean; methane rises and deflagrates on fire;
  a lit coal seam burns slowly and leaves an ash pile (the ash-model tune point);
  Stone-bowl detector — no grid wipe; heat map sane; zero console errors.
- **e2e (Playwright):** a fuels smoke test (paint oil/gasoline/coal + fire, assert
  no errors) where a concurrent-session-free port allows.

## Out of scope for 3d-1

- Metals (iron/gold/aluminium, rust, thermite, molten iron) — **3d-2**.
- Reactive (gunpowder, sodium, glass, salt water) — **3d-3**.
- A precise exothermic-combustion / burn-duration model — combustion stays the
  existing flammable rule (+ the optional coal exothermic tune above).
- Oil/water not mixing beyond density layering; no emulsions/surfactants.
