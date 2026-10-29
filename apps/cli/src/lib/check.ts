import type { Marking, PetriNet, Token } from '@pnm/core';
import { parseEventLogCsv, EventLogParseError } from '@pnm/io';
import {
  DEFAULT_MAX_STATES,
  DEFAULT_MAX_TIME_MS,
  activityLabels,
  buildStateSpace,
  checkLog,
  checkProperties,
  compileProperty,
  endActivities,
  parseDeclare,
  parseLtlf,
  parseProperties,
  propertyMeaning,
  propertyText,
  tracesFromRows,
  LtlfSyntaxError,
  type CheckResult,
  type ConformanceResult,
  type FinalStates,
  type PropertySpec,
  type StateSpace,
} from '@pnm/analysis';
import { CommandError, UsageError } from '../errors';

export { DEFAULT_MAX_STATES, DEFAULT_MAX_TIME_MS };

/** Resolves a place by id or name. */
function placeId(net: PetriNet, key: string, what: string): string {
  const byId = net.places.find((p) => p.id === key);
  if (byId) return byId.id;
  const byName = net.places.filter((p) => p.name === key);
  if (byName.length === 1 && byName[0]) return byName[0].id;
  throw new UsageError(
    byName.length > 1
      ? `${what}: the place name "${key}" is ambiguous; use the id.`
      : `${what}: the net has no place "${key}".`,
  );
}

/**
 * Markings that end a run: a list of objects (or one object) from place name or id to a token
 * count or a list of tokens. `what` names the source in the messages (`--final`, `final`).
 */
export function parseFinalMarkings(net: PetriNet, json: unknown, what: string): Marking[] {
  const list = Array.isArray(json) ? json : [json];
  return list.map((entry, index): Marking => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new UsageError(`${what}: entry ${index + 1} must be an object.`);
    }
    const marking: Marking = {};
    for (const [key, value] of Object.entries(entry)) {
      const id = placeId(net, key, what);
      if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
        if (value > 0) marking[id] = Array.from({ length: value }, () => 1);
      } else if (Array.isArray(value)) {
        if (value.length > 0) marking[id] = value as Token[];
      } else {
        throw new UsageError(`${what}: "${key}" must be a token count or a list of tokens.`);
      }
    }
    return marking;
  });
}

/**
 * The properties to check: the DECLARE templates and LTLf formulas given, else those stored in the
 * net. Problems with stored properties come back as `warnings`. Throws a `UsageError` for a
 * property that cannot be read or if there is none.
 */
export function collectSpecs(
  net: PetriNet,
  declares: readonly string[],
  ltlfs: readonly string[],
): { specs: PropertySpec[]; warnings: string[] } {
  const specs: PropertySpec[] = [];
  declares.forEach((text, index) => {
    try {
      const parsed = parseDeclare(text);
      specs.push({
        id: `declare-${index + 1}`,
        kind: 'declare',
        template: parsed.template,
        activities: parsed.activities,
        ...(parsed.n !== undefined && { n: parsed.n }),
      });
    } catch (error) {
      throw new UsageError(`--declare "${text}": ${(error as Error).message}`);
    }
  });
  ltlfs.forEach((formula, index) => {
    try {
      parseLtlf(formula);
    } catch (error) {
      if (error instanceof LtlfSyntaxError) {
        throw new UsageError(`--ltlf "${formula}": ${error.message}`);
      }
      throw error;
    }
    specs.push({ id: `ltlf-${index + 1}`, kind: 'ltlf', formula });
  });
  if (specs.length > 0) return { specs, warnings: [] };
  const stored = parseProperties(net.properties);
  if (stored.properties.length === 0) {
    throw new UsageError(
      'No properties to check. Give --declare or --ltlf, or store properties in the net.',
    );
  }
  return { specs: stored.properties, warnings: stored.errors };
}

/** Typos and templates with the wrong number of activities are usage errors, not verdicts. */
export function assertSpecsValid(net: PetriNet, specs: readonly PropertySpec[]): void {
  const { labels } = activityLabels(net);
  const faulty = specs
    .map((spec) => ({ spec, compiled: compileProperty(spec, labels) }))
    .filter(({ compiled }) => compiled.error !== null && !compiled.tooLarge);
  if (faulty.length > 0) {
    throw new UsageError(
      faulty
        .map(({ spec, compiled }) => `${propertyText(spec)}: ${compiled.error ?? ''}`)
        .join('\n'),
    );
  }
}

export function finalName(final: FinalStates): string {
  return final === 'deadlock' || final === 'all' ? final : 'markings';
}

export interface StateSpaceCheck {
  final: FinalStates;
  space: StateSpace;
  results: CheckResult[];
  ok: boolean;
}

/** Checks the properties on the state space of the net. */
export async function runStateSpaceCheck(
  net: PetriNet,
  specs: readonly PropertySpec[],
  options: { final: FinalStates; states: number; timeMs: number },
): Promise<StateSpaceCheck> {
  const { final } = options;
  const space = await buildStateSpace(net, {
    maxStates: options.states,
    maxTimeMs: options.timeMs,
    ...(typeof final === 'object' && { final }),
  });
  const results = await checkProperties(net, space, [...specs], { final });
  return { final, space, results, ok: results.every((r) => r.verdict === 'holds') };
}

/** The result of `pnm check --json` on the state space, without the name of the file. */
export function stateSpaceCheckJson(
  net: PetriNet,
  specs: readonly PropertySpec[],
  run: StateSpaceCheck,
): Record<string, unknown> {
  const { space, results, final, ok } = run;
  return {
    mode: 'state-space',
    final: finalName(final),
    states: space.states.length,
    edges: space.edges.length,
    complete: !space.truncated,
    ...(space.reason !== undefined && { reason: space.reason }),
    ok,
    properties: results.map((r, i) => {
      const spec = specs[i]!;
      return {
        id: r.id,
        property: propertyText(spec),
        meaning: propertyMeaning(spec),
        verdict: r.verdict,
        explanation: r.explanation,
        vacuous: r.vacuous,
        infiniteRuns: r.infiniteRuns,
        warnings: r.warnings,
        ...(r.counterexample && {
          counterexample: {
            steps: r.counterexample.steps.map((s, k) => ({
              transition: r.counterexample?.activities[k],
              ...(s.binding !== undefined && { binding: s.binding }),
            })),
            marking: Object.fromEntries(
              Object.entries(r.counterexample.marking).map(([id, tokens]) => [
                net.places.find((p) => p.id === id)?.name ?? id,
                tokens,
              ]),
            ),
          },
        }),
      };
    }),
  };
}

export interface LogCheck {
  result: ConformanceResult;
  /** Cases that have not reached an end activity were left out. */
  skipOpen: boolean;
  ok: boolean;
}

/** Checks the properties on the cases of an event log (CSV). `label` names the log in messages. */
export function runLogCheck(
  net: PetriNet,
  specs: readonly PropertySpec[],
  csv: string,
  options: { includeOpen: boolean; label: string },
): LogCheck {
  let rows;
  try {
    rows = parseEventLogCsv(csv);
  } catch (error) {
    if (error instanceof EventLogParseError)
      throw new CommandError(`${options.label}: ${error.message}`);
    throw error;
  }
  const { labels } = activityLabels(net);
  const ends = endActivities(net);
  const skipOpen = !options.includeOpen && ends.length > 0;
  const result = checkLog(tracesFromRows(rows), [...specs], {
    ...(skipOpen && { endActivities: ends }),
    activities: labels,
  });
  return {
    result,
    skipOpen,
    ok: result.properties.every((p) => p.error === undefined && p.violatingCount === 0),
  };
}

/** The result of `pnm check --json` on a log, without the name of the file and of the log. */
export function logCheckJson(
  specs: readonly PropertySpec[],
  run: LogCheck,
): Record<string, unknown> {
  const { result, skipOpen } = run;
  return {
    mode: 'log',
    cases: result.cases,
    open: result.open,
    skippedOpen: skipOpen,
    ok: result.properties.every((p) => p.violatingCount === 0),
    properties: result.properties.map((p, i) => ({
      id: p.id,
      property: propertyText(specs[i]!),
      total: p.total,
      satisfied: p.satisfied,
      ratio: p.ratio,
      violatingCount: p.violatingCount,
      activation: p.activation,
      violating: p.violating.map((v) => ({ caseId: v.caseId, activities: v.activities })),
    })),
  };
}
