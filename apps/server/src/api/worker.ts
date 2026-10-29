import { parentPort } from 'node:worker_threads';
import { failureOf, type Failure } from './failure';
import { OPERATIONS, isOperation } from './ops';

/** What the main thread sends to a worker. */
export interface JobMessage {
  id: number;
  op: string;
  params: unknown;
}

/** What a worker sends back. */
export type ResultMessage =
  { id: number; ok: true; result: unknown } | { id: number; ok: false; failure: Failure };

/**
 * The entry of a thread of the job pool: runs one job after the other, each message is one job.
 * The thread has no environment of its own and no key; it only computes.
 */
const port = parentPort;
if (port) {
  port.on('message', (message: JobMessage) => {
    void (async () => {
      try {
        if (!isOperation(message.op)) throw new Error(`Unknown operation ${message.op}`);
        const run = OPERATIONS[message.op] as (params: unknown) => Promise<unknown>;
        const result = await run(message.params);
        port.postMessage({ id: message.id, ok: true, result } satisfies ResultMessage);
      } catch (error) {
        port.postMessage({
          id: message.id,
          ok: false,
          failure: failureOf(error),
        } satisfies ResultMessage);
      }
    })();
  });
}
