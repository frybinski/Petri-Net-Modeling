import { chmod, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';
import { cliRoot, embeddedDefines } from './embedded.ts';

export const OUTFILE = join(cliRoot, 'dist', 'pnm.js');

/**
 * Bundles the command line into one ESM file with a shebang. The workspace packages are
 * TypeScript sources; esbuild compiles and includes them, so the file runs on Node 22 without
 * `node_modules`.
 */
export async function buildCli(outfile: string = OUTFILE): Promise<string> {
  await mkdir(dirname(outfile), { recursive: true });
  await build({
    entryPoints: [join(cliRoot, 'src', 'main.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    legalComments: 'none',
    logLevel: 'warning',
    define: embeddedDefines(),
    banner: {
      // Some bundled CommonJS packages call `require` for Node's own modules.
      js: [
        '#!/usr/bin/env node',
        "import { createRequire as __pnmCreateRequire } from 'node:module';",
        'const require = __pnmCreateRequire(import.meta.url);',
      ].join('\n'),
    },
  });
  await chmod(outfile, 0o755);
  return outfile;
}
