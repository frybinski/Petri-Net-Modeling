import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const serverRoot = resolve(here, '..');
export const repoRoot = resolve(serverRoot, '..', '..');

/** What the bundle carries with it: its version. The build and the unit tests put it in. */
export function embeddedDefines(): Record<string, string> {
  const pkg = JSON.parse(readFileSync(join(serverRoot, 'package.json'), 'utf8')) as {
    version: string;
  };
  return { __PNM_VERSION__: JSON.stringify(pkg.version) };
}
