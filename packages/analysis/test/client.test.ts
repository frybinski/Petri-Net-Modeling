import { describe, expect, it } from 'vitest';
import {
  AnalysisCancelled,
  analyzeBehaviour,
  analyzeInvariants,
  analyzeStructure,
  buildStateSpace,
  createAnalysisClient,
  createAnalysisHandler,
  createLocalAnalysisClient,
  type AnalysisRequest,
  type AnalysisResponse,
  type CancelRequest,
  type PropertySpec,
  type StateSpaceProgress,
  type WorkerLike,
} from '../src';
import { example, ptNet } from './helpers';

/**
 * A worker stand-in: messages are cloned like `postMessage` does and handled by the same handler
 * the real worker uses, one macrotask later.
 */
function fakeWorker(): WorkerLike & { responses: AnalysisResponse[]; terminated: boolean } {
  const handle = createAnalysisHandler();
  const worker: WorkerLike & { responses: AnalysisResponse[]; terminated: boolean } = {
    responses: [],
    terminated: false,
    onmessage: null,
    onerror: null,
    terminate() {
      worker.terminated = true;
    },
    postMessage(message) {
      const request = structuredClone(message) as AnalysisRequest | CancelRequest;
      setTimeout(() => {
        void handle(request, (response) => {
          const copy = structuredClone(response);
          worker.responses.push(copy);
          setTimeout(() => worker.onmessage?.({ data: copy } as MessageEvent), 0);
        });
      }, 0);
    },
  };
  return worker;
}

const growing = ptNet({ places: [['p']], transitions: ['arrive'], arcs: [['arrive', 'p']] });

describe.each([
  ['the local client', () => createLocalAnalysisClient()],
  ['a worker', () => createAnalysisClient(fakeWorker())],
])('%s', (_, make) => {
  it('answers the same as the functions', async () => {
    const client = make();
    const net = example('producer-consumer');
    expect(await client.structure(net)).toEqual(analyzeStructure(net));
    expect(await client.invariants(net)).toEqual(analyzeInvariants(net));
    const report = await client.stateSpace(net);
    const space = await buildStateSpace(net);
    expect(report.space).toEqual(space);
    expect(report.behaviour).toEqual(analyzeBehaviour(net, space));
    const coverability = await client.coverability(net);
    expect(coverability.bounded).toBe(true);
    client.dispose();
  });

  it('checks properties and logs', async () => {
    const client = make();
    const net = example('order-processing');
    const properties: PropertySpec[] = [
      { id: 'a', kind: 'declare', template: 'response', activities: ['Approve', 'Create invoice'] },
      { id: 'b', kind: 'ltlf', formula: 'F Reject' },
    ];
    const report = await client.check(net, properties);
    expect(report.results.map((r) => r.verdict)).toEqual(['holds', 'holds']);
    expect(report.states).toBe(216);
    const log = await client.conformance(
      [
        { caseId: '1', activities: ['Approve', 'Create invoice'] },
        { caseId: '2', activities: ['Approve'] },
      ],
      properties.slice(0, 1),
    );
    expect(log.properties[0]).toMatchObject({ total: 2, satisfied: 1 });
    client.dispose();
  });

  it('reports progress and can be cancelled', async () => {
    const client = make();
    const progress: StateSpaceProgress[] = [];
    const controller = new AbortController();
    const promise = client.stateSpace(
      growing,
      { maxStates: 50_000_000, maxTimeMs: 60_000 },
      {
        signal: controller.signal,
        onProgress: (p) => {
          progress.push(p);
          if (progress.length === 2) controller.abort();
        },
      },
    );
    await expect(promise).rejects.toBeInstanceOf(AnalysisCancelled);
    expect(progress.length).toBeGreaterThanOrEqual(2);
    // The client still works afterwards.
    expect((await client.structure(growing)).places).toBe(1);
    client.dispose();
  });

  it('rejects calls with an aborted signal and after dispose', async () => {
    const client = make();
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.structure(growing, undefined, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(AnalysisCancelled);
    client.dispose();
    await expect(client.structure(growing)).rejects.toThrow(/stopped/);
  });

  it('turns an error of the analysis into a rejection', async () => {
    const client = make();
    const broken = { ...growing, places: null } as unknown as typeof growing;
    await expect(client.structure(broken)).rejects.toThrow();
    client.dispose();
  });
});

describe('the worker protocol', () => {
  it('reuses the state space for a check right after the exploration', async () => {
    const worker = fakeWorker();
    const client = createAnalysisClient(worker);
    const net = example('order-processing');
    await client.stateSpace(net);
    const before = worker.responses.filter((r) => r.type === 'progress').length;
    expect(before).toBeGreaterThan(0);
    await client.check(net, [{ id: 'a', kind: 'ltlf', formula: 'F Approve' }]);
    expect(worker.responses.filter((r) => r.type === 'progress')).toHaveLength(before);
    // A different limit explores again.
    await client.check(net, [{ id: 'a', kind: 'ltlf', formula: 'F Approve' }], { maxStates: 100 });
    expect(worker.responses.filter((r) => r.type === 'progress').length).toBeGreaterThan(before);
    client.dispose();
    expect(worker.terminated).toBe(true);
  });

  it('rejects pending calls when the worker fails', async () => {
    const worker = fakeWorker();
    const client = createAnalysisClient(worker);
    const pending = client.stateSpace(growing, { maxStates: 50_000_000, maxTimeMs: 60_000 });
    worker.onerror?.({ message: 'boom' } as ErrorEvent);
    await expect(pending).rejects.toThrow('boom');
    client.dispose();
  });
});
