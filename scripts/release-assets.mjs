#!/usr/bin/env node
// Prepares the files of a release: the bundled command line as `pnm-<version>.js` and its SHA-256
// sum as `pnm-<version>.js.sha256` (the format of `sha256sum`, so `sha256sum -c` checks it).
//
//   node scripts/release-assets.mjs 1.0.0 release-assets
//   node scripts/release-assets.mjs v1.0.0 out --bundle apps/cli/dist/pnm.js
//
// Run `pnpm build` first. The bundle must start with a shebang and report the same version when it
// is asked for it, so a release cannot carry a file of another version.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** Copies the bundle, writes the sum and checks the file. Returns the paths and the sum. */
export function prepare({ version, outDir, bundle }) {
  const source = readFileSync(bundle, 'utf8');
  if (!source.startsWith('#!/usr/bin/env node')) {
    throw new Error(
      `${bundle} does not start with a shebang: is it the bundle of the command line?`,
    );
  }
  mkdirSync(outDir, { recursive: true });
  const name = `pnm-${version}.js`;
  const file = join(outDir, name);
  copyFileSync(bundle, file);
  const reported = execFileSync(process.execPath, [file, '--version'], { encoding: 'utf8' }).trim();
  if (reported !== version) {
    throw new Error(`${name} reports version ${reported}, not ${version}.`);
  }
  const sum = sha256(file);
  const sumFile = `${file}.sha256`;
  writeFileSync(sumFile, `${sum}  ${name}\n`);
  return { file, sumFile, sum };
}

function main(argv) {
  const args = argv.slice(2);
  let bundle = join(root, 'apps', 'cli', 'dist', 'pnm.js');
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--bundle') bundle = resolve(args[(i += 1)] ?? '');
    else positional.push(args[i]);
  }
  if (positional.length !== 2) {
    console.error(
      'Usage: node scripts/release-assets.mjs <version|tag> <out dir> [--bundle <file>]',
    );
    return 2;
  }
  const version = positional[0].trim().replace(/^v/, '');
  try {
    const { file, sumFile, sum } = prepare({ version, outDir: resolve(positional[1]), bundle });
    console.log(`${file}\n${sumFile}\nsha256 ${sum}`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv);
