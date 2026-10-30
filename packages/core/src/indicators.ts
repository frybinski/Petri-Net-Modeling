import type { Indicator, IndicatorMeasure, PetriNet } from './model';

/** Decimal places of an indicator whose `digits` is not set. */
export const DEFAULT_INDICATOR_DIGITS = 1;
/** The most decimal places an indicator may show. */
export const MAX_INDICATOR_DIGITS = 6;

/** What is wrong with one field of an indicator. `path` is relative to the indicator. */
export interface IndicatorProblem {
  /** The field, for example `measure.of`, `per.via`, `factor`, `digits`, `id`. */
  path: string;
  message: string;
}

/** The measures that count tokens of a place, as opposed to the firings of a transition. */
export function measureCountsPlace(measure: IndicatorMeasure): boolean {
  return measure.kind !== 'firings';
}

function measureProblems(
  net: PetriNet,
  measure: IndicatorMeasure,
  base: string,
): IndicatorProblem[] {
  const out: IndicatorProblem[] = [];
  const place = net.places.find((p) => p.id === measure.of);
  const transition = net.transitions.find((t) => t.id === measure.of);
  if (measure.kind === 'firings') {
    if (!transition) {
      out.push({
        path: `${base}.of`,
        message: place
          ? `"${measure.of}" is a place; firings are counted for a transition.`
          : `The net has no transition "${measure.of}".`,
      });
    }
    return out;
  }
  if (!place) {
    out.push({
      path: `${base}.of`,
      message: transition
        ? `"${measure.of}" is a transition; ${measure.kind} counts tokens of a place.`
        : `The net has no place "${measure.of}".`,
    });
  }
  if (measure.kind !== 'tokens' && measure.via !== undefined) {
    const via = net.transitions.find((t) => t.id === measure.via);
    if (!via) {
      out.push({
        path: `${base}.via`,
        message: net.places.some((p) => p.id === measure.via)
          ? `"${measure.via}" is a place; "via" names a transition.`
          : `The net has no transition "${measure.via}".`,
      });
    } else if (place) {
      const connected = net.arcs.some((a) =>
        measure.kind === 'inflow'
          ? a.source === via.id && a.target === place.id
          : a.source === place.id && a.target === via.id,
      );
      if (!connected) {
        out.push({
          path: `${base}.via`,
          message:
            measure.kind === 'inflow'
              ? `There is no arc from "${via.id}" to "${place.id}", so nothing flows in over it.`
              : `There is no arc from "${place.id}" to "${via.id}", so nothing flows out over it.`,
        });
      }
    }
  }
  return out;
}

/**
 * Checks one indicator against the net: the places and transitions it names exist and are of the
 * right kind, `via` has an arc to the place, `factor` is finite, `digits` is an integer from 0 to
 * 6. `earlier` are the indicators before it in the list (for the duplicate id).
 */
export function indicatorProblems(
  net: PetriNet,
  indicator: Indicator,
  earlier: readonly Indicator[] = [],
): IndicatorProblem[] {
  const out: IndicatorProblem[] = [];
  if (indicator.id.trim() === '') out.push({ path: 'id', message: 'The id must not be empty.' });
  else if (earlier.some((other) => other.id === indicator.id)) {
    out.push({
      path: 'id',
      message: `The id "${indicator.id}" is used by more than one indicator.`,
    });
  }
  out.push(...measureProblems(net, indicator.measure, 'measure'));
  if (indicator.per !== undefined && typeof indicator.per === 'object') {
    out.push(...measureProblems(net, indicator.per, 'per'));
  }
  if (indicator.factor !== undefined && !Number.isFinite(indicator.factor)) {
    out.push({ path: 'factor', message: 'The factor must be a finite number.' });
  }
  const digits = indicator.digits;
  if (
    digits !== undefined &&
    !(Number.isInteger(digits) && digits >= 0 && digits <= MAX_INDICATOR_DIGITS)
  ) {
    out.push({
      path: 'digits',
      message: `The decimal places must be an integer from 0 to ${MAX_INDICATOR_DIGITS} (found ${digits}).`,
    });
  }
  return out;
}
