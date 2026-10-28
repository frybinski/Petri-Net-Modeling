import { tokenLabel, type Id, type Marking, type PetriNet, type Position } from '@pnm/core';
import { truncate } from './inscriptions';
import {
  PARALLEL_ARC_BEND,
  PLACE_SHAPE,
  TRANSITION_SHAPE,
  arcGeometry,
  arrowHeadPoints,
  MAX_TOKEN_DOTS,
  shapeSize,
  tokenDotOffsets,
  type Endpoint,
} from './geometry';

export interface SvgExportOptions {
  /** Marking to draw; defaults to the initial marking of the net. */
  marking?: Marking;
  /** Padding around the drawing in pixels. */
  padding?: number;
  /** Draw on a dark background. */
  dark?: boolean;
  /** Draw guards, arc inscriptions and place types of JSON nets (default true). */
  inscriptions?: boolean;
}

interface Palette {
  background: string;
  stroke: string;
  fill: string;
  text: string;
  muted: string;
  noteFill: string;
  noteStroke: string;
  noteText: string;
}

const LIGHT: Palette = {
  background: '#ffffff',
  stroke: '#3f3f46',
  fill: '#ffffff',
  text: '#18181b',
  muted: '#52525b',
  noteFill: '#fef9c3',
  noteStroke: '#eab308',
  noteText: '#422006',
};

const DARK: Palette = {
  background: '#111114',
  stroke: '#d4d4d8',
  fill: '#1c1c20',
  text: '#f4f4f5',
  muted: '#a1a1aa',
  noteFill: '#3b3512',
  noteStroke: '#a16207',
  noteText: '#fef9c3',
};

export const NOTE_WIDTH = 180;
export const NOTE_LINE_HEIGHT = 16;
const NOTE_PADDING = 8;

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Splits note text into lines that roughly fit the note width. */
export function wrapNoteText(text: string, maxChars = 24): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line === '') line = word;
      else if (`${line} ${word}`.length <= maxChars) line = `${line} ${word}`;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

export function noteHeight(text: string): number {
  return wrapNoteText(text).length * NOTE_LINE_HEIGHT + NOTE_PADDING * 2;
}

/** Renders a net as a standalone SVG document, drawn from the model rather than the DOM. */
export function netToSvg(net: PetriNet, options: SvgExportOptions = {}): string {
  const palette = options.dark ? DARK : LIGHT;
  const padding = options.padding ?? 40;
  const marking = options.marking ?? net.marking;
  const json = net.profile === 'json-net';
  const showInscriptions = json && (options.inscriptions ?? true);

  const endpoints = new Map<Id, Endpoint>();
  for (const p of net.places) endpoints.set(p.id, { center: p.position, shape: PLACE_SHAPE });
  for (const t of net.transitions) {
    endpoints.set(t.id, { center: t.position, shape: TRANSITION_SHAPE });
  }

  // Bounds of everything that is drawn.
  const xs: number[] = [];
  const ys: number[] = [];
  const extend = (x: number, y: number): void => {
    xs.push(x);
    ys.push(y);
  };
  for (const { center, shape } of endpoints.values()) {
    const { width, height } = shapeSize(shape);
    extend(center.x - width / 2, center.y - height / 2);
    extend(center.x + width / 2, center.y + height / 2 + 24 + (json ? 28 : 0)); // room for the labels below
    if (json) extend(center.x - 80, center.y - height / 2 - 16); // room for guards above
  }
  for (const a of net.annotations ?? []) {
    extend(a.position.x, a.position.y);
    extend(a.position.x + NOTE_WIDTH, a.position.y + noteHeight(a.text));
  }
  for (const a of net.arcs) for (const p of a.points ?? []) extend(p.x, p.y);
  if (xs.length === 0) {
    extend(0, 0);
    extend(200, 120);
  }
  const minX = Math.min(...xs) - padding;
  const minY = Math.min(...ys) - padding;
  const width = Math.max(...xs) + padding - minX;
  const height = Math.max(...ys) + padding - minY;

  const direction = new Set(net.arcs.map((a) => `${a.source}>${a.target}`));
  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" width="${width}" height="${height}" font-family="Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="13">`,
  );
  out.push(`<title>${escapeXml(net.name)}</title>`);
  out.push(
    `<rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${palette.background}"/>`,
  );

  // Annotations first, so that the net is drawn on top.
  for (const note of net.annotations ?? []) {
    const lines = wrapNoteText(note.text);
    out.push(
      `<g><rect x="${note.position.x}" y="${note.position.y}" width="${NOTE_WIDTH}" height="${noteHeight(note.text)}" rx="6" fill="${palette.noteFill}" stroke="${palette.noteStroke}"/>`,
    );
    lines.forEach((line, i) => {
      out.push(
        `<text x="${note.position.x + NOTE_PADDING}" y="${note.position.y + NOTE_PADDING + 12 + i * NOTE_LINE_HEIGHT}" fill="${palette.noteText}">${escapeXml(line)}</text>`,
      );
    });
    out.push('</g>');
  }

  // Arcs.
  for (const arc of net.arcs) {
    const source = endpoints.get(arc.source);
    const target = endpoints.get(arc.target);
    if (!source || !target) continue;
    const hasReverse = direction.has(`${arc.target}>${arc.source}`);
    const geometry = arcGeometry({
      source,
      target,
      points: arc.points,
      bend: hasReverse ? PARALLEL_ARC_BEND : 0,
    });
    out.push(
      `<g><path d="${geometry.path}" fill="none" stroke="${palette.stroke}" stroke-width="1.6"/>`,
    );
    out.push(
      `<polygon points="${arrowHeadPoints(geometry.tip, geometry.angle)}" fill="${palette.stroke}"/>`,
    );
    const inscription = showInscriptions ? (arc.inscription ?? '').trim() : '';
    if (inscription !== '') {
      out.push(
        `<text x="${geometry.label.x}" y="${geometry.label.y - 6}" text-anchor="middle" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="11" fill="${palette.text}" stroke="${palette.background}" stroke-width="4" paint-order="stroke">${escapeXml(truncate(inscription, 24))}</text>`,
      );
    } else if (arc.weight !== 1) {
      out.push(
        `<text x="${geometry.label.x}" y="${geometry.label.y - 6}" text-anchor="middle" fill="${palette.text}" stroke="${palette.background}" stroke-width="4" paint-order="stroke" font-weight="600">${arc.weight}</text>`,
      );
    }
    out.push('</g>');
  }

  // Places.
  for (const place of net.places) {
    const { x, y } = place.position;
    const count = marking[place.id]?.length ?? 0;
    out.push(
      `<g><circle cx="${x}" cy="${y}" r="${PLACE_SHAPE.kind === 'circle' ? PLACE_SHAPE.radius : 20}" fill="${palette.fill}" stroke="${palette.stroke}" stroke-width="2"/>`,
    );
    if (json) {
      if (count > 0) {
        out.push(
          `<text x="${x}" y="${y + 5}" text-anchor="middle" font-weight="600" fill="${palette.text}">${count}</text>`,
        );
      }
    } else if (count > 0 && count <= MAX_TOKEN_DOTS) {
      for (const o of tokenDotOffsets(count)) {
        out.push(`<circle cx="${x + o.x}" cy="${y + o.y}" r="3.4" fill="${palette.text}"/>`);
      }
    } else if (count > MAX_TOKEN_DOTS) {
      out.push(
        `<text x="${x}" y="${y + 5}" text-anchor="middle" font-weight="600" fill="${palette.text}">${count}</text>`,
      );
    }
    if (place.capacity !== undefined) {
      out.push(
        `<text x="${x + 18}" y="${y - 18}" font-size="10" fill="${palette.muted}">k=${place.capacity}</text>`,
      );
    }
    out.push(labelSvg(place.name, place.position, 36, palette));
    let line = 36;
    if (showInscriptions && place.type !== undefined) {
      line += 13;
      out.push(
        `<text x="${x}" y="${y + line}" text-anchor="middle" font-size="10" font-style="italic" fill="${palette.muted}">${escapeXml(place.type)}</text>`,
      );
    }
    if (json && count > 0 && count <= 3) {
      line += 13;
      const labels = (marking[place.id] ?? []).map((t) => tokenLabel(t, 18)).join('  ');
      out.push(
        `<text x="${x}" y="${y + line}" text-anchor="middle" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="10" fill="${palette.muted}">${escapeXml(labels)}</text>`,
      );
    }
    out.push('</g>');
  }

  // Transitions.
  for (const t of net.transitions) {
    const { x, y } = t.position;
    out.push(
      `<g><rect x="${x - 20}" y="${y - 30}" width="40" height="60" rx="3" fill="${palette.fill}" stroke="${palette.stroke}" stroke-width="2"/>`,
    );
    out.push(labelSvg(t.name, t.position, 46, palette));
    const guard = showInscriptions ? (t.guard ?? '').trim() : '';
    if (guard !== '') {
      out.push(
        `<text x="${x}" y="${y - 36}" text-anchor="middle" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="10" fill="${palette.muted}">[ ${escapeXml(truncate(guard, 34))} ]</text>`,
      );
    }
    out.push('</g>');
  }

  out.push('</svg>');
  return `${out.join('\n')}\n`;
}

function labelSvg(name: string, center: Position, offset: number, palette: Palette): string {
  if (name === '') return '';
  return `<text x="${center.x}" y="${center.y + offset}" text-anchor="middle" fill="${palette.text}">${escapeXml(name)}</text>`;
}
