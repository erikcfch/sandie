import type { Form } from './elements';

/** Bottom of the movement band (a real gas maps near here). */
export const SIM_DENSITY_LO = 1;
/** Top of the movement band for movable materials (kept below BARRIER_DENSITY). */
export const SIM_DENSITY_HI = 95;
/** log10(g/cm³) mapped to LO (covers Hydrogen ≈ 9e-5). */
export const DENSITY_LOG_MIN = -4.1;
/** log10(g/cm³) mapped to HI (headroom above Gold ≈ 19.3 for future materials). */
export const DENSITY_LOG_MAX = 1.3;
/** Static solids get this sentinel so they stay denser than every movable material. */
export const BARRIER_DENSITY = 100;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Monotonic log-map of real density (g/cm³) into [SIM_DENSITY_LO, SIM_DENSITY_HI].
 * Non-positive density → 0 (Empty). */
export function normalizedDensity(realDensity: number): number {
  if (realDensity <= 0) return 0;
  const t = (Math.log10(realDensity) - DENSITY_LOG_MIN) / (DENSITY_LOG_MAX - DENSITY_LOG_MIN);
  return clamp(SIM_DENSITY_LO + t * (SIM_DENSITY_HI - SIM_DENSITY_LO), SIM_DENSITY_LO, SIM_DENSITY_HI);
}

/** Sim density used for movement swaps. Static solids are immovable barriers
 * (a sentinel above every movable material), except Empty (real density 0 → 0).
 * Movable materials (powder/liquid/gas) derive from real density. */
export function simDensity(form: Form, realDensity: number): number {
  if (form === 'static') return realDensity > 0 ? BARRIER_DENSITY : 0;
  return normalizedDensity(realDensity);
}
