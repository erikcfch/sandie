/** Reachability saturates here; LIVE threshold is REACH_TAU below it. */
export const REACH_MAX = 100;
/** A cell counts as reachable (LIVE-eligible) at/above this. */
export const REACH_TAU = 0.5;
/** Per-hop drop from a source (range ≈ REACH_MAX/REACH_STEP cells). */
export const REACH_STEP = 1;

/** One reachability step (gradient / Bellman-Ford relaxation) for one field.
 * `neighbourMax` = max reach among the 4 orthogonal neighbours. A source pins to
 * REACH_MAX; a conductor sits one REACH_STEP below its highest neighbour; a
 * non-conductor is 0. Removing a source collapses the gradient (retraction).
 * Mirrored verbatim in simulate.wgsl's electricity pass. */
export function reachUpdate(neighbourMax: number, isConductive: boolean, isSource: boolean): number {
  if (isSource) return REACH_MAX;
  if (!isConductive) return 0;
  return Math.max(0, neighbourMax - REACH_STEP);
}

/** A conductor is live (carries current) only when reachable from BOTH a source
 * and a ground — an open circuit is dead. */
export function isLive(srcReach: number, gndReach: number): boolean {
  return srcReach >= REACH_TAU && gndReach >= REACH_TAU;
}
