/** Too many requests are waiting; the caller answers 429. */
export class QueueFullError extends Error {
  constructor() {
    super('The queue is full');
    this.name = 'QueueFullError';
  }
}

export interface SlotQueue {
  /**
   * Waits for a free slot and returns the function that gives it back. Rejects with
   * `QueueFullError` if `maxQueue` requests already wait, and with the reason of the signal if
   * the caller goes away while waiting.
   */
  acquire(signal?: AbortSignal): Promise<() => void>;
  readonly running: number;
  readonly waiting: number;
}

/** At most `concurrency` holders at a time, at most `maxQueue` waiting, first come first served. */
export function createSlotQueue(concurrency: number, maxQueue: number): SlotQueue {
  let running = 0;
  const waiters: Array<{ start: () => void }> = [];

  function releaseOnce(): () => void {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      running -= 1;
      waiters.shift()?.start();
    };
  }

  return {
    get running() {
      return running;
    },
    get waiting() {
      return waiters.length;
    },
    acquire(signal) {
      if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('Aborted'));
      if (running < concurrency) {
        running += 1;
        return Promise.resolve(releaseOnce());
      }
      if (waiters.length >= maxQueue) return Promise.reject(new QueueFullError());
      return new Promise((resolve, reject) => {
        const waiter = {
          start: () => {
            signal?.removeEventListener('abort', onAbort);
            running += 1;
            resolve(releaseOnce());
          },
        };
        const onAbort = (): void => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(signal?.reason ?? new Error('Aborted'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        waiters.push(waiter);
      });
    },
  };
}
