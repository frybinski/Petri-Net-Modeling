import { buildServer } from '../scripts/build.ts';

/** Some tests run `node dist/server.js` or load `dist/worker.js` in a thread, so build it first. */
export default async function setup(): Promise<void> {
  await buildServer();
}
