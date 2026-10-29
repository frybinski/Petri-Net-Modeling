import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNetText, type PetriNet } from '@pnm/core';
import {
  createSimulation,
  type LogEvent,
  type SimEvent,
  type Simulation,
  type SimOptions,
} from '../src';

export const loadExample = (name: string): PetriNet =>
  parseNetText(
    readFileSync(
      join(import.meta.dirname, '..', '..', '..', 'examples', `${name}.pn.json`),
      'utf8',
    ),
  );

/** The log of a run: a row per start and complete and case, with the exact times of the engine. */
export function logOf(events: readonly SimEvent[], net: PetriNet): LogEvent[] {
  const names = new Map(net.transitions.map((t) => [t.id, t.name]));
  const log: LogEvent[] = [];
  for (const event of events) {
    if (event.type !== 'start' && event.type !== 'complete') continue;
    for (const caseId of event.caseIds) {
      log.push({
        caseId,
        activity: names.get(event.transitionId) ?? event.transitionId,
        time: event.t,
        lifecycle: event.type,
      });
    }
  }
  return log;
}

/** Maps every activity (the name of a transition) to its transition. */
export function identityMapping(net: PetriNet): Record<string, string> {
  return Object.fromEntries(net.transitions.map((t) => [t.name, t.id]));
}

/** What a state looks like from outside: the cases on every place, in order, and the firings. */
export function shape(
  sim: Simulation,
  horizon = Infinity,
): {
  time: number;
  places: Record<string, string[]>;
  running: Array<Record<string, unknown>>;
} {
  const places: Record<string, string[]> = {};
  for (const place of sim.net.places) {
    const tokens = sim.state.marking[place.id] ?? [];
    const metas = sim.state.meta[place.id] ?? [];
    expectSameLength(tokens.length, metas.length);
    places[place.id] = metas.map((m) => m.caseId ?? '-');
  }
  return {
    time: sim.state.time,
    places,
    running: sim.state.running.map((f) => ({
      transitionId: f.transitionId,
      caseIds: f.caseIds,
      slot: f.slot,
      start: f.start,
      // The end of a firing that the log does not reach is not known to a replay.
      end: f.end > horizon ? 'beyond the log' : f.end,
    })),
  };
}

function expectSameLength(a: number, b: number): void {
  if (a !== b) throw new Error(`marking and meta differ in length: ${a} against ${b}`);
}

export interface EngineRun {
  /** Every event of the run. */
  events: SimEvent[];
  /** The state after every instant that the run had. */
  instants: Array<{ time: number; state: ReturnType<typeof shape> }>;
  sim: Simulation;
}

/** Runs the engine instant by instant until `seconds`, and then to exactly `seconds`. */
export async function runEngine(
  net: PetriNet,
  seconds: number,
  options: SimOptions = {},
): Promise<EngineRun> {
  const sim = createSimulation(net, options);
  const events: SimEvent[] = [...sim.initialEvents];
  const instants: EngineRun['instants'] = [];
  for (;;) {
    const next = sim.nextEventTime();
    if (next === null || next > seconds) break;
    const batch = await sim.step();
    events.push(...batch);
    if (batch.some((e) => e.type === 'start' || e.type === 'complete')) {
      instants.push({ time: sim.state.time, state: shape(sim, seconds) });
    }
  }
  events.push(...(await sim.advance(seconds - sim.state.time)));
  return { events, instants, sim };
}

/** Plays a simulation instant by instant to the end, then to exactly `seconds`. */
export async function playOut(
  sim: Simulation,
  seconds: number,
): Promise<{
  events: SimEvent[];
  instants: Array<{ time: number; state: ReturnType<typeof shape> }>;
}> {
  const events: SimEvent[] = [...sim.initialEvents];
  const instants: EngineRun['instants'] = [];
  for (;;) {
    const next = sim.nextEventTime();
    if (next === null || next > seconds) break;
    const batch = await sim.step();
    events.push(...batch);
    if (batch.some((e) => e.type === 'start' || e.type === 'complete')) {
      instants.push({ time: sim.state.time, state: shape(sim, seconds) });
    }
  }
  events.push(...(await sim.advance(seconds - sim.state.time)));
  return { events, instants };
}

/** The part of an event that two runs must agree on (ids of tokens aside). */
export function essence(event: SimEvent): Record<string, unknown> | null {
  switch (event.type) {
    case 'spawn':
      return {
        type: event.type,
        id: event.id,
        t: event.t,
        transitionId: event.transitionId,
        caseId: event.caseId,
      };
    case 'start':
      return {
        type: event.type,
        id: event.id,
        t: event.t,
        transitionId: event.transitionId,
        firingId: event.firingId,
        slot: event.slot,
        caseIds: event.caseIds,
        consumed: event.consumed.map((r) => [r.placeId, r.caseId, r.since]),
      };
    case 'complete':
      return {
        type: event.type,
        id: event.id,
        t: event.t,
        transitionId: event.transitionId,
        firingId: event.firingId,
        slot: event.slot,
        caseIds: event.caseIds,
        produced: event.produced.map((r) => [r.placeId, r.caseId]),
      };
    default:
      return null;
  }
}
