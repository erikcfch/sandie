import { getElement } from './elements';
import { getChain } from './phaseTransitions';
import type { Chain } from './phaseTransitions';

interface PlateauBounds {
  plateauStart: number;
  plateauEnd: number;
}

// Cumulative enthalpy bounds for each transition's latent-heat plateau,
// walking the chain from its coldest segment. Enthalpy = 0 is defined as
// temperature = 0 within the coldest segment (both of our chains have a
// boundary at or above 0, so 0 always falls inside that segment).
function buildBreakpoints(chain: Chain): PlateauBounds[] {
  const bounds: PlateauBounds[] = [];
  let prevBoundaryTemp = 0;
  let enthalpyAtPrevBoundary = 0;

  for (let i = 0; i < chain.transitions.length; i++) {
    const transition = chain.transitions[i];
    const segment = chain.segments[i];
    const plateauStart = enthalpyAtPrevBoundary + segment.heatCapacity * (transition.boundaryTemp - prevBoundaryTemp);
    const plateauEnd = plateauStart + transition.latentHeat;
    bounds.push({ plateauStart, plateauEnd });
    prevBoundaryTemp = transition.boundaryTemp;
    enthalpyAtPrevBoundary = plateauEnd;
  }

  return bounds;
}

/**
 * Encodes a temperature as enthalpy for the given element's material family.
 * The segment is chosen by the temperature value itself, not by elementId's
 * current phase - so e.g. asking for "Water" at a sub-zero temperature
 * correctly encodes into the Ice segment, keeping paint physically
 * consistent regardless of which element was nominally selected.
 */
export function enthalpyForTemperature(temperature: number, elementId: number): number {
  const chain = getChain(elementId);
  if (!chain) {
    return temperature * getElement(elementId).specificHeat;
  }

  const bounds = buildBreakpoints(chain);
  let prevBoundaryTemp = 0;
  let enthalpyAtPrevBoundary = 0;

  for (let i = 0; i < chain.transitions.length; i++) {
    const transition = chain.transitions[i];
    const segment = chain.segments[i];

    if (temperature <= transition.boundaryTemp) {
      return enthalpyAtPrevBoundary + segment.heatCapacity * (temperature - prevBoundaryTemp);
    }

    prevBoundaryTemp = transition.boundaryTemp;
    enthalpyAtPrevBoundary = bounds[i].plateauEnd;
  }

  const lastSegment = chain.segments[chain.segments.length - 1];
  return enthalpyAtPrevBoundary + lastSegment.heatCapacity * (temperature - prevBoundaryTemp);
}

/**
 * Decodes enthalpy back into a temperature and (possibly updated) element id.
 * `currentElementId` disambiguates which side of a latent-heat plateau a
 * cell is on while its enthalpy is inside that plateau's band (hysteresis:
 * it stays whichever phase it currently is until enthalpy fully clears the
 * band in either direction).
 */
export function temperatureAndElementFromEnthalpy(
  currentElementId: number,
  enthalpy: number,
): { temperature: number; elementId: number } {
  const chain = getChain(currentElementId);
  if (!chain) {
    return { temperature: enthalpy / getElement(currentElementId).specificHeat, elementId: currentElementId };
  }

  const bounds = buildBreakpoints(chain);
  let prevBoundaryTemp = 0;
  let enthalpyAtPrevBoundary = 0;

  for (let i = 0; i < chain.transitions.length; i++) {
    const transition = chain.transitions[i];
    const segment = chain.segments[i];
    const { plateauStart, plateauEnd } = bounds[i];

    if (enthalpy < plateauStart) {
      const temperature = prevBoundaryTemp + (enthalpy - enthalpyAtPrevBoundary) / segment.heatCapacity;
      return { temperature, elementId: segment.elementId };
    }
    if (enthalpy < plateauEnd) {
      const elementId = currentElementId === transition.highElementId ? transition.highElementId : transition.lowElementId;
      return { temperature: transition.boundaryTemp, elementId };
    }

    prevBoundaryTemp = transition.boundaryTemp;
    enthalpyAtPrevBoundary = plateauEnd;
  }

  const lastSegment = chain.segments[chain.segments.length - 1];
  const temperature = prevBoundaryTemp + (enthalpy - enthalpyAtPrevBoundary) / lastSegment.heatCapacity;
  return { temperature, elementId: lastSegment.elementId };
}

/**
 * Energy flowing from `temperatureFrom` toward `temperatureTo` this tick,
 * bottlenecked by whichever side conducts worse (a poor insulator anywhere
 * in the path limits flow, like a resistor in series).
 */
export function heatFlux(
  temperatureFrom: number,
  temperatureTo: number,
  conductivityFrom: number,
  conductivityTo: number,
  rate: number,
): number {
  const conductivity = Math.min(conductivityFrom, conductivityTo);
  return conductivity * rate * (temperatureFrom - temperatureTo);
}
