import { buildCli } from './build.ts';

const file = await buildCli();
process.stdout.write(`Built ${file}\n`);
