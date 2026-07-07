# Sulfuric acid concentration tiers + corrected Copper reaction

## Purpose

The current Copper+Sulfuric Acid reaction (added in the previous chem-reaction-engine
feature) is chemically wrong: it treats a single generic "Sulfuric Acid" as reacting
with Copper at any temperature, producing Hydrogen. In reality, **dilute** sulfuric
acid does not react with copper at all (copper is below hydrogen in the reactivity
series, and dilute H₂SO₄ can't oxidize it); only **hot, concentrated** sulfuric acid
attacks copper, producing copper sulfate, sulfur dioxide, and water - not hydrogen
gas.

This spec fixes that, and - since fixing it requires distinguishing acid
concentration in the first place - adds a small "tunable" concentration mechanic:
four discrete acid tiers (Very Dilute / Dilute / Concentrated / Fuming), with
heating driving a one-way progression up the tiers (boiling off water
concentrates the acid, matching how real dilute acid is water + acid). This gives
players the ability to *make* concentrated/fuming acid themselves by heating
dilute acid, rather than only having it available as a separate paint option.

This is a followup to `2026-07-07-chem-reaction-engine-design.md`. A further
followup (not part of this spec) will add an atmosphere/oxidizer concept and
explosive Fire+Hydrogen combustion; another followup after that will add a Base
element and exothermic acid+base neutralization. Both are deliberately deferred -
this spec is scoped to concentration tiers and the Copper/acid accuracy fix only.

## Scope

**In scope:**
- Rename the existing "Sulfuric Acid" element (id 11) to "Sulfuric Acid (Dilute)"
  - properties unchanged, label only.
- Add 3 new acid tiers: Very Dilute, Concentrated, Fuming (oleum).
- Add a new Sulfur Dioxide (SO₂) gas element.
- Add a one-way, heat-driven progression Very Dilute -> Dilute -> Concentrated ->
  Fuming, via a new generalized "threshold reaction" engine (temperature-only,
  no catalyst neighbor - the same shape as Wood's ignition, but now shared across
  3 new cases instead of duplicated).
- Remove the existing Copper+Acid->Hydrogen reaction entirely.
- Add temperature-gated Copper+Concentrated/Fuming Acid reactions producing
  Copper Sulfate + (Sulfur Dioxide or Water), via a new optional
  `minTemperature` field on the existing `ContactReaction` schema.
- Very Dilute and Dilute Acid get **no** reaction with Copper at all (the
  accuracy fix - locked in with a regression test asserting absence).

**Out of scope (explicitly deferred):**
- Atmosphere/oxidizer concept and Fire+Hydrogen explosive combustion (next spec).
- Base element(s) and acid+base neutralization (a later spec).
- Continuous (non-tiered) concentration values - four discrete tiers only.
- Any change to Wood->Fire or Fire->Steam/Smoke's existing bespoke logic - it
  already works and is left untouched, even though it's structurally similar to
  the new threshold-reaction engine (see Architecture below for why).

## New elements (`src/elements.ts`)

The existing id-11 element is renamed (properties unchanged except `name`):
`Sulfuric Acid` -> `Sulfuric Acid (Dilute)`.

Three new tiers plus the SO₂ byproduct, all `family: 'chem'`, all
`defaultTemp: AMBIENT_TEMP` (inert until heated/reacted, like the existing chem
elements):

| id | name | category | density | color | conductivity | heatCapacity | formula |
|---|---|---|---|---|---|---|---|
| 15 | Sulfuric Acid (Very Dilute) | liquid | 41 | `[210,230,120]` | 0.28 | 4.2 | H₂SO₄ (~10%) |
| 16 | Sulfuric Acid (Concentrated) | liquid | 52 | `[200,160,20]` | 0.20 | 2.5 | H₂SO₄ (conc.) |
| 17 | Sulfuric Acid (Fuming) | liquid | 56 | `[140,100,10]` | 0.15 | 2.0 | H₂SO₄·SO₃ |
| 18 | Sulfur Dioxide | gas | 1 | `[225,225,150]` | 0.05 | 0.6 | SO₂ |

Density rises with concentration (less water = denser, matching real H₂SO₄);
heatCapacity falls (less water = less thermal buffering). Density ordering:
Water(40) < VeryDilute(41) < Dilute(45) < Concentrated(52) < Fuming(56) < Sand(60) -
all acid tiers stay in the Water-Sand band, consistent with the existing density
convention (nothing needs to relate to Lava's density specifically).

Movement: all four acid tiers are `category: 'liquid'`; Sulfur Dioxide is
`category: 'gas'`. Per the existing (already-shipped) pattern, `simulate.wgsl`'s
`isPowderOrLiquid`/`isLiquid`/`isGas` functions need each new id added so they
actually move correctly - this was a real gap in the previous feature's spec that
got caught during planning; calling it out up front this time.

Hydrogen (id 14) is untouched and stays in the element table - still hand-paintable,
even though after this spec nothing produces it via reaction. It becomes reachable
again via reaction in the atmosphere/combustion followup.

## Architecture: two reaction engines instead of one

The existing engine (`CONTACT_REACTIONS` - reactant + adjacent catalyst -> product)
doesn't fit the acid-tier progression: boiling off water needs no neighbor, just
heat, exactly like Wood's ignition. Rather than duplicate Wood's bespoke
temperature-threshold branch three more times, this spec adds a **second**,
parallel, generalized engine specifically for temperature-only transitions.

### New: `THRESHOLD_REACTIONS` (`src/reactions.ts`)

```ts
export interface ThresholdReaction {
  reactant: number;
  minTemperature: number;
  product: number;
  chance: number;
}
```

Serialized the same way as `CONTACT_REACTIONS` (a `thresholdReactionData()`
function mirroring `reactionData()`), uploaded as its own GPU buffer, read by its
own small loop in `simulate.wgsl`'s `heat()` (separate from the contact-reaction
loop, since there's no catalyst-neighbor check to share).

**Why not fold Wood->Fire into this new table too?** Wood's ignition is
*instant* once the temperature threshold is crossed (no stochastic roll at all in
the current code) - effectively `chance: 1`. The very first version of the
contact-reaction engine hit exactly this problem when considering whether to
migrate Fire's touching-water->Steam behavior, and deliberately left it bespoke
to avoid either (a) breaking the existing `chance` strictly-`< 1` test invariant,
or (b) silently changing Wood's ignition from instant to 95%-ish stochastic. Same
reasoning applies here: Wood->Fire already works, is already reviewed and
shipped, and isn't part of what this spec needs to fix - leave it alone. The new
`THRESHOLD_REACTIONS` table's three entries are all genuinely stochastic
(`chance: 0.05`, matching `FIRE_DECAY_CHANCE`/`LAVA_OBSIDIAN_CHANCE`'s existing
scale), so no such conflict arises for them.

The three transitions (thresholds are game-balance approximations documented as
such, not lab-precise - same spirit as the existing `WOOD_IGNITE_POINT: 300`):

| reactant | minTemperature | product | chance |
|---|---|---|---|
| Sulfuric Acid (Very Dilute) | 100 (water's boiling point) | Sulfuric Acid (Dilute) | 0.05 |
| Sulfuric Acid (Dilute) | 180 (boiling point rises as water content drops) | Sulfuric Acid (Concentrated) | 0.05 |
| Sulfuric Acid (Concentrated) | 300 (further heating drives off SO₃ character) | Sulfuric Acid (Fuming) | 0.05 |

One-way: cooling a Concentrated Acid cell back down does **not** revert it to
Dilute (the water that boiled off is gone - unlike Ice<->Water's genuine
reversible equilibrium, this is a one-way substance change, same category as
Wood->Fire, just triggered generically instead of bespoke).

### Extended: `CONTACT_REACTIONS` gets an optional `minTemperature`

```ts
export interface ContactReaction {
  reactant: number;
  catalystNeighbor: number;
  product: number;
  chance: number;
  enthalpyDelta: number;
  minTemperature?: number; // absent = applies at any temperature
}
```

All existing entries (Lava+Water->Obsidian) are unaffected (no `minTemperature`,
same as today). The shader's existing contact-reaction loop gains one extra
check: if a reaction row specifies a minimum temperature, the reactant cell's
current temperature must meet it, or the reaction is skipped for that row this
tick. Absence is encoded as a large negative sentinel (e.g. `-999`) in the
existing unused padding slot of the reaction's second vec4 (no buffer stride
change needed - Task 3 of the previous feature already left three padding
floats unused per row).

### Copper + Acid reactions (replaces the old Copper+Acid->Hydrogen entries)

Very Dilute and Dilute Acid: **no `CONTACT_REACTIONS` entry at all** with Copper -
this is the accuracy fix itself. Locked in with a regression test asserting no
such entry exists (not just "no test covers it" - an explicit assertion of
absence).

Concentrated Acid + Copper, only when hot (>=150 deg - copper needs heated
concentrated acid to react in reality): `Cu + 2H2SO4 -> CuSO4 + SO2 + 2H2O`.
One cell can only hold one product, so (as with the previous Copper/Hydrogen
pair) this is modeled as independent reaction rows, weighted roughly toward the
real 1:2 SO2:H2O ratio:

| reactant | catalystNeighbor | product | minTemperature | chance | enthalpyDelta |
|---|---|---|---|---|---|
| Copper | Concentrated Acid | Copper Sulfate | 150 | 0.06 | 40 |
| Concentrated Acid | Copper | Sulfur Dioxide | 150 | 0.02 | 40 |
| Concentrated Acid | Copper | Water | 150 | 0.04 | 40 |

Fuming Acid + Copper: more reactive, needs less heat (>=80) and reacts faster:

| reactant | catalystNeighbor | product | minTemperature | chance | enthalpyDelta |
|---|---|---|---|---|---|
| Copper | Fuming Acid | Copper Sulfate | 80 | 0.10 | 60 |
| Fuming Acid | Copper | Sulfur Dioxide | 80 | 0.04 | 60 |
| Fuming Acid | Copper | Water | 80 | 0.06 | 60 |

## Toolbar

No structural changes - the Chem section already groups generically by
`family`, so it grows from 4 buttons to 8 (Sulfuric Acid Very Dilute/Dilute/
Concentrated/Fuming, Copper, Copper Sulfate, Hydrogen, Sulfur Dioxide)
automatically.

## Testing

- `elements.test.ts`: new tier elements' properties, density ordering
  (VeryDilute < Dilute < Concentrated < Fuming), the renamed Dilute entry's
  name and unchanged other properties.
- `reactions.test.ts`: extend for `minTemperature` on `ContactReaction`; new
  Copper+Concentrated/Fuming Acid rows; explicit regression test asserting
  **no** `CONTACT_REACTIONS` entry has `catalystNeighbor` = Copper's id with
  `reactant` = Very Dilute or Dilute Acid's id (and vice versa) - i.e. the
  accuracy fix is actually absent-by-assertion, not just absent-by-omission.
- New test file (e.g. `thresholdReactions.test.ts`) mirroring `reactions.test.ts`'s
  shape, for `THRESHOLD_REACTIONS` + `thresholdReactionData()`.
- No WGSL test harness (as before) - manual browser verification: paint Very
  Dilute Acid, heat it in stages (e.g. via nearby Lava or the ambient-temp
  slider), confirm it climbs Very Dilute -> Dilute -> Concentrated -> Fuming;
  confirm hot Concentrated/Fuming Acid next to Copper produces Copper
  Sulfate/Sulfur Dioxide/Water; confirm Dilute/Very Dilute Acid next to Copper
  does **not** react even when hot - this last check is the most important
  thing to actually see, since it's the core accuracy fix.
