import { hasErrors, validate, type PetriNet } from '@pnm/core';
import { eventLogRows, toEventLogCsv, toXes, type LogColumns } from '@pnm/io';
import type { ActivityMapping, CompleteOnly, MetricsSnapshot } from '@pnm/sim';
import { choiceOption, numberOption, parseCommandArgs } from '../args';
import { CommandError, UsageError } from '../errors';
import { formatDuration, formatNumber, makeStyle, plural, table } from '../format';
import type { Io } from '../io';
import { runReplay } from '../lib/replay';
import { metricTables } from '../metrics-text';
import { loadNet, reportImportWarnings } from '../net-file';

export const REPLAY_HELP = `Usage: pnm replay <net> <log.csv|log.xes> [options]

Replays an event log on the net: cases enter with their first event, activities take the tokens of
their case and put tokens on the next places, at the times of the log. Where the log does not fit the
net, a token is created and the deviation is counted. Prints the fitness (token replay, Rozinat and
van der Aalst: 1 - missing/consumed/2 - remaining/produced/2), the deviations and the key figures.

The log is CSV (the export of this tool, or any file with a case, an activity and a time column;
comma, semicolon or tab separated) or XES. Activities are matched to transitions by name, ignoring
case, spaces, _ and -, then by id, then by a unique beginning; the others are listed and skipped.

  --map <a>=<t>          activity of the log = transition (id or name); may be repeated
  --ignore <a>           skip this activity without a remark; may be repeated
  --complete-only <m>    zero (default): an activity without a start takes no time;
                         span: it starts when the previous activity of its case ended
  --time-origin <t>      time 0: first (default, the first event), net (the start time of the net)
                         or an ISO 8601 time
  --case-column <c>      CSV: the column with the case, if it is not named case_id, case, ...
  --activity-column <c>  CSV: the column with the activity
  --time-column <c>      CSV: the column with the time (ISO 8601 or Unix seconds)
  --lifecycle-column <c> CSV: the column with start/complete (without it every row is a complete)
  --check-guards         also check the guards of the transitions (JSON nets)
  --seed <n>             choose among free tokens of a resource at random (default: the oldest)
  --warmup <n>           seconds at the start that are left out of the key figures
  --strict               exit with status 1 if the fitness is below 1
  --csv <file>           the replayed events as an event log (case_id, activity, timestamp, lifecycle)
  --xes <file>           the same as XES
  --metrics <file>       the figures of the replay as JSON
  --json                 print the figures as JSON instead of the summary
  --quiet, -q            print no summary
  --help

A file name of - writes to standard output; the summary then goes to standard error.
Exit status: 0 success, 1 the net or the log cannot be used, or --strict and a deviation, 2 wrong usage.
`;

function columnsOf(values: Record<string, unknown>): LogColumns {
  const columns: LogColumns = {};
  const pairs = [
    ['case', 'case-column'],
    ['activity', 'activity-column'],
    ['time', 'time-column'],
    ['lifecycle', 'lifecycle-column'],
  ] as const;
  for (const [key, option] of pairs) {
    const value = values[option];
    if (typeof value === 'string') columns[key] = value;
  }
  return columns;
}

export async function replayCommand(io: Io, args: readonly string[]): Promise<number> {
  const { values, positionals } = parseCommandArgs(args, {
    map: { type: 'string', multiple: true },
    ignore: { type: 'string', multiple: true },
    'complete-only': { type: 'string' },
    'time-origin': { type: 'string' },
    'case-column': { type: 'string' },
    'activity-column': { type: 'string' },
    'time-column': { type: 'string' },
    'lifecycle-column': { type: 'string' },
    'check-guards': { type: 'boolean' },
    seed: { type: 'string' },
    warmup: { type: 'string' },
    strict: { type: 'boolean' },
    csv: { type: 'string' },
    xes: { type: 'string' },
    metrics: { type: 'string' },
    json: { type: 'boolean' },
    quiet: { type: 'boolean', short: 'q' },
  });
  const [netPath, logPath, ...extra] = positionals;
  if (netPath === undefined) throw new UsageError('Missing net file.');
  if (logPath === undefined) throw new UsageError('Missing event log (a .csv or .xes file).');
  if (extra.length > 0) throw new UsageError(`Unexpected argument "${extra[0] ?? ''}".`);
  const completeOnly: CompleteOnly =
    choiceOption(values['complete-only'], 'complete-only', ['zero', 'span'] as const) ?? 'zero';
  const seed = numberOption(values.seed, 'seed', Number.isInteger, 'an integer');
  const warmup = numberOption(values.warmup, 'warmup', (n) => n >= 0, 'a number of at least 0');

  const loaded = await loadNet(io, netPath);
  const { net } = loaded;
  reportImportWarnings(io, netPath, loaded);
  const problems = validate(net);
  if (hasErrors(problems)) {
    for (const d of problems.filter((p) => p.severity === 'error')) {
      io.err(
        `${netPath}: error: ${d.message}${d.elementId !== undefined ? ` (${d.elementId})` : ''}\n`,
      );
    }
    throw new CommandError(`${netPath}: the net has errors; fix them first (pnm validate).`);
  }

  let text: string;
  try {
    text = await io.readText(logPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new CommandError(`${logPath}: no such file`);
    throw new CommandError(`${logPath}: cannot be read (${(error as Error).message})`);
  }
  const map: Record<string, string> = {};
  for (const spec of values.map ?? []) {
    const eq = spec.lastIndexOf('=');
    if (eq <= 0 || eq === spec.length - 1) {
      throw new UsageError(`--map needs the form <activity>=<transition>, got "${spec}".`);
    }
    map[spec.slice(0, eq)] = spec.slice(eq + 1);
  }
  const run = await runReplay(net, text, {
    map,
    ignore: values.ignore ?? [],
    completeOnly,
    ...(values['time-origin'] !== undefined && { timeOrigin: values['time-origin'] }),
    columns: columnsOf(values),
    checkGuards: values['check-guards'] === true,
    ...(seed !== undefined && { seed }),
    ...(warmup !== undefined && { warmup }),
    label: logPath,
    netLabel: netPath,
  });
  const { log, events, metrics, groups, stats, skipped } = run;
  for (const warning of run.logWarnings) io.err(`${logPath}: warning: ${warning}\n`);
  if (skipped.length > 0) {
    io.err(
      `${logPath}: warning: ${plural(skipped.length, 'activity', 'activities')} not mapped to a transition and skipped: ${skipped
        .map((a) => `"${a}"`)
        .join(', ')}. Map with --map "<activity>=<transition>" or silence with --ignore.\n`,
    );
  }
  for (const warning of run.warnings) io.err(`${netPath}: warning: ${warning}\n`);

  const settings = { ...net.simulation, startTime: log.origin };
  if (values.csv !== undefined)
    await io.writeText(values.csv, toEventLogCsv(events, net, settings));
  if (values.xes !== undefined) await io.writeText(values.xes, toXes(events, net, settings));
  const { net: netName, ...rest } = run.result;
  const result = { net: netName, log: logPath, ...rest };
  if (values.metrics !== undefined) {
    await io.writeText(values.metrics, `${JSON.stringify(result, null, 2)}\n`);
  }

  const toStdout = [values.csv, values.xes, values.metrics].includes('-');
  const say = (out: string): void => {
    if (toStdout || values.json === true) io.err(out);
    else io.out(out);
  };
  if (values.json === true && !toStdout) {
    io.out(`${JSON.stringify(result, null, 2)}\n`);
  }
  if (values.quiet !== true) {
    say(summary(net, result, metrics, groups, io));
    const written: string[] = [];
    if (values.csv !== undefined && values.csv !== '-') {
      written.push(`${values.csv} (${plural(eventLogRows(events, net, settings).length, 'row')})`);
    }
    if (values.xes !== undefined && values.xes !== '-') written.push(values.xes);
    if (values.metrics !== undefined && values.metrics !== '-') written.push(values.metrics);
    if (written.length > 0) say(`\nWrote ${written.join(', ')}\n`);
  }
  if (values.strict === true && stats.fitness !== null && stats.fitness < 1) return 1;
  return 0;
}

function summary(
  net: PetriNet,
  result: {
    log: string;
    events: number;
    cases: number;
    seconds: number;
    fitness: number | null;
    consumed: number;
    produced: number;
    missing: number;
    remaining: number;
    ignored: number;
    guard: number;
    openCases: number;
    mapping: ActivityMapping;
  },
  metrics: MetricsSnapshot,
  groups: ReadonlyArray<{ kind: string; what: string; count: number }>,
  io: Io,
): string {
  const style = makeStyle(io.color);
  const lines: string[] = [];
  lines.push(
    style.bold(
      `${net.name}: replayed ${result.log} (${plural(result.events, 'event')}, ${plural(result.cases, 'case')}, ${formatDuration(result.seconds)})`,
    ),
  );
  const fitness = result.fitness === null ? '-' : result.fitness.toFixed(4);
  const fit =
    result.fitness === null || result.fitness >= 1 ? style.green(fitness) : style.red(fitness);
  lines.push(
    `  fitness            ${fit}  (${result.missing} of ${result.consumed} tokens had to be created, ${result.remaining} of ${result.produced} were left behind)`,
  );
  const count = result.missing + result.ignored + result.guard;
  lines.push(
    `  deviations         ${count === 0 ? 'none' : style.red(String(count))}${
      count === 0
        ? ''
        : `  (missing ${result.missing}, ignored ${result.ignored}, guard ${result.guard})`
    }`,
  );
  lines.push(
    `  cases completed    ${metrics.completedCases}` +
      (metrics.throughputPerHour === null
        ? ''
        : `  (${formatNumber(metrics.throughputPerHour)} per hour)`),
  );
  lines.push(`  cases open         ${result.openCases}`);
  lines.push(
    `  cycle time         mean ${formatDuration(metrics.meanCycleTime)}, max ${formatDuration(metrics.maxCycleTime)}`,
  );
  if (groups.length > 0) {
    lines.push('');
    lines.push(
      table(
        [{ header: 'DEVIATION' }, { header: 'WHAT' }, { header: 'COUNT', align: 'right' }],
        groups.map((g) => [g.kind, g.what, String(g.count)]),
      ).trimEnd(),
    );
  }
  lines.push(...metricTables(net, metrics));
  return `${lines.join('\n')}\n`;
}
