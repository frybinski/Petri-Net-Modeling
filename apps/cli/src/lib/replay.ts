import type { Id, PetriNet } from '@pnm/core';
import {
  EventLogParseError,
  looksLikeXes,
  readLog,
  type LogColumns,
  type ReadLogResult,
} from '@pnm/io';
import {
  autoMapActivities,
  createReplay,
  type ActivityMapping,
  type CompleteOnly,
  type MetricsSnapshot,
  type SimEvent,
} from '@pnm/sim';
import { CommandError, UsageError } from '../errors';

export type Deviation = Extract<SimEvent, { type: 'deviation' }>;

export interface DeviationGroup {
  kind: string;
  what: string;
  count: number;
}

/** The transition a mapping refers to, by id or by an unambiguous name. */
function findTransition(net: PetriNet, key: string, what: string): Id {
  const byId = net.transitions.find((t) => t.id === key);
  if (byId) return byId.id;
  const byName = net.transitions.filter((t) => t.name === key);
  if (byName.length === 1 && byName[0]) return byName[0].id;
  if (byName.length > 1)
    throw new UsageError(`${what}: the name "${key}" is ambiguous; use the id.`);
  throw new UsageError(`${what}: the net has no transition "${key}".`);
}

/** Deviations of one kind and place, counted. */
export function groupDeviations(net: PetriNet, deviations: readonly Deviation[]): DeviationGroup[] {
  const places = new Map(net.places.map((p) => [p.id, p.name]));
  const transitions = new Map(net.transitions.map((t) => [t.id, t.name]));
  const groups = new Map<string, DeviationGroup>();
  for (const d of deviations) {
    const what =
      d.kind === 'missing'
        ? `${transitions.get(d.transitionId ?? '') ?? d.activity ?? '?'} found no token on ${places.get(d.placeId ?? '') ?? d.placeId ?? '?'}`
        : d.kind === 'ignored'
          ? `"${d.activity ?? '?'}" skipped, it has no transition`
          : `guard of ${transitions.get(d.transitionId ?? '') ?? d.activity ?? '?'} not satisfied`;
    const key = `${d.kind}\u0000${what}`;
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { kind: d.kind, what, count: 1 });
  }
  return [...groups.values()];
}

export interface ReplayResult {
  net: string;
  events: number;
  cases: number;
  seconds: number;
  origin: string;
  mapping: ActivityMapping;
  skippedActivities: string[];
  fitness: number | null;
  consumed: number;
  produced: number;
  missing: number;
  remaining: number;
  ignored: number;
  guard: number;
  openCases: number;
  deviations: DeviationGroup[];
  warnings: string[];
  metrics: MetricsSnapshot;
}

export interface ReplayRequest {
  /** Activity of the log to transition (id or name). */
  map?: Record<string, string>;
  /** Activities to skip without a remark. */
  ignore?: string[];
  completeOnly?: CompleteOnly;
  /** `first`, `net` or an ISO 8601 time. */
  timeOrigin?: string;
  columns?: LogColumns;
  checkGuards?: boolean;
  seed?: number;
  warmup?: number;
  /** Names the log in messages (the file name). */
  label?: string;
  /** Names the net in messages (the file name). */
  netLabel?: string;
}

export interface ReplayRun {
  /** The document of `--metrics` and `--json`, without the key `log` (the name of the file). */
  result: ReplayResult;
  log: ReadLogResult;
  events: SimEvent[];
  /** Warnings of the reader of the log. */
  logWarnings: string[];
  /** Activities of the log with no transition that were skipped. */
  skipped: string[];
  /** Warnings of the replay. */
  warnings: string[];
  mapping: ActivityMapping;
  metrics: MetricsSnapshot;
  groups: DeviationGroup[];
  fitness: number | null;
  /** The figures the summary prints. */
  stats: NonNullable<MetricsSnapshot['replay']>;
  seconds: number;
}

/**
 * Replays the text of an event log (CSV or XES) on a net that has no errors. Throws a
 * `UsageError` for a mapping that names an unknown activity or transition and a `CommandError`
 * for a log that cannot be read.
 */
export async function runReplay(
  net: PetriNet,
  logText: string,
  request: ReplayRequest = {},
): Promise<ReplayRun> {
  const label = request.label ?? 'the log';
  const completeOnly: CompleteOnly = request.completeOnly ?? 'zero';

  let timeOrigin = request.timeOrigin ?? 'first';
  if (timeOrigin === 'net') {
    const start = net.simulation?.startTime;
    if (start === undefined) {
      throw new UsageError(
        '--time-origin net: the net has no start time in its simulation settings.',
      );
    }
    timeOrigin = start;
  }
  let log: ReadLogResult;
  try {
    log = readLog(looksLikeXes(logText) ? { xes: logText } : { csv: logText }, {
      timeOrigin,
      columns: request.columns ?? {},
    });
  } catch (error) {
    if (error instanceof EventLogParseError) throw new CommandError(`${label}: ${error.message}`);
    throw error;
  }

  // Which transition each activity belongs to: by name and the like, then by choice.
  const { mapping } = autoMapActivities(net, log.activities);
  const explicit: ActivityMapping = {};
  for (const [activity, key] of Object.entries(request.map ?? {})) {
    if (!log.activities.includes(activity)) {
      throw new UsageError(
        `--map: the log has no activity "${activity}" (activities: ${log.activities.join(', ')}).`,
      );
    }
    explicit[activity] = findTransition(net, key, '--map');
  }
  for (const activity of request.ignore ?? []) {
    if (!log.activities.includes(activity)) {
      throw new UsageError(`--ignore: the log has no activity "${activity}".`);
    }
    explicit[activity] = null;
  }
  const finalMapping: ActivityMapping = { ...mapping, ...explicit };
  const skipped = log.activities.filter((a) => finalMapping[a] === undefined);

  let replay;
  try {
    replay = createReplay(net, log.events, {
      mapping: finalMapping,
      completeOnly,
      ...(request.checkGuards === true && { strict: true }),
      ...(request.seed !== undefined && { seed: request.seed }),
      ...(request.warmup !== undefined && { warmup: request.warmup }),
    });
  } catch (error) {
    const prefix = request.netLabel === undefined ? '' : `${request.netLabel}: `;
    throw new CommandError(`${prefix}${(error as Error).message}`);
  }

  const events: SimEvent[] = [];
  const warnings: string[] = [];
  for (;;) {
    const batch = await replay.advance(Infinity, { maxEvents: 100_000 });
    for (const event of batch) {
      events.push(event);
      if (event.type === 'warning' && !warnings.includes(event.message))
        warnings.push(event.message);
    }
    if (batch.some((event) => event.type === 'idle')) break;
  }
  const metrics = replay.metrics();
  const stats = metrics.replay;
  if (!stats) throw new CommandError('The replay produced no figures.');
  const deviations = events.filter((e): e is Deviation => e.type === 'deviation');
  const groups = groupDeviations(net, deviations);
  const result: ReplayResult = {
    net: net.name,
    events: log.events.length,
    cases: log.cases,
    seconds: replay.state.time,
    origin: log.origin,
    mapping: finalMapping,
    skippedActivities: skipped,
    fitness: stats.fitness,
    consumed: stats.consumed,
    produced: stats.produced,
    missing: stats.missing,
    remaining: stats.remaining,
    ignored: stats.ignored,
    guard: stats.guard,
    openCases: stats.openCases,
    deviations: groups,
    warnings,
    metrics,
  };
  return {
    result,
    log,
    events,
    logWarnings: log.warnings,
    skipped,
    warnings,
    mapping: finalMapping,
    metrics,
    groups,
    fitness: stats.fitness,
    stats,
    seconds: replay.state.time,
  };
}
