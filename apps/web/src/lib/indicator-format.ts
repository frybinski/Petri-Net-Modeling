import type { Indicator, IndicatorMeasure, PetriNet } from '@pnm/core';
import { en } from '../i18n/en';

const nameOf = (net: PetriNet, id: string): string =>
  net.places.find((p) => p.id === id)?.name ?? net.transitions.find((t) => t.id === id)?.name ?? id;

/** What a measure counts, in words: `put on CO2e (kg) via Cutting`. */
export function describeMeasure(net: PetriNet, measure: IndicatorMeasure): string {
  const t = en.indicators;
  const name = nameOf(net, measure.of);
  switch (measure.kind) {
    case 'tokens':
      return t.describeNow(name);
    case 'firings':
      return t.describeFirings(name);
    case 'inflow':
    case 'outflow': {
      const base = measure.kind === 'inflow' ? t.describeIn(name) : t.describeOut(name);
      return measure.via === undefined
        ? base
        : `${base} ${t.describeVia(nameOf(net, measure.via))}`;
    }
  }
}

/** One line for the list: what is measured and what it is relative to. */
export function describeIndicator(net: PetriNet, indicator: Indicator): string {
  const t = en.indicators;
  const parts = [describeMeasure(net, indicator.measure)];
  const per = indicator.per;
  if (per === 'case') parts.push(t.describePerCase);
  else if (per === 'hour') parts.push(t.describePerHour);
  else if (per !== undefined) parts.push(t.describePer(describeMeasure(net, per)));
  return parts.join(' · ');
}

/** An id for a new indicator, made from its name and different from the ones in use. */
export function newIndicatorId(label: string, taken: readonly string[]): string {
  const base =
    label
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'indicator';
  let id = base;
  for (let n = 2; taken.includes(id); n += 1) id = `${base}-${n}`;
  return id;
}
