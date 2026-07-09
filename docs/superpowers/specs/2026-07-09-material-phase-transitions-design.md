# Material System — Phase 2b: Data-Driven Phase Transitions

**Date:** 2026-07-09
**Status:** Approved, ready for implementation planning
**Branch:** `material-phase-transitions` (off `master`)

## Motivation

Phase transitions (melting/boiling with latent heat) are the last hardcoded
piece of the thermal model. The **TypeScript** side is already data-driven —
`thermal.ts` walks `getChain()` from `phaseTransitions.ts` generically — but the
**shader** hand-unrolls each chain: `thermalFromEnthalpy` dispatches on
`isWaterFamily`/`isLavaFamily` into `waterChainFromEnthalpy`/
`lavaChainFromEnthalpy`, with the boundary temps and latent heats baked in as
WGSL consts (`ICE_WATER_BOUNDARY`, `WATER_STEAM_LATENT`, …). `render.wgsl`
hand-unrolls its own display-only copy too.

So adding a material that melts or boils (a new metal, wax, glass) requires
writing new bespoke shader functions. Phase 2b makes the shader thermal decode
**generic and data-driven** — uploading the chain data to the GPU and walking it
— so a new phase-changing material becomes a pure `PHASE_TRANSITIONS` data row.
This also generalizes the enthalpy re-encoding (`enthalpyForNewElement`) that
flammability/soak/corrode already depend on.

## Design

### Chain data → GPU

A new `chains` GPU buffer, `array<vec4<f32>>`, with **one entry per chain
segment**, ordered coldest→hottest within each chain:

```
(segmentElementId, heatCapacity, boundaryTempAbove, latentHeatAbove)
```

`boundaryTempAbove`/`latentHeatAbove` describe the transition from this segment to
the next; the last segment of a chain has no transition above (its z/w are unused
— the walk knows it's last by index). Example flattened buffer:

| idx | element | heatCap | boundaryAbove | latentAbove | chain |
|-----|---------|---------|---------------|-------------|-------|
| 0 | Ice | 2.1 | 0 | 80 | Ice–Water–Steam |
| 1 | Water | 4.0 | 100 | 540 | |
| 2 | Steam | 2.0 | — | — | |
| 3 | Stone | 0.8 | 700 | 200 | Stone–Lava |
| 4 | Lava | 1.0 | — | — | |
| 5 | Wax | 2.0 | 60 | 40 | Wax–Molten Wax (new) |
| 6 | Molten Wax | 2.2 | — | — | |

### Per-element chain membership

Each element's chain pointer goes into the **`materials` buffer's two currently-
reserved slots** (offsets 10, 11 in the 12-float layout) — **no buffer growth**:
- `chainStart` — flat index of the element's chain's first segment (its coldest).
- `chainCount` — number of segments in the chain; **0 = no chain** (a simple
  material: `temperature = enthalpy / heatCapacity`).

All elements sharing a chain get the same `chainStart` and `chainCount`.

### Generic chain-walk (the shader rewrite)

Rewrite `thermalFromEnthalpy(currentElementId, enthalpy)` and
`enthalpyForNewElement(temperature, targetElementId)` in `simulate.wgsl` as a
dynamic loop over the element's chain segments, computing cumulative enthalpy
breakpoints (segment slope + latent-heat plateau) exactly as `thermal.ts`'s
`buildBreakpoints` + `temperatureAndElementFromEnthalpy` + `enthalpyForTemperature`
do — including the **plateau hysteresis** (a cell mid-plateau stays its current
phase until the enthalpy fully clears the band, resolved by comparing
`currentElementId` to the segment element ids read from the buffer). Then:
- delete `waterChainFromEnthalpy`, `lavaChainFromEnthalpy`,
  `waterChainEnthalpyForTemperature`, `lavaChainEnthalpyForTemperature`,
  `isWaterFamily`, `isLavaFamily`, and the hardcoded `*_BOUNDARY`/`*_LATENT`
  consts.
- `render.wgsl`'s display-only `temperatureFromEnthalpy` gets the same generic
  walk (temperature only) and its own hand-unrolled copies are deleted; it gains
  the `chains` buffer binding.

WGSL supports the small dynamic loop (`chainCount` ≤ 3). The `chains` buffer is
bound to the sim passes (a new binding) and to the render pass.

### Behavior-preserving

The migrated chains (Ice–Water–Steam, Stone–Lava) carry identical boundary temps
and latent heats, and the generic walk reproduces the hand-unrolled math exactly,
so melting/boiling/freezing/solidifying is unchanged. The enthalpy re-encoding
used by flammability/soak/corrode also stays identical (same values, now via the
generic path). Verified in-browser.

## New material: Wax (the demo)

Two new elements + one `PHASE_TRANSITIONS` row — **no shader edits** — proving the
data-drive:
- **Wax** (id 26): static solid, organic, low-ish density; `meltingPoint` 60.
- **Molten Wax** (id 27): liquid, organic; the melted phase.
- `PHASE_TRANSITIONS`: `Wax ↔ Molten Wax` at boundary 60 °C, latent heat ~40.

At ~60 °C Wax melts to Molten Wax (a flowing liquid) and resolidifies when cooled
— reachable with modest heat (near Fire/Lava, or the ambient-temp slider, which
maxes at 150 °C). It fizzes nothing and reacts with nothing; it purely exercises
the generic melt/freeze chain.

## Testing

- **Unit (vitest):** the new `chainData()` serializer (correct flattened
  segments, ordered coldest→hottest; the sentinel/last-segment handling); the
  `chainStart`/`chainCount` in `materialProperties()` (elements in a chain point
  at the right segment; simple materials get 0); and a test that
  `thermal.ts`'s existing generic functions produce the same Wax melt/freeze
  breakpoints (the TS side already generalizes, so Wax works there for free —
  assert it). The WGSL walk mirrors these.
- **e2e + in-browser:** existing transitions unchanged (Ice melts to Water and
  boils to Steam; Stone melts to Lava near heat; Water freezes to Ice at low
  ambient); Wax melts to Molten Wax when heated past 60 °C and resolidifies when
  cooled; the heat map shows the flat plateau during Wax's melt (proving the
  generic plateau logic); no console errors. Drive in headed Chrome.

## Risks

1. **The generic walk must exactly reproduce the hand-unrolled math**, including
   plateau hysteresis (Ice stays Ice through the melt band). Mirror `thermal.ts`
   precisely; verify existing melt/boil/freeze in-browser and that soak/corrode/
   flammability enthalpy carry-over is unchanged.
2. **Buffer/binding change** (new `chains` buffer bound to sim + render; two
   reserved `materials` slots now populated). Behavior-preserving but touches the
   thermal core and both shaders — verify in-browser (no "Invalid
   ComputePipeline").
3. **WGSL dynamic loop + struct returns** — the walk returns a temperature +
   element id (a struct, like the existing `ThermalResult`). Keep it simple;
   `chainCount` is tiny.
4. **WGSL not validated by typecheck/build** — verify in a real browser; watch
   the console; no i32/u32 mixing.

## Relationship to prior work

Builds on the merged material system (Phase 1 schema + `materials` buffer, Phase
2a's 12-float layout with its two reserved slots). Reuses `phaseTransitions.ts` /
`thermal.ts`'s already-generic chain logic as the source of truth the shader now
mirrors. Completes the data-driven thermal model; Phase 2c (viscosity) and Phase
3 (material library) remain.
