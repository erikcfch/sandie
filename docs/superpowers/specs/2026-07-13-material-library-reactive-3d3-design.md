# Material Library: Reactive — Phase 3d-3 Design Spec

**Date:** 2026-07-13
**Status:** Approved shape; ready for implementation plan
**Branch:** `material-reactive` (off `master`)
**Parent:** Phase 3 program — `docs/superpowers/specs/2026-07-10-material-library-phase3-design.md` (3d)

## Motivation

The final 3d sub-batch and the last of Phase 3. Four reactive materials that tie
every Phase-3 mechanism together: an explosive (→ 3b blast), a conductive liquid
(→ 3c electricity), and violent contact/threshold chemistry. **Pure data** — new
`ElementDef` rows + reaction-table rows + one existing-element tweak (Hydrogen).
**Zero shader edits**: every product is chainless (Fire/Hydrogen/Steam/Glass/Salt
Water — none is in a phase chain), so the generic blast / electricity / contact /
threshold engines already handle everything. Builds on 3d-2 metals (merged).

## Roster (new `ElementDef` rows, ids from 42)

| Material | id | form | family | realDensity | specificHeat | thermalCond | notes |
|----------|----|------|--------|-------------|--------------|-------------|-------|
| Gunpowder | 42 | powder | physical | 1.7 | 1.0 | 0.2 | `explosive`+`flammable`; sensitive + weaker than TNT |
| Sodium | 43 | powder | chem `Na` | 0.97 | 1.23 | 0.6 | reactive metal; ρ<1 so it **floats on water** |
| Glass | 44 | static | physical | 2.5 | 0.84 | 0.3 | inert solid; fused from hot Sand |
| Salt Water | 45 | liquid | chem | 1.025 | 3.9 | 0.25 | **`conductive`** brine → energizes 3c circuits |

- Colours (approx): Gunpowder charcoal `[55,52,58]`; Sodium dull silver
  `[190,188,175]` (warmer than Aluminium's `[196,200,206]`); Glass pale blue-white
  `[200,225,230]`; Salt Water grey-blue `[90,150,185]` (greyer than Water's
  `[64,128,220]`).
- **Gunpowder** — `explosive:true`, `flammable:true`, `detonationTemp:120`,
  `ignitionTemp:180`, `blastStrength:110`, `burnProduct:Fire`, `burnRate:0.6`.
  vs TNT (detonationTemp 190 / ignitionTemp 280 / blastStrength 200): gunpowder
  triggers with less heat and pops smaller. A powder, so it pours and piles;
  handled by the existing 3b `blast` pass — no new reaction row.
- **Sodium** — `metallic:'metal'`, `formula:'Na'`, `form:'powder'` (granular
  simplification so it floats — a static metal would get the 3a barrier density
  and couldn't float). NOT `conductive` (it's a reactive metal, not a wire).
  ρ 0.97 < Water 1.0 → floats on water via 3a, so dropping it on a pool flares at
  the surface.
- **Glass** — inert static solid, `origin:'inorganic'`, no `meltingPoint` in the
  sim (no molten-glass phase; formed one-way from Sand).
- **Salt Water** — `conductive:true` (materialFlags bit 5), `viscosityRefLog10:0`
  (thin like water). ρ 1.025 > Water so it sinks below fresh water. `family:'chem'`
  with **no formula** (a solution, not a compound), so its toolbar button is just
  "Salt Water" (exact-match in e2e).

## Existing-element tweak: Hydrogen (id 14) becomes flammable

For the "H₂ builds up and flashes" chain, Hydrogen gains `flammable:true`,
`ignitionTemp:100` (ignites easily), `burnProduct:Steam` (2H₂+O₂→2H₂O vapour),
`burnRate:0.9` (fast). This is chemically correct (H₂ is flammable) and reuses the
generic flammable rule. **Verified isolated:** Hydrogen (id 14) appears only in its
`elements.ts` definition — it is NOT a product of any CONTACT/THRESHOLD/corrosion
reaction today (grepped `src/`), so the tweak only affects painted H₂ and the new
Sodium-produced H₂. The flammable-enumeration test at `elements.test.ts:318` must
grow (it maps `ELEMENTS.filter(flammable)` in id order) to
`['Wood', 'Hydrogen', 'TNT', 'Oil', 'Gasoline', 'Gasoline Vapor', 'Alcohol', 'Coal', 'Methane', 'Gunpowder']`
— Hydrogen after Wood (id 14) and Gunpowder last (id 42).

## Reactions (all data rows, chainless products)

- **Sodium + Water → Fire + Hydrogen** (two `CONTACT_REACTIONS` rows, no
  `minTemperature` — reacts at room temp):
  - `Sodium + Water(catalyst) → Fire`, `chance ~0.5` (violent/fast), big
    `enthalpyDelta ~600` (the flare heat — Fire lands at ~620 °C, hot enough to
    ignite the H₂ and nearby flammables).
  - `Water + Sodium(catalyst) → Hydrogen`, `chance ~0.3`, `enthalpyDelta 0` (the
    adjacent water gives off H₂ gas, which rises and — now flammable — flashes when
    the sodium fire reaches it). Mirrors the Copper+Acid multi-product split.
- **Sand → Glass** (one `THRESHOLD_REACTIONS` row): `Sand` at
  `minTemperature 700 °C → Glass`, `chance ~0.05`. Sand fuses to glass under
  sustained intense heat. **Finicky by design** (lava cools to stone in ~2 s, so
  glass forms only where the heat holds — the same heat-delivery character as
  thermite/coal); the controller confirms/tunes the temperature in-browser.
- **Salt + Water → Salt Water** (one `CONTACT_REACTIONS` row): `Salt +
  Water(catalyst) → Salt Water`, `chance ~0.1`, no `minTemperature`. Salt dissolves
  into conductive brine where it meets water. (Salt stays `soluble` for acid
  corrosion — that's a separate pass; this is an independent contact reaction.)

No new WGSL. Gunpowder rides the 3b blast pass; Salt Water rides the 3c electricity
pass (conductive bit); Sodium/Glass/Salt-Water ride the generic contact/threshold
loops.

## Testing

- **Unit (vitest):** ids 42–45 contiguous; each has valid form/phase/origin/metallic;
  Gunpowder `explosive`+`flammable` with blast params; Sodium metal/powder/ρ<Water
  (floats) /not-conductive; Glass inert static; Salt Water `conductive` liquid /
  ρ>Water (sinks below fresh water); the two Sodium+Water rows, the Sand→Glass
  threshold row, and the Salt+Water→Salt Water row exist with correct
  reactant/catalyst/product; Hydrogen now `flammable` → Steam; flammable-enumeration
  test updated (adds Hydrogen, Gunpowder).
- **In-browser (headed Chrome) — authoritative:** drop Sodium on a water pool →
  it floats and flares (fire + rising hydrogen that flashes); pile Gunpowder and
  spark/heat it → it pops (smaller than TNT, triggers easier); heat a Sand bed with
  lava → it fuses to Glass where the heat sustains (the tune point); paint Salt on a
  Water pool → brine forms, and a `Battery — Salt Water — Ground` path lights up
  (conductive liquid completes a 3c circuit). Stone-bowl detector — no grid wipe;
  heat map sane; zero console errors. **Remember `rm -rf node_modules/.vite` if any
  shader is touched (none should be) — the stale-shader trap.**
- **e2e (Playwright):** a reactive smoke test (sodium+water, gunpowder+fire, sand+lava,
  salt+water circuit; assert no errors) — Sodium carries a formula (`Na`) → non-exact
  match; Gunpowder/Glass/Salt Water have no formula → exact.

## Out of scope for 3d-3

- Molten Glass / a Glass phase chain (Glass is inert once formed).
- Salt Water boiling back to Steam + Salt residue (a possible future threshold row).
- Sodium as a conductor, or a sodium explosion (blast) — it flares chemically, not
  via the 3b pass.
- A precise NaOH product for the sodium-water reaction (modelled as Fire + H₂).
