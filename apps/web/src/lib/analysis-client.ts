import { createLocalAnalysisClient, type AnalysisClient } from '@pnm/analysis';
import { createAnalysisWorkerClient } from '@pnm/analysis/worker-client';

type Factory = () => AnalysisClient;

const defaultFactory: Factory = () => {
  // jsdom and Node have no Worker; a browser may refuse to start one. The analyses then run in the
  // page itself, with the same interface.
  if (typeof Worker === 'undefined') return createLocalAnalysisClient();
  try {
    return createAnalysisWorkerClient();
  } catch {
    return createLocalAnalysisClient();
  }
};

let factory: Factory = defaultFactory;

/** Creates the client the editor uses to run analyses (a Web Worker where available). */
export function createAnalysisClientForEditor(): AnalysisClient {
  return factory();
}

/** For tests: replaces how clients are created; call without argument to restore the default. */
export function setAnalysisClientFactory(next?: Factory): void {
  factory = next ?? defaultFactory;
}
