import { parseNetText, type Diagnostic, type PetriNet } from '@pnm/core';
import { fromPnml } from '@pnm/io';

export type NetFormat = 'json' | 'pnml';

export interface LoadedNet {
  net: PetriNet;
  format: NetFormat;
  /** What the PNML reader reports, without the findings of the check. Empty for JSON files. */
  importWarnings: string[];
  /** The findings of the check that the PNML reader made. Empty for JSON files. */
  importDiagnostics: Diagnostic[];
  /** The positions come from the automatic layout of the import. */
  laidOut: boolean;
}

/** Tells a PNML file from a net file: by its first character, else by its name. */
export function detectFormat(text: string, path = ''): NetFormat {
  const first = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).trimStart().charAt(0);
  if (first === '<') return 'pnml';
  if (first === '{') return 'json';
  return /\.(pnml|xml)$/i.test(path) ? 'pnml' : 'json';
}

/**
 * Reads the text of a `.pn.json` file or of PNML. Throws `NetFormatError` or `PnmlError` for
 * text that is no net; the caller says where the text came from.
 */
export async function parseNetInput(
  text: string,
  options: { path?: string; layout?: 'keep' | 'auto' } = {},
): Promise<LoadedNet> {
  const format = detectFormat(text, options.path ?? '');
  if (format === 'json') {
    return {
      net: parseNetText(text),
      format,
      importWarnings: [],
      importDiagnostics: [],
      laidOut: false,
    };
  }
  const imported = await fromPnml(text, { layout: options.layout ?? 'keep' });
  return {
    net: imported.net,
    format,
    importWarnings: imported.importWarnings,
    importDiagnostics: imported.diagnostics,
    laidOut: imported.laidOut,
  };
}
