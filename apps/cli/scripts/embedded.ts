import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const cliRoot = resolve(here, '..');
export const repoRoot = resolve(cliRoot, '..', '..');

/**
 * What the program carries with it: its version and the example nets of the repository. The build
 * (esbuild) and the unit tests (vitest) both put these in as compile time constants.
 */
export function embeddedDefines(): Record<string, string> {
  const pkg = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8')) as {
    version: string;
  };
  const dir = join(repoRoot, 'examples');
  const examples = readdirSync(dir)
    .filter((file) => file.endsWith('.pn.json'))
    .sort()
    .map((file) => ({
      id: file.replace(/\.pn\.json$/, ''),
      text: readFileSync(join(dir, file), 'utf8'),
    }));
  return {
    __PNM_VERSION__: JSON.stringify(pkg.version),
    __PNM_EXAMPLES__: JSON.stringify(examples),
  };
}
