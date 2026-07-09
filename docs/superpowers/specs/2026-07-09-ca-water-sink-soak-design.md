# CA Water with Sink & Soak — Design Spec

**Date:** 2026-07-09
**Status:** Approved, ready for implementation planning
**Branch:** `ca-water-sink-soak` (off `main`)

## Motivation

An earlier effort replaced Water's cellular-automaton (CA) movement with a
continuous Eulerian fluid solver (MAC velocity + Jacobi pressure projection) on
the `continuous-water-fluid` branch. On real GPUs it ran, but fought the
falling-sand genre at every turn: mass wasn't conserved (thin water vanished),
advection smeared, and — most of all — the bridge stitching a continuous field
onto the discrete `Cell` grid was a bug factory (a storage-buffer-limit crash, a
read/write aliasing crash, a spurious-boiling feedback loop). Worst of all, it
made the interaction the game most wants — **sand sinking through water** —
*harder*, because a continuous field can't swap with a discrete grain.

The falling-sand genre (Powder Game, Sandspiel, Noita) almost universally uses
**CA water**, for good reasons: mass is conserved by construction (water is
particles that swap, never created or destroyed), it interacts naturally with
every other element because it *is* the same grid, and there is no bridge. The
original sandie block-CA water looked blocky and sluggish only because it lacked
a strong horizontal-dispersion rule — not because CA water is inherently weak.

This project builds a proper CA water (fast leveling via dispersion), gets
**sink** almost for free, and adds a **soak** mechanic (graded wet sand). It
starts fresh from `main`; the Eulerian solver is preserved, unmerged, on its own
branch as an experiment.

## Scope

**In scope:**
- Fast-leveling CA water (multi-cell dispersion via many water-only movement
  substeps per frame).
- Sand (and other denser powders/liquids) sinking through water.
- A **soak** mechanic: sand absorbs water and becomes progressively wetter,
  modeled as a few discrete wet-sand element tiers.
- **Natural gas dispersion** (fixing a pre-existing baseline issue found while
  testing). Rising gas currently splits into two symmetric streams that diverge
  to the corners instead of rising as a plume: the movement pass applies the
  same crossed-diagonal swap to rising gas as to falling powder, and where
  falling *converges* into a pile, rising *diverges*; the fully-deterministic
  diagonal makes the split perfectly symmetric, and horizontal spread (every
  tick) outpaces the block-alignment-gated rise. Fix: randomize the gas diagonal
  to break the symmetric split and gate gas horizontal spread by a probability
  so gas rises before it fans out. Same movement shader the water/soak work
  edits, so it batches in here.

**Non-goals (this phase):**
- Continuous/sub-cell water depth or true pressure/momentum (that was the
  Eulerian approach; deliberately not revived here).
- Wetness for materials other than Sand.
- Continuous (per-cell float) wetness — wetness is quantized into element tiers.
- Any change to the thermal/reaction engines beyond the small additions the
  soak transitions need.

## Architecture Overview

Everything stays on the existing GPU compute pipeline and the discrete
`Cell{elementId, enthalpy}` grid. Water is once again a normal CA liquid
(`elementId == WATER`, density 40), moved by the Margolus block-CA `movement`
pass — no separate field, no sync bridge. Three things change or get added:

1. **Water leveling** — a strengthened sideways-flow rule plus running the water
   movement many substeps per frame.
2. **Sink** — falls out of the existing density-swap rules; essentially free.
3. **Soak** — new wet-sand element tiers with absorb / cohesion / drip / dry
   behaviors.

### 1. Water movement & leveling

Water obeys the classic falling-sand precedence each substep: try straight
**down**, else **down-diagonal** (randomized left/right to avoid bias), else
**sideways** into an open or less-dense neighbor. The existing Margolus block-CA
already expresses down / diagonal / horizontal swaps; the horizontal-flow rule
is strengthened so water reliably spreads into empty space.

The key to *fast* leveling is running the water movement as **many 1-cell
substeps per frame** (a tunable `WATER_SUBSTEPS`, target ~8–16) while
powders/solids continue at `TICKS_PER_FRAME` (3). Each substep still moves water
at most one cell (so the block-CA stays race-free — no atomics, no multi-cell
jumps), but N substeps disperse water ~N cells per frame, which flattens a
column quickly and reads as genuinely fluid. The exact substep count is tuned
against the existing profiler overlay.

The substep pass is water-focused: it runs the same race-free block-CA movement
but is cheap because only water (and the empty/gas cells it moves into) actually
changes. Sand-through-water sinking is resolved in the general movement pass (see
Sink); the extra water substeps only accelerate water's own spreading.

### 2. Sink

Because water is a normal CA liquid again, a denser powder or liquid resting on
water simply swaps down through it via the existing `shouldSwapVertical`
density rule (`density(top) > density(bottom)`), exactly as Sand already sinks
through nothing and as Lava/Acid already displace lighter liquids. Sand (density
60) > Water (40), so sand sinks; water rises to fill. No new movement code — the
only reason this didn't work before was the Eulerian "water is an immovable
obstacle" hack, which does not exist on this branch.

### 3. Soak (graded wet-sand tiers)

Wetness is quantized into a small ladder of distinct elements — mirroring how the
codebase already models acid concentration as discrete tiers — so **no change to
the `Cell` struct or any buffer layout** is needed:

```
Sand  ->  Damp Sand  ->  Wet Sand  ->  Saturated Sand
(dry)     (tier 1)       (tier 2)       (tier 3)
```

Each tier is a new entry in `src/elements.ts` with its own color (progressively
darker/browner) and density (slightly higher as it holds more water). Behaviors:

- **Absorb.** A sand-tier cell adjacent to Water climbs one tier *and consumes a
  water cell* (the adjacent Water becomes Empty). Consuming the water is what
  keeps mass conserved and lets pools actually drain into sand. This is the one
  piece the current single-cell reaction engine can't express as-is (it
  transforms only the reactant, not the catalyst) — see Implementation Notes.
- **Cohesion.** Wetter tiers slide diagonally *less* often — a per-tier
  diagonal-slide probability — so wet sand clumps and piles steeper than dry
  sand, while Saturated sand is the most cohesive.
- **Drip.** Saturated Sand with an empty cell below releases a Water cell
  downward and drops back to Wet Sand — so over-saturated sand sheds water.
- **Dry.** A wet tier drops one level over time (a low per-tick chance) or
  quickly near heat/Fire; heat-drying turns the released water into Steam, while
  slow ambient drying can simply release a Water cell (or evaporate a small
  amount). Drying restores dry Sand at the bottom of the ladder.

## Implementation Notes / Risks

These are the "watch out" spots — the design is sound; these need care in the
plan:

1. **Two-cell absorb.** Absorbing must transform *both* the sand cell (up a tier)
   and the neighboring water cell (to Empty). The existing `CONTACT_REACTIONS`
   engine transforms only the reactant cell. Options for the plan: extend the
   reaction engine to optionally consume the catalyst neighbor, or model absorb
   as a dedicated pass / a movement-style rule where a water cell is pulled into
   an adjacent sand cell. Whichever is chosen must stay race-free under the
   parallel grid update.
2. **Cohesion in a block-CA.** "Slides less" is a stochastic gate on the
   diagonal swap keyed by the wet tier (higher tier -> lower slide chance),
   reusing the existing `hash()` RNG. Must not deadlock water underneath (wet
   sand shouldn't trap water so hard it can never drip).
3. **Water substep interleave.** The extra water-only substeps must compose
   cleanly with the general movement + heat passes in one frame without letting
   water outrun the sink interaction or double-move. The plan pins down the exact
   dispatch order.
4. **Mass accounting across soak.** Absorb consumes water, drip/dry release it;
   the transitions must balance so a closed sand+water system neither gains nor
   loses water except through genuine evaporation (heat-drying to Steam).

## Testing

Follows the repo's pattern of mirroring shader logic in pure TypeScript for unit
testing (as `thermal.ts` mirrors the shader math):

- **Unit (vitest):** pure functions for the new rules — water flow precedence,
  the wet-tier absorb/drip/dry transitions, and the cohesion slide-gate —
  tested for mass balance (absorb consumes exactly one water; drip releases
  exactly one) and correct tier progression, mirrored into the shader.
- **e2e (Playwright):** paint a water column and assert it spreads/levels; drop
  Sand into a pool and assert it sinks and the water rises; pour water onto a
  sand pile and assert it darkens (soaks) and that a saturated pile drips. Guard
  on WebGPU availability like the existing smoke test.

## Relationship to Prior Work

- The Eulerian solver (`continuous-water-fluid` branch) is preserved, unmerged.
  Its `fluid.ts` math, the GPU profiler, and the resolution/tick scale-up remain
  available if a high-fidelity "real fluid" mode is ever wanted.
- This branch starts from `main`, so it inherits the original block-CA and the
  thermal/reaction engines unchanged.
