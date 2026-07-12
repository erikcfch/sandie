/** Reachability saturates here; LIVE threshold is REACH_TAU below it. */
export const REACH_MAX = 100;
/** A cell counts as reachable (LIVE-eligible) at/above this. */
export const REACH_TAU = 0.5;
/** Per-tick retraction when a cell has no reachable neighbour (cut wire fades). */
export const REACH_DECAY = 20;

/** One reachability step for one field. `neighbourMax` = max reach among the 4
 * orthogonal neighbours. Mirrored verbatim in simulate.wgsl's electricity pass. */
export function reachUpdate(
  selfReach: number, neighbourMax: number, isConductive: boolean, isSource: boolean,
): number {
  if (isSource) return REACH_MAX;
  if (!isConductive) return 0;
  if (neighbourMax >= REACH_TAU) return REACH_MAX;
  return Math.max(0, selfReach - REACH_DECAY);
}

/** A conductor is live (carries current) only when reachable from BOTH a source
 * and a ground — an open circuit is dead. */
export function isLive(srcReach: number, gndReach: number): boolean {
  return srcReach >= REACH_TAU && gndReach >= REACH_TAU;
}
