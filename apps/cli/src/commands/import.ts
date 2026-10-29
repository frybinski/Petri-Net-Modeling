import { choiceOption, parseCommandArgs, requireOne } from '../args';
import { plural } from '../format';
import type { Io } from '../io';
import { describeNet, loadNet, reportImportWarnings, serialize } from '../net-file';

export const IMPORT_HELP = `Usage: pnm import <file.pnml> [-o <net.pn.json>] [--layout auto|keep]

Reads a PNML file (place/transition nets of ProM, pm4py, WoPeD and others, and the files of this
tool) and writes it as .pn.json. Without -o the JSON goes to standard output. What was not
understood is reported on standard error as warnings.

  -o, --output <file>  where to write; - is standard output (default)
  --layout <mode>      keep (default) uses the positions of the file and lays the net out only if
                       positions are missing; auto always computes a new layout

Exit status: 0 success, 1 the file cannot be read as PNML, 2 wrong usage.
`;

export async function importCommand(io: Io, args: readonly string[]): Promise<number> {
  const { values, positionals } = parseCommandArgs(args, {
    output: { type: 'string', short: 'o' },
    layout: { type: 'string' },
  });
  const path = requireOne(positionals, 'PNML file');
  const layout = choiceOption(values.layout, 'layout', ['keep', 'auto'] as const) ?? 'keep';
  const loaded = await loadNet(io, path, layout);
  reportImportWarnings(io, path, loaded);
  const output = values.output ?? '-';
  await io.writeText(output, serialize(loaded.net, 'json'));
  io.err(
    `${path}: read ${describeNet(loaded.net)}` +
      (loaded.laidOut ? ', laid out automatically' : '') +
      (loaded.importWarnings.length > 0
        ? `, ${plural(loaded.importWarnings.length, 'warning')}`
        : '') +
      (output !== '-' ? `; wrote ${output}` : '') +
      '\n',
  );
  return 0;
}
