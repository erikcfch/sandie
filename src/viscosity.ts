import { getElement } from './elements';

export const VISC_TREF = 20;
export const VISC_HALF = 200;
export const FLUID_MIN_DRIP = 0.2;
export const VISC_LOG_MIN = -1;
export const VISC_LOG_MAX = 14;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** log10 of dynamic viscosity (cP) at temperature `t`, clamped to a sane band. */
export function logViscosityAt(elementId: number, t: number): number {
  const element = getElement(elementId);
  const refLog10 = element.viscosityRefLog10 ?? 0;
  const coeff = element.viscosityTempCoeff ?? 0;
  return clamp(refLog10 + coeff * (t - VISC_TREF), VISC_LOG_MIN, VISC_LOG_MAX);
}

/** Horizontal/leveling fluidity in (0,1]; ~0 for very thick liquids (they mound). */
export function fluidityAt(elementId: number, t: number): number {
  const visc = 10 ** logViscosityAt(elementId, t);
  return VISC_HALF / (VISC_HALF + visc);
}

/** Vertical-drip fluidity, floored so a liquid always eventually settles downward. */
export function dripFluidityAt(elementId: number, t: number): number {
  return Math.max(FLUID_MIN_DRIP, fluidityAt(elementId, t));
}
