import { describe, expect, it } from 'vitest';
import {
  createHandler,
  createLocalClient,
  createSimulationClient,
  type LogEvent,
  type Request,
  type WorkerLike,
} from '../src';
import { makeNet } from './helpers';

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

const log: LogEvent[] = [
  { caseId: 'x', activity: 'A', time: 2, lifecycle: 'start' },
  { caseId: 'x', activity: 'A', time: 6, lifecycle: 'complete' },
  { caseId: 'x', activity: 'B', time: 7, lifecycle: 'complete' },
];
const options = { mapping: { A: 't1', B: 't2' } };

function fakeWorker(): WorkerLike {
  const handle = createHandler();
  const worker = {
    onmessage: null as WorkerLike['onmessage'],
    onerror: null as WorkerLike['onerror'],
    postMessage(message: unknown) {
      const copy = structuredClone(message) as Request;
      setTimeout(() => {
        void handle(copy).then((response) => {
          worker.onmessage?.({ data: structuredClone(response) } as MessageEvent);
        });
      }, 0);
    },
    terminate() {},
  };
  return worker;
}

describe.each([
  ['local client', () => createLocalClient()],
  ['worker client', () => createSimulationClient(fakeWorker())],
])('replay through the %s', (_name, create) => {
  it('starts a replay, steps through the log and reports the figures of the replay', async () => {
    const client = create();
    const init = await client.initReplay(chain(), { events: log, options });
    expect(init.events).toEqual([]);
    expect(init.view.timed).toBe(true);
    expect(init.view.nextEventTime).toBe(2);
    expect(init.view.enabled).toEqual([]);
    expect(init.view.rates).toEqual({});
    const first = await client.step();
    expect(first.events.map((e) => e.type)).toEqual(['spawn', 'start']);
    expect(first.view.running.map((f) => [f.transitionId, f.start, f.end])).toEqual([['t1', 2, 6]]);
    const rest = await client.advance(Infinity, 100);
    expect(rest.events.map((e) => e.type)).toEqual(['complete', 'start', 'complete', 'idle']);
    expect(rest.view.marking['c']).toHaveLength(1);
    expect(rest.view.metrics.replay).toMatchObject({ fitness: 1, processed: 3, total: 3 });
    const back = await client.back();
    expect(back.view.canStepBack).toBe(true);
    const reset = await client.reset();
    expect(reset.view.time).toBe(0);
    expect(reset.view.metrics.replay?.processed).toBe(0);
  });

  it('refuses what a replay cannot do', async () => {
    const client = create();
    await client.initReplay(chain(), { events: log, options });
    await expect(client.fire('t1')).rejects.toThrow(/by hand/);
    await expect(client.adjust('a', 1)).rejects.toThrow(/edited/);
    await expect(client.push([])).rejects.toThrow(/live/);
    await expect(client.closeFeed()).rejects.toThrow(/live/);
    await expect(
      client.initReplay(chain(), { events: log, options: { mapping: { A: 'nope' } } }),
    ).rejects.toThrow(/not a transition/);
  });

  it('feeds a live replay with events and ends the feed', async () => {
    const client = create();
    const init = await client.initReplay(chain(), { events: [], options, live: true });
    expect(init.view.nextEventTime).toBeNull();
    const idle = await client.advance(5);
    expect(idle.events.map((e) => e.type)).toEqual(['idle']);
    const pushed = await client.push([
      { caseId: 'y', activity: 'A', time: 3, lifecycle: 'complete' },
    ]);
    expect(pushed.view.nextEventTime).toBe(3);
    const played = await client.advance(10);
    expect(played.events.map((e) => e.type)).toEqual(['spawn', 'start', 'complete', 'idle']);
    expect(played.view.marking['b']).toHaveLength(1);
    await client.closeFeed();
    await expect(
      client.push([{ caseId: 'y', activity: 'B', lifecycle: 'complete' }]),
    ).rejects.toThrow(/closed/);
    // The engine can be started again on the same client.
    const engine = await client.init(chain());
    expect(engine.view.timed).toBe(false);
    await expect(client.push([])).rejects.toThrow(/live/);
  });
});
