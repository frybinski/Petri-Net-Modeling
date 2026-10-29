import { hasErrors, validate, type Marking, type PetriNet } from '@pnm/core';
import {
  DEFAULT_MAX_STATES,
  DEFAULT_MAX_TIME_MS,
  propertyMeaning,
  propertyText,
  propertyTitle,
  type CheckResult,
  type ConformanceResult,
  type FinalStates,
  type PropertySpec,
} from '@pnm/analysis';
import { numberOption, parseCommandArgs, requireOne } from '../args';
import { CommandError, UsageError } from '../errors';
import { makeStyle, plural } from '../format';
import type { Io } from '../io';
import {
  assertSpecsValid,
  collectSpecs,
  logCheckJson,
  parseFinalMarkings,
  runLogCheck,
  runStateSpaceCheck,
  stateSpaceCheckJson,
} from '../lib/check';
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

async function readMarkings(io: Io, net: PetriNet, file: string): Promise<Marking[]> {
  let json: unknown;
  try {
    json = JSON.parse(await io.readText(file));
  } catch (error) {
    throw new UsageError(`--final: ${file} cannot be read as JSON (${(error as Error).message}).`);
  }
  return parseFinalMarkings(net, json, '--final');
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

  const { specs, warnings } = collectSpecs(net, values.declare ?? [], values.ltlf ?? []);
  for (const message of warnings) io.err(`${path}: warning: ${message}\n`);
  assertSpecsValid(net, specs);
  const style = makeStyle(io.color);

  if (values.log !== undefined) {
    let text: string;
    try {
      text = await io.readText(values.log);
    } catch (error) {
      throw new CommandError(`${values.log}: cannot be read (${(error as Error).message})`);
    }
    const run = runLogCheck(net, specs, text, {
      includeOpen: values['include-open'] === true,
      label: values.log,
    });
    if (values.json === true) {
      const { mode, ...rest } = logCheckJson(specs, run);
      io.out(`${JSON.stringify({ file: path, mode, log: values.log, ...rest }, null, 2)}\n`);
    } else {
      io.out(logText(net, values.log, specs, run.result, run.skipOpen, style));
    }
    return run.ok ? 0 : 1;
  }

  let final: FinalStates = 'deadlock';
  if (values.final !== undefined) {
    final =
      values.final === 'deadlock' || values.final === 'all'
        ? values.final
        : { markings: await readMarkings(io, net, values.final) };
  }
  const run = await runStateSpaceCheck(net, specs, { final, states, timeMs });
  const { space, results, ok } = run;
  if (values.json === true) {
    const { mode, ...rest } = stateSpaceCheckJson(net, specs, run);
    io.out(`${JSON.stringify({ file: path, mode, ...rest }, null, 2)}\n`);
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
