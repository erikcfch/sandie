/** Fraction of pressure retained per tick (< 1 → a blast fades to zero). */
export const BLAST_DECAY = 0.72;
/** Share of the local pressure that mixes with the 4-neighbour average. */
export const BLAST_DIFFUSE = 0.5;

/** One explicit diffusion+decay step of the pressure field, plus injection.
 * Mirrored verbatim in simulate.wgsl's blast pass. */
export function nextPressure(
  here: number, up: number, down: number, left: number, right: number, injected: number,
): number {
  const neighbourAvg = (up + down + left + right) / 4;
  const mixed = here * (1 - BLAST_DIFFUSE) + neighbourAvg * BLAST_DIFFUSE;
  return mixed * BLAST_DECAY + injected;
}

/** Pressure thresholds for the blast pass's matter-affecting effects. */
export const DESTROY_PRESSURE = 12;
export const CHAIN_PRESSURE = 8;
export const IGNITE_PRESSURE = 4;

/** Pure product decision: what a cell's local pressure does to it this tick.
 * Mirrored verbatim in simulate.wgsl's blast pass. */
export function blastEffect(
  pressure: number, cell: { flammable: boolean; explosive: boolean },
): 'none' | 'destroy' | 'ignite' | 'detonate' {
  if (cell.explosive && pressure >= CHAIN_PRESSURE) return 'detonate';
  if (pressure >= DESTROY_PRESSURE) return 'destroy';
  if (cell.flammable && pressure >= IGNITE_PRESSURE) return 'ignite';
  return 'none';
}
