# Material Library — Phase 3 Design Spec

**Date:** 2026-07-10
**Status:** Approved shape; sub-phase 3a scoped for implementation next
**Branches:** one per sub-phase off `master` (`material-values`, `material-explosions`, `material-electricity`, `material-library`)

## Motivation

Phases 1–2 built the data-driven material *engine*: taxonomy axes + capability
flags + typed behavior params in GPU buffers, a generic corrosion pass, generic
data-driven phase transitions, generic contact/threshold reactions, and
temperature-dependent viscosity. Adding a liquid/powder/gas/flammable/corrosive/
soluble material that melts, boils, or reacts is now **pure data** — zero shader
edits (confirmed: every GPU buffer and reaction count is derived from
`ELEMENTS.length` / the reaction-table lengths; the toolbar auto-generates from
`ELEMENTS`).

Phase 3 spends that engine: a **focused, high-impact material library** where
every new material lights up an existing mechanism *or* one of two new ones, and
several interact with each other. It also cashes in two pieces the master spec
deliberately deferred: **adopting the real scientific values into the sim**, and
**two new interaction mechanisms** (explosions, electricity) that the library
needs to feel alive.

## Decisions locked in brainstorming (2026-07-10)

- **Library size:** focused high-impact (~12–14 materials), curated for
  interaction, not breadth. More batches can follow.
- **Values:** *adopt* normalized real values into the sim (the master spec's
  deferred "later phase") — sim `density` derived from `realDensity` via a
  monotonic log-normalization; thermal from `specificHeat`. New materials then
  specify only real values.
- **Mechanisms:** add **both** explosions and electricity.
- **Sequencing:** four independent sub-phases, each its own branch / spec / plan
  / in-browser verify / `--no-ff` merge, in order **3a → 3b → 3c → 3d**. Isolates
  the behavioral-regression refactor (3a) from the new shader logic (3b, 3c), so
  a grid-wipe is bisectable to one sub-phase.
- **Implementation style:** subagent-driven development (fresh implementer
  subagent per task, TDD, controller verifies each in headed Chrome), matching
  every prior phase.

## Risk posture (carried from prior phases)

- **WGSL is not validated by typecheck/build.** Drive every shader change in
  headed Chrome (`channel:'chrome'`, `--enable-unsafe-webgpu`; headless has no GPU
  adapter). The Stone-bowl test is the grid-corruption detector.
- **Dawn/WGSL codegen hazard** (see `project_wgsl_chainwalk_codegen_bug`): certain
  loop/early-return shapes in certain passes silently wipe the grid to Empty with
  no console error. 3b and 3c add new passes/logic and must be built incrementally
  and verified continuously. 3a is TS-only (no new shader control flow) so it is
  *not* exposed to this hazard — its risk is behavioral regression only.
- **Vite HMR is unreliable across `git checkout`s** — restart the dev server fresh
  per branch/observation. Ports 5173–5175 are usually taken by concurrent
  sessions → lands on 5176.

---

## Sub-phase 3a — Values adoption (TS-only, foundational) — ✅ DONE (2026-07-10, branch `material-values`)

**Goal:** the sim *derives* movement density and thermal capacity from each
material's real scientific values, instead of hand-tuned game numbers. Purely a
data change — the shader still reads `density(id)` / `heatCapacityOf(id)` exactly
as today; only the numbers in the buffer change. **No new WGSL control flow.**

**As built (decisions locked during implementation + in-browser verification):**
- New pure leaf `src/density.ts`: `normalizedDensity(realDensity)` (monotonic log
  map, **no rounding** — float, so near-equal densities stay strictly ordered) +
  `simDensity(form, realDensity)`. Constants: `SIM_DENSITY_LO=1`,
  `SIM_DENSITY_HI=95`, `DENSITY_LOG_MIN=-4.1`, `DENSITY_LOG_MAX=1.3`,
  `BARRIER_DENSITY=100`.
- **Static-barrier rule (key correctness fix):** static solids are barriers only
  because their old game density was 90–100; real densities would let sand sink
  through wood/ice and lava leak through stone. So `simDensity` gives static
  solids the `BARRIER_DENSITY` sentinel (Empty → 0) and only movable
  (powder/liquid/gas) materials derive from real density. Barrier integrity
  verified (max movable 84.89 < 100), confirmed in headed Chrome (sand rests on
  wood + ice).
- The `density` and `heatCapacity` hand-tuned `ElementDef` fields were **removed**;
  `realDensity` and `specificHeat` are now required and are the single source of
  truth (`materialProperties()` derives the buffer values; `thermal.ts` /
  `phaseTransitions.ts` read `specificHeat`).
- **User decision (lava-powder flip):** ACCEPT — sand/powders float on lava under
  real densities (molten rock is denser); no per-material override added.
- Verified in headed Chrome: barriers hold, sand floats on lava, no grid wipe, no
  console errors; heat map decodes correctly (grey ambient / red lava / blue ice)
  and phase chains fire (Ice→Water→Steam, Lava→Stone). 156 unit tests green,
  typecheck + build clean, 6/7 e2e behavior tests pass (the 1 failure — profiler
  backtick toggle — is pre-existing and unrelated, identical to master).

### Density normalization

Movement compares `density(a)` vs `density(b)` (denser sinks / displaces). Real
densities span ~4.5 orders of magnitude (Fire ≈ 3e-4 g/cm³ → Gold 19.3), so a
**monotonic log map** into the game range preserves ordering without extreme
ratios:

```
normalizedDensity(ρ) = clamp( LO + (log10(ρ) - LOG_MIN) / (LOG_MAX - LOG_MIN) * (HI - LO), LO, HI )   // no rounding — stays float
```

with `LOG_MIN=-4.1`/`LOG_MAX=1.3` spanning the real range and `[LO, HI]=[1, 95]`
the movable band (kept below `BARRIER_DENSITY=100`; static solids use that
sentinel, Empty stays 0). The function is a pure, unit-tested leaf (`density.ts`,
mirroring `viscosity.ts`/`thermal.ts`).

**Expected behavior changes to verify + accept-or-clamp (regression surface):**
Most orderings are preserved (gas < liquid < powder/solid follows real density),
but real values *correct* a few hand-set ones — e.g. **Sand (1.6) now floats on
Concentrated/Fuming acid (1.83/1.90)** where today it sinks. 3a's verification
enumerates every movement-relevant pair whose ordering flips and the controller
decides per pair: accept (more realistic) or nudge. This list is the core
deliverable of 3a's own spec.

### Thermal adoption

`heatCapacity` → use `specificHeat` directly (already the same units/scale;
Water 4.0 → 4.18, etc.). Because the enthalpy model and the `chains` buffer are
built from `heatCapacity`, the phase-transition boundary temperatures must be
re-verified (Ice→Water→Steam, Stone↔Lava, Wax↔Molten Wax) — the *plateau temps*
are data (unchanged) but the enthalpy-per-degree slope shifts.

### Verification (3a)

Re-verify **all 28 existing materials** in headed Chrome: movement stratification
(gas rises, powders sink through liquids, buoyancy swaps), the full thermal chain
set, corrosion, reactions, viscosity flow. Unit tests: normalization is monotonic,
maps Empty→0, fills the range, and a golden table of every material's derived
`density`/`heatCapacity`.

---

## Sub-phase 3b — Explosions (shader)

**Goal:** a blast primitive so explosives feel explosive.

- **New capability flag** `explosive` (bit 8) + params (`blastRadius`,
  `blastStrength`) on the `materials` buffer.
- **Trigger:** an `explosive` cell whose temperature crosses its ignition point
  (from Fire, heat, or — after 3c — an electric spark) detonates.
- **Effect:** a radial blast over `blastRadius` that (1) displaces loose cells
  (powder/liquid/gas) outward, (2) ignites `flammable` neighbors, (3) converts the
  epicenter to Fire/Smoke. `static` solids resist (optionally chip to a rubble
  powder at high strength). Strength/radius are per-material.
- **Model choice (to settle in 3b's spec):** simplest race-free form is a
  block-CA or single-pass "pressure stamp" — a detonating cell writes an outward
  impulse read by neighbors next tick — rather than a true pressure field. Built
  incrementally with continuous Stone-bowl checks.

**Materials that use it:** Gunpowder, TNT, Methane (deflagration when it meets
Fire), Gasoline vapor.

---

## Sub-phase 3c — Electricity (shader)

**Goal:** current flows through conductors, activating the dormant `conductive`
flag.

- **Model:** a per-tick propagation pass. A `charged` bit spreads from a
  `source` cell (Battery) to adjacent `conductive` cells; decays with distance /
  needs a path (optionally toward a ground/sink). Non-conductors block it.
- **Conductors:** metals (Copper existing, + Iron, Gold, Aluminum), and **Salt
  Water** (pure Water weakly / not — a nice reason to make Salt Water its own
  material). Gold is the best conductor (contrast: inert but conductive).
- **Effects of charge:** heats the wire (ohmic), can ignite adjacent `flammable`,
  and can **detonate** `explosive` cells → ties 3b and 3c together (electric
  detonation of TNT).
- **Source/sink:** a `Battery` source cell; ground can be the grid floor or a
  dedicated sink. Details in 3c's spec.

**Materials that use it:** Iron, Gold, Aluminum, Copper (existing), Salt Water,
Battery.

---

## Sub-phase 3d — The library (~12–14 materials, pure data)

Each row is a `ElementDef` (real values only, per 3a) plus optional data rows in
`phaseTransitions.ts` / `reactions.ts` / `thresholdReactions.ts`. No shader edits.

| # | Material | Form | Hooks | Interaction |
|---|----------|------|-------|-------------|
| 1 | Oil | liquid | flammable | floats on water (ρ≈0.9<1), burns |
| 2 | Gasoline | liquid | flammable, volatile | low ignition; evaporates → flammable vapor |
| 3 | Alcohol (Ethanol) | liquid | flammable | clean burn; ρ≈0.79 |
| 4 | Gunpowder | powder | flammable, **explosive** | Fire → fast burn → blast |
| 5 | TNT | static | **explosive** | detonates from heat *or* electric spark |
| 6 | Coal | powder | flammable | slow, hot, steady burn (feeds fire) |
| 7 | Methane | gas | flammable | rises; meets Fire → deflagration |
| 8 | Iron | static | metal, **conductive** | rusts → existing Rust; conducts; melts |
| 9 | Gold | static | metal, **conductive** | dense, inert, best conductor |
| 10 | Aluminum | static | metal, **conductive** | + Rust + heat → **thermite** (exothermic → Iron) |
| 11 | Glass | static | phase transition | Sand melts → Glass at high temp |
| 12 | Sodium | powder | **contact reaction** | + Water → Fire + Hydrogen (violent) |
| 13 | Salt Water | liquid | conductive | Salt + Water → conductive liquid |
| 14 | Battery | static | electricity **source** | powers electricity |

**Reaction data this implies (all table rows, no shader edits):**
- **Thermite:** `Aluminum + Rust (hot) → Iron`, large exothermic `enthalpyDelta`
  (contact reaction). (Iron is a *product*, so id ordering must let Rust→Iron and
  Iron→Rust coexist.)
- **Sodium + Water → Fire (+ Hydrogen):** contact reaction, exothermic; showcases
  a violent metal.
- **Iron rusting:** `Iron + Water/Oxygen → Rust`, slow (contact or threshold).
- **Sand → Glass:** phase-transition (or threshold) at high temp.
- **Salt Water:** `Salt + Water → Salt Water` (replaces Salt's current
  dissolve-to-Empty when the neighbor is Water; or a dedicated contact rule).
- **Gasoline vapor:** threshold reaction Gasoline → Gasoline Vapor (flammable gas)
  above a low temp.

### Verification (3d)

Paint-and-observe each material in headed Chrome: oil floats + burns, gunpowder
blasts, TNT detonates by heat and by spark, thermite flares, sodium reacts with
water, sand melts to glass, methane rises and deflagrates, current lights a wire.

---

## Testing strategy (all sub-phases)

Follows the repo's pure-TS-mirror pattern (`thermal.ts`/`viscosity.ts` ↔ shader):
- **Unit (vitest):** normalization (`density.ts`) monotonic/range/golden table;
  new flag packing (`explosive`); electricity/blast pure helpers where factorable;
  every new material has a valid form/phase/origin and consistent flags/params.
- **In-browser (headed Chrome):** the authoritative check for anything the shader
  runs — regression sweep in 3a, mechanism behavior in 3b/3c, per-material in 3d.
- **e2e (Playwright):** smoke per sub-phase where a concurrent-session-free port
  allows (chem materials render "name (formula)", so match non-exact).

## Out of scope for Phase 3

- A large breadth library (this is a focused batch; more materials later).
- Pressure/gas-diffusion physics beyond the blast impulse.
- Full circuit semantics (logic gates, resistance networks) — 3c is basic
  current + heat + ignition only.
