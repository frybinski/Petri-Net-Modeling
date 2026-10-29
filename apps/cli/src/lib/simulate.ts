import { isSourceTransition, type Id, type PetriNet } from '@pnm/core';
import { eventLogRows, toEventLogCsv, toXes } from '@pnm/io';
import { createSimulation, type MetricsSnapshot, type SimEvent } from '@pnm/sim';
import { CommandError, UsageError } from '../errors';

const CHUNK_SECONDS = 600;
const CHUNK_EVENTS = 100_000;
export const DEFAULT_SECONDS = 3600;
export const DEFAULT_MAX_EVENTS = 10_000_000;

/** The transition a rate refers to, by id or by an unambiguous name. */
function findTransition(net: PetriNet, key: string, what: string): Id {
  const byId = net.transitions.find((t) => t.id === key);
  if (byId) return byId.id;
  const byName = net.transitions.filter((t) => t.name === key);
  if (byName.length === 1 && byName[0]) return byName[0].id;
  if (byName.length > 1)
    throw new UsageError(`${what}: the name "${key}" is ambiguous; use the id.`);
  const sources = net.transitions
    .filter((t) => isSourceTransition(net, t.id))
    .map((t) => t.id)
    .join(', ');
  throw new UsageError(
    `${what}: the net has no transition "${key}"` +
      (sources === '' ? '.' : ` (source transitions: ${sources}).`),
  );
}

/**
 * The arrival rates of source transitions (per hour; `null` switches the arrivals off) by the id
 * or name of the transition. `what` names the option in the messages (`--rate`, `rates`).
 */
export function resolveRates(
  net: PetriNet,
  entries: ReadonlyArray<{ transition: string; perHour: number | null }>,
  what: string,
): Record<Id, number | null> {
  const rates: Record<Id, number | null> = {};
  for (const entry of entries) {
    const id = findTransition(net, entry.transition, what);
    if (!isSourceTransition(net, id)) {
      throw new UsageError(`${what}: "${id}" is not a source transition (it has input arcs).`);
    }
    rates[id] = entry.perHour;
  }
  return rates;
}

export interface SimulateRequest {
  seconds: number;
  /** Default: the seed of the net, else 1. */
  seed?: number;
  warmup?: number;
  rates?: Record<Id, number | null>;
  maxEvents: number;
  /** Keep the events (for the log files); otherwise only their number is counted. */
  keepEvents: boolean;
  /** A prefix for the message when the simulation cannot be created (the file name). */
  label?: string;
}

export interface SimulateRun {
  seed: number;
  seconds: number;
  /** The number of events the run produced. */
  eventCount: number;
  warnings: string[];
  metrics: MetricsSnapshot;
  /** Empty unless `keepEvents` was set. */
  events: SimEvent[];
}

/**
 * Runs the timed simulation for `seconds` of model time. The run is deterministic: the same net,
 * seed and options give the same events. Throws a `CommandError` if the simulation cannot be
 * created or the run exceeds `maxEvents`.
 */
export async function runSimulation(net: PetriNet, request: SimulateRequest): Promise<SimulateRun> {
  const seed = request.seed ?? net.simulation?.seed ?? 1;
  const rates = request.rates ?? {};
  let simulation;
  try {
    simulation = createSimulation(net, {
      seed,
      ...(request.warmup !== undefined && { warmup: request.warmup }),
      ...(Object.keys(rates).length > 0 && { rates }),
    });
  } catch (error) {
    const prefix = request.label === undefined ? '' : `${request.label}: `;
    throw new CommandError(`${prefix}${(error as Error).message}`);
  }
  const events: SimEvent[] = [];
  const warnings: string[] = [];
  let count = 0;
  const take = (batch: readonly SimEvent[]): void => {
    count += batch.length;
    for (const event of batch) {
      if (event.type === 'warning' && !warnings.includes(event.message))
        warnings.push(event.message);
    }
    if (request.keepEvents) for (const event of batch) events.push(event);
  };
  take(simulation.initialEvents);
  while (simulation.state.time < request.seconds) {
    const step = Math.min(CHUNK_SECONDS, request.seconds - simulation.state.time);
    take(await simulation.advance(step, { maxEvents: CHUNK_EVENTS }));
    if (count > request.maxEvents) {
      throw new CommandError(
        `The run produced more than ${request.maxEvents} events by model time ${Math.round(simulation.state.time)} s; ` +
          'shorten it with --seconds or raise --max-events.',
      );
    }
  }
  return {
    seed,
    seconds: request.seconds,
    eventCount: count,
    warnings,
    metrics: simulation.metrics(),
    events,
  };
}

/** The settings that the exports of a run use: those of the net, with a start time if given. */
export function exportSettings(net: PetriNet, startTime?: string) {
  return { ...net.simulation, ...(startTime !== undefined && { startTime }) };
}

/** The event log of a run as CSV. */
export function runToCsv(net: PetriNet, run: SimulateRun, startTime?: string): string {
  return toEventLogCsv(run.events, net, exportSettings(net, startTime));
}

/** The event log of a run as XES. */
export function runToXes(net: PetriNet, run: SimulateRun, startTime?: string): string {
  return toXes(run.events, net, exportSettings(net, startTime));
}

/** The number of rows (events) in the exported log. */
export function logRowCount(net: PetriNet, run: SimulateRun, startTime?: string): number {
  return eventLogRows(run.events, net, exportSettings(net, startTime)).length;
}

/** The events as lines of JSON (the file of `--events`). */
export function runToEventLines(run: SimulateRun): string {
  return run.events.map((e) => JSON.stringify(e)).join('\n') + (run.events.length > 0 ? '\n' : '');
}

/** The document of `--metrics`: key figures and run data. */
export function metricsDocument(net: PetriNet, run: SimulateRun): Record<string, unknown> {
  return {
    net: net.name,
    seed: run.seed,
    seconds: run.seconds,
    events: run.eventCount,
    warnings: run.warnings,
    metrics: run.metrics,
  };
}
