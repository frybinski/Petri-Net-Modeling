import { createAnalysisHandler } from './handler';
import type {
  AnalysisClient,
  AnalysisRequest,
  AnalysisResponse,
  CancelRequest,
  CommandName,
  Commands,
  RunOptions,
} from './protocol';
import { AnalysisCancelled } from './state-space';

/** The part of a `Worker` the client uses. */
export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: MessageEvent) => unknown) | null;
  onerror: ((event: ErrorEvent) => unknown) | null;
}

interface Pending {
  resolve: (result: Commands[CommandName]['result']) => void;
  reject: (error: Error) => void;
  onProgress: RunOptions['onProgress'];
}

type Send = (request: AnalysisRequest | CancelRequest) => void;

function build(
  start: (deliver: (response: AnalysisResponse) => void, fail: (message: string) => void) => Send,
  stop: () => void,
): AnalysisClient {
  const pending = new Map<number, Pending>();
  let counter = 0;
  let disposed = false;

  const deliver = (response: AnalysisResponse): void => {
    const entry = pending.get(response.id);
    if (!entry) return;
    if (response.type === 'progress') {
      entry.onProgress?.(response.progress);
      return;
    }
    pending.delete(response.id);
    if (response.type === 'result') entry.resolve(response.result);
    else entry.reject(response.cancelled ? new AnalysisCancelled() : new Error(response.message));
  };
  const fail = (message: string): void => {
    for (const entry of pending.values()) entry.reject(new Error(message));
    pending.clear();
  };
  const send = start(deliver, fail);

  function call<K extends CommandName>(
    cmd: K,
    args: Commands[K]['args'],
    run: RunOptions = {},
  ): Promise<Commands[K]['result']> {
    if (disposed) return Promise.reject(new Error('The analysis was stopped'));
    if (run.signal?.aborted) return Promise.reject(new AnalysisCancelled());
    counter += 1;
    const id = counter;
    return new Promise((resolve, reject) => {
      pending.set(id, {
        resolve: resolve as Pending['resolve'],
        reject,
        onProgress: run.onProgress,
      });
      run.signal?.addEventListener(
        'abort',
        () => {
          if (pending.has(id)) send({ id: ++counter, cmd: 'cancel', target: id });
        },
        { once: true },
      );
      send({ id, cmd, ...args } as AnalysisRequest);
    });
  }

  return {
    structure: (net, options, run) => call('structure', { net, ...(options && { options }) }, run),
    invariants: (net, options, run) =>
      call('invariants', { net, ...(options && { options }) }, run),
    stateSpace: (net, options, run) =>
      call('stateSpace', { net, ...(options && { options }) }, run),
    coverability: (net, options, run) =>
      call('coverability', { net, ...(options && { options }) }, run),
    check: (net, properties, options, run) =>
      call('check', { net, properties, ...(options && { options }) }, run),
    conformance: (traces, properties, options, run) =>
      call('conformance', { traces, properties, ...(options && { options }) }, run),
    dispose() {
      disposed = true;
      for (const entry of pending.values()) entry.reject(new Error('The analysis was stopped'));
      pending.clear();
      stop();
    },
  };
}

/** A client that talks to the analyses running in a Web Worker (see `worker.ts`). */
export function createAnalysisClient(worker: WorkerLike): AnalysisClient {
  return build(
    (deliver, fail) => {
      worker.onmessage = (event) => {
        deliver(event.data as AnalysisResponse);
      };
      worker.onerror = (event) => {
        fail(event.message || 'The analysis worker failed');
      };
      return (request) => {
        worker.postMessage(request);
      };
    },
    () => {
      worker.terminate();
    },
  );
}

/**
 * A client that runs the analyses in the calling thread, with the same interface. Used where no
 * worker is available (tests, Node, a browser that blocks workers).
 */
export function createLocalAnalysisClient(): AnalysisClient {
  const handle = createAnalysisHandler();
  return build(
    (deliver) => (request) => {
      // Answer asynchronously, like a worker would.
      void Promise.resolve().then(() => handle(request, deliver));
    },
    () => undefined,
  );
}
