import { NetFormatError, serializeNet, type PetriNet } from '@pnm/core';
import { PnmlError, toPnml } from '@pnm/io';
import { CommandError } from './errors';
import type { Io } from './io';
import { detectFormat, parseNetInput, type LoadedNet, type NetFormat } from './lib/net-text';

export { detectFormat, type LoadedNet, type NetFormat };

/** The format that an output file name asks for. */
export function formatOfName(path: string): NetFormat {
  return /\.(pnml|xml)$/i.test(path) ? 'pnml' : 'json';
}

/**
 * Reads a net from a `.pn.json` or PNML file (or from standard input with `-`).
 * Throws a `CommandError` that names the file.
 */
export async function loadNet(
  io: Io,
  path: string,
  layout: 'keep' | 'auto' = 'keep',
): Promise<LoadedNet> {
  let text: string;
  try {
    text = await io.readText(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new CommandError(`${path}: no such file`);
    throw new CommandError(`${path}: cannot be read (${(error as Error).message})`);
  }
  try {
    return await parseNetInput(text, { path, layout });
  } catch (error) {
    if (error instanceof NetFormatError) {
      throw new CommandError(`${path}: ${error.message}`);
    }
    if (error instanceof PnmlError) throw new CommandError(`${path}: ${error.message}`);
    throw error;
  }
}

/** The text of a net in the given format. */
export function serialize(net: PetriNet, format: NetFormat): string {
  return format === 'pnml' ? toPnml(net) : serializeNet(net);
}

/** Prints the warnings of an import to standard error. */
export function reportImportWarnings(io: Io, path: string, loaded: LoadedNet): void {
  for (const warning of loaded.importWarnings) io.err(`${path}: warning: ${warning}\n`);
}

/** A short description of a net for messages: its name and sizes. */
export function describeNet(net: PetriNet): string {
  const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;
  return `"${net.name}" (${count(net.places.length, 'place')}, ${count(net.transitions.length, 'transition')}, ${count(net.arcs.length, 'arc')})`;
}
