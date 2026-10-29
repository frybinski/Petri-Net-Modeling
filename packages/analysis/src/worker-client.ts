import { createAnalysisClient } from './client';
import type { AnalysisClient } from './protocol';

/**
 * Starts the analyses in a Web Worker. Vite bundles `worker.ts` as a separate chunk because of the
 * `new Worker(new URL(...))` form below; keep it exactly like this.
 */
export function createAnalysisWorkerClient(): AnalysisClient {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  return createAnalysisClient(worker);
}
