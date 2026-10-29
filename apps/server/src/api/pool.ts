import { Worker } from 'node:worker_threads';
import { ApiError } from '../errors';
import type { Logger } from '../logger';
import { apiErrorOf, type Failure } from './failure';

export interface PoolOptions {
  /** The bundle that runs in a thread (`worker.js`); it must answer the messages of `worker.ts`. */
  workerFile: string | URL;
  /** The number of threads, and so of jobs that run at the same time. */
  size: number;
  /** A job that runs longer is stopped by ending its thread. */
  timeoutMs: number;
  /** The heap of a thread in megabytes; a job that needs more ends with `resource_limit`. */
  memoryMb: number;
  /** How many jobs may wait for a free thread; more are refused. */
  maxQueue: number;
  logger: Logger;
  /** An idle thread is ended after this time and started again when needed. Default 5 minutes. */
  idleMs?: number;
}

export interface RunOptions {
  /** Ends the job (and its thread) when the caller goes away. */
  signal?: AbortSignal;
  /** A shorter limit than the pool's. */
  timeoutMs?: number;
}

export interface PoolStats {
  size: number;
  running: number;
  queued: number;
  /** Threads that exist right now. */
  threads: number;
}

export interface JobPool {
  run<T = unknown>(op: string, params: unknown, options?: RunOptions): Promise<T>;
  stats(): PoolStats;
  /** Ends all threads; running and waiting jobs are rejected. */
  close(): Promise<void>;
}

interface Job {
  id: number;
  op: string;
  params: unknown;
  timeoutMs: number;
  signal: AbortSignal | undefined;
  resolve(value: unknown): void;
  reject(error: unknown): void;
  timer?: NodeJS.Timeout;
  onAbort?: () => void;
}

interface Slot {
  worker: Worker | null;
  job: Job | null;
  idleTimer?: NodeJS.Timeout;
}

type Message =
  { id: number; ok: true; result: unknown } | { id: number; ok: false; failure: Failure };

export function createJobPool(options: PoolOptions): JobPool {
  const { logger } = options;
  const idleMs = options.idleMs ?? 5 * 60 * 1000;
  const slots: Slot[] = Array.from({ length: options.size }, () => ({ worker: null, job: null }));
  const queue: Job[] = [];
  let nextId = 1;
  let closed = false;

  function spawn(slot: Slot): Worker {
    const worker = new Worker(options.workerFile, {
      // The thread gets no copy of the environment, which holds the key of the language model.
      env: {},
      resourceLimits: {
        maxOldGenerationSizeMb: options.memoryMb,
        maxYoungGenerationSizeMb: Math.max(8, Math.min(64, Math.floor(options.memoryMb / 4))),
        stackSizeMb: 4,
      },
    });
    worker.on('message', (message: Message) => {
      const job = slot.job;
      if (slot.worker !== worker || job === null || job.id !== message.id) return;
      finish(slot, job);
      if (message.ok) job.resolve(message.result);
      else {
        if (message.failure.internal !== undefined) {
          logger.error('job failed', { op: job.op, error: message.failure.internal });
        }
        job.reject(apiErrorOf(message.failure));
      }
      advance(slot);
    });
    worker.on('error', (error: Error & { code?: string }) => {
      if (slot.worker !== worker) return;
      slot.worker = null;
      const job = slot.job;
      if (job === null) return;
      finish(slot, job);
      if (error.code === 'ERR_WORKER_OUT_OF_MEMORY') {
        job.reject(
          new ApiError(
            422,
            'resource_limit',
            `The job needed more memory than the limit of ${options.memoryMb} MB and was stopped. ` +
              'Use a smaller net or lower limits.',
          ),
        );
      } else {
        logger.error('job thread failed', { op: job.op, error: error.message.slice(0, 300) });
        job.reject(new ApiError(500, 'internal', 'The job failed unexpectedly.'));
      }
      advance(slot);
    });
    worker.on('exit', () => {
      if (slot.worker !== worker) return;
      slot.worker = null;
      const job = slot.job;
      if (job === null) return;
      finish(slot, job);
      job.reject(new ApiError(500, 'internal', 'The job thread ended unexpectedly.'));
      advance(slot);
    });
    slot.worker = worker;
    return worker;
  }

  /** Takes the job off its thread: no timer, no abort listener. */
  function finish(slot: Slot, job: Job): void {
    if (job.timer) clearTimeout(job.timer);
    if (job.onAbort) job.signal?.removeEventListener('abort', job.onAbort);
    slot.job = null;
  }

  /** Ends the thread of a job, which stops whatever it is doing. */
  function stop(slot: Slot, error: unknown): void {
    const job = slot.job;
    const worker = slot.worker;
    slot.worker = null;
    if (job !== null) {
      finish(slot, job);
      job.reject(error);
    }
    if (worker) void worker.terminate();
    advance(slot);
  }

  function start(slot: Slot, job: Job): void {
    if (slot.idleTimer) clearTimeout(slot.idleTimer);
    slot.job = job;
    // A job that waited in the queue had a listener there; the running job needs its own.
    if (job.onAbort) job.signal?.removeEventListener('abort', job.onAbort);
    const worker = slot.worker ?? spawn(slot);
    job.timer = setTimeout(() => {
      logger.warn('job stopped after its time limit', { op: job.op, limitMs: job.timeoutMs });
      stop(
        slot,
        new ApiError(
          504,
          'timeout',
          `The job did not finish within ${Math.round((job.timeoutMs / 1000) * 10) / 10} seconds and was stopped.`,
        ),
      );
    }, job.timeoutMs);
    if (job.signal) {
      job.onAbort = () => {
        stop(slot, job.signal?.reason ?? new Error('Aborted'));
      };
      job.signal.addEventListener('abort', job.onAbort, { once: true });
    }
    worker.postMessage({ id: job.id, op: job.op, params: job.params });
  }

  function advance(slot: Slot): void {
    if (slot.job !== null || closed) return;
    const next = queue.shift();
    if (next) {
      start(slot, next);
      return;
    }
    if (slot.worker && idleMs > 0) {
      slot.idleTimer = setTimeout(() => {
        if (slot.job === null && slot.worker) {
          const worker = slot.worker;
          slot.worker = null;
          void worker.terminate();
        }
      }, idleMs);
      slot.idleTimer.unref();
    }
  }

  return {
    run<T>(op: string, params: unknown, runOptions: RunOptions = {}): Promise<T> {
      if (closed) {
        return Promise.reject(new ApiError(503, 'unavailable', 'The server is shutting down.'));
      }
      const signal = runOptions.signal;
      if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('Aborted'));
      return new Promise<T>((resolve, reject) => {
        const job: Job = {
          id: nextId++,
          op,
          params,
          timeoutMs: runOptions.timeoutMs ?? options.timeoutMs,
          signal,
          resolve: resolve as (value: unknown) => void,
          reject,
        };
        const free = slots.find((slot) => slot.job === null);
        if (free) {
          start(free, job);
          return;
        }
        if (queue.length >= options.maxQueue) {
          reject(
            new ApiError(
              503,
              'busy',
              'All workers are busy and the queue is full. Try again in a moment.',
              { headers: { 'Retry-After': '5' } },
            ),
          );
          return;
        }
        if (signal) {
          const onAbort = (): void => {
            const index = queue.indexOf(job);
            if (index >= 0) queue.splice(index, 1);
            reject(signal.reason ?? new Error('Aborted'));
          };
          signal.addEventListener('abort', onAbort, { once: true });
          job.onAbort = onAbort;
        }
        queue.push(job);
      });
    },

    stats() {
      return {
        size: slots.length,
        running: slots.filter((slot) => slot.job !== null).length,
        queued: queue.length,
        threads: slots.filter((slot) => slot.worker !== null).length,
      };
    },

    async close() {
      closed = true;
      const error = new ApiError(503, 'unavailable', 'The server is shutting down.');
      for (const job of queue.splice(0)) job.reject(error);
      const ending: Array<Promise<number>> = [];
      for (const slot of slots) {
        if (slot.idleTimer) clearTimeout(slot.idleTimer);
        const worker = slot.worker;
        const job = slot.job;
        slot.worker = null;
        if (job) {
          finish(slot, job);
          job.reject(error);
        }
        if (worker) ending.push(worker.terminate());
      }
      await Promise.all(ending);
    },
  };
}
