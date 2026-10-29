import { buildServer } from './build.ts';

const files = await buildServer();
process.stdout.write(`Built ${files.join(', ')}\n`);
