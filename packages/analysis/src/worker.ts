import { createAnalysisHandler } from './handler';
import type { AnalysisRequest, CancelRequest } from './protocol';

/**
 * Entry point of the Web Worker: runs the analyses and answers the requests of
 * `createAnalysisClient`. Loaded by `worker-client.ts`.
 */
interface WorkerScope {
  onmessage: ((event: { data: AnalysisRequest | CancelRequest }) => void) | null;
  postMessage(message: unknown): void;
}

const scope = globalThis as unknown as WorkerScope;
const handle = createAnalysisHandler();

scope.onmessage = (event) => {
  void handle(event.data, (response) => {
    scope.postMessage(response);
  });
};
