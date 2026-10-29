import { describe, expect, it } from 'vitest';
import { createLiveReplay, createReplay, type LogEvent, type SimEvent } from '../src';
import { makeNet } from './helpers';
import { identityMapping, loadExample, logOf, runEngine } from './replay-helpers';

/** a -> t1 -> b -> t2 -> c */
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

const mapping = { t1: 't1', t2: 't2' };
const row = (
  caseId: string,
  activity: string,
  time: number,
  lifecycle: LogEvent['lifecycle'],
): LogEvent => ({ caseId, activity, time, lifecycle });
const types = (events: readonly SimEvent[]): string[] => events.map((e) => e.type);

describe('a live replay', () => {
  it('waits for events: advance plays only up to the latest one that has arrived', async () => {
    const live = createLiveReplay(chain(), { mapping, clock: () => 0 });
    expect(live.nextEventTime()).toBeNull();
    expect(live.closed).toBe(false);
    // Nothing has arrived: the clock does not run ahead, the replay says it is idle.
    expect(types(await live.advance(10))).toEqual(['idle']);
    expect(live.state.time).toBe(0);
    expect(await live.advance(10)).toEqual([]);

    live.push([row('x', 't1', 5, 'start'), row('x', 't1', 8, 'complete')]);
    expect(live.nextEventTime()).toBe(5);
    expect(await live.advance(3)).toEqual([]);
    expect(live.state.time).toBe(3);
    // The next two seconds reach the first event; the replay does not go beyond the latest (8).
    expect(types(await live.advance(100))).toEqual(['spawn', 'start', 'complete', 'idle']);
    expect(live.state.time).toBe(8);
    expect(live.state.marking['b']).toHaveLength(1);
    expect(live.nextEventTime()).toBeNull();
  });

  it('reports idle once while it waits, and again after the next wait', async () => {
    const live = createLiveReplay(chain(), { mapping, clock: () => 0 });
    live.push([row('x', 't1', 1, 'complete')]);
    expect(types(await live.advance(5))).toEqual(['spawn', 'start', 'complete', 'idle']);
    expect(await live.advance(5)).toEqual([]);
    live.push([row('x', 't2', 4, 'complete')]);
    expect(types(await live.advance(5))).toEqual(['start', 'complete', 'idle']);
    expect(live.state.time).toBe(4);
    expect(live.state.marking['c']).toHaveLength(1);
  });

  it('stamps an event without a time with the clock', async () => {
    let wall = 0;
    const live = createLiveReplay(chain(), { mapping, clock: () => wall });
    wall = 12.5;
    live.push([{ caseId: 'x', activity: 't1', lifecycle: 'complete' }]);
    const events = await live.advance(100);
    expect(events.find((e) => e.type === 'spawn')?.t).toBe(12.5);
    expect(live.now()).toBe(12.5);
    expect(live.state.time).toBe(12.5);
  });

  it('takes an event whose time has passed at the present moment', async () => {
    const live = createLiveReplay(chain(), { mapping, clock: () => 0 });
    live.push([row('x', 't1', 20, 'complete')]);
    await live.advance(100);
    expect(live.state.time).toBe(20);
    live.push([row('x', 't2', 3, 'complete')]);
    const late = await live.advance(1);
    expect(late.filter((e) => e.type === 'start' || e.type === 'complete').map((e) => e.t)).toEqual(
      [20, 20],
    );
    expect(live.state.time).toBe(20);
  });

  it('keeps events in the order of their time even if they arrive out of order', async () => {
    const live = createLiveReplay(chain(), { mapping, clock: () => 0 });
    live.push([row('y', 't1', 9, 'complete'), row('x', 't1', 4, 'complete')]);
    const events = await live.advance(100);
    expect(
      events.filter((e) => e.type === 'spawn').map((e) => (e as { caseId: string }).caseId),
    ).toEqual(['x', 'y']);
  });

  it('shows the end of a running activity when its complete arrives', async () => {
    const live = createLiveReplay(chain(), { mapping, clock: () => 0 });
    live.push([row('x', 't1', 2, 'start')]);
    await live.advance(5);
    expect(live.state.running.map((f) => [f.transitionId, f.start, f.end])).toEqual([
      ['t1', 2, Infinity],
    ]);
    live.push([row('x', 't1', 9, 'complete')]);
    expect(live.state.running[0]?.end).toBe(9);
    await live.advance(100);
    expect(live.state.running).toEqual([]);
    expect(live.state.marking['b']).toHaveLength(1);
  });

  it('can be closed: what has arrived is played, nothing more is accepted', async () => {
    const live = createLiveReplay(chain(), { mapping, clock: () => 0 });
    live.push([row('x', 't1', 1, 'complete'), row('x', 't2', 2, 'complete')]);
    live.close();
    expect(live.closed).toBe(true);
    expect(() => {
      live.push([row('x', 't1', 3, 'complete')]);
    }).toThrow(/closed/);
    const events = await live.advance(100);
    expect(types(events)).toEqual(['spawn', 'start', 'complete', 'start', 'complete', 'idle']);
    expect(live.state.marking['c']).toHaveLength(1);
  });

  it('refuses events that make no sense', () => {
    const live = createLiveReplay(chain(), { mapping, clock: () => 0 });
    expect(() => {
      live.push([{ caseId: 'x', activity: 't1', lifecycle: 'complete', time: Number.NaN }]);
    }).toThrow(/valid time/);
    expect(() => {
      live.push([{ caseId: 'x', activity: 't1', lifecycle: 'pause' as 'start' }]);
    }).toThrow(/lifecycle/);
    const batch = createReplay(chain(), [], { mapping });
    expect('push' in batch).toBe(false);
  });

  it('starts with the events it was given, and goes back and starts over', async () => {
    const live = createLiveReplay(chain(), {
      mapping,
      clock: () => 0,
      events: [row('x', 't1', 1, 'complete')],
    });
    await live.advance(10);
    live.push([row('x', 't2', 6, 'complete')]);
    await live.advance(10);
    expect(live.state.marking['c']).toHaveLength(1);
    expect(live.canStepBack()).toBe(true);
    await live.stepBack();
    expect(live.state.marking['c']).toBeUndefined();
    expect(live.state.marking['b']).toHaveLength(1);
    await live.reset();
    expect(live.state.time).toBe(0);
    expect(live.nextEventTime()).toBe(1);
    const again = await live.advance(100);
    expect(types(again)).toEqual(['spawn', 'start', 'complete', 'start', 'complete', 'idle']);
  });

  it('replays an engine log pushed in pieces to the same state as the whole log at once', async () => {
    const net = loadExample('parcel-center');
    const engine = await runEngine(net, 1800, { seed: 1 });
    const log = logOf(engine.events, net);
    const batch = createReplay(net, log, { mapping: identityMapping(net) });
    await batch.advance(1800);

    const live = createLiveReplay(net, { mapping: identityMapping(net), clock: () => 0 });
    const collected: SimEvent[] = [];
    for (let at = 0; at < log.length; at += 97) {
      live.push(log.slice(at, at + 97));
      collected.push(...(await live.advance(30)));
    }
    collected.push(...(await live.advance(10_000)));
    expect(live.state.marking).toEqual(batch.state.marking);
    const { replay: liveStats, ...liveMetrics } = live.metrics();
    const { replay: batchStats, ...batchMetrics } = batch.metrics();
    expect(liveStats).toMatchObject({ fitness: 1, missing: 0, remaining: 0 });
    expect(batchStats?.fitness).toBe(1);
    expect(liveMetrics.completedCases).toBe(batchMetrics.completedCases);
    expect(liveMetrics.meanCycleTime).toBe(batchMetrics.meanCycleTime);
    expect(collected.filter((e) => e.type === 'deviation')).toEqual([]);
  });
});
