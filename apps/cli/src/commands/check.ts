import { hasErrors, validate, type Marking, type PetriNet, type Token } from '@pnm/core';
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
  propertyTitle,
  tracesFromRows,
  LtlfSyntaxError,
  type CheckResult,
  type ConformanceResult,
  type FinalStates,
  type PropertySpec,
} from '@pnm/analysis';
import { numberOption, parseCommandArgs, requireOne } from '../args';
import { CommandError, UsageError } from '../errors';
import { makeStyle, plural } from '../format';
import type { Io } from '../io';
import { loadNet, reportImportWarnings } from '../net-file';

export const CHECK_HELP = `Usage: pnm check <net> [--declare <t>]... [--ltlf <f>]... [options]

Checks behavioural properties of a net. A property is a DECLARE template or an LTLf formula over
the names of the transitions. Without --declare and --ltlf the properties stored in the net
(the "properties" list) are checked.

  --declare <t>       a template, for example "response(Approve, Create invoice)"; may be repeated.
                      Templates: existence absence exactly init end responded-existence
                      co-existence response precedence succession alternate-response
                      alternate-precedence alternate-succession chain-response chain-precedence
                      chain-succession not-co-existence not-succession not-chain-succession
                      choice exclusive-choice. existence/absence/exactly take a count: existence(a, 2)
  --ltlf <f>          an LTLf formula, for example "G(a -> F b)"; may be repeated. Operators:
                      ! & | -> <-> X Xw F G U W R true false; names with spaces go in quotation marks
  --final <e>         what ends a run: deadlock (default), all (check every prefix) or a JSON file
                      with a list of markings (place name or id -> token count)
  --states <n>        maximum number of states, default ${DEFAULT_MAX_STATES}
  --time <ms>         maximum time for the state space, default ${DEFAULT_MAX_TIME_MS}
  --log <file.csv>    check an event log (CSV with case_id, activity, lifecycle) instead of the state
                      space; prints the share of the cases that satisfy each property
  --include-open      with --log: also count cases that have not reached an end activity
  --json              print the result as JSON
  --help

A property holds if every run from the initial marking to an end state satisfies it. A violated
property comes with a shortest counterexample.
Exit status: 0 all properties hold, 1 a property is violated or cannot be verified (the state space
was cut off), or the net has errors, 2 wrong usage (unreadable property, unknown activity).
`;

/** Resolves a place by id or name. */
function placeId(net: PetriNet, key: string): string {
  const byId = net.places.find((p) => p.id === key);
  if (byId) return byId.id;
  const byName = net.places.filter((p) => p.name === key);
  if (byName.length === 1 && byName[0]) return byName[0].id;
  throw new UsageError(
    byName.length > 1
      ? `--final: the place name "${key}" is ambiguous; use the id.`
      : `--final: the net has no place "${key}".`,
  );
}

async function readMarkings(io: Io, net: PetriNet, file: string): Promise<Marking[]> {
  let json: unknown;
  try {
    json = JSON.parse(await io.readText(file));
  } catch (error) {
    throw new UsageError(`--final: ${file} cannot be read as JSON (${(error as Error).message}).`);
  }
  const list = Array.isArray(json) ? json : [json];
  return list.map((entry, index): Marking => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new UsageError(`--final: entry ${index + 1} of ${file} must be an object.`);
    }
    const marking: Marking = {};
    for (const [key, value] of Object.entries(entry)) {
      const id = placeId(net, key);
      if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
        if (value > 0) marking[id] = Array.from({ length: value }, () => 1);
      } else if (Array.isArray(value)) {
        if (value.length > 0) marking[id] = value as Token[];
      } else {
        throw new UsageError(`--final: "${key}" must be a token count or a list of tokens.`);
      }
    }
    return marking;
  });
}

function collectSpecs(
  net: PetriNet,
  declares: readonly string[],
  ltlfs: readonly string[],
  io: Io,
  path: string,
): PropertySpec[] {
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
  if (specs.length > 0) return specs;
  const stored = parseProperties(net.properties);
  for (const message of stored.errors) io.err(`${path}: warning: ${message}\n`);
  if (stored.properties.length === 0) {
    throw new UsageError(
      'No properties to check. Give --declare or --ltlf, or store properties in the net.',
    );
  }
  return stored.properties;
}

function describeCounterexample(result: CheckResult, net: PetriNet): string[] {
  const counter = result.counterexample;
  if (!counter) return [];
  const names = new Map(net.places.map((p) => [p.id, p.name || p.id]));
  const steps =
    counter.steps.length === 0
      ? ['(the empty run)']
      : counter.steps.map((step, index) => {
          const binding =
            step.binding !== undefined && Object.keys(step.binding).length > 0
              ? ` ${JSON.stringify(step.binding)}`
              : '';
          return `${index + 1}. ${counter.activities[index] ?? step.transitionId}${binding}`;
        });
  const marking = Object.entries(counter.marking)
    .filter(([, tokens]) => tokens.length > 0)
    .map(([id, tokens]) => `${names.get(id) ?? id}${tokens.length > 1 ? ` x${tokens.length}` : ''}`)
    .join(', ');
  return [
    `counterexample (${plural(counter.steps.length, 'step')}):`,
    ...steps.map((line) => `  ${line}`),
    `ends in: ${marking === '' ? '(empty marking)' : marking}`,
  ];
}

function finalName(final: FinalStates): string {
  return final === 'deadlock' || final === 'all' ? final : 'markings';
}

export async function checkCommand(io: Io, args: readonly string[]): Promise<number> {
  const { values, positionals } = parseCommandArgs(args, {
    declare: { type: 'string', multiple: true },
    ltlf: { type: 'string', multiple: true },
    final: { type: 'string' },
    states: { type: 'string' },
    time: { type: 'string' },
    log: { type: 'string' },
    'include-open': { type: 'boolean' },
    json: { type: 'boolean' },
  });
  const path = requireOne(positionals, 'net file');
  const states =
    numberOption(
      values.states,
      'states',
      (n) => Number.isInteger(n) && n > 0,
      'a positive integer',
    ) ?? DEFAULT_MAX_STATES;
  const timeMs =
    numberOption(values.time, 'time', (n) => n > 0, 'a number of milliseconds above 0') ??
    DEFAULT_MAX_TIME_MS;

  const loaded = await loadNet(io, path);
  const { net } = loaded;
  reportImportWarnings(io, path, loaded);
  const problems = validate(net);
  if (hasErrors(problems)) {
    for (const d of problems.filter((p) => p.severity === 'error')) {
      io.err(
        `${path}: error: ${d.message}${d.elementId !== undefined ? ` (${d.elementId})` : ''}\n`,
      );
    }
    throw new CommandError(`${path}: the net has errors; fix them before checking (pnm validate).`);
  }

  const specs = collectSpecs(net, values.declare ?? [], values.ltlf ?? [], io, path);
  const { labels } = activityLabels(net);
  // Typos and templates with the wrong number of activities are usage errors, not verdicts.
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
  const style = makeStyle(io.color);

  if (values.log !== undefined) {
    let text: string;
    try {
      text = await io.readText(values.log);
    } catch (error) {
      throw new CommandError(`${values.log}: cannot be read (${(error as Error).message})`);
    }
    let rows;
    try {
      rows = parseEventLogCsv(text);
    } catch (error) {
      if (error instanceof EventLogParseError)
        throw new CommandError(`${values.log}: ${error.message}`);
      throw error;
    }
    const ends = endActivities(net);
    const skipOpen = values['include-open'] !== true && ends.length > 0;
    const result = checkLog(tracesFromRows(rows), specs, {
      ...(skipOpen && { endActivities: ends }),
      activities: labels,
    });
    const ok = result.properties.every((p) => p.error === undefined && p.violatingCount === 0);
    if (values.json === true) {
      io.out(`${JSON.stringify(logJson(path, values.log, specs, result, skipOpen), null, 2)}\n`);
    } else {
      io.out(logText(net, values.log, specs, result, skipOpen, style));
    }
    return ok ? 0 : 1;
  }

  let final: FinalStates = 'deadlock';
  if (values.final !== undefined) {
    final =
      values.final === 'deadlock' || values.final === 'all'
        ? values.final
        : { markings: await readMarkings(io, net, values.final) };
  }
  const space = await buildStateSpace(net, {
    maxStates: states,
    maxTimeMs: timeMs,
    ...(typeof final === 'object' && { final }),
  });
  const results = await checkProperties(net, space, specs, { final });
  const ok = results.every((r) => r.verdict === 'holds');
  if (values.json === true) {
    io.out(
      `${JSON.stringify(
        {
          file: path,
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
        },
        null,
        2,
      )}\n`,
    );
  } else {
    const lines: string[] = [
      style.bold(
        `${net.name}: ${plural(space.states.length, 'state')}, ${plural(space.edges.length, 'edge')}` +
          (space.truncated ? ` (cut off: ${space.reason ?? 'limit'})` : ''),
      ),
    ];
    results.forEach((result, i) => {
      const spec = specs[i]!;
      const verdict =
        result.verdict === 'holds'
          ? style.green('holds    ')
          : result.verdict === 'violated'
            ? style.red('VIOLATED ')
            : style.yellow('unknown  ');
      lines.push('', `${verdict}${propertyTitle(spec)}`);
      const indent = ' '.repeat(9);
      if (propertyTitle(spec) !== propertyText(spec)) lines.push(`${indent}${propertyText(spec)}`);
      lines.push(`${indent}${propertyMeaning(spec)}`);
      lines.push(`${indent}${result.explanation}`);
      for (const warning of result.warnings)
        lines.push(`${indent}${style.yellow('warning:')} ${warning}`);
      for (const line of describeCounterexample(result, net)) lines.push(`${indent}${line}`);
    });
    io.out(`${lines.join('\n')}\n`);
  }
  return ok ? 0 : 1;
}

function logText(
  net: PetriNet,
  file: string,
  specs: readonly PropertySpec[],
  result: ConformanceResult,
  skipOpen: boolean,
  style: ReturnType<typeof makeStyle>,
): string {
  const lines = [
    style.bold(
      `${net.name} against ${file}: ${plural(result.cases, 'case')}` +
        (skipOpen ? `, ${result.open} still open and left out` : ''),
    ),
  ];
  result.properties.forEach((p, i) => {
    const spec = specs[i]!;
    const percent = `${Math.round(p.ratio * 1000) / 10} %`;
    const verdict = p.violatingCount === 0 ? style.green('holds    ') : style.red('VIOLATED ');
    lines.push('', `${verdict}${propertyTitle(spec)}`);
    if (propertyTitle(spec) !== propertyText(spec)) lines.push(`         ${propertyText(spec)}`);
    lines.push(`         ${propertyMeaning(spec)}`);
    lines.push(`         ${p.satisfied} of ${p.total} cases satisfy it (${percent})`);
    if (p.activation) {
      lines.push(
        `         activations ${p.activation.activations}, fulfilled ${p.activation.fulfilled}`,
      );
    }
    for (const v of p.violating.slice(0, 5)) {
      lines.push(`         case ${v.caseId}: ${v.activities.join(' -> ')}`);
    }
    if (p.violatingCount > 5) lines.push(`         ... and ${p.violatingCount - 5} more`);
  });
  return `${lines.join('\n')}\n`;
}

function logJson(
  file: string,
  log: string,
  specs: readonly PropertySpec[],
  result: ConformanceResult,
  skipOpen: boolean,
): unknown {
  return {
    file,
    mode: 'log',
    log,
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
