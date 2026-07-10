# Material System — Phase 2c: Temperature-Dependent Viscosity

**Date:** 2026-07-09
**Status:** Approved, ready for implementation planning
**Branch:** `material-viscosity` (off `master`)

## Motivation

Liquid flow in sandie is currently binary and hardcoded. The generic `movement`
pass moves every form (powder/liquid/gas) once per tick, and a **water-only**
`waterMovement` pass runs `WATER_SUBSTEPS` (12) extra substeps per frame that make
`WATER` — and only `WATER` (element id 3, hardcoded) — level fast and read as a
fluid. Every other liquid (Lava, Molten Wax, the four acids) moves solely through
the 3×/frame `movement` pass, so they barely spread: they all behave "thick" by
accident, and none of it is intentional or per-liquid.

Phase 2c makes flow a **per-liquid, temperature-dependent viscosity** — the last
big physical property still missing from the data-driven material system. Water and
the dilute acids flow freely and level flat; concentrated acid is a touch more
sluggish; Molten Wax oozes; Lava barely spreads and mounds. And because viscosity
is computed from each cell's **temperature** (reusing 2b's `thermalFromEnthalpy`),
the behavior is emergent and alive: superheated lava creeps faster, cooling lava
thickens and mounds and then **freezes to Stone via the 2b phase chain**; Molten
Wax is thickest just above its 60 °C melt point and runnier when hotter, then
resolidifies to Wax. Two independent systems (thermal + movement) produce real
lava/wax behavior with no special-casing.

## Design decisions (settled)

- **Viscosity governs both** horizontal leveling **and** vertical drip (thick
  liquids ooze downward slowly, not just spread slowly).
- **Fully realistic** ratios — derived from real dynamic viscosities and their real
  temperature dependence, log-normalized for the sim (consistent with the
  material system's "real values, normalized" decision; density is already
  log-mapped). Lava is genuinely ~10⁴–10⁷× thicker than water, so realistic Lava
  mounds and creeps rather than flowing freely — accepted.
- **Temperature-dependent** — viscosity is recomputed per liquid cell every tick
  from the cell's temperature via a per-material curve, not a fixed constant.
- **Mechanic:** a probabilistic **fluidity gate** (the recommended approach) — the
  same pattern the codebase already uses for gas dispersal (`GAS_DISPERSE_CHANCE`)
  and wet-sand cohesion (`diagonalSlideChance`), now per-liquid and
  temperature-driven. (Rejected: per-liquid substep budgets — poor fit to the
  global-pass model; a velocity/accumulator field — reintroduces the
  Eulerian complexity we deliberately abandoned.)

## The viscosity engine

### Fluidity from temperature

Define **fluidity `f ∈ [0, 1]`** — the per-tick probability that a liquid cell
takes an available move into empty space. `f = 1` means it moves essentially every
substep (water: snaps flat, drips immediately); small `f` means it moves rarely
(lava: mounds, oozes).

Fluidity is derived from a per-material **viscosity–temperature curve**, Arrhenius-
like in log space (viscosity falls roughly exponentially as temperature rises):

```
log10Visc(T) = refLogVisc + viscTempSlope * (T - T_ref)      // clamped to a sane band
f_raw        = 10 ^ (WATER_LOG_VISC - log10Visc(T))          // normalized so water ≈ 1
```

- `refLogVisc` — log₁₀ of the material's dynamic viscosity (in cP) at a reference
  temperature `T_ref`.
- `viscTempSlope` — d(log₁₀ viscosity)/dT, ≤ 0 (viscosity drops as it heats). For
  water/acids this is ~0 (their thin viscosity barely matters); for Lava and Molten
  Wax it is meaningfully negative so hotter = runnier.
- `WATER_LOG_VISC` — the normalization constant (log₁₀ of water's ~1 cP), so water's
  fluidity sits at ~1 across its range.

`T` is the cell's temperature from **`thermalFromEnthalpy(elementId, enthalpy)`** —
the generic 2b walk — so a liquid at a phase-plateau or freshly heated reports the
right temperature and its fluidity tracks it live.

The exact coefficients are fit in the plan from the reference table below and tuned
in-browser; the spec fixes the **model and the reference data**, not final magic
numbers.

### Two floors, for two different reasons

- **Horizontal leveling fluidity may fall all the way to ~0.** This is what lets
  ultra-viscous Lava hold a mound and refuse to flatten — the "static spread"
  behavior accepted under "fully realistic."
- **Vertical drip fluidity is floored at a small `F_MIN_DRIP > 0`.** Even the most
  viscous liquid must eventually settle downward under gravity — a liquid cell with
  empty space below must never hang in mid-air. So drip slows to a crawl but never
  fully stops. (For Lava and Molten Wax this window is self-limiting anyway: as they
  cool they cross their 2b boundary and become static solids — Stone / Wax.)

This split honors realism (faithful ratios above the floor; lava won't spread) while
preventing the one non-negotiable artifact (floating liquid).

### The `liquidMovement` pass (generalizes `waterMovement`)

Replace the water-only `waterMovement` with a generic **`liquidMovement`** pass over
all liquids, keeping the proven race-free Margolus 2×2 block structure and the same
substep count / ping-pong parity (`WATER_SUBSTEPS`, likely renamed
`LIQUID_SUBSTEPS`). For each liquid cell, each candidate move into empty/gas is
gated by a hash-based roll against that cell's fluidity:

- **Vertical drip** into empty/gas below — gated by `max(F_MIN_DRIP, f)`.
- **Diagonal ooze** into an empty/gas diagonal below — gated by `f`.
- **Horizontal leveling** into adjacent empty — gated by `f`.

Water (`f ≈ 1`) reproduces today's fast leveling; the acids flow nearly as freely;
Molten Wax oozes; Lava mounds and only creeps.

### Division of labor with `movement`

`movement` continues to own gravity and **buoyancy** for everything: powders fall,
gases rise, and **cross-material density swaps stay gravity-driven** (a dense Lava
blob still sinks through Water, Water still sits on oil-like layers by density) —
these are *not* viscosity-gated, so buoyancy is unaffected. What moves out of
`movement` (or becomes fluidity-gated there) is **liquid motion into empty space** —
drip/diagonal/level — which `liquidMovement` now owns under fluidity control. The
plan picks the cleanest split (delegate liquid-into-empty entirely to
`liquidMovement`, keeping `movement`'s liquid handling limited to buoyancy swaps);
the invariant is: *every liquid move into empty space is fluidity-gated; no
cross-material buoyancy swap is.*

### Data → GPU

New per-material params (`refLogVisc`, `viscTempSlope`; `T_ref` and the global
`WATER_LOG_VISC` / `F_MIN_DRIP` are constants) pack into the `materials` float
buffer, which grows from **3 vec4 (12 floats) to 4 vec4 (16 floats)** per element —
a stride bump exactly like Phase 2a's 2→3 change, touching the material accessors in
both `simulate.wgsl` and `render.wgsl` (`materials[id * 3u]` → `materials[id * 4u]`,
with the chain slots moving to the new offsets). Non-liquids leave the viscosity
params at 0 and are never read (only `isLiquid` cells compute fluidity).

## Reference viscosities (the values)

Real dynamic viscosities (cP ≈ mPa·s), the basis for the normalized curve. Fluidity
shown at each liquid's default sim temperature for intuition (illustrative, not
final):

| liquid | ~viscosity | T-dependence | ~fluidity @ default T | reads as |
|--------|-----------|--------------|----------------------|----------|
| Water | ~1 cP @20 °C | negligible | ~1.0 | snaps flat, drips freely |
| Sulfuric Acid (Very Dilute / Dilute) | ~1–3 cP | negligible | ~0.9 | flows like water |
| Sulfuric Acid (Concentrated / Fuming) | ~25 cP @20 °C | mild | ~0.3 | noticeably sluggish |
| Molten Wax | ~5 cP near 60 °C, ~2–3 cP hot | moderate | ~0.4, higher when hotter | oozes, pools slowly |
| Lava | ~10⁴–10⁵ cP @≥1200 °C, ~10⁷ @800 °C | strong | ~0.01 (creeps), rises when superheated | mounds, holds slopes, slow ooze |

As Lava cools below 700 °C it becomes Stone (static) via 2b; as Molten Wax cools
below 60 °C it becomes Wax (static) via 2b — so the "near-frozen liquid" regime is
naturally short-lived and hands off to a real solid.

## Testing

Follows the repo's pure-TS-mirror + in-browser discipline.

- **Unit (vitest):** a pure `fluidityAt(temperature, elementId)` (or `viscosityAt` +
  the fluidity mapping) module mirroring the shader math, tested for: water ≫ lava at
  equal temperature; lava's fluidity **rising** with temperature (and wax's too);
  concentrated acid < dilute acid; monotonicity; the `F_MIN_DRIP` floor on drip and
  the →0 behavior on horizontal for lava; water ≈ 1 across its range. Plus serializer
  tests that the expanded `materials` layout emits **16 floats/element** in the
  documented order and that the viscosity params land at the right offsets, and that
  non-liquids carry 0s.
- **e2e + in-browser (headed Chrome):** paint each liquid and confirm the flow feel —
  Water/dilute-acid level flat fast; concentrated acid lags; Molten Wax oozes and
  pools slowly then resolidifies to Wax when cooled; **Lava mounds and only creeps,
  flows visibly faster when superheated (raise ambient / add Fire), and freezes to
  Stone as it cools**; buoyancy still works (dense liquid sinks through lighter);
  water still soaks into sand and the 2b transitions still behave; heat map correct;
  **no console errors** ("Invalid ComputePipeline" would mean a WGSL bug). Because
  shaders change, drive it in headed Chrome (`channel:'chrome'`).

## Risks

1. **"Fully realistic" makes Lava nearly static.** Accepted by design; the
   `F_MIN_DRIP` vertical floor keeps it a *slow-oozing liquid* rather than a frozen
   block or a floating one, and cooling→Stone gives it a real endpoint. If Lava reads
   as too inert in-browser, the knob is `F_MIN_DRIP` / the lava curve — tune, don't
   restructure.
2. **Buffer stride change (3→4 vec4).** Touches every material accessor in both
   shaders and the serializer/tests. Behavior-preserving for existing fields; verify
   the untouched sim (movement, thermal, corrosion, phase transitions) is unchanged
   in-browser besides the intended new flow behavior.
3. **Fluidity must not break race-freedom or ping-pong parity.** The gate is a
   deterministic per-cell hash roll inside the existing Margolus block resolution —
   no new races. Keep the substep count's parity (soak + corrode + substeps even, grid
   ends in buffer A), as noted in `config.ts`.
4. **Mid-air hang / disappearing liquid.** The classic failure: a fluidity gate that
   can zero out vertical motion, or a two-cell move that isn't mass-conserving. The
   `F_MIN_DRIP` floor plus the swap-based (mass-conserving by construction) CA prevent
   both; verify no liquid hangs or vanishes in-browser.
5. **WGSL not validated by typecheck/build** — verify in a real browser; watch the
   console; no i32/u32 mixing in the hash rolls (`u32(blockX) + Ku`).

## Relationship to prior work

Builds directly on the merged material system: Phase 1 (schema + `materials`/flags
buffers), Phase 2a (the 3-vec4 stride and `isLiquid`/`form` lookups + the
soak/corrode two-cell-pass pattern the `liquidMovement` gate mirrors), and Phase 2b
(the generic `thermalFromEnthalpy` this reuses to get each cell's temperature, and
the Lava→Stone / MoltenWax→Wax chains that give viscous liquids their solid
endpoint). Reuses the water CA foundation ([[project_ca_water_sink_soak]]).
Remaining after 2c: 2d (generalize acid chemistry), Phase 3 (large material
library). Same in-browser-verification discipline — WGSL isn't validated by
typecheck/build, so drive shader changes in headed Chrome.
