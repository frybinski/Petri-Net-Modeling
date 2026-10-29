import { describe, expect, it } from 'vitest';
import {
  createReplay,
  createSimulation,
  type ActivityMapping,
  type LogEvent,
  type MetricsSnapshot,
  type SimEvent,
  type Simulation,
} from '../src';
import { makeJsonNet, makeNet } from './helpers';
import { essence, identityMapping, loadExample, logOf, playOut, runEngine } from './replay-helpers';

const HOUR = 3600;

const withoutReplay = (m: MetricsSnapshot): Omit<MetricsSnapshot, 'replay'> => {
  const { replay: _replay, ...rest } = m;
  return rest;
};

describe('wiedergabetreue: the log of an engine run, replayed on the same net', () => {
  for (const [name, hours] of [
    ['parcel-center', 2],
    ['smart-office', 8],
  ] as const) {
    it(`${name}: fitness 1, no deviations, the same states, events and key figures`, async () => {
      const net = loadExample(name);
      const seconds = hours * HOUR;
      const engine = await runEngine(net, seconds, { seed: 1 });
      const log = logOf(engine.events, net);
      expect(log.length).toBeGreaterThan(1000);

      const replay = createReplay(net, log, { mapping: identityMapping(net) });
      const played = await playOut(replay, seconds);

      // The same state after every instant: marking, cases on the places, running firings.
      expect(played.instants).toHaveLength(engine.instants.length);
      expect(played.instants).toEqual(engine.instants);
      // The same events (type, time, transition, firing, slot, cases, tokens taken and put).
      const wanted = engine.events.map(essence).filter((e) => e !== null);
      const got = played.events.map(essence).filter((e) => e !== null);
      expect(got.length).toBeGreaterThan(2000);
      expect(got).toEqual(wanted);
      // No deviation and no warning.
      expect(played.events.filter((e) => e.type === 'deviation' || e.type === 'warning')).toEqual(
        [],
      );
      // The same key figures: cases, throughput, cycle times, places and resources.
      const metrics = replay.metrics();
      expect(withoutReplay(metrics)).toEqual(engine.sim.metrics());
      expect(metrics.completedCases).toBeGreaterThan(100);
      expect(metrics.throughputPerHour).toBe(engine.sim.metrics().throughputPerHour);
      expect(metrics.meanCycleTime).toBe(engine.sim.metrics().meanCycleTime);
      expect(metrics.replay).toMatchObject({
        fitness: 1,
        missing: 0,
        remaining: 0,
        ignored: 0,
        guard: 0,
        openCases: engine.sim.metrics().casesInSystem,
      });
      expect(replay.state.counters.case).toBe(engine.sim.state.counters.case);
    });
  }
});

describe('nets with an AND split and an AND join', () => {
  it('complaint handling: the log of a run replays without deviation', async () => {
    const net = loadExample('complaint-handling');
    const seconds = 2 * HOUR;
    const engine = await runEngine(net, seconds, { seed: 5 });
    const log = logOf(engine.events, net);
    const replay = createReplay(net, log, { mapping: identityMapping(net) });
    const played = await playOut(replay, seconds);
    expect(played.events.filter((e) => e.type === 'deviation')).toEqual([]);
    // Cases overtake each other at the join, so the same two cases can be in the join twice at
    // once; a log cannot say which of the two firings ends first. The state agrees in everything
    // but the expected end of such a firing.
    const withoutEnds = (instants: typeof engine.instants) =>
      instants.map((i) => ({
        ...i,
        state: { ...i.state, running: i.state.running.map(({ end: _end, ...rest }) => rest) },
      }));
    expect(withoutEnds(played.instants)).toEqual(withoutEnds(engine.instants));
    expect(played.events.map(essence).filter((e) => e !== null)).toEqual(
      engine.events.map(essence).filter((e) => e !== null),
    );
    expect(replay.metrics().replay).toMatchObject({ fitness: 1, missing: 0 });
  });
});

/** The log of the parcel center for `seconds` (seed 1), with the net. */
async function parcelLog(seconds: number) {
  const net = loadExample('parcel-center');
  const engine = await runEngine(net, seconds, { seed: 1 });
  return { net, engine, log: logOf(engine.events, net), mapping: identityMapping(net) };
}

async function playAll(sim: Simulation): Promise<SimEvent[]> {
  const events: SimEvent[] = [];
  for (;;) {
    const batch = await sim.step();
    events.push(...batch);
    if (batch.some((e) => e.type === 'idle')) return events;
  }
}

type Deviation = Extract<SimEvent, { type: 'deviation' }>;
const deviations = (events: readonly SimEvent[]): Deviation[] =>
  events.filter((e): e is Deviation => e.type === 'deviation');

describe('deviations from the net', () => {
  it('a log without Scannen has no token to take on Gescannt: it is created, and the fitness falls', async () => {
    const { net, log, mapping } = await parcelLog(1800);
    const without = log.filter((e) => e.activity !== 'Scannen');
    const sorts = without.filter((e) => e.activity === 'Sortieren' && e.lifecycle === 'start');
    expect(sorts.length).toBeGreaterThan(20);

    const replay = createReplay(net, without, { mapping });
    const events = await playAll(replay);
    const found = deviations(events);
    expect(found).toHaveLength(sorts.length);
    for (const d of found) {
      expect(d).toMatchObject({
        kind: 'missing',
        placeId: 'p_scanned',
        transitionId: 't_sort',
        activity: 'Sortieren',
      });
      expect(d.message).toContain('Gescannt');
      expect(sorts.some((s) => s.caseId === d.caseId && s.time === d.t)).toBe(true);
    }
    const stats = replay.metrics().replay!;
    expect(stats.missing).toBe(sorts.length);
    // The token on the input buffer was never taken: every case that finished left one behind.
    const finished = replay.state.marking['p_done']?.length ?? 0;
    expect(finished).toBeGreaterThan(50);
    expect(stats.remaining).toBe(finished);
    expect(stats.fitness!).toBeLessThan(1);
    expect(stats.fitness!).toBeCloseTo(
      1 - stats.missing / stats.consumed / 2 - stats.remaining / stats.produced / 2,
      12,
    );
    expect(stats.ignored).toBe(0);
    // The key figures count the created tokens like any other: nothing is negative.
    for (const place of replay.metrics().places) expect(place.current).toBeGreaterThanOrEqual(0);
    expect(replay.metrics().places.find((p) => p.placeId === 'p_scanned')?.current).toBe(0);
  });

  it('an activity that is not mapped is skipped and counted; the rest replays as before', async () => {
    const { net, log, mapping } = await parcelLog(1800);
    const noise: LogEvent[] = [];
    log
      .filter((e) => e.activity === 'Anlieferung' && e.lifecycle === 'start')
      .slice(0, 7)
      .forEach((e) => {
        noise.push({ ...e, activity: 'Etikett drucken', lifecycle: 'start', time: e.time + 0.5 });
        noise.push({
          ...e,
          activity: 'Etikett drucken',
          lifecycle: 'complete',
          time: e.time + 0.6,
        });
      });
    const mixed = [...log, ...noise];
    const base = createReplay(net, log, { mapping });
    const baseEvents = await playAll(base);

    const variants: ActivityMapping[] = [{}, { 'Etikett drucken': null }];
    for (const mapped of variants) {
      const replay = createReplay(net, mixed, { mapping: { ...mapping, ...mapped } });
      const events = await playAll(replay);
      const found = deviations(events);
      expect(found).toHaveLength(14);
      expect(found.every((d) => d.kind === 'ignored' && d.activity === 'Etikett drucken')).toBe(
        true,
      );
      expect(found[0]?.message).toContain('not mapped');
      expect(found[0]?.caseId).toBeDefined();
      const stats = replay.metrics().replay!;
      expect(stats).toMatchObject({ ignored: 14, missing: 0, fitness: 1 });
      // The marking is the same as without the noise.
      expect(replay.state.marking).toEqual(base.state.marking);
      expect(events.filter((e) => e.type === 'start' || e.type === 'complete').length).toBe(
        baseEvents.filter((e) => e.type === 'start' || e.type === 'complete').length,
      );
    }
  });

  it('refuses a mapping to a transition that the net does not have', () => {
    const net = loadExample('parcel-center');
    expect(() => createReplay(net, [], { mapping: { Scannen: 'nope' } })).toThrow(
      /not a transition/,
    );
  });
});

describe('complete-only logs', () => {
  it('the engine log reduced to its ends replays with activities of no duration', async () => {
    const { net, log, mapping } = await parcelLog(1800);
    const ends = log.filter((e) => e.lifecycle === 'complete');
    const replay = createReplay(net, ends, { mapping, completeOnly: 'zero' });
    const sampled: number[] = [];
    let events: SimEvent[] = [];
    for (;;) {
      const batch = await replay.step();
      events = events.concat(batch);
      sampled.push(replay.state.running.length);
      if (batch.some((e) => e.type === 'idle')) break;
    }
    expect(deviations(events)).toEqual([]);
    expect(replay.metrics().replay).toMatchObject({ fitness: 1, missing: 0 });
    // Nothing is ever under way: every activity starts and ends at its instant.
    expect(Math.max(...sampled)).toBe(0);
    const starts = events.filter((e) => e.type === 'start');
    const completes = events.filter((e) => e.type === 'complete');
    expect(starts.length).toBe(completes.length);
    expect(completes.length).toBe(ends.length);
    for (const start of starts) {
      const end = completes.find((c) => c.type === 'complete' && c.firingId === start.firingId);
      expect(end?.t).toBe(start.t);
    }
  });

  it('with span an activity starts when the previous one of its case ended', () => {
    const net = makeNet({
      places: ['a', 'b', 'c'],
      transitions: ['t1', 't2'],
      arcs: [
        ['a', 't1'],
        ['t1', 'b'],
        ['b', 't2'],
        ['t2', 'c'],
      ],
    });
    const log: LogEvent[] = [
      { caseId: 'x', activity: 't1', time: 10, lifecycle: 'complete' },
      { caseId: 'x', activity: 't2', time: 40, lifecycle: 'complete' },
    ];
    const mapping = { t1: 't1', t2: 't2' };
    return (async () => {
      // At 10 the first activity ends and the second starts: it is under way until 40.
      const during = createReplay(net, log, { mapping, completeOnly: 'span' });
      await during.advance(10.5);
      expect(during.state.running.map((f) => [f.transitionId, f.start, f.end])).toEqual([
        ['t2', 10, 40],
      ]);
      await during.advance(100);
      expect(during.state.running).toEqual([]);
      expect(during.state.marking['c']).toHaveLength(1);
      expect(during.metrics().replay).toMatchObject({ missing: 0, fitness: 1 });
      // Without span both take no time.
      const zero = createReplay(net, log, { mapping, completeOnly: 'zero' });
      await zero.advance(10.5);
      expect(zero.state.running).toEqual([]);
      expect(zero.state.marking['b']).toHaveLength(1);
    })();
  });
});

describe('how a case begins', () => {
  const chain = () =>
    makeNet({
      places: ['a', 'b', 'c'],
      transitions: ['t1', 't2'],
      arcs: [
        ['a', 't1'],
        ['t1', 'b'],
        ['b', 't2'],
        ['t2', 'c'],
      ],
    });
  const row = (
    caseId: string,
    activity: string,
    time: number,
    lifecycle: LogEvent['lifecycle'],
  ) => ({
    caseId,
    activity,
    time,
    lifecycle,
  });
  const mapping = { t1: 't1', t2: 't2' };

  it('is created at the input place of its first transition', async () => {
    const net = chain();
    const log = [
      row('x', 't1', 1, 'start'),
      row('x', 't1', 2, 'complete'),
      row('x', 't2', 3, 'start'),
      row('x', 't2', 4, 'complete'),
    ];
    const replay = createReplay(net, log, { mapping });
    const events = await playAll(replay);
    const spawns = events.filter((e) => e.type === 'spawn');
    expect(spawns).toHaveLength(1);
    expect(spawns[0]).toMatchObject({ caseId: 'x', t: 1 });
    expect((spawns[0] as { transitionId?: string }).transitionId).toBeUndefined();
    expect((spawns[0] as { tokens?: unknown[] }).tokens).toMatchObject([
      { placeId: 'a', caseId: 'x' },
    ]);
    expect(deviations(events)).toEqual([]);
    expect(replay.state.marking['c']).toHaveLength(1);
    expect(replay.metrics().replay).toMatchObject({ fitness: 1, openCases: 0 });
    expect(replay.metrics().completedCases).toBe(1);
  });

  it('may begin in the middle of the process: the token is there with the case', async () => {
    const replay = createReplay(chain(), [row('y', 't2', 5, 'complete')], { mapping });
    const events = await playAll(replay);
    expect(deviations(events)).toEqual([]);
    expect(replay.state.marking['c']).toHaveLength(1);
  });

  it('enters through the source transition that feeds the place, which counts as its firing', async () => {
    const net = makeNet({
      places: ['q', 'done'],
      transitions: [{ id: 'arr', timing: { kind: 'fixed', value: 0 } }, 'work'],
      arcs: [
        ['arr', 'q'],
        ['q', 'work'],
        ['work', 'done'],
      ],
    });
    const log = [row('k', 'work', 7, 'start'), row('k', 'work', 9, 'complete')];
    const replay = createReplay(net, log, { mapping: { work: 'work' } });
    const events = await playAll(replay);
    const kinds = events
      .filter((e) => e.type !== 'idle')
      .map((e) => [e.type, 'transitionId' in e ? e.transitionId : undefined]);
    expect(kinds).toEqual([
      ['spawn', 'arr'],
      ['start', 'arr'],
      ['complete', 'arr'],
      ['start', 'work'],
      ['complete', 'work'],
    ]);
    expect(deviations(events)).toEqual([]);
    expect(replay.metrics().replay).toMatchObject({ fitness: 1, missing: 0 });
  });

  it('takes over the tokens of the initial marking before it creates any', async () => {
    const net = chain();
    net.marking['a'] = [1, 1];
    const log = ['x', 'y', 'z'].flatMap((id, i) => [
      row(id, 't1', i + 1, 'start'),
      row(id, 't1', i + 1.5, 'complete'),
    ]);
    const replay = createReplay(net, log, { mapping });
    // Before the log starts the two tokens wait without a case.
    expect(replay.state.marking['a']).toHaveLength(2);
    expect(replay.state.meta['a']?.map((m) => m.caseId)).toEqual([undefined, undefined]);
    const events = await playAll(replay);
    const spawns = events.filter((e) => e.type === 'spawn') as Array<
      Extract<SimEvent, { type: 'spawn' }>
    >;
    expect(spawns.map((s) => [s.caseId, s.tokens?.length ?? 0])).toEqual([
      ['x', 0],
      ['y', 0],
      ['z', 1],
    ]);
    expect(replay.state.marking['a']).toBeUndefined();
    expect(replay.state.marking['b']).toHaveLength(3);
    expect(deviations(events)).toEqual([]);
  });
});

describe('resources and the order of events', () => {
  /** in -> work (uses the one machine) -> out; arrivals feed `in`. */
  const shop = () =>
    makeNet({
      places: ['in', { id: 'machine', tokens: 1 }, 'out'],
      transitions: [{ id: 'arr', rate: 60 }, 'work'],
      arcs: [
        ['arr', 'in'],
        ['in', 'work'],
        ['machine', 'work'],
        ['work', 'machine'],
        ['work', 'out'],
      ],
    });
  const mapping = { arr: 'arr', work: 'work' };
  const row = (
    caseId: string,
    activity: string,
    time: number,
    lifecycle: LogEvent['lifecycle'],
  ): LogEvent => ({
    caseId,
    activity,
    time,
    lifecycle,
  });
  const arrivals = (...ids: string[]): LogEvent[] =>
    ids.flatMap((id) => [row(id, 'arr', 0, 'start'), row(id, 'arr', 0, 'complete')]);

  it('two cases at the one machine at once: the second finds none and one is created', async () => {
    const log = [
      ...arrivals('a', 'b'),
      row('a', 'work', 1, 'start'),
      row('b', 'work', 2, 'start'),
      row('a', 'work', 5, 'complete'),
      row('b', 'work', 6, 'complete'),
    ];
    const replay = createReplay(shop(), log, { mapping });
    const events = await playAll(replay);
    const found = deviations(events);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'missing', placeId: 'machine', caseId: 'b', t: 2 });
    // The machine that appeared stays: there are two now.
    expect(replay.state.marking['machine']).toHaveLength(2);
    expect(replay.state.marking['out']).toHaveLength(2);
  });

  it('events at one time are taken in the order of the log', async () => {
    const free = [
      ...arrivals('a', 'b'),
      row('a', 'work', 1, 'start'),
      row('a', 'work', 5, 'complete'),
      row('b', 'work', 5, 'start'),
      row('b', 'work', 8, 'complete'),
    ];
    const ok = createReplay(shop(), free, { mapping });
    expect(deviations(await playAll(ok))).toEqual([]);
    // The same events with the start listed first: the machine is not back yet.
    const swapped = [
      free[0]!,
      free[1]!,
      free[2]!,
      free[3]!,
      free[6]!,
      free[5]!,
      free[4]!,
      free[7]!,
    ];
    const late = createReplay(shop(), swapped, { mapping });
    const found = deviations(await playAll(late));
    expect(found.map((d) => d.kind)).toEqual(['missing']);
  });

  it('with a seed the resource token is chosen at random, without it the oldest is taken', async () => {
    const net = shop();
    net.marking['machine'] = [1, 1, 1];
    const log = [
      ...arrivals('a', 'b', 'c', 'd', 'e', 'f'),
      ...['a', 'b', 'c', 'd', 'e', 'f'].flatMap((id, i) => [
        row(id, 'work', 10 + i * 10, 'start'),
        row(id, 'work', 15 + i * 10, 'complete'),
      ]),
    ];
    const taken = async (seed?: number): Promise<string[]> => {
      const replay = createReplay(net, log, { mapping, ...(seed !== undefined && { seed }) });
      const events = await playAll(replay);
      expect(deviations(events)).toEqual([]);
      return events.flatMap((e) =>
        e.type === 'start' && e.transitionId === 'work'
          ? e.consumed.filter((r) => r.placeId === 'machine').map((r) => r.tokenId)
          : [],
      );
    };
    const oldest = await taken();
    expect(oldest).toHaveLength(6);
    expect(await taken()).toEqual(oldest);
    const a = await taken(3);
    expect(await taken(3)).toEqual(a);
    expect(a).not.toEqual(oldest);
  });
});

describe('the Simulation interface', () => {
  it('replays the same stream every time, and again after a reset', async () => {
    const { net, log, mapping } = await parcelLog(900);
    const replay = createReplay(net, log, { mapping });
    const first = await playAll(replay);
    const marking = structuredClone(replay.state.marking);
    await replay.reset();
    expect(replay.state.time).toBe(0);
    expect(replay.canStepBack()).toBe(false);
    const second = await playAll(replay);
    expect(second).toEqual(first);
    expect(replay.state.marking).toEqual(marking);
    const other = createReplay(net, log, { mapping });
    expect(await playAll(other)).toEqual(first);
  });

  it('steps back and restores', async () => {
    const { net, log, mapping } = await parcelLog(900);
    const replay = createReplay(net, log, { mapping });
    expect(replay.canStepBack()).toBe(false);
    for (let i = 0; i < 30; i += 1) await replay.step();
    const saved = replay.snapshot();
    const marking = structuredClone(replay.state.marking);
    const metrics = replay.metrics();
    const later: SimEvent[] = [];
    for (let i = 0; i < 40; i += 1) later.push(...(await replay.step()));
    expect(replay.canStepBack()).toBe(true);
    for (let i = 0; i < 40; i += 1) expect(await replay.stepBack()).toBe(true);
    expect(replay.state.marking).toEqual(marking);
    expect(replay.metrics()).toEqual(metrics);
    // And forward again: the same events.
    const again: SimEvent[] = [];
    for (let i = 0; i < 40; i += 1) again.push(...(await replay.step()));
    expect(again).toEqual(later);
    await replay.restore(saved);
    expect(replay.state.marking).toEqual(marking);
    expect(replay.snapshot().replay?.cursor).toBe(saved.replay?.cursor);
    // A snapshot of the engine is no snapshot of a replay.
    const engineSnapshot = createSimulation(net).snapshot();
    await expect(replay.restore(engineSnapshot)).rejects.toThrow(/replay/);
  });

  it('advance plays up to a time, then sets the clock; step goes instant by instant', async () => {
    const net = makeNet({
      places: ['a', 'b'],
      transitions: ['t'],
      arcs: [
        ['a', 't'],
        ['t', 'b'],
      ],
    });
    const log: LogEvent[] = [
      { caseId: 'x', activity: 't', time: 5, lifecycle: 'complete' },
      { caseId: 'y', activity: 't', time: 12, lifecycle: 'complete' },
    ];
    const replay = createReplay(net, log, { mapping: { t: 't' } });
    expect(replay.nextEventTime()).toBe(5);
    const quiet = await replay.advance(3);
    expect(quiet).toEqual([]);
    expect(replay.state.time).toBe(3);
    const first = await replay.advance(3);
    expect(first.map((e) => e.type)).toEqual(['spawn', 'start', 'complete']);
    expect(replay.state.time).toBe(6);
    expect(replay.nextEventTime()).toBe(12);
    const limited = await replay.advance(100, { maxEvents: 1 });
    expect(limited.length).toBeGreaterThanOrEqual(1);
    expect(replay.state.time).toBe(12);
    expect(replay.nextEventTime()).toBeNull();
    // At the end it says so once, and the clock goes on.
    const end = await replay.advance(10);
    expect(end.map((e) => e.type)).toEqual(['idle']);
    expect(replay.state.time).toBe(22);
    expect(await replay.advance(1)).toEqual([]);
    expect(await replay.step()).toEqual([]);
  });

  it('cannot be steered by hand', async () => {
    const { net, log, mapping } = await parcelLog(300);
    const replay = createReplay(net, log, { mapping });
    await expect(replay.fireManually('t_scan')).rejects.toThrow(/by hand/);
    await expect(replay.editMarking('p_in', [1])).rejects.toThrow(/edited/);
    await expect(replay.setRate('t_arr', 10)).rejects.toThrow(/rates/);
    expect(replay.rates()).toEqual({});
    expect((await replay.enabled()).enabled.size).toBe(0);
    // A random step is the next step of the log.
    const events = await replay.stepRandom();
    expect(events.some((e) => e.type === 'spawn')).toBe(true);
    expect(replay.initialEvents).toEqual([]);
  });

  it('stops at a breakpoint on a transition and on a place', async () => {
    const { net, log, mapping } = await parcelLog(900);
    const replay = createReplay(net, log, { mapping });
    replay.setBreakpoints({ transitions: ['t_sort'], places: {} });
    const events = await replay.advance(900);
    const stop = events.find((e) => e.type === 'breakpoint');
    expect(stop).toMatchObject({ kind: 'transition', elementId: 't_sort' });
    expect(events.at(-1)).toBe(stop);
    expect(replay.state.time).toBeLessThan(900);
    replay.setBreakpoints({ transitions: [], places: { p_in: 3 } });
    const more = await replay.advance(900);
    expect(more.find((e) => e.type === 'breakpoint')).toMatchObject({
      kind: 'place',
      elementId: 'p_in',
    });
  });

  it('counts the cases that have not finished as open', async () => {
    const { net, log, mapping, engine } = await parcelLog(1800);
    const replay = createReplay(net, log, { mapping });
    await playAll(replay);
    const stats = replay.metrics().replay!;
    expect(stats.openCases).toBe(engine.sim.metrics().casesInSystem);
    expect(stats.openCases).toBeGreaterThan(0);
    expect(stats.processed).toBe(log.length);
    expect(stats.total).toBe(log.length);
    expect(stats.fitness).toBe(1);
  });
});

describe('JSON nets', () => {
  const orders = () =>
    makeJsonNet({
      types: { order: { type: 'object', properties: { amount: { type: 'number' } } } },
      places: [
        { id: 'in', type: 'order' },
        { id: 'big', type: 'order' },
        { id: 'small', type: 'order' },
      ],
      transitions: [
        { id: 'large', guard: '$o.amount > 100' },
        { id: 'little', guard: '$o.amount <= 100' },
      ],
      arcs: [
        { from: 'in', to: 'large', inscription: '$o' },
        { from: 'large', to: 'big', inscription: '$o' },
        { from: 'in', to: 'little', inscription: '$o' },
        { from: 'little', to: 'small', inscription: '$o' },
      ],
    });
  const log: LogEvent[] = [
    {
      caseId: 'c1',
      activity: 'large',
      time: 1,
      lifecycle: 'start',
      attributes: { amount: '150', note: 'x' },
    },
    {
      caseId: 'c1',
      activity: 'large',
      time: 2,
      lifecycle: 'complete',
      attributes: { amount: '150' },
    },
    // 50 does not satisfy the guard of "large".
    { caseId: 'c2', activity: 'large', time: 3, lifecycle: 'start', attributes: { amount: '50' } },
    {
      caseId: 'c2',
      activity: 'large',
      time: 4,
      lifecycle: 'complete',
      attributes: { amount: '50' },
    },
  ];
  const mapping = { large: 'large', little: 'little' };

  it('makes the tokens of a case out of its data', async () => {
    const replay = createReplay(orders(), log, { mapping });
    await playAll(replay);
    // What the case brought along stays with its tokens.
    expect(replay.state.marking['big']).toEqual([
      { caseId: 'c1', amount: 150, note: 'x' },
      { caseId: 'c2', amount: 50 },
    ]);
    expect(replay.metrics().replay?.fitness).toBe(1);
  });

  it('does not check guards, and says so once', async () => {
    const replay = createReplay(orders(), log, { mapping });
    const events = await playAll(replay);
    expect(deviations(events)).toEqual([]);
    const warnings = events.filter((e) => e.type === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ code: 'REPLAY_GUARDS_NOT_CHECKED', elementId: 'large' });
  });

  it('with strict a token that does not satisfy a guard is a deviation', async () => {
    const replay = createReplay(orders(), log, { mapping, strict: true });
    const events = await playAll(replay);
    const found = deviations(events);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'guard', caseId: 'c2', transitionId: 'large', t: 3 });
    expect(events.filter((e) => e.type === 'warning')).toEqual([]);
    expect(replay.metrics().replay).toMatchObject({ guard: 1, missing: 0, fitness: 1 });
  });
});
