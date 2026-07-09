import { getElement } from './elements';

/** Whether a corrosive element dissolves a soluble element: both flags set and
 * the corrosive's strength meets the soluble's threshold. Mirrored in the
 * shader's corrode pass. */
export function dissolves(corrosiveId: number, solubleId: number): boolean {
  const c = getElement(corrosiveId);
  const s = getElement(solubleId);
  if (!c.corrosive || !s.soluble) return false;
  return (c.corrosiveStrength ?? 0) >= (s.solubility ?? Number.POSITIVE_INFINITY);
}
