import { describe, expect, it } from 'vitest';
import {
  createHandler,
  createLocalClient,
  createSimulationClient,
  type Request,
  type WorkerLike,
} from '../src';
import { makeJsonNet, makeNet } from './helpers';

const net = () =>
  makeNet({
    places: [{ id: 'p', tokens: 2 }, 'q'],
    transitions: [{ id: 't', timing: { kind: 'fixed', value: 5 } }],
    arcs: [
      ['p', 't'],
      ['t', 'q'],
    ],
  });

/** A worker that runs the handler in this thread and answers asynchronously, like a real one. */
function fakeWorker(): WorkerLike & { terminated: boolean } {
  const handle = createHandler();
  const worker = {
    terminated: false,
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
    terminate() {
      worker.terminated = true;
    },
  };
  return worker;
}

describe.each([
  ['local client', () => createLocalClient()],
  ['worker client', () => createSimulationClient(fakeWorker())],
])('%s', (_name, create) => {
  it('reports the identity of every token next to the marking', async () => {
    const client = create();
    const init = await client.init(net(), { seed: 1 });
    expect(init.view.meta['p']).toHaveLength(2);
    expect(init.view.meta['p']!.map((m) => m.id)).toEqual(['k1', 'k2']);
    const after = await client.step();
    for (const [placeId, tokens] of Object.entries(after.view.marking)) {
      expect(after.view.meta[placeId]).toHaveLength(tokens.length);
    }
  });

  it('initialises, steps and reports the view', async () => {
    const client = create();
    const init = await client.init(net(), { seed: 1 });
    expect(init.view.time).toBe(0);
    expect(init.view.timed).toBe(true);
    expect(init.view.enabled?.map((e) => e.transitionId)).toEqual(['t']);
    const first = await client.step();
    expect(first.events.map((e) => e.type)).toEqual(['start', 'start']);
    expect(first.view.running).toHaveLength(2);
    expect(first.view.nextEventTime).toBe(5);
    expect(first.view.marking).toEqual({});
    const second = await client.step();
    expect(second.events.map((e) => e.type)).toEqual(['complete', 'complete']);
    expect(second.view.marking['q']).toHaveLength(2);
    expect(second.view.metrics.completedCases).toBe(2);
    client.dispose();
  });

  it('leaves out the enabled transitions on request', async () => {
    const client = create();
    await client.init(net());
    const result = await client.advance(1, undefined, { enabled: false });
    expect(result.view.enabled).toBeNull();
    client.dispose();
  });

  it('steps back, resets and edits', async () => {
    const client = create();
    await client.init(net());
    await client.step();
    const back = await client.back();
    expect(back.view.time).toBe(0);
    expect(back.view.canStepBack).toBe(false);
    const edit = await client.edit('p', [1, 1, 1]);
    expect(edit.events[0]).toMatchObject({ type: 'marking-edited', delta: 1 });
    const reset = await client.reset(3);
    expect(reset.view.marking['p']).toHaveLength(2);
    client.dispose();
  });

  it('answers in the order of the calls, even if they are issued without waiting', async () => {
    const client = create();
    await client.init(net());
    const results = await Promise.all([client.step(), client.step(), client.view()]);
    expect(results.map((r) => r.view.time)).toEqual([0, 5, 5]);
    client.dispose();
  });

  it('turns an engine error into a rejection', async () => {
    const client = create();
    await client.init(net());
    await expect(client.fire('nope')).rejects.toThrow(/Unknown transition/);
    await expect(client.fire('t', undefined)).resolves.toBeDefined();
    client.dispose();
  });

  it('saves and restores a snapshot', async () => {
    const client = create();
    await client.init(net());
    const snapshot = await client.snapshot();
    await client.step();
    const restored = await client.restore(snapshot);
    expect(restored.view.time).toBe(0);
    expect(restored.view.marking['p']).toHaveLength(2);
    client.dispose();
  });

  it('rejects calls after dispose', async () => {
    const client = create();
    client.dispose();
    await expect(client.view()).rejects.toThrow(/stopped/);
  });

  it('requires init first', async () => {
    const client = create();
    await expect(client.step()).rejects.toThrow(/not been initialised/);
    client.dispose();
  });
});

describe('worker client', () => {
  it('rejects pending calls when the worker fails and terminates it on dispose', async () => {
    const worker = fakeWorker();
    worker.postMessage = () => {
      // never answers
    };
    const client = createSimulationClient(worker);
    const pending = client.view();
    worker.onerror?.({ message: 'boom' } as ErrorEvent);
    await expect(pending).rejects.toThrow('boom');
    client.dispose();
    expect(worker.terminated).toBe(true);
  });
});

describe('adjusting tokens', () => {
  it('adds and withdraws relative to the marking of the engine, however fast it is called', async () => {
    const client = createLocalClient();
    await client.init(net());
    const results = await Promise.all([
      client.adjust('q', 1),
      client.adjust('q', 1),
      client.adjust('q', -1),
      client.adjust('p', -1),
      client.adjust('p', -1),
      client.adjust('p', -1),
    ]);
    const last = results.at(-1)!.view;
    expect(last.marking['q']).toHaveLength(1);
    expect(last.marking['p']).toBeUndefined();
    client.dispose();
  });

  it('copies the last token of a JSON net, or the sample if the place is empty', async () => {
    const client = createLocalClient();
    const json = makeJsonNet({
      places: [{ id: 'p', tokens: [{ id: 1 }] }, { id: 'q' }],
      transitions: [],
      arcs: [],
    });
    await client.init(json);
    expect((await client.adjust('p', 1)).view.marking['p']).toEqual([{ id: 1 }, { id: 1 }]);
    expect((await client.adjust('q', 1, { id: 'x' })).view.marking['q']).toEqual([{ id: 'x' }]);
    client.dispose();
  });
});
