# Material System — Phase 2a: Generic Corrosion / Dissolving

**Date:** 2026-07-09
**Status:** Approved, ready for implementation planning
**Branch:** `material-corrosion` (off `master`)

## Motivation

Phase 1 made classification data-driven and delivered the first generic,
flag-driven behavior (flammability). Phase 2a delivers the first **generic
emergent interaction** the material system was designed for: any `corrosive`
material automatically dissolves any `soluble` material, driven entirely by
flags + per-material params — no enumerated reaction pairs. This is the pattern
that lets new materials interact automatically.

The existing specific chemistry (Copper + Concentrated Acid → CuSO₄ + SO₂ + H₂O)
stays in the explicit `CONTACT_REACTIONS` override table, untouched — Copper is
not flagged `soluble`, so the generic engine skips it. Generic and specific
coexist, exactly as the material-system design intended.

## Design decisions (settled)

- **Mechanic:** strength-gated + acid depletes. A corrosive dissolves a soluble
  only when its `corrosiveStrength ≥` the soluble's `solubility` threshold; the
  soluble becomes its `dissolvedProduct`, and the corrosive steps down to its
  `weakensTo` (acid dilutes as it works — Fuming→Concentrated→Dilute→Very
  Dilute→Water). Mass-aware and scientific.
- **Demo materials:** a resistance ladder — Salt (dissolves in the weakest
  acid), Limestone (needs dilute+, fizzes CO₂), Rust (needs concentrated+),
  with Copper (override, concentrated+) as the tough top of the ladder.

## The corrosion engine

### New material params

Extend `ElementDef` (schema from Phase 1) with the values the generic rule reads
(the `corrosive`/`soluble` flags already exist from Phase 1):
- `corrosiveStrength?: number` — a corrosive's strength tier.
- `solubility?: number` — a soluble's threshold: the **minimum `corrosiveStrength`
  that dissolves it** (1 = dissolved by the weakest acid; higher = tougher). Low
  number = highly soluble.
- `dissolvedProduct?: number` — element id the soluble becomes when it dissolves.
- `weakensTo?: number` — element id a corrosive becomes when it reacts (its
  depletion product). Absent = the corrosive is not consumed (catalytic).

These pack into the `materials` GPU float buffer, which grows from 2 `vec4`s
(8 floats) to **3 `vec4`s (12 floats)** per element:
- `[0]`: density, thermalConductivity, heatCapacity, ignitionTemp *(Phase 1)*
- `[1]`: burnProduct, burnRate, **corrosiveStrength, solubility**
- `[2]`: **dissolvedProduct, weakensTo**, 0 (reserved), 0 (reserved)

Shader material accessors change stride from `materials[id * 2u]` to
`materials[id * 3u]` (both `simulate.wgsl` and `render.wgsl`); the new params are
read from `[id*3u + 1u]` and `[id*3u + 2u]`.

### The `corrode` pass

A new block-CA compute pass, following the proven two-cell `soak` pattern
(Margolus block-owned resolution → race-free two-cell transforms; enthalpy
re-encoded across every element change via `preserveTempEnthalpy`, the lesson
from soak):

For each 2×2 block, check the orthogonal corrosive↔soluble adjacencies. For the
first pair where `isCorrosive(c)`, `isSoluble(s)`, and
`corrosiveStrength(c) ≥ solubility(s)`, with a stochastic roll `< CORRODE_CHANCE`:
- the soluble cell becomes `dissolvedProduct(s)` (enthalpy re-encoded for the
  new element);
- the corrosive cell becomes `weakensTo(c)` if it has one, else stays (enthalpy
  re-encoded);
- at most one dissolve per block per tick.

No temperature gate for generic corrosion (acid dissolves limestone/salt/rust at
ambient); the Copper reaction's temperature/concentration gates stay in the
override table. The pass is dispatched per frame alongside the existing passes
(like `soak`), with its own SimParams slot for a distinct Margolus alignment, and
the grid buffer ping-pong kept consistent (ending back in buffer A).

### Coexistence with the override table

`CONTACT_REACTIONS`/`THRESHOLD_REACTIONS` are unchanged. Copper stays non-`soluble`,
so the generic `corrode` pass never touches it; its specific reaction with
concentrated/fuming acid runs in the discrete `heat()` reaction loop as today.
Where a material is both flagged `soluble` AND appears in the override table
(none do in this phase), the override runs in `heat()` and generic corrosion in
`corrode` — they must not double-consume; this phase avoids the overlap by
construction.

## New materials (the resistance ladder)

Four new elements (ids 22–25), defined with the full Phase-1 schema (taxonomy,
flags, sim `density` + real reference values). `solubility` is the min corrosive
strength that dissolves them.

| id | name | form | solubility | dissolvedProduct | notes |
|----|------|------|-----------|------------------|-------|
| 22 | Salt | powder | 1 | Empty | NaCl; dissolved by any acid; whitish |
| 23 | Limestone | powder | 2 | CO₂ | CaCO₃; needs dilute+; fizzes CO₂; pale grey |
| 24 | Rust | powder | 3 | Empty | Fe₂O₃; needs concentrated+; orange-brown |
| 25 | CO₂ | gas | — | — | Limestone's product; rises (see note) |

The four **acids** gain `corrosiveStrength` and `weakensTo`:

| acid | corrosiveStrength | weakensTo |
|------|-------------------|-----------|
| Sulfuric Acid (Very Dilute) | 1 | Water |
| Sulfuric Acid (Dilute) | 2 | Sulfuric Acid (Very Dilute) |
| Sulfuric Acid (Concentrated) | 3 | Sulfuric Acid (Dilute) |
| Sulfuric Acid (Fuming) | 4 | Sulfuric Acid (Concentrated) |

So Very Dilute dissolves only Salt; Dilute adds Limestone; Concentrated adds
Rust; and every dissolve steps the acid one tier weaker until it becomes Water.

**CO₂ note:** real CO₂ is denser than air and pools low, but sandie models "air"
as Empty and all gases rise into empty — so CO₂ rises like the other gases
(fine, and desirable, for a fizzing-bubbles look). Documented simplification.

## Testing

Follows the repo's pure-TS-mirror pattern:
- **Unit (vitest):** a pure `corrosionDecision(corrosiveStrength, solubility,
  roll, chance)` (and the tier helpers `weakensTo`/`dissolvedProduct` lookups) in
  a small module, tested for the strength gate (strength ≥ solubility fires;
  below doesn't), mass-awareness (one dissolve per fire), and the acid-depletion
  ladder; mirrored in the shader. Plus tests that the new elements exist with the
  right flags/params and that the expanded serializer emits 12 floats/element in
  the documented layout.
- **e2e + in-browser:** paint each acid tier onto Salt/Limestone/Rust and confirm
  the strength gate (very-dilute dissolves only salt; concentrated dissolves all
  three); confirm Limestone fizzes CO₂ upward; confirm the acid visibly dilutes
  (tier steps down) as it works and stops at Water; heat map stays at ambient (no
  spurious heat from the dissolves — enthalpy re-encoded); no console errors.
  Because shaders change, drive it in headed Chrome (`channel:'chrome'`).

## Risks

1. **Buffer stride change (2→3 vec4).** Touches every material accessor in both
   shaders and the serializer/tests. Behavior-preserving refactor for the Phase-1
   fields; verify the existing sim (movement/thermal/flammability) is unchanged
   in-browser, plus the new corrosion behavior.
2. **Two-cell enthalpy correctness.** The `corrode` pass changes elementId on both
   cells — re-encode enthalpy for each new element (`preserveTempEnthalpy` /
   dissolvedProduct at the soluble's temperature) so dissolving doesn't inject or
   drop heat (the soak-pass lesson). Verify with the heat-map overlay.
3. **WGSL not validated by typecheck/build** — verify the new pass + stride in a
   real browser (watch for "Invalid ComputePipeline"); no i32/u32 mixing in hash
   seeds (`u32(blockX) + Ku`).
4. **Dispatch/ping-pong.** Adding the `corrode` pass to the frame must keep the
   grid ending in buffer A and give the pass a distinct Margolus alignment
   (its own SimParams slot), mirroring how `soak`/`waterMovement` were wired.

## Relationship to prior work

Builds on the merged material-system Phase 1 (schema, flags, `materials`
buffer) and reuses the `soak` pass's two-cell block-CA pattern and
`preserveTempEnthalpy`. Later Phase 2 pieces (2b data-driven phase transitions,
2c viscosity, 2d generalize acid chemistry) are separate specs; 2d builds on this.
