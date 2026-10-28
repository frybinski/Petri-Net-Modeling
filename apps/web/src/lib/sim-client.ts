import { createLocalClient, type SimulationClient } from '@pnm/sim';
import { createWorkerClient } from '@pnm/sim/worker-client';

type Factory = () => SimulationClient;

const defaultFactory: Factory = () => {
  // jsdom and Node have no Worker; a browser may refuse to start one (for example from a file
  // URL). The engine then runs in the page itself, with the same interface.
  if (typeof Worker === 'undefined') return createLocalClient();
  try {
    return createWorkerClient();
  } catch {
    return createLocalClient();
  }
};

let factory: Factory = defaultFactory;

/** Creates the client the editor uses to run a simulation (a Web Worker where available). */
export function createSimulationClientForEditor(): SimulationClient {
  return factory();
}

/** For tests: replaces how clients are created; call without argument to restore the default. */
export function setSimulationClientFactory(next?: Factory): void {
  factory = next ?? defaultFactory;
}
