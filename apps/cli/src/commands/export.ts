import { serializeNet } from '@pnm/core';
import { netToSvg, toPnml, toTikz } from '@pnm/io';
import { choiceOption, numberOption, parseCommandArgs, requireOne } from '../args';
import { CommandError, UsageError } from '../errors';
import type { Io } from '../io';
import { loadNet, reportImportWarnings } from '../net-file';

export const EXPORT_HELP = `Usage: pnm export <net> --format svg|png|pnml|tikz|json [-o <file>] [options]

Writes a net in another format. Without -o the text goes to standard output; the format can also
come from the extension of -o (.svg .pnml .tex .json .png).

  --format <f>        svg, png, pnml, tikz or json
  -o, --output <file> where to write; - is standard output

svg:
  --dark              draw on a dark background
  --no-inscriptions   leave out guards, inscriptions, types
  --padding <n>       margin around the drawing in pixels, default 40
tikz:
  --standalone        a complete document (class standalone) instead of a tikzpicture
  --scale <n>         centimetres per editor pixel, default 0.02
  --labels <l>        names (default), ids or none
  --no-inscriptions   leave out guards, inscriptions, weights, types
  --tokens <t>        dots (default), count or none
  --styles <s>        inline (default) defines place, transition, arc and token;
                      external leaves them to the document
  --no-grayscale      colored inline styles instead of black and white
pnml:
  --no-toolspecific   leave out the extensions of this tool (types, guards, timing, ...)
json:
  the .pn.json file of the net (a PNML input is converted)

png is only available in the web app (File > Export > Image): rasterising needs a browser.
Convert the SVG with another tool if you need PNG on the command line.
`;

type Format = 'svg' | 'png' | 'pnml' | 'tikz' | 'json';
const FORMATS: readonly Format[] = ['svg', 'png', 'pnml', 'tikz', 'json'];

function formatFromName(path: string): Format | undefined {
  const lower = path.toLowerCase();
  if (lower.endsWith('.svg')) return 'svg';
  if (lower.endsWith('.png')) return 'png';
  if (lower.endsWith('.pnml')) return 'pnml';
  if (lower.endsWith('.tex')) return 'tikz';
  if (lower.endsWith('.json')) return 'json';
  return undefined;
}

export async function exportCommand(io: Io, args: readonly string[]): Promise<number> {
  const { values, positionals } = parseCommandArgs(args, {
    format: { type: 'string', short: 'f' },
    output: { type: 'string', short: 'o' },
    dark: { type: 'boolean' },
    inscriptions: { type: 'boolean' },
    padding: { type: 'string' },
    standalone: { type: 'boolean' },
    scale: { type: 'string' },
    labels: { type: 'string' },
    tokens: { type: 'string' },
    styles: { type: 'string' },
    grayscale: { type: 'boolean' },
    toolspecific: { type: 'boolean' },
  });
  const path = requireOne(positionals, 'net file');
  const format =
    choiceOption(values.format, 'format', FORMATS) ??
    (values.output !== undefined ? formatFromName(values.output) : undefined);
  if (format === undefined) {
    throw new UsageError(
      `Give the format with --format (${FORMATS.join(', ')}) or an output file with a known extension.`,
    );
  }

  const applies: Record<string, readonly Format[]> = {
    dark: ['svg'],
    padding: ['svg'],
    standalone: ['tikz'],
    scale: ['tikz'],
    labels: ['tikz'],
    tokens: ['tikz'],
    styles: ['tikz'],
    grayscale: ['tikz'],
    inscriptions: ['svg', 'tikz'],
    toolspecific: ['pnml'],
  };
  for (const [option, formats] of Object.entries(applies)) {
    if ((values as Record<string, unknown>)[option] !== undefined && !formats.includes(format)) {
      throw new UsageError(
        `--${option} applies to ${formats.join(' and ')} only, not to ${format}.`,
      );
    }
  }

  const padding = numberOption(values.padding, 'padding', (n) => n >= 0, 'a number of at least 0');
  const scale = numberOption(values.scale, 'scale', (n) => n > 0, 'a number above 0');
  const labels = choiceOption(values.labels, 'labels', ['names', 'ids', 'none'] as const);
  const tokens = choiceOption(values.tokens, 'tokens', ['dots', 'count', 'none'] as const);
  const styles = choiceOption(values.styles, 'styles', ['inline', 'external'] as const);

  if (format === 'png') {
    throw new CommandError(
      'PNG export needs a browser and is not available on the command line. Use File > Export > ' +
        'Image in the web app, or convert the SVG (pnm export --format svg) with a tool such as ' +
        'rsvg-convert or Inkscape.',
    );
  }

  const loaded = await loadNet(io, path);
  const { net } = loaded;
  reportImportWarnings(io, path, loaded);

  let text: string;
  switch (format) {
    case 'svg':
      text = netToSvg(net, {
        ...(values.dark === true && { dark: true }),
        ...(values.inscriptions !== undefined && { inscriptions: values.inscriptions }),
        ...(padding !== undefined && { padding }),
      });
      break;
    case 'tikz':
      text = toTikz(net, {
        ...(values.standalone === true && { standalone: true }),
        ...(scale !== undefined && { scale }),
        ...(labels !== undefined && { labels }),
        ...(tokens !== undefined && { tokens }),
        ...(styles !== undefined && { styles }),
        ...(values.inscriptions !== undefined && { inscriptions: values.inscriptions }),
        ...(values.grayscale !== undefined && { grayscale: values.grayscale }),
      });
      break;
    case 'pnml':
      text = toPnml(net, {
        ...(values.toolspecific !== undefined && { toolspecific: values.toolspecific }),
      });
      break;
    case 'json':
      text = serializeNet(net);
      break;
  }

  const output = values.output ?? '-';
  await io.writeText(output, text);
  if (output !== '-') io.err(`Wrote ${output}\n`);
  return 0;
}
