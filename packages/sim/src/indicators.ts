import {
  DEFAULT_INDICATOR_DIGITS,
  type Id,
  type Indicator,
  type IndicatorMeasure,
  type PetriNet,
} from '@pnm/core';
import type { SimEvent } from './types';

/** The value of an indicator after a run (or part of one). */
export interface IndicatorValue {
  id: string;
  label: string;
  /** Shown after the value; empty if the indicator has no unit. */
  unit: string;
  /** `null` if the reference is 0 (nothing to relate to yet), shown as a dash. */
  value: number | null;
  /** Decimal places to show. */
  digits: number;
}

/** What the key figures of a run know that an indicator may be built from. */
export interface IndicatorInput {
  /** Tokens on every place now. */
  count: Readonly<Record<Id, number>>;
  /** Cases completed in the observation window. */
  completedCases: number;
  /** Seconds observed (since the warm-up). */
  observedSeconds: number;
  /** The counters of `IndicatorCounters`, by the keys of `counterKey`. */
  counters: Readonly<Record<string, number>>;
}

/** The key of the counter that a flow or firing measure reads, or `null` for a momentary value. */
export function counterKey(measure: IndicatorMeasure): string | null {
  switch (measure.kind) {
    case 'tokens':
      return null;
    case 'firings':
      return `fire:${measure.of}`;
    case 'inflow':
    case 'outflow': {
      const base = `${measure.kind === 'inflow' ? 'in' : 'out'}:${measure.of}`;
      return measure.via === undefined ? base : `${base}|${measure.via}`;
    }
  }
}

function measuresOf(indicator: Indicator): IndicatorMeasure[] {
  return typeof indicator.per === 'object'
    ? [indicator.measure, indicator.per]
    : [indicator.measure];
}

/** The counters that the indicators of a net need; empty if it has none. */
export function neededCounters(net: PetriNet): Set<string> {
  const keys = new Set<string>();
  for (const indicator of net.simulation?.indicators ?? []) {
    for (const measure of measuresOf(indicator)) {
      const key = counterKey(measure);
      if (key !== null) keys.add(key);
    }
  }
  return keys;
}

/**
 * Counts the flows and firings that indicators relate to, for the events inside the observation
 * window. Returns a function that adds an event to `counters` (which it changes). A firing is
 * counted when it starts, the tokens it takes when it starts and the tokens it puts when it
 * completes.
 */
export function counterUpdater(
  keys: ReadonlySet<string>,
  warmup: number,
): (counters: Record<string, number>, event: SimEvent) => void {
  const bump = (counters: Record<string, number>, key: string, by = 1): void => {
    if (keys.has(key)) counters[key] = (counters[key] ?? 0) + by;
  };
  return (counters, event) => {
    if (event.t < warmup) return;
    if (event.type === 'start') {
      bump(counters, `fire:${event.transitionId}`);
      for (const ref of event.consumed) {
        bump(counters, `out:${ref.placeId}`);
        bump(counters, `out:${ref.placeId}|${event.transitionId}`);
      }
    } else if (event.type === 'complete') {
      for (const ref of event.produced) {
        bump(counters, `in:${ref.placeId}`);
        bump(counters, `in:${ref.placeId}|${event.transitionId}`);
      }
    }
  };
}

function measureValue(measure: IndicatorMeasure, input: IndicatorInput): number {
  if (measure.kind === 'tokens') return input.count[measure.of] ?? 0;
  const key = counterKey(measure);
  return key === null ? 0 : (input.counters[key] ?? 0);
}

/** The value of one indicator: `factor` times the measure, divided by the reference. */
export function indicatorValue(indicator: Indicator, input: IndicatorInput): IndicatorValue {
  const factor = indicator.factor ?? 1;
  const measured = measureValue(indicator.measure, input);
  let reference = 1;
  const per = indicator.per;
  if (per === 'case') reference = input.completedCases;
  else if (per === 'hour') reference = input.observedSeconds / 3600;
  else if (per !== undefined) reference = measureValue(per, input);
  const value = reference > 0 ? (factor * measured) / reference : null;
  return {
    id: indicator.id,
    label: indicator.label,
    unit: indicator.unit ?? '',
    value: value !== null && Number.isFinite(value) ? value : null,
    digits: indicator.digits ?? DEFAULT_INDICATOR_DIGITS,
  };
}

/** The values of all indicators of a net, in the order of the net. */
export function indicatorValues(net: PetriNet, input: IndicatorInput): IndicatorValue[] {
  return (net.simulation?.indicators ?? []).map((indicator) => indicatorValue(indicator, input));
}

/** The value as text with the decimal places of the indicator: `14.8`, or `–` if there is none. */
export function formatIndicatorValue(entry: Pick<IndicatorValue, 'value' | 'digits'>): string {
  return entry.value === null ? '–' : entry.value.toFixed(entry.digits);
}
