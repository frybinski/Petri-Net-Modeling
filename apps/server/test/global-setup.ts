import { join } from 'node:path';
import { buildCli } from '../../cli/scripts/build.ts';
import { buildServer, OUT_DIR } from '../scripts/build.ts';

/**
 * Some tests run `node dist/server.js` or load `dist/worker.js` in a thread, and the interface is
 * compared with the command line, so both are built first. The command line goes to a file of its
 * own so that it does not collide with the tests of `apps/cli`, which build `apps/cli/dist`.
 */
export default async function setup(): Promise<void> {
  await Promise.all([buildServer(), buildCli(join(OUT_DIR, 'pnm-cli.js'))]);
}
