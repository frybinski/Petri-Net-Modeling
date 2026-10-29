import type { Id, Marking, PetriNet, Position } from '@pnm/core';

export interface TikzOptions {
  /** A complete document (`standalone` class) instead of a fragment. Default false. */
  standalone?: boolean;
  /** Centimetres per pixel of the editor. Default 0.02 (50 px are 1 cm). */
  scale?: number;
  /** What labels the nodes: their names, their ids or nothing. Default `names`. */
  labels?: 'names' | 'ids' | 'none';
  /** Show guards, arc inscriptions and weights, place types and capacities. Default true. */
  inscriptions?: boolean;
  /** Tokens as dots (up to 5 per place, else their number), as a number, or not at all. */
  tokens?: 'dots' | 'count' | 'none';
  /**
   * `inline` defines the styles `place`, `transition`, `arc` and `token` inside the picture;
   * `external` leaves them to the document (the macros of a thesis, for example). Default inline.
   */
  styles?: 'inline' | 'external';
  /** Black, white and grays only. Default true. Only affects the inline styles. */
  grayscale?: boolean;
  /** Marking to draw; defaults to the initial marking of the net. */
  marking?: Marking;
}

/** Most tokens drawn as dots; a place with more shows the number. */
export const TIKZ_MAX_DOTS = 5;

const PREAMBLE = [
  '\\documentclass[tikz,border=4pt]{standalone}',
  '\\usepackage[T1]{fontenc}',
  '\\usepackage[utf8]{inputenc}',
];

/** The characters of LaTeX text that need a replacement. */
const TEX_ESCAPES: Record<string, string> = {
  '&': '\\&',
  '%': '\\%',
  $: '\\$',
  '#': '\\#',
  _: '\\_',
  '{': '\\{',
  '}': '\\}',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
  '\\': '\\textbackslash{}',
};

/**
 * Escapes text for LaTeX (`& % $ # _ { } ~ ^ \`). Line breaks and other control characters become
 * spaces; umlauts and other letters stay as they are (UTF-8).
 */
export function texEscape(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) out += ' ';
    else out += TEX_ESCAPES[char] ?? char;
  }
  return out;
}

/** Code-like text (guards, inscriptions, type names) in the typewriter font. */
function texCode(text: string): string {
  return `\\texttt{${texEscape(text)}}`;
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function num(value: number): string {
  return String(round(value));
}

/** The editor's arrangement of up to five dots in a place, in pixels. */
function dotOffsets(count: number): Position[] {
  const polygon = (n: number, radius: number): Position[] =>
    Array.from({ length: n }, (_, i) => {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      return { x: round(Math.cos(angle) * radius, 2), y: round(Math.sin(angle) * radius, 2) };
    });
  switch (count) {
    case 1:
      return [{ x: 0, y: 0 }];
    case 2:
      return [
        { x: -6, y: 0 },
        { x: 6, y: 0 },
      ];
    case 3:
      return polygon(3, 7.5);
    case 4:
      return [
        { x: -5.5, y: -5.5 },
        { x: 5.5, y: -5.5 },
        { x: -5.5, y: 5.5 },
        { x: 5.5, y: 5.5 },
      ];
    case 5:
      return polygon(5, 10);
    default:
      return [];
  }
}

function styleLines(grayscale: boolean): string[] {
  const place = grayscale ? 'draw=black, fill=white' : 'draw=blue!60!black, fill=blue!5';
  const transition = grayscale
    ? 'draw=black, fill=black!12'
    : 'draw=orange!70!black, fill=orange!15';
  return [
    '\\tikzset{',
    `  place/.style={circle, ${place}, thick, minimum size=8mm, inner sep=0pt},`,
    `  transition/.style={rectangle, ${transition}, thick, minimum width=4mm, minimum height=8mm, inner sep=0pt},`,
    '  arc/.style={->, >=stealth, thick},',
    '  token/.style={circle, fill=black, inner sep=1.2pt},',
    '}',
  ];
}

/** A TikZ node name: letters, digits, hyphens and underscores only, unique among `used`. */
function nodeName(id: Id, used: Set<string>): string {
  const base = id.replace(/[^A-Za-z0-9_-]/g, '_') || 'n';
  let name = base;
  for (let i = 2; used.has(name); i += 1) name = `${base}_${i}`;
  used.add(name);
  return name;
}

/**
 * Draws a net as TikZ: places as circles, transitions as rectangles, arcs as arrows, tokens as
 * dots or numbers, with labels, guards, inscriptions and weights. The result is a `tikzpicture`
 * (a fragment for `\input` or an `\inputtikz` macro) or, with `standalone`, a complete document.
 *
 * Positions are shifted so that the drawing starts at the origin and the y axis points up, as in
 * TikZ; the output is deterministic.
 */
export function toTikz(net: PetriNet, options: TikzOptions = {}): string {
  const scale = options.scale !== undefined && options.scale > 0 ? options.scale : 0.02;
  const labels = options.labels ?? 'names';
  const showInscriptions = options.inscriptions ?? true;
  const tokenMode = options.tokens ?? 'dots';
  const external = options.styles === 'external';
  const grayscale = options.grayscale ?? true;
  const marking = options.marking ?? net.marking;
  const json = net.profile === 'json-net';

  const nodes = [...net.places, ...net.transitions];
  const xs = nodes.map((n) => n.position.x);
  const ys = nodes.map((n) => n.position.y);
  for (const arc of net.arcs) {
    for (const point of arc.points ?? []) {
      xs.push(point.x);
      ys.push(point.y);
    }
  }
  const minX = xs.length > 0 ? Math.min(...xs) : 0;
  const maxY = ys.length > 0 ? Math.max(...ys) : 0;
  const at = (p: Position): string => `(${num((p.x - minX) * scale)},${num((maxY - p.y) * scale)})`;

  const used = new Set<string>();
  const names = new Map<Id, string>();
  for (const node of nodes) {
    if (!names.has(node.id)) names.set(node.id, nodeName(node.id, used));
  }

  const labelText = (id: Id, name: string): string => {
    if (labels === 'none') return '';
    return labels === 'ids' ? texEscape(id) : texEscape(name);
  };

  const body: string[] = [];

  body.push('% Places');
  for (const place of net.places) {
    const tokens = marking[place.id] ?? [];
    const count = tokens.length;
    const options: string[] = ['place'];
    const text = labelText(place.id, place.name);
    if (text !== '') options.push(`label={below:{${text}}}`);
    if (showInscriptions && place.type !== undefined) {
      options.push(`label={[font=\\scriptsize]above right:{${texCode(place.type)}}}`);
    }
    if (showInscriptions && place.capacity !== undefined) {
      options.push(`label={[font=\\scriptsize]right:{$k{=}${num(place.capacity)}$}}`);
    }
    const asNumber =
      tokenMode === 'count' || (tokenMode === 'dots' && (json || count > TIKZ_MAX_DOTS));
    const inside = asNumber && count > 0 ? String(count) : '';
    if (inside !== '') options.push('font=\\small\\bfseries');
    body.push(
      `\\node[${options.join(', ')}] (${names.get(place.id) ?? ''}) at ${at(place.position)} {${inside}};`,
    );
  }
  if (tokenMode === 'dots') {
    for (const place of net.places) {
      const count = (marking[place.id] ?? []).length;
      if (json || count === 0 || count > TIKZ_MAX_DOTS) continue;
      for (const offset of dotOffsets(count)) {
        const spot = at({ x: place.position.x + offset.x, y: place.position.y - offset.y });
        body.push(`\\node[token] at ${spot} {};`);
      }
    }
  }

  body.push('% Transitions');
  for (const transition of net.transitions) {
    const options: string[] = ['transition'];
    const text = labelText(transition.id, transition.name);
    if (text !== '') options.push(`label={below:{${text}}}`);
    const guard = showInscriptions ? (transition.guard ?? '').trim() : '';
    if (guard !== '') options.push(`label={[font=\\scriptsize]above:{${texCode(`[${guard}]`)}}}`);
    body.push(
      `\\node[${options.join(', ')}] (${names.get(transition.id) ?? ''}) at ${at(transition.position)} {};`,
    );
  }

  if (net.arcs.length > 0) {
    body.push('% Arcs');
    const direction = new Set(net.arcs.map((a) => `${a.source}>${a.target}`));
    for (const arc of net.arcs) {
      const source = names.get(arc.source);
      const target = names.get(arc.target);
      if (source === undefined || target === undefined) continue;
      const inscription = showInscriptions ? (arc.inscription ?? '').trim() : '';
      let label = '';
      if (inscription !== '') label = texCode(inscription);
      else if (showInscriptions && arc.weight !== 1) label = num(arc.weight);
      const tag =
        label === ''
          ? ''
          : ` node[midway, above, fill=white, inner sep=1pt, font=\\scriptsize] {${label}}`;
      const points = arc.points ?? [];
      if (points.length > 0) {
        const via = points.map((p) => ` -- ${at(p)}`).join('');
        // The label goes on the last segment, where the arrowhead is.
        body.push(`\\draw[arc] (${source})${via} --${tag} (${target});`);
      } else if (direction.has(`${arc.target}>${arc.source}`)) {
        body.push(`\\draw[arc] (${source}) to[bend left=20]${tag} (${target});`);
      } else {
        body.push(`\\draw[arc] (${source}) --${tag} (${target});`);
      }
    }
  }

  const lines: string[] = [];
  if (options.standalone) {
    lines.push(...PREAMBLE, '\\begin{document}');
  }
  lines.push(`% Petri net "${net.name.replace(/[\r\n]+/g, ' ')}", generated by pnm`);
  lines.push('\\begin{tikzpicture}');
  if (!external) lines.push(...styleLines(grayscale).map((line) => `  ${line}`));
  lines.push(...body.map((line) => `  ${line}`));
  lines.push('\\end{tikzpicture}');
  if (options.standalone) lines.push('\\end{document}');
  return `${lines.join('\n')}\n`;
}
