import { placeRoles, type PetriNet } from '@pnm/core';
import type { EventLogRow } from '@pnm/io';
import { declareActivation, type Activation } from './declare';
import { activityLabels, compileProperty, declareOf, satisfies, type PropertySpec } from './spec';
import type { LtlfDfaOptions } from './ltlf';

/** The activities of one case of a log, in the order in which they happened. */
export interface LogTrace {
  caseId: string;
  activities: string[];
}

export interface TraceOptions {
  /** Which events count: the end of an activity (default), its start, or both. */
  lifecycle?: 'complete' | 'start' | 'all';
}

/** Groups log rows by case, in the order in which the cases first appear. */
export function tracesFromRows(
  rows: readonly Pick<EventLogRow, 'caseId' | 'activity' | 'lifecycle'>[],
  options: TraceOptions = {},
): LogTrace[] {
  const lifecycle = options.lifecycle ?? 'complete';
  const traces = new Map<string, LogTrace>();
  for (const row of rows) {
    if (lifecycle !== 'all' && row.lifecycle !== lifecycle) continue;
    let trace = traces.get(row.caseId);
    if (!trace) {
      trace = { caseId: row.caseId, activities: [] };
      traces.set(row.caseId, trace);
    }
    trace.activities.push(row.activity);
  }
  return [...traces.values()];
}

/**
 * The activities that end a case: the transitions that put a token on a place nothing takes tokens
 * from (a sink place). A case whose last activity is another one has not finished. A quantity place
 * (CO2, waste) that nothing empties is no sink: its tokens belong to no case.
 */
export function endActivities(net: PetriNet): string[] {
  const { labelOf } = activityLabels(net);
  const placeIds = new Set(net.places.map((p) => p.id));
  const roles = placeRoles(net);
  const consumed = new Set(net.arcs.filter((a) => placeIds.has(a.source)).map((a) => a.source));
  const ends = new Set<string>();
  for (const arc of net.arcs) {
    if (
      placeIds.has(arc.target) &&
      !consumed.has(arc.target) &&
      roles.get(arc.target) !== 'quantity'
    ) {
      const label = labelOf.get(arc.source);
      if (label !== undefined) ends.add(label);
    }
  }
  return [...ends];
}

export interface ConformanceOptions {
  /**
   * Activities that end a case. If given, cases whose last activity is not one of them are open
   * (still running when the log ended) and are left out of the counts.
   */
  endActivities?: readonly string[];
  /** Cases listed per property at most. Default 50. */
  maxViolating?: number;
  ltlf?: LtlfDfaOptions;
  /**
   * The activities that exist (the names of the transitions). A property that mentions another
   * activity is reported as an error, which catches typos. Omit to skip the check.
   */
  activities?: readonly string[];
}

export interface ViolatingCase {
  caseId: string;
  activities: string[];
  activation?: Activation;
}

export interface PropertyConformance {
  id: string;
  /** Cases the property was evaluated on. */
  total: number;
  satisfied: number;
  /** `satisfied / total` (1 for an empty log). */
  ratio: number;
  violating: ViolatingCase[];
  /** Number of violating cases (can exceed `violating.length`). */
  violatingCount: number;
  /** Activations and fulfilments summed over the cases, for templates that react to an activity. */
  activation: Activation | null;
  error?: string;
}

export interface ConformanceResult {
  /** Cases in the log. */
  cases: number;
  /** Cases left out because they were still open. */
  open: number;
  properties: PropertyConformance[];
}

/** Checks properties on the cases of an event log: the share of the cases that satisfy each. */
export function checkLog(
  traces: readonly LogTrace[],
  specs: readonly PropertySpec[],
  options: ConformanceOptions = {},
): ConformanceResult {
  const maxViolating = options.maxViolating ?? 50;
  const ends = options.endActivities ? new Set(options.endActivities) : null;
  const closed =
    ends === null
      ? traces
      : traces.filter((t) => {
          const last = t.activities[t.activities.length - 1];
          return last !== undefined && ends.has(last);
        });

  const properties = specs.map((spec): PropertyConformance => {
    const compiled = compileProperty(spec, options.activities ?? null, options.ltlf);
    if (compiled.error !== null && !compiled.tooLarge) {
      return {
        id: spec.id,
        total: closed.length,
        satisfied: 0,
        ratio: 0,
        violating: [],
        violatingCount: 0,
        activation: null,
        error: compiled.error ?? 'The property cannot be evaluated.',
      };
    }
    let satisfied = 0;
    let violatingCount = 0;
    const violating: ViolatingCase[] = [];
    let activations = 0;
    let fulfilled = 0;
    let reacts = false;
    for (const trace of closed) {
      const mine =
        spec.kind === 'declare' ? declareActivation(declareOf(spec), trace.activities) : null;
      if (mine) {
        reacts = true;
        activations += mine.activations;
        fulfilled += mine.fulfilled;
      }
      if (satisfies(compiled, trace.activities)) {
        satisfied += 1;
        continue;
      }
      violatingCount += 1;
      if (violating.length < maxViolating) {
        violating.push({
          caseId: trace.caseId,
          activities: trace.activities,
          ...(mine !== null && { activation: mine }),
        });
      }
    }
    return {
      id: spec.id,
      total: closed.length,
      satisfied,
      ratio: closed.length === 0 ? 1 : satisfied / closed.length,
      violating,
      violatingCount,
      activation: reacts ? { activations, fulfilled } : null,
    };
  });
  return { cases: traces.length, open: traces.length - closed.length, properties };
}
