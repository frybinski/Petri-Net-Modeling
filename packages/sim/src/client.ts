import { createHandler } from './handler';
import type {
  Command,
  CommandOptions,
  Request,
  Response,
  SimResult,
  SimulationClient,
} from './protocol';
import type { SimSnapshot } from './types';

type Pending = {
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
};

/** The part of a `Worker` the client uses. */
export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: MessageEvent) => unknown) | null;
  onerror: ((event: ErrorEvent) => unknown) | null;
}

function build(send: (request: Request) => Promise<Response>, stop: () => void): SimulationClient {
  let counter = 0;

  async function ask(command: Command, opts?: CommandOptions): Promise<Response> {
    counter += 1;
    const request: Request = {
      ...command,
      id: counter,
      ...(opts?.enabled !== undefined && { enabled: opts.enabled }),
    };
    const response = await send(request);
    if (response.type === 'error') throw new Error(response.message);
    return response;
  }

  async function result(command: Command, opts?: CommandOptions): Promise<SimResult> {
    const response = await ask(command, opts);
    if (response.type !== 'result') throw new Error('Unexpected answer of the simulation');
    return { events: response.events, view: response.view };
  }

  return {
    init: (net, options, opts) => result({ cmd: 'init', net, ...(options && { options }) }, opts),
    step: (opts) => result({ cmd: 'step' }, opts),
    stepRandom: (count, opts) =>
      result({ cmd: 'stepRandom', ...(count !== undefined && { count }) }, opts),
    advance: (seconds, maxEvents, opts) =>
      result({ cmd: 'advance', seconds, ...(maxEvents !== undefined && { maxEvents }) }, opts),
    fire: (transitionId, binding, opts) =>
      result({ cmd: 'fire', transitionId, ...(binding && { binding }) }, opts),
    edit: (placeId, tokens, opts) => result({ cmd: 'edit', placeId, tokens }, opts),
    setRate: (transitionId, perHour, opts) =>
      result({ cmd: 'setRate', transitionId, perHour }, opts),
    setBreakpoints: (breakpoints, opts) => result({ cmd: 'setBreakpoints', breakpoints }, opts),
    back: (opts) => result({ cmd: 'back' }, opts),
    reset: (seed, opts) => result({ cmd: 'reset', ...(seed !== undefined && { seed }) }, opts),
    view: (opts) => result({ cmd: 'view' }, opts),
    async snapshot(): Promise<SimSnapshot> {
      const response = await ask({ cmd: 'snapshot' });
      if (response.type !== 'snapshot') throw new Error('Unexpected answer of the simulation');
      return response.snapshot;
    },
    restore: (snapshot, opts) => result({ cmd: 'restore', snapshot }, opts),
    dispose: stop,
  };
}

/** A client that talks to an engine running in a Web Worker (see `worker.ts`). */
export function createSimulationClient(worker: WorkerLike): SimulationClient {
  const pending = new Map<number, Pending>();
  let disposed = false;

  const failAll = (message: string): void => {
    for (const entry of pending.values()) entry.reject(new Error(message));
    pending.clear();
  };

  worker.onmessage = (event) => {
    const response = event.data as Response;
    const entry = pending.get(response.id);
    if (!entry) return;
    pending.delete(response.id);
    entry.resolve(response);
  };
  worker.onerror = (event) => {
    failAll(event.message || 'The simulation worker failed');
  };

  return build(
    (request) =>
      new Promise<Response>((resolve, reject) => {
        if (disposed) {
          reject(new Error('The simulation was stopped'));
          return;
        }
        pending.set(request.id, { resolve, reject });
        worker.postMessage(request);
      }),
    () => {
      disposed = true;
      failAll('The simulation was stopped');
      worker.terminate();
    },
  );
}

/**
 * A client that runs the engine in the calling thread, with the same interface. Used where no
 * worker is available (tests, Node, a browser that blocks workers).
 */
export function createLocalClient(): SimulationClient {
  const handle = createHandler();
  let disposed = false;
  return build(
    (request) => {
      if (disposed) return Promise.reject(new Error('The simulation was stopped'));
      return handle(request);
    },
    () => {
      disposed = true;
    },
  );
}
