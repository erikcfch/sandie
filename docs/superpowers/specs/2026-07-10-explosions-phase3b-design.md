# Explosions — Phase 3b Design Spec

**Date:** 2026-07-10
**Status:** ✅ DONE — implemented + GPU-verified on branch `material-explosions`
**Branch:** `material-explosions` (off `master`)
**Parent:** Phase 3 program — `docs/superpowers/specs/2026-07-10-material-library-phase3-design.md` (3b)

## As built (2026-07-10)

Implemented subagent-driven (7 tasks, each spec/quality-reviewed + in-browser
verified; opus whole-branch review). The pressure field is a canonical
`pressureField` buffer + `pressureNext` scratch with a per-frame copy-back; the
`blast` pass is a separate **in-place** pass (own bind-group layout, single
read-write grid) so it does NOT disturb the existing ping-pong parity; only
`movement` gained a read-only pressure binding. Detonation uses the **proxy
temperature** and a chainless `blastProductEnthalpy` (never the chain walk) — no
grid wipe. Verified in headed Chrome: TNT detonates + chain-consumes a block;
destroy converts inert→Smoke (the surrounding lava→Smoke plume — an unambiguous
inert-destroy signal, since lava has no other path to smoke); ignite→Fire; the
`movement` fling launches loose material outward/up; idle movement is byte-
identical (no fling when pressure≈0). 167 unit tests, typecheck, build green;
6/7 e2e behavior tests pass (the 1 failure — profiler backtick toggle — is
pre-existing/unrelated, identical to master).

**Tuned constants (game-balance, tuned in-browser):** `BLAST_DECAY=0.72`,
`BLAST_DIFFUSE=0.5`, `DESTROY_PRESSURE=12`, `CHAIN_PRESSURE=8`, `IGNITE_PRESSURE=4`,
`FLING_PRESSURE=3`. **TNT:** `detonationTemp=190` (safely above the 150 ambient-max
so no spontaneous detonation; detonates when engulfed in sustained fire/lava —
a thin/brief heat source will NOT set it off, which is acceptable), `ignitionTemp=280`
(> detonationTemp so detonation wins over burning), `blastStrength=200`,
`thermalConductivity=0.6`, `burnProduct=Fire`.

**Controller adjudications of the final movement-pass review (both plan-mandate-
conflicting QUALITY findings, not correctness — race-freedom + idle-identical both
hold):** (1) *2-cell fling near a blast core* — ACCEPTED: the Margolus block is
conservative (no duplication/race), the primary fling isn't undone, and fast fling
near a core suits a blast; restructuring the critical movement pass risked a
base-movement regression. (2) *no hash-roll scatter on the fling* — DECLINED as
optional polish: the strong uniform fling reads as forceful displacement and the
brief's own concrete code omitted the roll. Both are noted for future feel-tuning.

**Kept:** the faint pressure tint in `render.wgsl` as a subtle shockwave glow
(invisible when pressure≈0, i.e. outside blasts).

## Motivation

The material library (3d) needs explosives to feel explosive. Phase 3b adds a
**blast primitive**: a pressure-field shockwave that flings loose material
outward, destroys terrain, and ignites/detonates what it touches — all through the
existing race-free CA, with products decided per-material by what's actually
burning. Phase 3a is the last pure-data phase; 3b is the first of the two new
*mechanisms* (3b explosions, 3c electricity) and carries real shader risk.

## Decisions locked in brainstorming (2026-07-10)

- **Model:** shockwave with displacement — a diffusing **pressure field**, not a
  simple convert-in-place fireball. Loose material is flung outward as the wave
  passes.
- **Trigger:** heat/fire — an `explosive` cell detonates when it reaches its
  `detonationTemp` (from fire, lava, or a neighbouring blast). Gunpowder etc. are
  also `flammable`, so fire spreads cell-to-cell (an emergent fuse) before each
  grain detonates. Electricity (3c) later becomes just another heat/spark source.
- **Terrain:** fully destructible — any cell whose local blast pressure exceeds a
  **global** `DESTROY` threshold is destroyed (no per-material resistance; reach
  is set by the charge's `blastStrength` decaying with distance).
- **Products are material-driven — Fire only ever comes from genuine combustion:**
  - the explosive itself → its own `burnProduct` (TNT → Fire),
  - a flammable caught in the blast → **its own** `burnProduct` (wood → Fire; oil/
    gasoline/methane in 3d → their own sootier/cleaner products — the blast routes
    through the existing param, so it's correct for free),
  - inert material destroyed by the blast → **Smoke** (a dust puff → clean crater),
    never Fire; inert loose material below the destroy threshold is displaced.
- **Demo material:** one new explosive — **TNT** — proves the mechanism (like Wax
  proved 2b). The full explosive roster (gunpowder, methane deflagration, gasoline
  vapor) is 3d data.

## New state

- **`explosive` capability flag** → `materialFlags` bit 8 (bits 0–7 are taken:
  form 0–1, flammable 2, corrosive 3, soluble 4, conductive 5, organic 6, metal 7).
- **Per-material params** in the `materials` buffer's two free float slots (14, 15):
  `detonationTemp` and `blastStrength` (peak pressure injected on detonation).
  Blast *radius* is emergent (strength diffuses + decays until it drops below the
  effect thresholds).
- **`pressure: array<f32>`** — a new GPU buffer, one f32 per cell, **double-
  buffered** and ping-ponged in lockstep with the cell grid (diffusion reads
  neighbours + writes self, exactly like the `heat` pass's enthalpy field). Bound
  to the sim passes that read/write it.

## Passes

One new pass, one modified, plus the new buffer. Frame order (existing): `paint`,
`TICKS_PER_FRAME × (movement, heat)`, `soak`, `corrode`, `LIQUID_SUBSTEPS ×
liquidMovement`. The `blast` pass is inserted after `heat`.

### New: `blast` pass (diffuse pressure + apply effects)

Per cell, race-free (reads its cell + neighbour pressures, writes only its own
cell + own pressure — the `heat`-pass shape, no swaps):

1. **Detonation.** If `isExplosive(id)` and the cell is hot enough OR already
   pressed hard enough — detonate: the cell becomes its `burnProduct` (Fire) and
   `blastStrength` is injected into its pressure. Two triggers:
   - heat: proxy temperature `enthalpy / heatCapacityOf(id) ≥ detonationTemp`,
   - chain: local pressure `≥ CHAIN_THRESHOLD` (a neighbouring blast sets it off).
   - **CRITICAL (Dawn/WGSL codegen bug, see [[project_wgsl_chainwalk_codegen_bug]]):**
     the heat trigger uses the **proxy** temperature `enthalpy/heatCapacityOf(id)`,
     NOT the chain-walk `thermalFromEnthalpy`. Calling the chain walk from a pass
     other than `heat` wiped the whole grid to Empty in 2c. `detonationTemp` is a
     monotonic threshold, so the proxy is sufficient (tuned in proxy space).
2. **Diffusion + decay.** `newPressure = DECAY · (this + neighbours weighted) +
   injected`, with `DECAY < 1` so a blast is a brief expanding shock that falls to
   zero within a few ticks (finite range, not permanent).
3. **Effects by local pressure** (product decided by what the cell IS):
   - `≥ DESTROY_THRESHOLD`: destroyed. **Flammable/explosive → its `burnProduct`**
     (combustion); **inert → Smoke** (pulverised dust), never Fire. Re-encode
     enthalpy for the new element via `enthalpyForNewElement` (carry temperature),
     as the reaction/corrode passes already do.
   - `≥ IGNITE_THRESHOLD` and `isFlammable`: ignite → its `burnProduct` (respects
     each fuel's own product; below `DESTROY` this is the ignition ring).
   - `≥ DISPLACE_THRESHOLD` and loose (powder/liquid/gas) and inert: leave the cell
     but let `movement` fling it (step below). Water etc. may also vaporise to
     Steam near `DESTROY`.
   - static solids that survive (pressure `< DESTROY`) are unchanged (barriers hold
     for weak blasts; strong ones destroy them per the destructible-terrain
     decision).

### Modified: `movement` pass (pressure-biased displacement — the fling)

`movement` already does race-free density/gravity swaps via the Margolus 2×2 block
CA. It gains a pressure read: a loose cell sitting in a pressure gradient prefers
swapping **down-gradient** (outward, away from the blast) instead of only falling.
When pressure is low it behaves exactly as today (gravity). This reuses the
existing race-free block-swap machinery — the pressure only biases *which* swap the
block owner chooses — so no new race surface. This is the trickiest piece and is
built **last**.

## Product model (summary table)

| Cell the blast hits | Becomes | Mechanism |
|---|---|---|
| The explosive (detonating) | its `burnProduct` (TNT → Fire) | existing `burnProduct` |
| A flammable (wood; 3d: oil/gasoline/methane) | its **own** `burnProduct` | existing `burnProduct` (material-specific) |
| Inert loose (sand) below DESTROY | displaced/flung | pressure-gradient swap |
| Inert loose (water) near DESTROY | Steam / displaced | vaporise |
| Inert (sand/stone/glass/metal) ≥ DESTROY | **Smoke** (dust) | global destroy threshold |
| Another explosive in the wave | detonates → its `burnProduct` | CHAIN_THRESHOLD |

**Fire is only ever combustion.** Inert destruction yields Smoke/dust, never Fire.

## Constants (initial; tuned in-browser)

`DESTROY_THRESHOLD`, `IGNITE_THRESHOLD`, `DISPLACE_THRESHOLD` (ordered
DESTROY > IGNITE ≳ DISPLACE), `CHAIN_THRESHOLD`, `DECAY` (≈0.6–0.8), a diffusion
weight, and per-material `detonationTemp` / `blastStrength` for TNT. All are
game-balance values (documented, tuned live), same spirit as `WOOD_IGNITE_POINT`.

## Demo material (3b)

- **TNT** — `static`, `explosive`, `flammable` (so fire lights it), high
  `blastStrength`, moderate `detonationTemp`, `burnProduct` = Fire. Chem or physical
  family (no formula needed). Proves detonation, destruction, chain-detonation
  (adjacent TNT), ignition (nearby Wood), and displacement (surrounding Sand flung).

## Testing

Follows the pure-TS-mirror pattern where math is factorable:
- **Unit (vitest):** a pure `blast.ts` (or extend an existing leaf) mirroring the
  pressure diffusion+decay update and the threshold→effect decision, tested for
  monotonic decay, finite range, and correct product selection per cell class;
  `explosive` flag packing (bit 8); TNT has valid params.
- **In-browser (headed Chrome) — authoritative:** built incrementally (see Risk).
  Final scene: light TNT with fire → detonates; surrounding Sand flung + craters;
  nearby Wood ignites (→ Fire, not forced); adjacent TNT chain-detonates; Stone
  destroyed to Smoke dust near the core; Stone-bowl detector confirms **no grid
  wipe**; heat map stays sane; zero console errors.
- **e2e (Playwright):** a smoke test (detonate TNT, assert no errors) where a
  concurrent-session-free port allows.

## Risk & incremental build order

Highest-risk sub-phase: a new buffer + new pass + `movement`/enthalpy edits → the
Dawn codegen/grid-wipe hazard. Mitigation — build strictly incrementally, each step
Stone-bowl-verified in fresh headed Chrome before the next:

1. Add the `pressure` buffer + bindings, inert (written 0, unread). Verify no
   change / no wipe.
2. `blast` pass: detonation only (proxy-temp trigger → TNT becomes Fire + inject
   pressure) + render pressure as a debug tint. Verify detonation + injection.
3. Diffusion + decay. Verify the pressure blob expands then fades to zero.
4. Effects: destroy (inert → Smoke), ignite (flammable → burnProduct), chain-
   detonate. Verify crater + ignition + chain, no wipe.
5. `movement` pressure-gradient displacement (the fling). Verify Sand flung
   outward; gravity unaffected when idle.

## Out of scope for 3b

- The explosive roster beyond TNT (gunpowder, methane deflagration, gasoline
  vapor) — 3d data.
- A falling **Debris/rubble** powder for destroyed solids — inert destruction is
  Smoke for now; rubble is an optional 3d material.
- Electric detonation — 3c wires an electric spark in as another heat source.
- True pressure *physics* (blast waves reflecting off walls, overpressure) beyond
  the diffuse-and-decay field.
