import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNetText, type PetriNet } from '@pnm/core';
import {
  autoMapActivities,
  createMetrics,
  createReplay,
  createSimulation,
  type SimEvent,
} from '@pnm/sim';
import { describe, expect, it } from 'vitest';
import { readLog, toEventLogCsv, toXes } from '../src';

const load = (name: string): PetriNet =>
  parseNetText(
    readFileSync(
      join(import.meta.dirname, '..', '..', '..', 'examples', `${name}.pn.json`),
      'utf8',
    ),
  );

/** Times in an exported log are whole milliseconds. */
const ms = (t: number): number => Math.round(t * 1000) / 1000;

/** The events of the engine with their times as the export writes them. */
function rounded(events: readonly SimEvent[]): SimEvent[] {
  return events.map((event) => {
    const copy = { ...event, t: ms(event.t) } as SimEvent;
    if (copy.type === 'start') {
      copy.consumed = copy.consumed.map((r) =>
        r.since === undefined ? r : { ...r, since: ms(r.since) },
      );
    }
    return copy;
  });
}

interface Instant {
  time: number;
  /** Cases on every place, in order. */
  places: Record<string, string[]>;
}

function stateOf(sim: {
  net: PetriNet;
  state: { marking: object; meta: Record<string, Array<{ caseId?: string }>> };
}): Record<string, string[]> {
  const places: Record<string, string[]> = {};
  for (const place of sim.net.places) {
    places[place.id] = (sim.state.meta[place.id] ?? []).map((m) => m.caseId ?? '-');
  }
  return places;
}

/** Runs instant by instant; the state after each instant, the last one per millisecond. */
async function instants(
  sim: ReturnType<typeof createSimulation> | ReturnType<typeof createReplay>,
  seconds: number,
  round: boolean,
  offset = 0,
): Promise<{ events: SimEvent[]; instants: Instant[] }> {
  const events: SimEvent[] = [...sim.initialEvents];
  const seen = new Map<number, Instant>();
  for (;;) {
    const next = sim.nextEventTime();
    if (next === null || next - offset > seconds) break;
    const batch = await sim.step();
    events.push(...batch);
    if (!batch.some((e) => e.type === 'start' || e.type === 'complete')) continue;
    const time = round ? ms(sim.state.time - offset) : sim.state.time - offset;
    seen.set(time, { time, places: stateOf(sim) });
  }
  events.push(...(await sim.advance(seconds - (sim.state.time - offset))));
  return { events, instants: [...seen.values()] };
}

const without = <T extends { replay?: unknown }>(m: T): Omit<T, 'replay'> => {
  const { replay: _replay, ...rest } = m;
  return rest;
};

describe.each([
  ['parcel-center', 2 * 3600],
  ['smart-office', 4 * 3600],
])('replay of the exported log of %s', (name, seconds) => {
  it('CSV: fitness 1, no deviation, the same states at the same times, the same key figures', async () => {
    const net = load(name);
    const engine = createSimulation(net, { seed: 1 });
    const run = await instants(engine, seconds, true);
    const csv = toEventLogCsv(run.events, net);

    // Time 0 is the start time of the run, as in the export.
    const log = readLog({ csv }, { timeOrigin: net.simulation?.startTime ?? 'first' });
    expect(log.warnings).toEqual([]);
    expect(log.cases).toBeGreaterThan(100);
    const { mapping, unmatched } = autoMapActivities(net, log.activities);
    expect(unmatched).toEqual([]);

    const replay = createReplay(net, log.events, { mapping });
    const played = await instants(replay, seconds, false);
    expect(played.events.filter((e) => e.type === 'deviation' || e.type === 'warning')).toEqual([]);
    expect(played.instants).toHaveLength(run.instants.length);
    expect(played.instants).toEqual(run.instants);

    // The same key figures, to the last digit, as the engine's events with the exported times.
    const reference = createMetrics(net, net.simulation?.warmup ?? 0);
    for (const event of rounded(run.events)) reference.apply(event);
    const expected = reference.snapshot(seconds);
    const got = replay.metrics();
    expect(without(got)).toEqual(expected);
    expect(got.replay).toMatchObject({
      fitness: 1,
      missing: 0,
      remaining: 0,
      ignored: 0,
      guard: 0,
    });
    expect(got.completedCases).toBeGreaterThan(50);
    expect(got.throughputPerHour).toBe(expected.throughputPerHour);
    expect(got.meanCycleTime).toBe(expected.meanCycleTime);
    // The engine itself, which times to the microsecond, agrees to a millisecond.
    const exact = engine.metrics();
    expect(got.completedCases).toBe(exact.completedCases);
    expect(got.casesInSystem).toBe(exact.casesInSystem);
    expect(Math.abs((got.meanCycleTime ?? 0) - (exact.meanCycleTime ?? 0))).toBeLessThan(0.001);
    expect(Math.abs((got.throughputPerHour ?? 0) - (exact.throughputPerHour ?? 0))).toBeLessThan(
      1e-6,
    );
  });

  it('XES: the same replay as the CSV', async () => {
    const net = load(name);
    const engine = createSimulation(net, { seed: 1 });
    const run = await instants(engine, seconds, true);
    const options = { timeOrigin: net.simulation?.startTime ?? 'first' };
    const fromCsv = readLog({ csv: toEventLogCsv(run.events, net) }, options);
    const fromXes = readLog({ xes: toXes(run.events, net) }, options);
    // An XES file lists the events trace by trace: the same events, but at one time in another order.
    const canonical = (events: typeof fromCsv.events) =>
      [...events].sort((a, b) =>
        JSON.stringify([a.time, a.caseId, a.lifecycle, a.activity]).localeCompare(
          JSON.stringify([b.time, b.caseId, b.lifecycle, b.activity]),
        ),
      );
    expect(canonical(fromXes.events)).toEqual(canonical(fromCsv.events));
    const { mapping } = autoMapActivities(net, fromXes.activities);
    const replay = createReplay(net, fromXes.events, { mapping });
    await replay.advance(seconds);
    expect(replay.metrics().replay).toMatchObject({ fitness: 1, missing: 0, remaining: 0 });
  });

  it('with the first event as time 0 everything is the same, shifted', async () => {
    const net = load(name);
    const engine = createSimulation(net, { seed: 1 });
    const run = await instants(engine, seconds, true);
    const log = readLog({ csv: toEventLogCsv(run.events, net) });
    const shift = log.events[0]!.time;
    expect(shift).toBe(0);
    const origin = readLog(
      { csv: toEventLogCsv(run.events, net) },
      { timeOrigin: net.simulation?.startTime ?? 'first' },
    ).events[0]!.time;
    expect(origin).toBeGreaterThan(0);
    const { mapping } = autoMapActivities(net, log.activities);
    const replay = createReplay(net, log.events, { mapping });
    const played = await instants(replay, seconds, false, 0);
    expect(played.events.filter((e) => e.type === 'deviation')).toEqual([]);
    expect(played.instants.map((i) => i.places)).toEqual(run.instants.map((i) => i.places));
    expect(replay.metrics().replay?.fitness).toBe(1);
  });
});

describe('replay of the bicycle frame production (N1): quantity places are not checked against the log', () => {
  it('replays the exported event log of eight hours with fitness 1, in CSV and in XES', async () => {
    const net = load('bike-frames');
    const seconds = 8 * 3600;
    const sim = createSimulation(net, { seed: 1 });
    const events: SimEvent[] = [...sim.initialEvents];
    while (sim.state.time < seconds) events.push(...(await sim.advance(600)));
    const settings = { ...net.simulation };
    const files = [
      ['CSV', { csv: toEventLogCsv(events, net, settings) }],
      ['XES', { xes: toXes(events, net, settings) }],
    ] as const;
    for (const [format, file] of files) {
      const log = readLog(file, { timeOrigin: net.simulation?.startTime ?? 'first' });
      expect(log.warnings, format).toEqual([]);
      // Deliveries and recycling belong to no case: they are not in the file.
      expect(log.activities, format).not.toContain('Primärstahl anliefern');
      expect(log.activities, format).not.toContain('Schrott aufbereiten');
      const { mapping, unmatched } = autoMapActivities(net, log.activities);
      expect(unmatched, format).toEqual([]);
      const replay = createReplay(net, log.events, { mapping });
      const played = await instants(replay, seconds, false);
      expect(
        played.events.filter((e) => e.type === 'deviation' || e.type === 'warning'),
        format,
      ).toEqual([]);
      const metrics = replay.metrics();
      expect(metrics.replay, format).toMatchObject({
        fitness: 1,
        missing: 0,
        remaining: 0,
        ignored: 0,
      });
      expect(metrics.completedCases, format).toBe(sim.metrics().completedCases);
      expect(metrics.casesInSystem, format).toBe(sim.metrics().casesInSystem);
      for (const place of metrics.places) expect(place.current, format).toBeGreaterThanOrEqual(0);
    }
  }, 60_000);
});
