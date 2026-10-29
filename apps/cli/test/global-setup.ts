import { buildCli } from '../scripts/build.ts';

/** The integration tests run `node dist/pnm.js`, so the bundle is rebuilt before they start. */
export default async function setup(): Promise<void> {
  await buildCli();
}
