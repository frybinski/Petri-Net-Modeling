import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNetText, type PetriNet } from '@pnm/core';
import { describe, expect, it } from 'vitest';
import { createSimulation, type SimEvent } from '../src';
import { makeJsonNet, makeNet } from './helpers';

const of = <T extends SimEvent['type']>(events: SimEvent[], type: T) =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);

const tokens = (sim: ReturnType<typeof createSimulation>, placeId: string): number =>
  sim.state.marking[placeId]?.length ?? 0;

/** Runs until nothing is left to do and returns all events. */
async function runToEnd(sim: ReturnType<typeof createSimulation>, limit = 100_000) {
  const all: SimEvent[] = [...sim.initialEvents];
  for (let i = 0; i < limit; i += 1) {
    const events = await sim.step();
    all.push(...events);
    if (events.some((e) => e.type === 'idle')) return all;
  }
  throw new Error('did not terminate');
}

describe('durations and two-phase firing', () => {
  const chain = (timing?: Parameters<typeof makeNet>[0]['transitions']) =>
    makeNet({
      places: [{ id: 'p', tokens: 1 }, 'q'],
      transitions: timing ?? [{ id: 't', timing: { kind: 'fixed', value: 10 } }],
      arcs: [
        ['p', 't'],
        ['t', 'q'],
      ],
    });

  it('takes the tokens at the start and gives the output at the end', async () => {
    const sim = createSimulation(chain());
    expect(sim.nextEventTime()).toBe(0);
    const started = await sim.step();
    expect(of(started, 'start')).toHaveLength(1);
    expect(of(started, 'complete')).toHaveLength(0);
    expect(tokens(sim, 'p')).toBe(0);
    expect(tokens(sim, 'q')).toBe(0);
    expect(sim.state.running).toHaveLength(1);
    expect(sim.nextEventTime()).toBe(10);
    const done = await sim.step();
    expect(done.map((e) => e.type)).toEqual(['complete']);
    expect(done[0]?.t).toBe(10);
    expect(tokens(sim, 'q')).toBe(1);
    expect(sim.state.time).toBe(10);
  });

  it('completes immediately when the duration is 0', async () => {
    const sim = createSimulation(chain([{ id: 't' }]));
    expect(sim.initialEvents.map((e) => e.type)).toEqual(['spawn']);
    const events = await sim.step();
    expect(events.map((e) => e.type)).toEqual(['start', 'complete']);
    expect(tokens(sim, 'q')).toBe(1);
    expect(sim.state.running).toHaveLength(0);
  });

  it('reports idle once when nothing is left', async () => {
    const sim = createSimulation(chain([{ id: 't' }]));
    await sim.step();
    expect((await sim.step()).map((e) => e.type)).toEqual(['idle']);
    expect(await sim.step()).toEqual([]);
    expect(sim.nextEventTime()).toBeNull();
  });

  it('draws uniform durations from the range', async () => {
    const net = makeNet({
      places: [{ id: 'p', tokens: 400 }, 'q'],
      transitions: [{ id: 't', timing: { kind: 'uniform', min: 2, max: 6 } }],
      arcs: [
        ['p', 't'],
        ['t', 'q'],
      ],
    });
    const sim = createSimulation(net, { seed: 5 });
    const events = await runToEnd(sim);
    const durations = of(events, 'complete').map((e) => e.t);
    expect(Math.min(...durations)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...durations)).toBeLessThanOrEqual(6);
    const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
    expect(mean).toBeGreaterThan(3.8);
    expect(mean).toBeLessThan(4.2);
  });

  it('draws exponential durations with the given mean', async () => {
    const net = makeNet({
      places: [{ id: 'p', tokens: 1500 }, 'q'],
      transitions: [{ id: 't', timing: { kind: 'exponential', mean: 20 } }],
      arcs: [
        ['p', 't'],
        ['t', 'q'],
      ],
    });
    const sim = createSimulation(net, { seed: 9 });
    const events = await runToEnd(sim);
    const durations = of(events, 'complete').map((e) => e.t);
    const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
    expect(mean).toBeGreaterThan(18.5);
    expect(mean).toBeLessThan(21.5);
  });

  it('numbers the parallel firings of a transition as slots', async () => {
    const net = makeNet({
      places: [{ id: 'p', tokens: 3 }, 'q'],
      transitions: [{ id: 't', timing: { kind: 'fixed', value: 4 } }],
      arcs: [
        ['p', 't'],
        ['t', 'q'],
      ],
    });
    const sim = createSimulation(net);
    const events = await sim.step();
    expect(of(events, 'start').map((e) => e.slot)).toEqual([0, 1, 2]);
    const later = await sim.step();
    expect(of(later, 'complete').map((e) => e.slot)).toEqual([0, 1, 2]);
  });
});

describe('resources', () => {
  it('limits parallel firings to the tokens of a resource place', async () => {
    const net = makeNet({
      places: [{ id: 'queue', tokens: 6 }, { id: 'scanner', tokens: 2 }, 'done'],
      transitions: [{ id: 'scan', timing: { kind: 'fixed', value: 5 } }],
      arcs: [
        ['queue', 'scan'],
        ['scanner', 'scan'],
        ['scan', 'scanner'],
        ['scan', 'done'],
      ],
    });
    const sim = createSimulation(net);
    let maxRunning = 0;
    const all: SimEvent[] = [];
    for (let i = 0; i < 20; i += 1) {
      const events = await sim.step();
      all.push(...events);
      maxRunning = Math.max(maxRunning, sim.state.running.length);
      if (events.some((e) => e.type === 'idle')) break;
    }
    expect(maxRunning).toBe(2);
    expect(tokens(sim, 'done')).toBe(6);
    expect(tokens(sim, 'scanner')).toBe(2);
    // Three rounds of two parcels.
    expect(of(all, 'complete').map((e) => e.t)).toEqual([5, 5, 10, 10, 15, 15]);
  });

  it('does not give resource tokens a case and does not pass cases through them', async () => {
    const net = makeNet({
      places: [{ id: 'queue', tokens: 1 }, { id: 'worker', tokens: 1 }, 'done'],
      transitions: ['work'],
      arcs: [
        ['queue', 'work'],
        ['worker', 'work'],
        ['work', 'worker'],
        ['work', 'done'],
      ],
    });
    const sim = createSimulation(net);
    expect(sim.initialEvents).toHaveLength(1); // only the parcel is a case
    await sim.step();
    expect(sim.state.meta['worker']?.[0]?.caseId).toBeUndefined();
    expect(sim.state.meta['done']?.[0]?.caseId).toBe('C-0001');
  });
});

describe('capacities', () => {
  it('lets running firings reserve room on the target place', async () => {
    const net = makeNet({
      places: [
        { id: 'p', tokens: 3 },
        { id: 'q', capacity: 1 },
      ],
      transitions: [{ id: 't', timing: { kind: 'fixed', value: 5 } }],
      arcs: [
        ['p', 't'],
        ['t', 'q'],
      ],
    });
    const sim = createSimulation(net);
    const first = await sim.step();
    expect(of(first, 'start')).toHaveLength(1);
    expect(sim.state.running).toHaveLength(1);
    expect(tokens(sim, 'p')).toBe(2);
    const second = await sim.step();
    expect(of(second, 'complete')).toHaveLength(1);
    // q is full now, so nothing else starts and the net is stuck.
    expect(tokens(sim, 'q')).toBe(1);
    expect(sim.state.running).toHaveLength(0);
    expect((await sim.step()).map((e) => e.type)).toEqual(['idle']);
  });

  it('shows no binding as enabled while the room is reserved', async () => {
    const net = makeNet({
      places: [
        { id: 'p', tokens: 2 },
        { id: 'q', capacity: 1 },
      ],
      transitions: [{ id: 't', timing: { kind: 'fixed', value: 5 } }],
      arcs: [
        ['p', 't'],
        ['t', 'q'],
      ],
    });
    const sim = createSimulation(net);
    await sim.step();
    expect((await sim.enabled()).enabled.size).toBe(0);
  });
});

describe('conflict resolution', () => {
  it('chooses by priority', async () => {
    const net = makeNet({
      places: [{ id: 'p', tokens: 10000 }, 'a', 'b'],
      transitions: [
        { id: 'ta', priority: 3 },
        { id: 'tb', priority: 1 },
      ],
      arcs: [
        ['p', 'ta'],
        ['p', 'tb'],
        ['ta', 'a'],
        ['tb', 'b'],
      ],
    });
    const sim = createSimulation(net, { seed: 11, maxFiringsPerInstant: 20000 });
    await sim.step();
    const a = tokens(sim, 'a');
    const b = tokens(sim, 'b');
    expect(a + b).toBe(10000);
    expect(a / 10000).toBeGreaterThan(0.73);
    expect(a / 10000).toBeLessThan(0.77);
  });

  it('chooses evenly without priorities', async () => {
    const net = makeNet({
      places: [{ id: 'p', tokens: 6000 }, 'a', 'b', 'c'],
      transitions: ['ta', 'tb', 'tc'],
      arcs: [
        ['p', 'ta'],
        ['p', 'tb'],
        ['p', 'tc'],
        ['ta', 'a'],
        ['tb', 'b'],
        ['tc', 'c'],
      ],
    });
    const sim = createSimulation(net, { seed: 3, maxFiringsPerInstant: 20000 });
    await sim.step();
    for (const id of ['a', 'b', 'c']) {
      expect(tokens(sim, id) / 6000).toBeGreaterThan(0.31);
      expect(tokens(sim, id) / 6000).toBeLessThan(0.36);
    }
  });
});

describe('arrivals', () => {
  const arrivalNet = (rate: number) =>
    makeNet({
      places: ['in', 'out'],
      transitions: [{ id: 'arrive', rate }, 'serve'],
      arcs: [
        ['arrive', 'in'],
        ['in', 'serve'],
        ['serve', 'out'],
      ],
    });

  it('spawns about `rate` cases per hour', async () => {
    let total = 0;
    const runs = 12;
    for (let seed = 1; seed <= runs; seed += 1) {
      const sim = createSimulation(arrivalNet(120), { seed });
      const events = await sim.advance(3600);
      total += of(events, 'spawn').length;
      expect(sim.state.time).toBe(3600);
    }
    expect(total / runs).toBeGreaterThan(105);
    expect(total / runs).toBeLessThan(135);
  });

  it('gives every arrival a new case that stays with its tokens', async () => {
    const sim = createSimulation(arrivalNet(600), { seed: 2 });
    const events = await sim.advance(600);
    const spawned = of(events, 'spawn').map((e) => e.caseId);
    expect(new Set(spawned).size).toBe(spawned.length);
    expect(spawned[0]).toBe('C-0001');
    for (const start of of(events, 'start')) expect(start.caseIds).toHaveLength(1);
    const served = of(events, 'complete').filter((e) => e.transitionId === 'serve');
    expect(served.every((e) => e.produced[0]?.caseId === e.caseIds[0])).toBe(true);
  });

  it('does not fire a source transition without a rate by itself', async () => {
    const net = makeNet({
      places: ['in'],
      transitions: ['arrive'],
      arcs: [['arrive', 'in']],
    });
    const sim = createSimulation(net);
    expect((await sim.step()).map((e) => e.type)).toEqual(['idle']);
    const manual = await sim.fireManually('arrive');
    expect(manual.map((e) => e.type)).toEqual(['spawn', 'start', 'complete']);
    expect(tokens(sim, 'in')).toBe(1);
  });

  it('follows a rate set while running and stops when it is switched off', async () => {
    const sim = createSimulation(arrivalNet(3600), { seed: 4 });
    const first = await sim.advance(60);
    expect(of(first, 'spawn').length).toBeGreaterThan(30);
    await sim.setRate('arrive', null);
    const quiet = await sim.advance(600);
    expect(of(quiet, 'spawn')).toHaveLength(0);
    await sim.setRate('arrive', 3600);
    const again = await sim.advance(60);
    expect(of(again, 'spawn').length).toBeGreaterThan(30);
    await expect(sim.setRate('serve', 10)).rejects.toThrow(/without input places/);
  });

  it('applies the rates option over the rate of the net', async () => {
    const sim = createSimulation(arrivalNet(3600), { rates: { arrive: null } });
    expect(sim.nextEventTime()).toBe(0); // starts are pending, but no arrival is scheduled
    expect(Object.keys(sim.state.nextArrival)).toEqual([]);
  });

  it('loses an arrival that finds no room and reports it once', async () => {
    const net = makeNet({
      places: [{ id: 'in', capacity: 1 }],
      transitions: [{ id: 'arrive', rate: 3600 }],
      arcs: [['arrive', 'in']],
    });
    const sim = createSimulation(net, { seed: 1 });
    const events = await sim.advance(120);
    expect(of(events, 'warning').filter((e) => e.code === 'ARRIVAL_BLOCKED')).toHaveLength(1);
    expect(tokens(sim, 'in')).toBe(1);
    expect(of(events, 'spawn')).toHaveLength(1);
  });
});

describe('case identity', () => {
  it('keeps the case along a sequence', async () => {
    const net = makeNet({
      places: [{ id: 'a', tokens: 1 }, 'b', 'c'],
      transitions: [{ id: 't1', timing: { kind: 'fixed', value: 2 } }, 't2'],
      arcs: [
        ['a', 't1'],
        ['t1', 'b'],
        ['b', 't2'],
        ['t2', 'c'],
      ],
    });
    const events = await runToEnd(createSimulation(net));
    const cases = new Set(
      events.flatMap((e) => (e.type === 'start' || e.type === 'complete' ? e.caseIds : [])),
    );
    expect([...cases]).toEqual(['C-0001']);
  });

  it('copies the case to every output of an AND split and keeps it through the AND join', async () => {
    const net = makeNet({
      places: [{ id: 'in', tokens: 1 }, 'x', 'y', 'x2', 'y2', 'out'],
      transitions: ['split', 'fx', 'fy', 'join'],
      arcs: [
        ['in', 'split'],
        ['split', 'x'],
        ['split', 'y'],
        ['x', 'fx'],
        ['fx', 'x2'],
        ['y', 'fy'],
        ['fy', 'y2'],
        ['x2', 'join'],
        ['y2', 'join'],
        ['join', 'out'],
      ],
    });
    const sim = createSimulation(net);
    await sim.step();
    expect(sim.state.meta['out']).toHaveLength(1);
    expect(sim.state.meta['out']?.[0]?.caseId).toBe('C-0001');
    const split = (await sim.enabled()).enabled.size;
    expect(split).toBe(0);
  });

  it('gives the tokens of the initial marking cases of their own', () => {
    const net = makeNet({
      places: [{ id: 'queue', tokens: 3 }, 'done'],
      transitions: ['t'],
      arcs: [
        ['queue', 't'],
        ['t', 'done'],
      ],
    });
    const sim = createSimulation(net);
    expect(of([...sim.initialEvents], 'spawn').map((e) => e.caseId)).toEqual([
      'C-0001',
      'C-0002',
      'C-0003',
    ]);
  });

  it('uses the case id prefix of the simulation settings', () => {
    const net = makeNet({
      places: [{ id: 'queue', tokens: 1 }, 'done'],
      transitions: ['t'],
      arcs: [
        ['queue', 't'],
        ['t', 'done'],
      ],
      simulation: { caseIdPrefix: 'P-' },
    });
    expect(createSimulation(net).state.meta['queue']?.[0]?.caseId).toBe('P-0001');
  });
});

describe('zero-time cycles', () => {
  it('stops with a warning instead of looping forever', async () => {
    const net = makeNet({
      places: [{ id: 'p', tokens: 1 }],
      transitions: ['t'],
      arcs: [
        ['p', 't'],
        ['t', 'p'],
      ],
    });
    const sim = createSimulation(net, { maxFiringsPerInstant: 50 });
    const events = await sim.step();
    expect(of(events, 'start')).toHaveLength(50);
    expect(of(events, 'warning').map((w) => w.code)).toEqual(['ZERO_TIME_CYCLE']);
    expect((await sim.step()).map((e) => e.type)).toEqual(['idle']);
  });
});

describe('editing the marking', () => {
  const resourceNet = () =>
    makeNet({
      places: [{ id: 'queue', tokens: 4 }, { id: 'worker', tokens: 1 }, 'done'],
      transitions: [{ id: 'work', timing: { kind: 'fixed', value: 10 } }],
      arcs: [
        ['queue', 'work'],
        ['worker', 'work'],
        ['work', 'worker'],
        ['work', 'done'],
      ],
    });

  it('lets added resources work at once', async () => {
    const sim = createSimulation(resourceNet());
    await sim.step();
    expect(sim.state.running).toHaveLength(1);
    const events = await sim.editMarking('worker', [1, 1]);
    expect(events).toMatchObject([{ type: 'marking-edited', placeId: 'worker', delta: 2 }]);
    const next = await sim.step();
    expect(of(next, 'start')).toHaveLength(2);
    expect(sim.state.running).toHaveLength(3);
  });

  it('withdraws free resources and refuses more than the capacity', async () => {
    const net = resourceNet();
    net.places.find((p) => p.id === 'queue')!.capacity = 5;
    const sim = createSimulation(net);
    const events = await sim.editMarking('queue', [1, 1]);
    expect(events[0]).toMatchObject({ delta: -2 });
    expect(tokens(sim, 'queue')).toBe(2);
    await expect(sim.editMarking('queue', Array(6).fill(1))).rejects.toThrow(/at most 5/);
    expect(await sim.editMarking('queue', [1, 1])).toEqual([]);
  });

  it('keeps the metadata of the tokens that stay', async () => {
    const sim = createSimulation(resourceNet());
    const before = sim.state.meta['queue']!.map((m) => m.id);
    await sim.editMarking('queue', [1, 1, 1, 1, 1]);
    const after = sim.state.meta['queue']!;
    expect(after.slice(0, 4).map((m) => m.id)).toEqual(before);
    expect(after[4]?.caseId).toBeUndefined();
  });
});

describe('snapshots and stepping back', () => {
  const net = () =>
    makeNet({
      places: [{ id: 'queue', tokens: 5 }, { id: 'worker', tokens: 1 }, 'done'],
      transitions: [{ id: 'work', timing: { kind: 'uniform', min: 5, max: 9 } }],
      arcs: [
        ['queue', 'work'],
        ['worker', 'work'],
        ['work', 'worker'],
        ['work', 'done'],
      ],
    });

  it('restores an earlier state, including the random stream', async () => {
    const sim = createSimulation(net(), { seed: 8 });
    await sim.step();
    const snapshot = sim.snapshot();
    const a = await sim.advance(40);
    const stateA = structuredClone(sim.state.marking);
    await sim.restore(snapshot);
    const b = await sim.advance(40);
    expect(b).toEqual(a);
    expect(sim.state.marking).toEqual(stateA);
  });

  it('steps back instant by instant', async () => {
    const sim = createSimulation(net(), { seed: 1 });
    expect(sim.canStepBack()).toBe(false);
    const first = await sim.step();
    const t1 = sim.state.time;
    const m1 = structuredClone(sim.state.marking);
    await sim.step();
    expect(sim.state.time).toBeGreaterThan(t1);
    expect(await sim.stepBack()).toBe(true);
    expect(sim.state.time).toBe(t1);
    expect(sim.state.marking).toEqual(m1);
    expect(sim.state.counters.event).toBe(sim.initialEvents.length + first.length);
    expect(await sim.stepBack()).toBe(true);
    expect(sim.state.time).toBe(0);
    expect(await sim.stepBack()).toBe(false);
  });

  it('replays the same events after stepping back', async () => {
    const sim = createSimulation(net(), { seed: 2 });
    await sim.step();
    const forward = await sim.step();
    await sim.stepBack();
    expect(await sim.step()).toEqual(forward);
  });

  it('counts manual firings and edits as steps', async () => {
    const sim = createSimulation(net());
    await sim.fireManually('work');
    expect(sim.state.running).toHaveLength(1);
    await sim.editMarking('worker', [1, 1]);
    await sim.stepBack();
    expect(sim.state.marking['worker']).toBeUndefined();
    await sim.stepBack();
    expect(sim.state.running).toHaveLength(0);
    expect(tokens(sim, 'queue')).toBe(5);
  });

  it('keeps at most `historyLimit` states', async () => {
    const sim = createSimulation(net(), { historyLimit: 3 });
    for (let i = 0; i < 6; i += 1) await sim.step();
    let steps = 0;
    while (await sim.stepBack()) steps += 1;
    expect(steps).toBe(3);
  });

  it('resets to the start, optionally with another seed', async () => {
    const sim = createSimulation(net(), { seed: 1 });
    const first = await runToEnd(sim);
    await sim.reset();
    expect(sim.state.time).toBe(0);
    expect(sim.canStepBack()).toBe(false);
    expect(await runToEnd(sim)).toEqual(first);
    await sim.reset(2);
    expect(await runToEnd(sim)).not.toEqual(first);
  });
});

describe('determinism', () => {
  const net = () =>
    makeNet({
      places: ['in', { id: 'staff', tokens: 2 }, 'mid', 'out'],
      transitions: [
        { id: 'arrive', rate: 900 },
        { id: 'a', timing: { kind: 'uniform', min: 3, max: 8 }, priority: 2 },
        { id: 'b', timing: { kind: 'exponential', mean: 5 } },
        { id: 'c', timing: { kind: 'fixed', value: 2 } },
      ],
      arcs: [
        ['arrive', 'in'],
        ['in', 'a'],
        ['staff', 'a'],
        ['a', 'staff'],
        ['a', 'mid'],
        ['in', 'b'],
        ['b', 'mid'],
        ['mid', 'c'],
        ['c', 'out'],
      ],
    });

  it('gives the same event stream for the same seed and another for another seed', async () => {
    const a = await createSimulation(net(), { seed: 21 }).advance(600);
    const b = await createSimulation(net(), { seed: 21 }).advance(600);
    const c = await createSimulation(net(), { seed: 22 }).advance(600);
    expect(a.length).toBeGreaterThan(50);
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
  });

  it('is independent of how the run is cut into steps', async () => {
    const whole = await createSimulation(net(), { seed: 5 }).advance(300);
    const sim = createSimulation(net(), { seed: 5 });
    const pieces: SimEvent[] = [];
    for (let i = 0; i < 30; i += 1) pieces.push(...(await sim.advance(10)));
    expect(pieces).toEqual(whole);
  });

  it('takes the seed from the net settings', async () => {
    const withSeed = net();
    withSeed.simulation = { seed: 21 };
    const a = await createSimulation(withSeed).advance(100);
    const b = await createSimulation(net(), { seed: 21 }).advance(100);
    expect(a).toEqual(b);
  });
});

describe('advance and breakpoints', () => {
  const net = () =>
    makeNet({
      places: [{ id: 'queue', tokens: 20 }, { id: 'worker', tokens: 1 }, 'done'],
      transitions: [{ id: 'work', timing: { kind: 'fixed', value: 10 } }],
      arcs: [
        ['queue', 'work'],
        ['worker', 'work'],
        ['work', 'worker'],
        ['work', 'done'],
      ],
    });

  it('moves the clock to the target even if nothing happens', async () => {
    const sim = createSimulation(net());
    await sim.advance(4);
    expect(sim.state.time).toBe(4);
    await sim.advance(2.5);
    expect(sim.state.time).toBe(6.5);
  });

  it('stops after the instant that reaches the event bundle size', async () => {
    const sim = createSimulation(net());
    const events = await sim.advance(Infinity, { maxEvents: 5 });
    expect(events.length).toBeGreaterThanOrEqual(5);
    expect(events.length).toBeLessThan(8);
    expect(sim.state.time).toBeLessThan(100);
  });

  it('runs to idle with an infinite horizon', async () => {
    const sim = createSimulation(net());
    const events = await sim.advance(Infinity);
    expect(events.at(-1)?.type).toBe('idle');
    expect(sim.state.time).toBe(200);
    expect(tokens(sim, 'done')).toBe(20);
  });

  it('pauses when a transition starts that has a breakpoint', async () => {
    const sim = createSimulation(net());
    sim.setBreakpoints({ transitions: ['work'], places: {} });
    const events = await sim.advance(Infinity);
    expect(events.at(-1)).toMatchObject({
      type: 'breakpoint',
      kind: 'transition',
      elementId: 'work',
    });
    expect(sim.state.time).toBe(0);
    const next = await sim.advance(Infinity);
    expect(next.at(-1)?.type).toBe('breakpoint');
    expect(sim.state.time).toBe(10);
  });

  it('pauses when a place reaches the limit, once per crossing', async () => {
    const sim = createSimulation(net());
    sim.setBreakpoints({ transitions: [], places: { done: 3 } });
    const events = await sim.advance(Infinity);
    expect(events.at(-1)).toMatchObject({ type: 'breakpoint', kind: 'place', elementId: 'done' });
    expect(tokens(sim, 'done')).toBe(3);
    const more = await sim.advance(25);
    expect(more.some((e) => e.type === 'breakpoint')).toBe(false);
  });
});

describe('manual firing', () => {
  it('requires a choice when a JSON transition has several bindings', async () => {
    const net = makeJsonNet({
      places: [
        { id: 'p', tokens: [1, 2, 3] },
        { id: 'q', tokens: [] },
      ],
      transitions: [{ id: 't' }],
      arcs: [
        { from: 'p', to: 't', inscription: '$n' },
        { from: 't', to: 'q', inscription: '$n * 2' },
      ],
    });
    const sim = createSimulation(net);
    await expect(sim.fireManually('t')).rejects.toThrow(/several bindings/);
    const { enabled } = await sim.enabled();
    const chosen = enabled.get('t')!.bindings[1]!;
    await sim.fireManually('t', chosen);
    expect(sim.state.marking).toEqual({ p: [1, 3], q: [4] });
    await expect(sim.fireManually('nope')).rejects.toThrow(/Unknown transition/);
    await expect(sim.fireManually('t', chosen)).rejects.toThrow(/no longer enabled/);
  });

  it('refuses a transition that is not enabled', async () => {
    const net = makeNet({
      places: ['p'],
      transitions: ['t'],
      arcs: [['p', 't']],
    });
    await expect(createSimulation(net).fireManually('t')).rejects.toThrow(/not enabled/);
  });

  it('picks randomly for a step and completes the zero-duration firing', async () => {
    const net = makeNet({
      places: [{ id: 'p', tokens: 2 }, 'q'],
      transitions: ['t'],
      arcs: [
        ['p', 't'],
        ['t', 'q'],
      ],
    });
    const sim = createSimulation(net);
    expect(of(await sim.stepRandom(), 'complete')).toHaveLength(1);
    expect(tokens(sim, 'q')).toBe(1);
    await sim.stepRandom();
    expect((await sim.stepRandom()).map((e) => e.type)).toEqual(['idle']);
  });
});

describe('JSON nets with durations', () => {
  const orders = (): PetriNet => {
    const net = parseNetText(
      readFileSync(
        join(import.meta.dirname, '..', '..', '..', 'examples', 'order-processing.pn.json'),
        'utf8',
      ),
    );
    net.transitions.find((t) => t.id === 'approve')!.timing = { kind: 'fixed', value: 5 };
    net.transitions.find((t) => t.id === 'invoice')!.timing = { kind: 'uniform', min: 2, max: 4 };
    return net;
  };

  it('processes all orders with the same outcome as without time', async () => {
    const sim = createSimulation(orders(), { seed: 3 });
    const events = await runToEnd(sim);
    const marking = sim.state.marking;
    expect(marking['incoming']).toBeUndefined();
    expect(marking['approved']).toBeUndefined();
    expect(marking['rejected']).toHaveLength(1);
    expect(marking['invoices']).toHaveLength(5);
    expect(marking['customers']).toHaveLength(2);
    expect(sim.state.time).toBeGreaterThanOrEqual(10);
    const starts = of(events, 'start').filter((e) => e.transitionId === 'approve');
    expect(starts.every((e) => 'o' in e.binding)).toBe(true);
  });

  it('keeps the resource tokens apart from the orders', async () => {
    const sim = createSimulation(orders(), { seed: 3 });
    await sim.step();
    for (const meta of sim.state.meta['customers'] ?? []) expect(meta.caseId).toBeUndefined();
  });
});
