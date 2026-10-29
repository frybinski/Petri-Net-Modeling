import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { parseNetText } from '@pnm/core';
import { parseCommandArgs } from '../args';
import { CommandError, UsageError } from '../errors';
import { table } from '../format';
import type { Io } from '../io';

export const EXAMPLES_HELP = `Usage: pnm examples list
       pnm examples copy <name> [<dir>] [--force]

The example nets of the repository are part of the program.

  list                lists them with their size
  copy <name> [dir]   writes <dir>/<name>.pn.json (default: the current folder); an existing file
                      is only replaced with --force. Use - as the folder for standard output.
`;

export interface Example {
  id: string;
  text: string;
}

/** The examples built into the program. */
export function embeddedExamples(): readonly Example[] {
  return __PNM_EXAMPLES__;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function examplesCommand(io: Io, args: readonly string[]): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === undefined) {
    io.err(EXAMPLES_HELP);
    return 2;
  }
  if (sub === '--help' || sub === '-h') {
    io.out(EXAMPLES_HELP);
    return 0;
  }
  const examples = embeddedExamples();
  if (sub === 'list') {
    parseCommandArgs(rest, {});
    io.out(
      table(
        [
          { header: 'NAME' },
          { header: 'PROFILE' },
          { header: 'PLACES', align: 'right' },
          { header: 'TRANSITIONS', align: 'right' },
          { header: 'TITLE' },
        ],
        examples.map((example) => {
          const net = parseNetText(example.text);
          return [
            example.id,
            net.profile,
            String(net.places.length),
            String(net.transitions.length),
            net.name,
          ];
        }),
      ),
    );
    return 0;
  }
  if (sub === 'copy') {
    const { values, positionals } = parseCommandArgs(rest, { force: { type: 'boolean' } });
    const [name, dir = '.', ...extra] = positionals;
    if (name === undefined) throw new UsageError('Missing example name (see pnm examples list).');
    if (extra.length > 0) throw new UsageError(`Unexpected argument "${extra[0] ?? ''}".`);
    const example = examples.find((e) => e.id === name);
    if (!example) {
      throw new CommandError(
        `No example "${name}". Available: ${examples.map((e) => e.id).join(', ')}.`,
      );
    }
    if (dir === '-') {
      await io.writeText('-', example.text);
      return 0;
    }
    const target = join(dir, `${example.id}.pn.json`);
    if (values.force !== true && (await exists(target))) {
      throw new CommandError(`${target} exists already; use --force to replace it.`);
    }
    await io.writeText(target, example.text);
    io.err(`Wrote ${target}\n`);
    return 0;
  }
  throw new UsageError(`Unknown examples command "${sub}" (list, copy).`);
}
