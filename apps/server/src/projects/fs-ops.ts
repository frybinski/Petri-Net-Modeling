import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises';

/**
 * The file operations the store uses. Tests replace some of them to make a write fail halfway; the
 * store must then leave the files as they were.
 */
export interface FsOps {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  readdir(path: string): Promise<string[]>;
  /** Writes a whole file that does not exist yet and flushes it to the disk. */
  writeNew(path: string, data: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string, options: { recursive?: boolean; force?: boolean }): Promise<void>;
  exists(path: string): Promise<boolean>;
  mtimeMs(path: string): Promise<number>;
}

export const nodeFs: FsOps = {
  mkdir: (path, options) => mkdir(path, options),
  readFile: (path, encoding) => readFile(path, encoding),
  readdir: (path) => readdir(path),
  async writeNew(path, data) {
    const handle = await open(path, 'wx', 0o640);
    try {
      await handle.writeFile(data, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
  rename: (from, to) => rename(from, to),
  rm: (path, options) => rm(path, options),
  async exists(path) {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  },
  async mtimeMs(path) {
    return (await stat(path)).mtimeMs;
  },
};

/** The name of a temporary file next to `path`; `.tmp` marks what a crash may leave behind. */
export function tempPathFor(path: string): string {
  return `${path}.${randomUUID().slice(0, 8)}.tmp`;
}

/**
 * Writes a file so that it is either there complete or not there: the data goes to a temporary
 * file next to it, is flushed, and is renamed over the target. A failure removes the temporary
 * file and leaves the target as it was.
 */
export async function writeAtomic(fs: FsOps, path: string, data: string): Promise<void> {
  const temp = tempPathFor(path);
  try {
    await fs.writeNew(temp, data);
    await fs.rename(temp, path);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}
