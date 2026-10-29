import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const BUNDLE = resolve(here, '..', 'dist', 'pnm.js');
export const REPO = resolve(here, '..', '..', '..');
export const example = (name: string): string => join(REPO, 'examples', `${name}.pn.json`);
export const fixture = (name: string): string =>
  join(REPO, 'packages', 'io', 'test', 'fixtures', 'pnml', name);

export interface Result {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  stdin?: string;
  cwd?: string;
  env?: Record<string, string>;
  bundle?: string;
}

/** Runs the bundled program like a user would: a child process with its own streams. */
export function pnm(args: string[], options: RunOptions = {}): Promise<Result> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [options.bundle ?? BUNDLE, ...args], {
      cwd: options.cwd,
      env: { ...process.env, NO_COLOR: '1', ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (status) => {
      resolvePromise({ status, stdout, stderr });
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(options.stdin ?? '');
  });
}

/** A scratch folder that the test removes itself. */
export function tempDir(): { dir: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'pnm-cli-'));
  return {
    dir,
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
