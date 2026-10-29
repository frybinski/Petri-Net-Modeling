import { chmod, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';
import { cliRoot, embeddedDefines } from './embedded.ts';

export const OUTFILE = join(cliRoot, 'dist', 'pnm.js');

/**
 * Bundles the command line into one ESM file with a shebang. The workspace packages are
 * TypeScript sources; esbuild compiles and includes them, so the file runs on Node 22 without
 * `node_modules`.
 */
export async function buildCli(): Promise<string> {
  await mkdir(join(cliRoot, 'dist'), { recursive: true });
  await build({
    entryPoints: [join(cliRoot, 'src', 'main.ts')],
    outfile: OUTFILE,
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
  await chmod(OUTFILE, 0o755);
  return OUTFILE;
}
