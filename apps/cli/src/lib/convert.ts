import { serializeNet, type PetriNet } from '@pnm/core';
import { netToSvg, toPnml, toTikz } from '@pnm/io';

/** The formats of `pnm export` that need no browser. */
export type ConvertFormat = 'svg' | 'pnml' | 'tikz' | 'json';

export interface ConvertOptions {
  /** svg */
  dark?: boolean;
  padding?: number;
  /** svg and tikz */
  inscriptions?: boolean;
  /** tikz */
  standalone?: boolean;
  scale?: number;
  labels?: 'names' | 'ids' | 'none';
  tokens?: 'dots' | 'count' | 'none';
  styles?: 'inline' | 'external';
  grayscale?: boolean;
  /** pnml */
  toolspecific?: boolean;
}

/** The text of a net in one of the formats, as `pnm export` writes it. */
export function convertNet(
  net: PetriNet,
  format: ConvertFormat,
  options: ConvertOptions = {},
): string {
  switch (format) {
    case 'svg':
      return netToSvg(net, {
        ...(options.dark === true && { dark: true }),
        ...(options.inscriptions !== undefined && { inscriptions: options.inscriptions }),
        ...(options.padding !== undefined && { padding: options.padding }),
      });
    case 'tikz':
      return toTikz(net, {
        ...(options.standalone === true && { standalone: true }),
        ...(options.scale !== undefined && { scale: options.scale }),
        ...(options.labels !== undefined && { labels: options.labels }),
        ...(options.tokens !== undefined && { tokens: options.tokens }),
        ...(options.styles !== undefined && { styles: options.styles }),
        ...(options.inscriptions !== undefined && { inscriptions: options.inscriptions }),
        ...(options.grayscale !== undefined && { grayscale: options.grayscale }),
      });
    case 'pnml':
      return toPnml(net, {
        ...(options.toolspecific !== undefined && { toolspecific: options.toolspecific }),
      });
    case 'json':
      return serializeNet(net);
  }
}
