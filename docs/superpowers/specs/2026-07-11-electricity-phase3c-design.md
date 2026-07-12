# Electricity — Phase 3c Design Spec

**Date:** 2026-07-11
**Status:** ✅ DONE — implemented + GPU-verified on branch `material-electricity`
**Branch:** `material-electricity` (off `master`)
**Parent:** Phase 3 program — `docs/superpowers/specs/2026-07-10-material-library-phase3-design.md` (3c)

## As built (2026-07-11)

Implemented subagent-driven (5 tasks, each spec/quality-reviewed + in-browser
verified). Reused 3b's architecture: `charge` is a `vec2<f32>` field (`srcReach`,
`gndReach`) with a canonical buffer + scratch + per-frame copy-back; the new
in-place `electricity` pass (own layout, dispatched outside the ping-pong on
`gridBufferA`) propagates both reachability fields, injects MAX at Battery
(`source` bit 9) / Ground (`ground` bit 10), and adds ohmic heat where LIVE
(`srcReach≥τ && gndReach≥τ`). **Dawn-safe** — ohmic heat is a bare `enthalpy +=`
gated by the proxy temp; no chain walk. `src/electricity.ts` mirrors the
reachability rule for unit tests. Verified in headed Chrome: a complete
Battery—Copper—Ground wire fully energises (cyan glow, fronts meeting in the
middle first), ohmically heats, and **electric-detonates a wired TNT** (ohmic heat
→ detonationTemp → 3b blast — the 3c↔3b tie); an **open circuit (no ground) is
dead** (its wired TNT stays intact); idle behaviour unchanged; no grid wipe, no
console errors. 175 unit tests, typecheck, build green.

**Tuned constants (game-balance):** `REACH_MAX=100`, `REACH_TAU=0.5`,
`REACH_DECAY=20`, `OHMIC_HEAT=5`, `HOT_CAP=600`; glow blend `0.6` (cyan; a feature,
invisible at rest). **Kept:** the electric glow + the 3b pressure tint (each
invisible outside its effect).

**Notes / follow-ups:** reachability propagates ~1 cell/frame, so a long wire
takes a couple seconds to fully energise — running the `electricity` pass per-tick
or in substeps would speed it up (deferred, not needed for the demo). Conductors
must be CONTIGUOUS — a gappy/sparse-painted wire breaks the flood (paint with high
flow). Battery/Ground are the demo source/sink; the metal conductor roster
(Iron/Gold/Aluminium) + Salt Water conductivity land in 3d.

## Motivation

Phase 3c activates the dormant `conductive` flag: electric current flows through
conductors on a complete circuit, heats them, and — by heating what it touches —
ignites flammables and **detonates explosives** (tying 3c to 3b's blast). It is the
second and last new mechanism before the 3d material library. It reuses 3b's
proven field-buffer + in-place-pass architecture.

## Decisions locked in brainstorming (2026-07-11)

- **Model — realistic circuit:** current flows only on a complete **source→ground**
  path; an open circuit (source but no ground path) is **dead**. Implemented on the
  GPU CA as **two decaying-reachability fields**, not a global solver.
- **Source/ground:** two new materials — **Battery** (source) and **Ground** (sink).
  Paint `Battery — conductive wire — Ground` and current flows on the connected path.
- **Effects (all):** ohmic heating, ignite flammables, detonate explosives, glow —
  but unified: **ohmic heating is the only new effect**; ignite/detonate **emerge**
  from the existing thermal/ignition/detonation rules once the wire is hot; glow is
  render-only.
- **Conductors:** metals — **Copper** (existing) is the demo wire. Pure water does
  NOT conduct; **Salt Water** (3d) will. Iron/Gold/Aluminum become conductors in 3d.
- **Demo materials:** Battery + Ground (the wire is existing Copper). Full metal
  conductor roster + Salt Water are 3d data.

## Model — two reachability fields

A conductor is **LIVE** where it is reachable-from-a-source AND reachable-from-
ground through conductive cells. Two scalar fields per cell:

- `srcReach` — floods out from Batteries through conductive cells.
- `gndReach` — floods out from Grounds through conductive cells.

**Propagation update (per field, per tick), with decay-retraction:**
```
reach(cell) =
  isSourceForThisField(cell)                         -> MAX          // Battery for src, Ground for gnd
  else if !isConductive(cell)                        -> 0            // charge only in conductors
  else if any conductive neighbour has reach >= TAU  -> MAX          // reset from a live neighbour
  else                                               -> max(0, reach(cell) - DECAY)   // fade if cut
```

- **No distance falloff along a live wire:** each conductive cell resets to `MAX`
  from any reachable conductive neighbour, so an arbitrarily long connected wire
  stays `MAX` (magnitude is not "current strength" — it is reachability).
- **Retraction on cut:** a cell that loses all reachable neighbours has no reset and
  decays to 0 within `~MAX/DECAY` ticks, so cutting a wire kills the downstream part.
- **Front advances 1 cell/tick;** an N-cell wire energises over N ticks (run the pass
  per tick, or a few substeps/frame if faster energising is wanted — a tuning knob).

**LIVE(cell) = srcReach(cell) >= TAU && gndReach(cell) >= TAU.** An open circuit
(only a source, no ground path) has `gndReach = 0` everywhere on it → not LIVE →
dead, delivering the realism. A dead-end branch off a live wire reads as LIVE/"hot"
(both fields flood into it) — an accepted game simplification (the branch is
energised even though it carries no net current).

## New state (reuses 3b's field pattern)

- **Capability flags:** `source` (Battery) and `ground` (Ground) → `materialFlags`
  bits 9 and 10 (`512u`, `1024u`; bit 8 = explosive from 3b). `conductive` (bit 5)
  already exists.
- **Charge field:** `charge: array<vec2<f32>>` (or two parallel `f32` buffers),
  one `(srcReach, gndReach)` per cell — a **canonical buffer + scratch + per-frame
  `copyBufferToBuffer` back**, exactly like 3b's `pressureField`/`pressureNext`.
- **Materials:** Battery (`source` + `conductive`), Ground (`ground` + `conductive`),
  both new `ElementDef` rows. Copper already `conductive`.

## Pass — new in-place `electricity` pass

Reuses 3b's blast-pass architecture: a SEPARATE **in-place** compute pass with its
own bind-group layout (grid `read_write`, chargeIn read-only, chargeOut write,
materials, materialFlags), dispatched OUTSIDE the ping-pong chain on `gridBufferA`
(so grid parity is untouched; `SIM_SLOTS += 1`). Per cell, race-free (reads its cell
+ neighbour charges, writes only its own cell + own charge):

1. Read `srcReach`/`gndReach` (self + 4 neighbours) and the cell id/flags.
2. Update both fields per the propagation rule above (inject `MAX` at Battery for
   `srcReach`, at Ground for `gndReach`).
3. If `LIVE` (both ≥ `TAU`): add ohmic heat to the cell's enthalpy
   (`enthalpy += OHMIC_HEAT` per tick, capped so a wire plateaus at a hot-but-stable
   temperature). **Dawn-safe:** a bare `enthalpy +=` — NO `thermalFromEnthalpy`/
   chain walk. Ignition of neighbours (Wood past ignitionTemp) and detonation of
   neighbours (TNT past detonationTemp) then happen via the EXISTING `heat`/`blast`
   passes — zero new code.
4. Write the cell + its updated `(srcReach, gndReach)`.

A pure-TS mirror (`src/electricity.ts`) covers the reachability update + LIVE
decision for unit tests, matching the shader.

## Effects summary

| Effect | How |
|---|---|
| Ohmic heating | LIVE cell `enthalpy += OHMIC_HEAT` (the only new effect) |
| Ignite flammables | **emergent** — hot wire raises neighbour Wood past ignitionTemp (existing `heat` rule) |
| Detonate explosives | **emergent** — hot wire raises neighbour TNT past detonationTemp (3b `blast`) |
| Glow | render tints LIVE cells (`srcReach*gndReach > 0`) an electric colour |

## Constants (initial; tuned in-browser)

`REACH_MAX`, `REACH_TAU` (LIVE threshold), `REACH_DECAY` (retraction speed vs range),
`OHMIC_HEAT` (per-tick enthalpy add), and a `HOT_CAP` so a wire plateaus rather than
runs away. Game-balance values, tuned live like 3b's blast constants.

## Demo (3c)

Battery — Copper wire — Ground: the wire lights up (glow) and warms. Break the wire
→ the downstream part goes dark (retraction). Run the wire past **Wood** → it
ignites; wire it to **TNT** → **electric detonation** (3b fires). Verify no grid
wipe (Stone-bowl), heat map sane, zero console errors.

## Testing

- **Unit (vitest):** `electricity.ts` reachability update (source→MAX,
  non-conductor→0, reset-from-neighbour, decay-retraction) + LIVE decision +
  open-circuit-is-dead; `source`/`ground` flag packing (bits 9/10); Battery/Ground
  material rows.
- **In-browser (headed Chrome) — authoritative:** built incrementally (see Risk).
- **e2e (Playwright):** a Battery/Copper/Ground smoke test (no errors, no wipe).

## Risk & incremental build order

Highest-risk sub-phase alongside 3b: a new field + new pass (Dawn hazard). Same
mitigation — build strictly incrementally, each step Stone-bowl-verified in fresh
headed Chrome:

1. Data: `source`/`ground` flags + Battery/Ground materials (pure TS + tests).
2. Charge field buffers + inert `electricity` pass (carry charge through, grid
   untouched) → verify nothing changed / no wipe.
3. Reachability propagation (both fields) + injection at Battery/Ground + a debug
   glow tint → verify the wire lights source→ground and an open wire stays dark.
4. Retraction → verify cutting the wire darkens the downstream part.
5. LIVE detection + ohmic heat → verify the wire warms (heat map), Wood ignites,
   TNT electric-detonates. No wipe.

## Out of scope for 3c

- The metal conductor roster (Iron/Gold/Aluminum) + Salt Water conductivity — 3d.
- Precise current magnitude / resistance networks / voltage — LIVE is boolean
  (reachable-both-ways), ohmic heat is a flat per-tick add.
- Arcing across air/water gaps — conductors only; no gap jumping.
- Logic gates / switches / components beyond source, ground, and wire.
