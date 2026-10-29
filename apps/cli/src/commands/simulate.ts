import { hasErrors, validate, type Id, type PetriNet } from '@pnm/core';
import type { MetricsSnapshot } from '@pnm/sim';
import { numberOption, parseCommandArgs, requireOne } from '../args';
import { CommandError, UsageError } from '../errors';
import { formatDuration, formatNumber, makeStyle, plural } from '../format';
import type { Io } from '../io';
import {
  logRowCount,
  metricsDocument,
  resolveRates,
  runSimulation,
  runToCsv,
  runToEventLines,
  runToXes,
} from '../lib/simulate';
import { metricTables } from '../metrics-text';
import { loadNet, reportImportWarnings } from '../net-file';

export const SIMULATE_HELP = `Usage: pnm simulate <net> [options]

Runs the timed simulation of a net and prints key figures. The run is deterministic: the same
net, seed and options give the same event stream, also in the web app.

  --seconds <n>       model time to simulate, default 3600
  --seed <n>          seed of the random number generator (default: the net's, else 1)
  --warmup <n>        seconds at the start that are left out of the key figures
  --rate <t>=<n>      arrivals per hour of a source transition, by id or name; "off" switches
                      the arrivals off; may be repeated
  --start-time <iso>  time that simulation time 0 maps to in the exports
  --max-events <n>    stop with an error after this many events, default 10000000
  --csv <file>        event log as CSV (case_id, activity, timestamp, lifecycle)
  --xes <file>        event log as XES
  --metrics <file>    key figures and run data as JSON
  --events <file>     the event stream, one JSON object per line
  --quiet, -q         print no summary
  --help

A file name of - writes to standard output; the summary then goes to standard error.
Exit status: 0 success, 1 the net has errors or the run failed, 2 wrong usage.
`;

function parseRates(net: PetriNet, specs: readonly string[]): Record<Id, number | null> {
  const entries = specs.map((spec) => {
    const eq = spec.lastIndexOf('=');
    if (eq <= 0)
      throw new UsageError(`--rate needs the form <transition>=<per hour>, got "${spec}".`);
    const raw = spec.slice(eq + 1);
    const perHour =
      raw === 'off'
        ? null
        : (numberOption(raw, 'rate', (n) => n >= 0, 'a number of at least 0 or "off"') ?? null);
    return { transition: spec.slice(0, eq), perHour };
  });
  return resolveRates(net, entries, '--rate');
}

function summary(net: PetriNet, metrics: MetricsSnapshot, info: Info, io: Io): string {
  const style = makeStyle(io.color);
  const lines: string[] = [];
  lines.push(
    style.bold(
      `${net.name}: simulated ${formatDuration(info.seconds)} (${info.seconds} s), seed ${info.seed}`,
    ),
  );
  lines.push(`  events             ${info.events}`);
  lines.push(
    `  cases completed    ${metrics.completedCases}` +
      (metrics.throughputPerHour === null
        ? ''
        : `  (${formatNumber(metrics.throughputPerHour)} per hour)`),
  );
  lines.push(`  cases in system    ${metrics.casesInSystem}`);
  lines.push(
    `  cycle time         mean ${formatDuration(metrics.meanCycleTime)}, max ${formatDuration(metrics.maxCycleTime)}`,
  );
  lines.push(...metricTables(net, metrics));
  return `${lines.join('\n')}\n`;
}

interface Info {
  seconds: number;
  seed: number;
  events: number;
}

export async function simulateCommand(io: Io, args: readonly string[]): Promise<number> {
  const { values, positionals } = parseCommandArgs(args, {
    seconds: { type: 'string' },
    seed: { type: 'string' },
    warmup: { type: 'string' },
    rate: { type: 'string', multiple: true },
    'start-time': { type: 'string' },
    'max-events': { type: 'string' },
    csv: { type: 'string' },
    xes: { type: 'string' },
    metrics: { type: 'string' },
    events: { type: 'string' },
    quiet: { type: 'boolean', short: 'q' },
  });
  const path = requireOne(positionals, 'net file');
  const seconds = numberOption(values.seconds, 'seconds', (n) => n > 0, 'a number above 0') ?? 3600;
  const seedOption = numberOption(values.seed, 'seed', Number.isInteger, 'an integer');
  const warmup = numberOption(values.warmup, 'warmup', (n) => n >= 0, 'a number of at least 0');
  const maxEvents =
    numberOption(
      values['max-events'],
      'max-events',
      (n) => Number.isInteger(n) && n > 0,
      'a positive integer',
    ) ?? 10_000_000;
  const startTime = values['start-time'];
  if (startTime !== undefined && Number.isNaN(Date.parse(startTime))) {
    throw new UsageError(`--start-time must be an ISO 8601 date and time (got "${startTime}").`);
  }

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
    throw new CommandError(
      `${path}: the net has errors; fix them before simulating (pnm validate).`,
    );
  }

  const rates = parseRates(net, values.rate ?? []);
  const keep = values.csv !== undefined || values.xes !== undefined || values.events !== undefined;
  const run = await runSimulation(net, {
    seconds,
    ...(seedOption !== undefined && { seed: seedOption }),
    ...(warmup !== undefined && { warmup }),
    rates,
    maxEvents,
    keepEvents: keep,
    label: path,
  });
  const { events, warnings, metrics, seed } = run;
  const count = run.eventCount;

  let rows = 0;
  if (values.csv !== undefined) await io.writeText(values.csv, runToCsv(net, run, startTime));
  if (values.xes !== undefined) await io.writeText(values.xes, runToXes(net, run, startTime));
  if (values.csv !== undefined || values.xes !== undefined) {
    rows = logRowCount(net, run, startTime);
  }
  if (values.events !== undefined) await io.writeText(values.events, runToEventLines(run));
  if (values.metrics !== undefined) {
    await io.writeText(values.metrics, `${JSON.stringify(metricsDocument(net, run), null, 2)}\n`);
  }

  const toStdout = [values.csv, values.xes, values.metrics, values.events].includes('-');
  const say = (text: string): void => {
    if (toStdout) io.err(text);
    else io.out(text);
  };
  for (const warning of warnings.slice(0, 5)) io.err(`${path}: warning: ${warning}\n`);
  if (warnings.length > 5) io.err(`${path}: warning: ${warnings.length - 5} more warnings\n`);
  if (values.quiet !== true) {
    say(summary(net, metrics, { seconds, seed, events: count }, io));
    const written: string[] = [];
    if (values.csv !== undefined && values.csv !== '-')
      written.push(`${values.csv} (${plural(rows, 'row')})`);
    if (values.xes !== undefined && values.xes !== '-')
      written.push(`${values.xes} (${plural(rows, 'event')})`);
    if (values.metrics !== undefined && values.metrics !== '-') written.push(values.metrics);
    if (values.events !== undefined && values.events !== '-')
      written.push(`${values.events} (${plural(events.length, 'line')})`);
    if (written.length > 0) say(`\nWrote ${written.join(', ')}\n`);
  }
  return 0;
}
