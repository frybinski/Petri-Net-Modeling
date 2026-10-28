import { createSimulationClient } from './client';
import type { SimulationClient } from './protocol';

/**
 * Starts the engine in a Web Worker. Vite bundles `worker.ts` as a separate chunk because of the
 * `new Worker(new URL(...))` form below; keep it exactly like this.
 */
export function createWorkerClient(): SimulationClient {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  return createSimulationClient(worker);
}
