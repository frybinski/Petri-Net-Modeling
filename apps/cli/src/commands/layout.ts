import type { PetriNet } from '@pnm/core';
import { choiceOption, numberOption, parseCommandArgs, requireOne } from '../args';
import { CommandError } from '../errors';
import type { Io } from '../io';
import { laidOutNet } from '../lib/layout';
import { describeNet, formatOfName, loadNet, reportImportWarnings, serialize } from '../net-file';

export const LAYOUT_HELP = `Usage: pnm layout <net> [-o <file>] [--direction RIGHT|DOWN] [--spacing <n>]

Computes new positions for all places and transitions (ELK, layered) and writes the net. The
positions are snapped to the grid of the editor, bend points of arcs are removed. Without -o the
.pn.json goes to standard output; a file name ending in .pnml is written as PNML.

  -o, --output <file>   where to write; - is standard output (default)
  --direction <d>       RIGHT (default) or DOWN
  --spacing <n>         minimum distance between nodes in pixels, default 60
`;

export async function layoutCommand(io: Io, args: readonly string[]): Promise<number> {
  const { values, positionals } = parseCommandArgs(args, {
    output: { type: 'string', short: 'o' },
    direction: { type: 'string' },
    spacing: { type: 'string' },
  });
  const path = requireOne(positionals, 'net file');
  const direction = choiceOption(values.direction, 'direction', ['RIGHT', 'DOWN'] as const);
  const spacing = numberOption(values.spacing, 'spacing', (n) => n >= 0, 'a number of at least 0');

  const loaded = await loadNet(io, path);
  reportImportWarnings(io, path, loaded);
  const { net } = loaded;
  let laidOut: PetriNet;
  try {
    laidOut = await laidOutNet(net, {
      ...(direction !== undefined && { direction }),
      ...(spacing !== undefined && { spacing }),
    });
  } catch (error) {
    throw new CommandError(`${path}: the layout failed (${(error as Error).message})`);
  }
  const output = values.output ?? '-';
  await io.writeText(output, serialize(laidOut, formatOfName(output)));
  io.err(`${path}: laid out ${describeNet(laidOut)}${output !== '-' ? `; wrote ${output}` : ''}\n`);
  return 0;
}
