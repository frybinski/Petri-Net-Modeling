import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** What the commands need from the outside world; tests replace it. */
export interface Io {
  /** Writes to standard output. */
  out(text: string): void;
  /** Writes to standard error. */
  err(text: string): void;
  /** Reads a file; `-` reads standard input. */
  readText(path: string): Promise<string>;
  /** Writes a file (and its folder); `-` writes to standard output. */
  writeText(path: string, text: string): Promise<void>;
  env: Readonly<Record<string, string | undefined>>;
  /** Standard output is a terminal that understands colors. */
  color: boolean;
  /** For the language model; defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks).toString('utf8');
}

/** The real thing: the process streams and the file system. */
export function nodeIo(): Io {
  const out = (text: string): void => {
    process.stdout.write(text);
  };
  return {
    out,
    err(text) {
      process.stderr.write(text);
    },
    readText: (path) => (path === '-' ? readStdin() : readFile(path, 'utf8')),
    async writeText(path, text) {
      if (path === '-') {
        out(text);
        return;
      }
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, text, 'utf8');
    },
    env: process.env,
    color: process.stdout.isTTY === true && process.env['NO_COLOR'] === undefined,
  };
}
