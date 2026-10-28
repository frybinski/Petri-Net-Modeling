import { createHandler } from './handler';
import type { Request } from './protocol';

/**
 * Entry point of the Web Worker: runs the engine and answers the requests of
 * `createSimulationClient`. Loaded by `worker-client.ts`.
 */
interface WorkerScope {
  onmessage: ((event: { data: Request }) => void) | null;
  postMessage(message: unknown): void;
}

const scope = globalThis as unknown as WorkerScope;
const handle = createHandler();

scope.onmessage = (event) => {
  void handle(event.data).then((response) => {
    scope.postMessage(response);
  });
};
