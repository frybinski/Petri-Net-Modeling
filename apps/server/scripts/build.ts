import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';
import { embeddedDefines, serverRoot } from './embedded.ts';

export const OUT_DIR = join(serverRoot, 'dist');

/**
 * Bundles the server into ESM files that run on Node 22 without `node_modules`: `server.js` (the
 * service), `worker.js` (a thread of the job pool) and `fake-llm.js` (a stand-in for the language
 * model server, for the local Compose file and the tests). The workspace packages are TypeScript sources; esbuild compiles and includes them.
 */
export async function buildServer(outDir: string = OUT_DIR): Promise<string[]> {
  await mkdir(outDir, { recursive: true });
  await build({
    entryPoints: {
      server: join(serverRoot, 'src', 'main.ts'),
      worker: join(serverRoot, 'src', 'api', 'worker.ts'),
      'fake-llm': join(serverRoot, 'src', 'fake-llm', 'main.ts'),
    },
    outdir: outDir,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    outExtension: { '.js': '.js' },
    legalComments: 'none',
    logLevel: 'warning',
    define: embeddedDefines(),
    banner: {
      // Some bundled CommonJS packages call `require` for Node's own modules.
      js: [
        "import { createRequire as __pnmCreateRequire } from 'node:module';",
        'const require = __pnmCreateRequire(import.meta.url);',
      ].join('\n'),
    },
  });
  return ['server.js', 'worker.js', 'fake-llm.js'].map((name) => join(outDir, name));
}
