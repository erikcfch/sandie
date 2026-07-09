import { ELEMENTS } from './elements';
import { getChain } from './phaseTransitions';

interface Built {
  data: Float32Array;
  start: Map<number, number>;
  count: Map<number, number>;
}

let cache: Built | undefined;

function build(): Built {
  if (cache) return cache;
  const entries: number[] = [];
  const start = new Map<number, number>();
  const count = new Map<number, number>();
  const seen = new Set<number>();
  for (const element of ELEMENTS) {
    const chain = getChain(element.id);
    if (!chain) continue;
    const coldest = chain.segments[0].elementId;
    if (seen.has(coldest)) continue;
    seen.add(coldest);
    const segStart = entries.length / 4; // vec4 index
    chain.segments.forEach((seg, i) => {
      const transition = chain.transitions[i]; // undefined for the last segment
      entries.push(seg.elementId, seg.heatCapacity, transition ? transition.boundaryTemp : 0, transition ? transition.latentHeat : 0);
    });
    for (const seg of chain.segments) {
      start.set(seg.elementId, segStart);
      count.set(seg.elementId, chain.segments.length);
    }
  }
  cache = { data: new Float32Array(entries), start, count };
  return cache;
}

/** The flattened chain buffer (one vec4 per segment). */
export function chainData(): Float32Array {
  return build().data;
}
/** Flat vec4 index of the element's chain's coldest segment (0 if no chain). */
export function chainStartOf(elementId: number): number {
  return build().start.get(elementId) ?? 0;
}
/** Number of segments in the element's chain (0 = no phase transitions). */
export function chainCountOf(elementId: number): number {
  return build().count.get(elementId) ?? 0;
}
