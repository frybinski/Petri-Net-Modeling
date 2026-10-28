import { tokenLabel, type Id, type Marking, type PetriNet, type Position } from '@pnm/core';
import { truncate } from './inscriptions';
import {
  MAX_TOKEN_DOTS,
  NODE_STROKE,
  PLACE_SHAPE,
  PLACE_SIZE,
  TOKEN_DOT_RADIUS,
  TRANSITION_HEIGHT,
  TRANSITION_SHAPE,
  TRANSITION_WIDTH,
  arcGeometry,
  arrowHeadPoints,
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
  /** Background and outline of label pills. */
  pill: string;
  pillStroke: string;
  /** Background of the type badge. */
  badge: string;
  noteFill: string;
  noteStroke: string;
  noteText: string;
}

const LIGHT: Palette = {
  background: '#fafafa',
  stroke: '#3f3f46',
  fill: '#ffffff',
  text: '#18181b',
  muted: '#62626c',
  pill: '#fafafa',
  pillStroke: '#c4c4cc',
  badge: '#f4f4f5',
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
  pill: '#111114',
  pillStroke: '#44444c',
  badge: '#202024',
  noteFill: '#3b3512',
  noteStroke: '#a16207',
  noteText: '#fef9c3',
};

const MONO =
  "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace";
const SANS = "'Inter Variable', Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

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

/** Estimated width of a label: monospace text is exact, proportional text is approximated. */
function textWidth(text: string, fontSize: number, mono: boolean, weight = 1): number {
  return text.length * fontSize * (mono ? 0.6 : 0.56 * weight);
}

interface PillOptions {
  mono?: boolean;
  fontSize?: number;
  bold?: boolean;
  upper?: boolean;
  fill: string;
  stroke: string;
  color: string;
  height?: number;
}

function pillWidth(
  text: string,
  { mono = false, fontSize = 11, bold = false, upper = false }: Partial<PillOptions>,
): number {
  const shown = upper ? text.toUpperCase() : text;
  const padding = upper ? 6 : 7;
  return Math.round(
    textWidth(shown, fontSize, mono, bold ? 1.12 : 1) +
      (upper ? shown.length * 0.5 : 0) +
      2 * padding,
  );
}

/** A rounded label centered on (cx, cy). Returns its SVG and its width. */
function pillSvg(
  cx: number,
  cy: number,
  text: string,
  options: PillOptions,
): { svg: string; width: number } {
  const { mono = false, fontSize = 11, bold = false, upper = false, fill, stroke, color } = options;
  const height = options.height ?? 18;
  const shown = upper ? text.toUpperCase() : text;
  const width = pillWidth(text, options);
  const family = mono ? MONO : SANS;
  const weight = bold ? ' font-weight="600"' : '';
  const spacing = upper ? ' letter-spacing="0.5"' : '';
  const svg =
    `<rect x="${round2(cx - width / 2)}" y="${round2(cy - height / 2)}" width="${width}" height="${height}" rx="${height / 2}" fill="${fill}" stroke="${stroke}"/>` +
    `<text x="${round2(cx)}" y="${round2(cy + fontSize * 0.36)}" text-anchor="middle" font-family="${family}" font-size="${fontSize}"${weight}${spacing} fill="${color}">${escapeXml(shown)}</text>`;
  return { svg, width };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
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

  const xs: number[] = [];
  const ys: number[] = [];
  const extend = (x: number, y: number): void => {
    xs.push(x);
    ys.push(y);
  };
  const body: string[] = [];

  const direction = new Set(net.arcs.map((a) => `${a.source}>${a.target}`));

  // Arcs, drawn first so that the nodes sit on top of their ends.
  const arcPills: string[] = [];
  for (const arc of net.arcs) {
    const source = endpoints.get(arc.source);
    const target = endpoints.get(arc.target);
    if (!source || !target) continue;
    const geometry = arcGeometry({
      source,
      target,
      points: arc.points,
      parallel: direction.has(`${arc.target}>${arc.source}`),
      obstacles: [...endpoints.entries()]
        .filter(([id]) => id !== arc.source && id !== arc.target)
        .map(([, endpoint]) => endpoint),
    });
    body.push(
      `<g><path d="${geometry.path}" fill="none" stroke="${palette.stroke}" stroke-width="1.6" stroke-linecap="round"/>` +
        `<polygon points="${arrowHeadPoints(geometry.tip, geometry.angle)}" fill="${palette.stroke}" stroke="${palette.stroke}" stroke-width="0.6" stroke-linejoin="round"/></g>`,
    );
    extend(geometry.start.x, geometry.start.y);
    extend(geometry.tip.x, geometry.tip.y);
    const inscription = showInscriptions ? (arc.inscription ?? '').trim() : '';
    const pillColors = { fill: palette.pill, stroke: palette.pillStroke, color: palette.text };
    if (inscription !== '') {
      const pill = pillSvg(geometry.label.x, geometry.label.y, truncate(inscription, 24), {
        mono: true,
        ...pillColors,
      });
      arcPills.push(pill.svg);
      extend(geometry.label.x - pill.width / 2, geometry.label.y - 9);
      extend(geometry.label.x + pill.width / 2, geometry.label.y + 9);
    } else if (arc.weight !== 1) {
      const pill = pillSvg(geometry.label.x, geometry.label.y, String(arc.weight), {
        fontSize: 12,
        bold: true,
        ...pillColors,
      });
      arcPills.push(pill.svg);
      extend(geometry.label.x - pill.width / 2, geometry.label.y - 9);
      extend(geometry.label.x + pill.width / 2, geometry.label.y + 9);
    }
  }

  // Places.
  const placeRadius = PLACE_SHAPE.kind === 'circle' ? PLACE_SHAPE.radius : PLACE_SIZE / 2;
  for (const place of net.places) {
    const { x, y } = place.position;
    const tokens = marking[place.id] ?? [];
    const count = tokens.length;
    const parts: string[] = [
      `<circle cx="${x}" cy="${y}" r="${placeRadius - NODE_STROKE / 2}" fill="${palette.fill}" stroke="${palette.stroke}" stroke-width="${NODE_STROKE}"/>`,
    ];
    if (!json && count > 0 && count <= MAX_TOKEN_DOTS) {
      for (const o of tokenDotOffsets(count)) {
        parts.push(
          `<circle cx="${round2(x + o.x)}" cy="${round2(y + o.y)}" r="${TOKEN_DOT_RADIUS}" fill="${palette.text}"/>`,
        );
      }
    } else if (count > 0 && (json || count > MAX_TOKEN_DOTS)) {
      parts.push(
        `<text x="${x}" y="${round2(y + 14 * 0.36)}" text-anchor="middle" font-family="${SANS}" font-size="14" font-weight="600" fill="${palette.text}">${count}</text>`,
      );
    }
    extend(x - placeRadius, y - placeRadius);
    extend(x + placeRadius, y + placeRadius);
    if (showInscriptions && place.type !== undefined) {
      const badge = {
        fontSize: 10,
        bold: true,
        upper: true,
        height: 16,
        fill: palette.badge,
        stroke: palette.pillStroke,
        color: palette.muted,
      };
      // The badge sits on the upper right of the outline, like on the canvas.
      const centerX = x - placeRadius + PLACE_SIZE * 0.62 + pillWidth(place.type, badge) / 2;
      const centerY = y - placeRadius - 1;
      parts.push(pillSvg(centerX, centerY, place.type, badge).svg);
      extend(centerX + pillWidth(place.type, badge) / 2, centerY - 8);
    }
    if (place.capacity !== undefined) {
      parts.push(
        `<text x="${round2(x - placeRadius + PLACE_SIZE * 0.88)}" y="${round2(y - placeRadius + PLACE_SIZE * 0.86 + 9)}" font-family="${MONO}" font-size="10" fill="${palette.muted}">k=${place.capacity}</text>`,
      );
      extend(x + placeRadius + 20, y);
    }
    let line = placeRadius + 6 + 12;
    parts.push(labelSvg(place.name, place.position, line, palette));
    extend(x - textWidth(place.name, 13, false, 1.05) / 2, y + placeRadius + 6);
    extend(x + textWidth(place.name, 13, false, 1.05) / 2, y + placeRadius + 22);
    if (json && count > 0 && count <= 3) {
      line += 15;
      const labels = tokens.map((t) => tokenLabel(t, 18)).join('  ');
      parts.push(
        `<text x="${x}" y="${y + line}" text-anchor="middle" font-family="${MONO}" font-size="10" fill="${palette.muted}">${escapeXml(labels)}</text>`,
      );
      extend(x - textWidth(labels, 10, true) / 2, y + line + 4);
      extend(x + textWidth(labels, 10, true) / 2, y + line + 4);
    }
    body.push(`<g>${parts.join('')}</g>`);
  }

  // Transitions.
  for (const t of net.transitions) {
    const { x, y } = t.position;
    const parts: string[] = [
      `<rect x="${x - TRANSITION_WIDTH / 2 + NODE_STROKE / 2}" y="${y - TRANSITION_HEIGHT / 2 + NODE_STROKE / 2}" width="${TRANSITION_WIDTH - NODE_STROKE}" height="${TRANSITION_HEIGHT - NODE_STROKE}" rx="3" fill="${palette.fill}" stroke="${palette.stroke}" stroke-width="${NODE_STROKE}"/>`,
    ];
    extend(x - TRANSITION_WIDTH / 2, y - TRANSITION_HEIGHT / 2);
    extend(x + TRANSITION_WIDTH / 2, y + TRANSITION_HEIGHT / 2);
    parts.push(labelSvg(t.name, t.position, TRANSITION_HEIGHT / 2 + 6 + 12, palette));
    extend(x - textWidth(t.name, 13, false, 1.05) / 2, y + TRANSITION_HEIGHT / 2 + 6);
    extend(x + textWidth(t.name, 13, false, 1.05) / 2, y + TRANSITION_HEIGHT / 2 + 22);
    const guard = showInscriptions ? (t.guard ?? '').trim() : '';
    if (guard !== '') {
      const pill = pillSvg(x, y - TRANSITION_HEIGHT / 2 - 8 - 9, `[ ${truncate(guard, 28)} ]`, {
        mono: true,
        fill: palette.pill,
        stroke: palette.pillStroke,
        color: palette.muted,
      });
      parts.push(pill.svg);
      extend(x - pill.width / 2, y - TRANSITION_HEIGHT / 2 - 8 - 18);
      extend(x + pill.width / 2, y);
    }
    body.push(`<g>${parts.join('')}</g>`);
  }

  // Annotations.
  const notes: string[] = [];
  for (const note of net.annotations ?? []) {
    const lines = wrapNoteText(note.text);
    notes.push(
      `<g><rect x="${note.position.x}" y="${note.position.y}" width="${NOTE_WIDTH}" height="${noteHeight(note.text)}" rx="6" fill="${palette.noteFill}" stroke="${palette.noteStroke}"/>`,
    );
    lines.forEach((line, i) => {
      notes.push(
        `<text x="${note.position.x + NOTE_PADDING}" y="${note.position.y + NOTE_PADDING + 12 + i * NOTE_LINE_HEIGHT}" fill="${palette.noteText}">${escapeXml(line)}</text>`,
      );
    });
    notes.push('</g>');
    extend(note.position.x, note.position.y);
    extend(note.position.x + NOTE_WIDTH, note.position.y + noteHeight(note.text));
  }
  for (const a of net.arcs) for (const p of a.points ?? []) extend(p.x, p.y);
  if (xs.length === 0) {
    extend(0, 0);
    extend(200, 120);
  }

  const minX = Math.floor(Math.min(...xs) - padding);
  const minY = Math.floor(Math.min(...ys) - padding);
  const width = Math.ceil(Math.max(...xs) + padding - minX);
  const height = Math.ceil(Math.max(...ys) + padding - minY);

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" width="${width}" height="${height}" font-family="${SANS}" font-size="13">`,
  );
  out.push(`<title>${escapeXml(net.name)}</title>`);
  out.push(
    `<rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${palette.background}"/>`,
  );
  // Annotations first, so that the net is drawn on top; the label pills of the arcs last.
  out.push(...notes);
  out.push(...body);
  out.push(...arcPills);
  out.push('</svg>');
  return `${out.join('\n')}\n`;
}

function labelSvg(name: string, center: Position, offset: number, palette: Palette): string {
  if (name === '') return '';
  return `<text x="${center.x}" y="${center.y + offset}" text-anchor="middle" font-weight="500" fill="${palette.text}">${escapeXml(name)}</text>`;
}
