import type { Id, Marking, PetriNet } from '@pnm/core';
import {
  distance,
  distanceToPath,
  pointAlong,
  pointInRect,
  pathLength,
  TOKEN_SPACING,
} from './geometry';
import type { Tone } from './palette';
import { arcKey, type Decor, type DomainView, type Point, type Rect, type Sprite } from './schema';

/** The layers of a scene, from back to front. */
export const LAYERS = [
  'decor',
  'arcs',
  'places',
  'transitions',
  'tokens',
  'labels',
  'highlight',
] as const;
export type Layer = (typeof LAYERS)[number];

export type Glyph =
  | 'gear'
  | 'barrier'
  | 'door'
  | 'dock'
  | 'arrow-in'
  | 'arrow-out'
  | 'truck'
  | 'exit'
  | 'ring'
  | 'diamond'
  | 'cross';

export type CellStyle = 'slot' | 'machine' | 'desk' | 'table';
export type CellState = 'free' | 'busy' | 'off';

interface Base {
  layer: Layer;
  /** The place, transition or arc of the net the command belongs to. */
  elementId?: Id;
}

export type DrawCommand = Base &
  (
    | {
        op: 'rect';
        x: number;
        y: number;
        w: number;
        h: number;
        radius?: number;
        fill?: Tone;
        stroke?: Tone;
        lineWidth?: number;
        dash?: [number, number];
        alpha?: number;
        shadow?: boolean;
      }
    | {
        op: 'path';
        points: Point[];
        stroke: Tone;
        lineWidth: number;
        dash?: [number, number];
        alpha?: number;
        arrow?: boolean;
        cap?: 'butt' | 'round' | 'square';
      }
    | { op: 'segments'; segs: Rect[]; stroke: Tone; lineWidth: number }
    | {
        op: 'circle';
        x: number;
        y: number;
        r: number;
        fill?: Tone;
        stroke?: Tone;
        lineWidth?: number;
        dash?: [number, number];
        alpha?: number;
        shadow?: boolean;
      }
    | {
        op: 'text';
        x: number;
        y: number;
        text: string;
        size: number;
        weight: number;
        tone: Tone;
        align: 'left' | 'center' | 'right';
        baseline: 'top' | 'middle' | 'bottom' | 'alphabetic';
        mono?: boolean;
        /** Extra space between letters, in pixels. */
        spacing?: number;
        halo?: boolean;
        alpha?: number;
      }
    | { op: 'belt'; points: Point[]; width: number }
    | { op: 'lane'; points: Point[]; width: number }
    | { op: 'buffer'; points: Point[]; width: number }
    | {
        op: 'cell';
        style: CellStyle;
        x: number;
        y: number;
        w: number;
        h: number;
        state: CellState;
      }
    | { op: 'glyph'; glyph: Glyph; x: number; y: number; size: number; tone: Tone; alpha?: number }
    | { op: 'sprite'; sprite: Sprite; x: number; y: number; size: number; angle?: number }
    | { op: 'badge'; x: number; y: number; text: string; accent?: boolean }
    | { op: 'progress'; x: number; y: number; w: number; h: number; value: number; tone?: Tone }
    /** A circle that fills clockwise from the top: the progress of a firing on its slot. */
    | {
        op: 'ring';
        x: number;
        y: number;
        r: number;
        /** 0 to 1. */
        value: number;
        tone: Tone;
        lineWidth?: number;
      }
  );

export type Shape =
  | { type: 'rect'; rect: Rect }
  | { type: 'path'; points: Point[]; width: number }
  | { type: 'circle'; x: number; y: number; r: number };

export type ElementKind = 'place' | 'transition' | 'arc';

/** A region of the picture that stands for an element of the net, for hover and clicks. */
export interface HitArea {
  elementId: Id;
  kind: ElementKind;
  shape: Shape;
  /** The area with the highest priority under the pointer wins. */
  priority: number;
}

export interface Scene {
  width: number;
  height: number;
  sprite: Sprite;
  layers: Record<Layer, DrawCommand[]>;
  hits: HitArea[];
}

export interface RunningSlot {
  transitionId: Id;
  /** Index of the slot the firing occupies. */
  slot: number;
}

export interface SceneOptions {
  /** Firings under way (simulation). */
  running?: readonly RunningSlot[];
  hover?: Id | null;
  selection?: readonly Id[];
}

const BELT_WIDTH = 24;
const BUFFER_WIDTH = 30;
const LANE_WIDTH = 18;

/** The size of a case on the canvas, 14 to 18 px depending on how much room the picture needs. */
export function spriteSize(sprite: Sprite): number {
  switch (sprite) {
    case 'person':
    case 'vehicle':
      return 18;
    case 'dot':
      return 14;
    case 'parcel':
    case 'document':
      return 16;
  }
}
const PRIORITY = { arc: 0, area: 1, path: 2, card: 2, box: 2, point: 3, cell: 4 };

// --- Text -------------------------------------------------------------------------------------

/** A rough width of a text in Inter, enough to wrap labels (the painter measures nothing). */
export function estimateTextWidth(text: string, size: number, weight = 500): number {
  const factor = weight >= 600 ? 0.6 : 0.56;
  return text.length * size * factor;
}

/** Wraps a text into at most two lines of about `maxWidth` pixels; the last line gets an ellipsis. */
export function wrapLabel(text: string, size: number, maxWidth: number, weight = 500): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current === '' ? word : `${current} ${word}`;
    if (estimateTextWidth(next, size, weight) > maxWidth && current !== '') {
      lines.push(current);
      current = word;
    } else current = next;
  }
  if (current !== '') lines.push(current);
  if (lines.length > 2) {
    const rest = lines.slice(1).join(' ');
    const room = Math.max(3, Math.floor(maxWidth / (size * 0.56)) - 1);
    return [lines[0]!, rest.length > room ? `${rest.slice(0, room - 1)}…` : rest];
  }
  return lines;
}

// --- Scene builder ----------------------------------------------------------------------------

class Builder {
  readonly layers: Record<Layer, DrawCommand[]> = {
    decor: [],
    arcs: [],
    places: [],
    transitions: [],
    tokens: [],
    labels: [],
    highlight: [],
  };
  readonly hits: HitArea[] = [];

  push(command: DrawCommand): void {
    this.layers[command.layer].push(command);
  }

  hit(elementId: Id, kind: ElementKind, shape: Shape, priority: number): void {
    this.hits.push({ elementId, kind, shape, priority });
  }
}

function upper(text: string): string {
  return text.toLocaleUpperCase();
}

function textLines(
  b: Builder,
  layer: Layer,
  elementId: Id | undefined,
  lines: string[],
  x: number,
  y: number,
  options: {
    size: number;
    weight: number;
    tone: Tone;
    align: 'left' | 'center' | 'right';
    /** `above` stacks upward from y, `below` downward, `top` is the same as below. */
    anchor: 'above' | 'below';
    spacing?: number;
    halo?: boolean;
    mono?: boolean;
  },
): void {
  const lineHeight = Math.round(options.size * 1.25);
  const ordered = options.anchor === 'above' ? [...lines].reverse() : lines;
  ordered.forEach((line, index) => {
    const offset = index * lineHeight * (options.anchor === 'above' ? -1 : 1);
    b.push({
      layer,
      ...(elementId !== undefined && { elementId }),
      op: 'text',
      x,
      y: y + offset,
      text: line,
      size: options.size,
      weight: options.weight,
      tone: options.tone,
      align: options.align,
      baseline: options.anchor === 'above' ? 'bottom' : 'top',
      ...(options.spacing !== undefined && { spacing: options.spacing }),
      ...(options.halo && { halo: true }),
      ...(options.mono && { mono: true }),
    });
  });
}

function buildDecor(b: Builder, decor: readonly Decor[]): void {
  for (const item of decor) {
    switch (item.kind) {
      case 'room': {
        const [x, y, w, h] = item.rect;
        b.push({
          layer: 'decor',
          op: 'rect',
          x,
          y,
          w,
          h,
          fill: 'room',
          stroke: 'roomEdge',
          lineWidth: 1,
        });
        if (item.label) {
          textLines(b, 'decor', undefined, [upper(item.label)], x + 10, y + 9, {
            size: 10,
            weight: 600,
            tone: 'inkMuted',
            align: 'left',
            anchor: 'below',
            spacing: 1,
          });
        }
        break;
      }
      case 'zone': {
        const [x, y, w, h] = item.rect;
        b.push({
          layer: 'decor',
          op: 'rect',
          x,
          y,
          w,
          h,
          radius: 8,
          fill: 'zone',
          stroke: 'zoneEdge',
          lineWidth: 1.2,
          dash: [6, 5],
          alpha: 0.55,
        });
        if (item.label) {
          textLines(b, 'decor', undefined, [upper(item.label)], x + 10, y + 8, {
            size: 11,
            weight: 700,
            tone: 'accent',
            align: 'left',
            anchor: 'below',
            spacing: 1.2,
          });
        }
        break;
      }
      case 'wall':
        b.push({
          layer: 'decor',
          op: 'segments',
          segs: item.segs,
          stroke: 'wall',
          lineWidth: item.width ?? 4,
        });
        break;
      case 'furniture': {
        const [x, y, w, h] = item.rect;
        b.push({
          layer: 'decor',
          op: 'rect',
          x,
          y,
          w,
          h,
          radius: 3,
          fill: 'furniture',
          stroke: 'furnitureEdge',
          lineWidth: 1,
        });
        // Long pieces (racks, counters) get dividers.
        if (w >= 2.5 * h || h >= 2.5 * w) {
          const along = w >= h ? w : h;
          const parts = Math.max(2, Math.round(along / 38));
          const segs: Rect[] = [];
          for (let k = 1; k < parts; k += 1) {
            const t = (k * along) / parts;
            segs.push(w >= h ? [x + t, y + 2, x + t, y + h - 2] : [x + 2, y + t, x + w - 2, y + t]);
          }
          b.push({ layer: 'decor', op: 'segments', segs, stroke: 'furnitureEdge', lineWidth: 1 });
        }
        break;
      }
      case 'label':
        b.push({
          layer: 'labels',
          op: 'text',
          x: item.pos[0],
          y: item.pos[1],
          text: item.text,
          size: 13,
          weight: 600,
          tone: 'ink2',
          align: 'left',
          baseline: 'alphabetic',
          halo: true,
        });
        break;
      case 'scale': {
        const [x, y] = item.pos;
        const end = x + item.px;
        b.push({
          layer: 'decor',
          op: 'path',
          points: [
            [x, y],
            [end, y],
          ],
          stroke: 'ink2',
          lineWidth: 1.5,
          cap: 'butt',
        });
        b.push({
          layer: 'decor',
          op: 'segments',
          segs: [
            [x, y - 4, x, y + 4],
            [end, y - 4, end, y + 4],
          ],
          stroke: 'ink2',
          lineWidth: 1.5,
        });
        b.push({
          layer: 'labels',
          op: 'text',
          x: x + item.px / 2,
          y: y - 7,
          text: item.label,
          size: 10,
          weight: 500,
          tone: 'ink2',
          align: 'center',
          baseline: 'alphabetic',
          mono: true,
        });
        break;
      }
    }
  }
}

/** The unit normal of the path at its middle that points downward (or to the right). */
function labelSpot(
  path: readonly Point[],
  offset: number,
): { x: number; y: number; side: 'below' | 'right' } {
  const half = pathLength(path) / 2;
  const { point, direction } = pointAlong(path, half);
  let nx = -direction[1];
  let ny = direction[0];
  if (Math.abs(ny) < 0.35) {
    if (nx < 0) nx = -nx;
    return { x: point[0] + nx * offset, y: point[1], side: 'right' };
  }
  if (ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  return { x: point[0] + nx * offset, y: point[1] + ny * offset, side: 'below' };
}

function directionAngle(direction: Point): number {
  return Math.atan2(direction[1], direction[0]);
}

interface TokenSpots {
  spots: Array<{ point: Point; direction: Point }>;
  extra: number;
  next: Point;
}

/** Where the tokens of a queue stand: from the end of the path backwards, 16 px apart. */
export function tokenSpots(path: readonly Point[], count: number): TokenSpots {
  const length = pathLength(path);
  const fit = Math.max(1, Math.floor((length - 12) / TOKEN_SPACING) + 1);
  const shown = count <= fit ? count : Math.max(1, fit - 1);
  const spots: TokenSpots['spots'] = [];
  for (let k = 0; k < shown; k += 1) {
    const { point, direction } = pointAlong(path, Math.max(0, length - 8 - k * TOKEN_SPACING));
    spots.push({ point, direction });
  }
  const next = pointAlong(path, Math.max(0, length - 8 - shown * TOKEN_SPACING)).point;
  return { spots, extra: count - shown, next };
}

export function cellStyleOf(kind: string): CellStyle {
  switch (kind) {
    case 'machine':
      return 'machine';
    case 'area':
      return 'desk';
    case 'rooms':
      return 'table';
    default:
      return 'slot';
  }
}

export function cellSize(style: CellStyle): [number, number] {
  switch (style) {
    case 'desk':
      return [38, 24];
    case 'table':
      return [64, 30];
    case 'machine':
      return [26, 26];
    case 'slot':
      return [24, 24];
  }
}

/**
 * Builds the picture of a net in the terms of its domain view: draw commands in layers plus the
 * regions for hover and clicks. Pure; nothing is drawn here. Entries of the view for elements
 * that the net does not have are ignored, elements without an entry are not drawn.
 */
export function buildScene(
  net: PetriNet,
  view: DomainView,
  marking: Marking,
  options: SceneOptions = {},
): Scene {
  const b = new Builder();
  const sprite = view.meta.entity.sprite;
  const running = options.running ?? [];
  const countOf = (placeId: Id): number => marking[placeId]?.length ?? 0;

  buildDecor(b, view.decor ?? []);

  // Arcs: faint connectors where the view has a path.
  const arcIds = new Map(net.arcs.map((a) => [arcKey(a.source, a.target), a.id]));
  for (const [key, arc] of Object.entries(view.arcs ?? {})) {
    const id = arcIds.get(key);
    if (id === undefined || arc.path.length < 2) continue;
    b.push({
      layer: 'arcs',
      elementId: id,
      op: 'path',
      points: arc.path,
      stroke: 'inkMuted',
      lineWidth: 1.4,
      dash: [5, 4],
      arrow: true,
    });
    b.hit(id, 'arc', { type: 'path', points: arc.path, width: 10 }, PRIORITY.arc);
  }

  // Which transition's slots are drawn by a resource place.
  const slotPlaceOf = new Map<Id, Id>();
  for (const place of net.places) {
    const entry = view.places[place.id];
    if (entry?.kind === 'slots' && net.transitions.some((t) => t.id === entry.of)) {
      if (!slotPlaceOf.has(entry.of)) slotPlaceOf.set(entry.of, place.id);
    }
  }
  const busyOf = (transitionId: Id): Set<number> =>
    new Set(running.filter((r) => r.transitionId === transitionId).map((r) => r.slot));

  // Places.
  for (const place of net.places) {
    const entry = view.places[place.id];
    if (!entry) continue;
    const count = countOf(place.id);
    switch (entry.kind) {
      case 'conveyor':
      case 'queue':
      case 'buffer': {
        if (entry.path.length < 2) break;
        const op = entry.kind === 'conveyor' ? 'belt' : entry.kind === 'queue' ? 'lane' : 'buffer';
        const width =
          entry.kind === 'conveyor'
            ? BELT_WIDTH
            : entry.kind === 'queue'
              ? LANE_WIDTH
              : BUFFER_WIDTH;
        b.push({ layer: 'places', elementId: place.id, op, points: entry.path, width });
        b.hit(
          place.id,
          'place',
          { type: 'path', points: entry.path, width: width + 6 },
          PRIORITY.path,
        );
        const { spots, extra, next } = tokenSpots(entry.path, count);
        for (const spot of spots) {
          b.push({
            layer: 'tokens',
            elementId: place.id,
            op: 'sprite',
            sprite,
            x: spot.point[0],
            y: spot.point[1],
            size: spriteSize(sprite),
            ...(sprite === 'person' || sprite === 'vehicle'
              ? { angle: directionAngle(spot.direction) }
              : {}),
          });
        }
        if (extra > 0) {
          b.push({
            layer: 'tokens',
            elementId: place.id,
            op: 'badge',
            x: next[0],
            y: next[1],
            text: `+${extra}`,
          });
        }
        if (entry.label) {
          const spot = labelSpot(entry.path, width / 2 + 10);
          textLines(
            b,
            'labels',
            place.id,
            wrapLabel(entry.label, 11, 120),
            spot.x,
            spot.y,
            spot.side === 'right'
              ? { size: 11, weight: 500, tone: 'ink2', align: 'left', anchor: 'below', halo: true }
              : {
                  size: 11,
                  weight: 500,
                  tone: 'ink2',
                  align: 'center',
                  anchor: 'below',
                  halo: true,
                },
          );
        }
        break;
      }
      case 'slots': {
        const transition = view.transitions[entry.of];
        if (!transition || transition.kind === 'hidden' || !('slots' in transition)) break;
        const slots = transition.slots ?? [];
        if (slotPlaceOf.get(entry.of) !== place.id) break;
        const style = cellStyleOf(transition.kind);
        const [w, h] = cellSize(style);
        const busy = busyOf(entry.of);
        let free = count;
        slots.forEach((slot, index) => {
          let state: CellState = 'off';
          if (busy.has(index)) state = 'busy';
          else if (free > 0) {
            state = 'free';
            free -= 1;
          }
          // The cells are the resource tokens: they lie on the card of the transition.
          b.push({
            layer: 'tokens',
            elementId: place.id,
            op: 'cell',
            style,
            x: slot[0],
            y: slot[1],
            w,
            h,
            state,
          });
          b.hit(
            place.id,
            'place',
            { type: 'rect', rect: [slot[0] - w / 2, slot[1] - h / 2, w, h] },
            PRIORITY.cell,
          );
        });
        break;
      }
      case 'pool': {
        const [x, y] = entry.pos;
        b.push({
          layer: 'places',
          elementId: place.id,
          op: 'circle',
          x,
          y,
          r: 16,
          fill: 'surface',
          stroke: 'ink2',
          lineWidth: 1.4,
          shadow: true,
        });
        b.push({
          layer: 'tokens',
          elementId: place.id,
          op: 'text',
          x,
          y,
          text: String(count),
          size: 12,
          weight: 600,
          tone: 'ink',
          align: 'center',
          baseline: 'middle',
          mono: true,
        });
        b.hit(place.id, 'place', { type: 'circle', x, y, r: 18 }, PRIORITY.point);
        if (entry.label) {
          textLines(b, 'labels', place.id, wrapLabel(entry.label, 11, 110), x, y + 22, {
            size: 11,
            weight: 500,
            tone: 'ink2',
            align: 'center',
            anchor: 'below',
            halo: true,
          });
        }
        break;
      }
      case 'source':
      case 'sink': {
        const [x, y, w, h] = entry.box;
        const isSink = entry.kind === 'sink';
        b.push({
          layer: 'places',
          elementId: place.id,
          op: 'rect',
          x,
          y,
          w,
          h,
          radius: 8,
          fill: isSink ? 'surface' : 'surface2',
          stroke: 'ink2',
          lineWidth: 1.2,
          ...(isSink ? { shadow: true } : { dash: [5, 4] as [number, number] }),
        });
        const glyph: Glyph = isSink
          ? sprite === 'parcel'
            ? 'truck'
            : sprite === 'person'
              ? 'exit'
              : 'arrow-out'
          : 'arrow-in';
        const small = h < 56 || w < 70;
        const glyphSize = small ? 16 : 26;
        b.push({
          layer: 'places',
          elementId: place.id,
          op: 'glyph',
          glyph,
          x: x + (small ? 14 : w / 2),
          y: small ? y + h / 2 : y + h / 2 - 12,
          size: glyphSize,
          tone: 'ink2',
        });
        b.push({
          layer: 'tokens',
          elementId: place.id,
          op: 'text',
          x: small ? x + w - 8 : x + w / 2,
          y: small ? y + h / 2 : y + h / 2 + 14,
          text: String(count),
          size: small ? 13 : 15,
          weight: 700,
          tone: 'ink',
          align: small ? 'right' : 'center',
          baseline: 'middle',
          mono: true,
        });
        b.hit(place.id, 'place', { type: 'rect', rect: entry.box }, PRIORITY.box);
        if (entry.label) {
          textLines(
            b,
            'labels',
            place.id,
            wrapLabel(entry.label, 11, Math.max(w + 20, 100)),
            x + w / 2,
            y + h + 6,
            {
              size: 11,
              weight: 500,
              tone: 'ink2',
              align: 'center',
              anchor: 'below',
              halo: true,
            },
          );
        }
        break;
      }
      case 'hidden':
        break;
    }
  }

  // Transitions.
  for (const transition of net.transitions) {
    const entry = view.transitions[transition.id];
    if (!entry || entry.kind === 'hidden') continue;
    const id = transition.id;
    const label = entry.label;
    const busy = busyOf(id);
    const runningCount = running.filter((r) => r.transitionId === id).length;
    switch (entry.kind) {
      case 'station':
      case 'machine':
      case 'gate': {
        const [x, y, w, h] = entry.box;
        const slots = entry.slots ?? [];
        b.push({
          layer: 'transitions',
          elementId: id,
          op: 'rect',
          x,
          y,
          w,
          h,
          radius: 8,
          fill: 'surface',
          stroke: runningCount > 0 ? 'ok' : 'ink2',
          lineWidth: runningCount > 0 ? 2 : 1.3,
          shadow: true,
        });
        if (entry.kind === 'machine') {
          b.push({
            layer: 'transitions',
            elementId: id,
            op: 'glyph',
            glyph: 'gear',
            x: x + w - 13,
            y: y + 13,
            size: 14,
            tone: 'inkMuted',
          });
        }
        if (entry.kind === 'gate') {
          b.push({
            layer: 'transitions',
            elementId: id,
            op: 'glyph',
            glyph: 'barrier',
            x: x + w / 2,
            y: y + 11,
            size: Math.max(14, w - 12),
            tone: 'ink2',
          });
        }
        const lowest = slots.reduce((m, s) => Math.max(m, s[1]), -Infinity);
        const barY = y + h - 10;
        if (h >= 44 && w >= 36 && lowest + 14 < barY) {
          b.push({
            layer: 'transitions',
            elementId: id,
            op: 'progress',
            x: x + 8,
            y: barY,
            w: w - 16,
            h: 4,
            value:
              slots.length === 0
                ? runningCount > 0
                  ? 1
                  : 0
                : Math.min(1, runningCount / slots.length),
          });
        }
        // Unclaimed slots only show where a firing is under way.
        if (!slotPlaceOf.has(id)) {
          slots.forEach((slot, index) => {
            if (!busy.has(index)) return;
            b.push({
              layer: 'transitions',
              elementId: id,
              op: 'circle',
              x: slot[0],
              y: slot[1],
              r: 14,
              fill: 'okSoft',
              stroke: 'ok',
              lineWidth: 1.5,
            });
          });
        }
        b.hit(id, 'transition', { type: 'rect', rect: entry.box }, PRIORITY.card);
        if (label) {
          const inside = w >= 84 && h >= 64 && entry.kind !== 'gate';
          if (inside) {
            textLines(b, 'labels', id, wrapLabel(label, 12, w - 36, 600), x + 10, y + 9, {
              size: 12,
              weight: 600,
              tone: 'ink',
              align: 'left',
              anchor: 'below',
            });
          } else {
            textLines(
              b,
              'labels',
              id,
              wrapLabel(label, 12, Math.max(w + 28, 96), 600),
              x + w / 2,
              y - 7,
              {
                size: 12,
                weight: 600,
                tone: 'ink',
                align: 'center',
                anchor: 'above',
                halo: true,
              },
            );
          }
        }
        break;
      }
      case 'area':
      case 'rooms': {
        const [x, y, w, h] = entry.box;
        const regions: Rect[] =
          entry.kind === 'rooms' && entry.rooms?.length ? entry.rooms : [entry.box];
        if (entry.kind === 'area') {
          b.push({
            layer: 'transitions',
            elementId: id,
            op: 'rect',
            x,
            y,
            w,
            h,
            radius: 6,
            fill: 'area',
            stroke: runningCount > 0 ? 'ok' : 'ink2',
            lineWidth: 1,
            dash: [7, 5],
            alpha: 0.9,
          });
        } else {
          for (const [rx, ry, rw, rh] of regions) {
            b.push({
              layer: 'transitions',
              elementId: id,
              op: 'rect',
              x: rx + 5,
              y: ry + 5,
              w: rw - 10,
              h: rh - 10,
              radius: 4,
              stroke: runningCount > 0 ? 'ok' : 'ink2',
              lineWidth: 1,
              dash: [7, 5],
              alpha: 0.6,
            });
          }
        }
        for (const region of regions) {
          b.hit(id, 'transition', { type: 'rect', rect: region }, PRIORITY.area);
        }
        if (!slotPlaceOf.has(id)) {
          entry.slots.forEach((slot, index) => {
            if (!busy.has(index)) return;
            b.push({
              layer: 'transitions',
              elementId: id,
              op: 'circle',
              x: slot[0],
              y: slot[1],
              r: 14,
              fill: 'okSoft',
              stroke: 'ok',
              lineWidth: 1.5,
            });
          });
        }
        if (label) {
          const [lx, ly] = entry.kind === 'area' ? [x + 10, y + 9] : [x + 10, y + h - 9];
          textLines(b, 'labels', id, [upper(label)], lx, ly, {
            size: 10,
            weight: 700,
            tone: 'ink2',
            align: 'left',
            anchor: entry.kind === 'area' ? 'below' : 'above',
            spacing: 1,
            halo: true,
          });
        }
        break;
      }
      case 'door':
      case 'dock':
      case 'waypoint': {
        const [x, y] = entry.pos;
        if (entry.kind === 'waypoint') {
          b.push({
            layer: 'transitions',
            elementId: id,
            op: 'glyph',
            glyph: entry.pass ? 'ring' : 'diamond',
            x,
            y,
            size: entry.pass ? 13 : 18,
            tone: runningCount > 0 ? 'ok' : 'ink2',
          });
          b.hit(id, 'transition', { type: 'circle', x, y, r: 14 }, PRIORITY.point);
        } else if (entry.kind === 'door') {
          b.push({
            layer: 'transitions',
            elementId: id,
            op: 'glyph',
            glyph: 'door',
            x,
            y,
            size: 36,
            tone: runningCount > 0 ? 'ok' : 'ink2',
          });
          b.hit(id, 'transition', { type: 'rect', rect: [x - 22, y - 24, 62, 48] }, PRIORITY.point);
        } else {
          b.push({
            layer: 'transitions',
            elementId: id,
            op: 'glyph',
            glyph: 'dock',
            x,
            y,
            size: 56,
            tone: runningCount > 0 ? 'ok' : 'ink2',
          });
          b.hit(id, 'transition', { type: 'rect', rect: [x - 14, y - 32, 40, 64] }, PRIORITY.point);
        }
        if (runningCount > 0) {
          b.push({
            layer: 'tokens',
            elementId: id,
            op: 'badge',
            x: x + 14,
            y: y - 14,
            text: String(runningCount),
            accent: true,
          });
        }
        if (label) {
          const reach = entry.kind === 'waypoint' ? 14 : entry.kind === 'dock' ? 36 : 28;
          const above = y - reach - 18 >= 0;
          textLines(
            b,
            'labels',
            id,
            wrapLabel(label, 11, 120, 600),
            x,
            above ? y - reach : y + reach,
            {
              size: 11,
              weight: 600,
              tone: 'ink',
              align: 'center',
              anchor: above ? 'above' : 'below',
              halo: true,
            },
          );
        }
        break;
      }
    }
    // Firings under way: the case on its slot; those without a slot are counted.
    const slots =
      entry.kind === 'station' ||
      entry.kind === 'machine' ||
      entry.kind === 'gate' ||
      entry.kind === 'area' ||
      entry.kind === 'rooms'
        ? (entry.slots ?? [])
        : [];
    let unplaced = 0;
    for (const firing of running.filter((r) => r.transitionId === id)) {
      const slot = slots[firing.slot];
      if (slot) {
        b.push({
          layer: 'tokens',
          elementId: id,
          op: 'sprite',
          sprite,
          x: slot[0],
          y: slot[1],
          size: spriteSize(sprite),
        });
      } else unplaced += 1;
    }
    if (
      unplaced > 0 &&
      (entry.kind === 'station' || entry.kind === 'machine' || entry.kind === 'gate')
    ) {
      const [x, y, w] = entry.box;
      b.push({
        layer: 'tokens',
        elementId: id,
        op: 'badge',
        x: x + w - 8,
        y: y - 2,
        text: String(unplaced),
        accent: true,
      });
    }
  }

  const scene: Scene = {
    width: view.meta.canvas.width,
    height: view.meta.canvas.height,
    sprite,
    layers: b.layers,
    hits: b.hits,
  };
  return withHighlight(scene, options);
}

/**
 * The part of the picture that depends on the net and the view only: scenery, belts, cards,
 * connectors and labels, with the regions for hover and clicks. Tokens, counters, slot cells and
 * progress bars are drawn on top of it by `buildDynamicScene`. A canvas keeps it in an offscreen
 * layer and redraws it when the net, the view, the zoom or the theme change.
 */
export function buildStaticScene(net: PetriNet, view: DomainView): Scene {
  const scene = buildScene(net, view, {}, {});
  return {
    ...scene,
    layers: {
      ...scene.layers,
      tokens: [],
      transitions: scene.layers.transitions.filter((c) => c.op !== 'progress'),
    },
  };
}

// --- Hover and selection ----------------------------------------------------------------------

/** The scene with the highlight layer for the given hover and selection. Cheap. */
export function withHighlight(
  scene: Scene,
  options: Pick<SceneOptions, 'hover' | 'selection'>,
): Scene {
  const commands: DrawCommand[] = [];
  const selected = new Set(options.selection ?? []);
  const hover = options.hover ?? null;
  const draw = (id: Id, mode: 'selected' | 'hover'): void => {
    for (const area of scene.hits) {
      if (area.elementId !== id) continue;
      const alpha = mode === 'selected' ? 1 : 0.85;
      const lineWidth = mode === 'selected' ? 2.5 : 2;
      const shape = area.shape;
      if (shape.type === 'rect') {
        const [x, y, w, h] = shape.rect;
        if (mode === 'hover') {
          commands.push({
            layer: 'highlight',
            elementId: id,
            op: 'rect',
            x: x - 4,
            y: y - 4,
            w: w + 8,
            h: h + 8,
            radius: 10,
            fill: 'accent',
            alpha: 0.1,
          });
        }
        commands.push({
          layer: 'highlight',
          elementId: id,
          op: 'rect',
          x: x - 4,
          y: y - 4,
          w: w + 8,
          h: h + 8,
          radius: 10,
          stroke: 'accent',
          lineWidth,
          alpha,
        });
      } else if (shape.type === 'circle') {
        commands.push({
          layer: 'highlight',
          elementId: id,
          op: 'circle',
          x: shape.x,
          y: shape.y,
          r: shape.r + 3,
          stroke: 'accent',
          lineWidth,
          alpha,
        });
      } else {
        commands.push({
          layer: 'highlight',
          elementId: id,
          op: 'path',
          points: shape.points,
          stroke: 'accent',
          lineWidth: shape.width + 8,
          alpha: 0.2,
          cap: 'round',
        });
        commands.push({
          layer: 'highlight',
          elementId: id,
          op: 'path',
          points: shape.points,
          stroke: 'accent',
          lineWidth: 1.6,
          alpha,
          cap: 'round',
        });
      }
    }
  };
  for (const id of selected) draw(id, 'selected');
  if (hover !== null && !selected.has(hover)) draw(hover, 'hover');
  return { ...scene, layers: { ...scene.layers, highlight: commands } };
}

function inShape(shape: Shape, point: Point, slack: number): boolean {
  switch (shape.type) {
    case 'rect':
      return pointInRect(point, shape.rect, slack);
    case 'circle':
      return distance(point, [shape.x, shape.y]) <= shape.r + slack;
    case 'path':
      return distanceToPath(point, shape.points) <= shape.width / 2 + slack;
  }
}

export interface Hit {
  elementId: Id;
  kind: ElementKind;
}

/**
 * The element under a point of the canvas (scene coordinates), or `null`. Of several elements the
 * one with the highest priority wins: resource slots over stations over belts over arcs.
 * `slack` widens every region (in scene pixels, to make thin arcs easier to hit at low zoom).
 */
export function hitTest(scene: Scene, point: Point, slack = 0): Hit | null {
  let best: HitArea | null = null;
  for (const area of scene.hits) {
    if (!inShape(area.shape, point, slack)) continue;
    if (best === null || area.priority >= best.priority) best = area;
  }
  return best ? { elementId: best.elementId, kind: best.kind } : null;
}

/** The center of the first region of an element, for placing a card next to it. */
export function elementBounds(scene: Scene, elementId: Id): Rect | null {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const area of scene.hits) {
    if (area.elementId !== elementId) continue;
    const shape = area.shape;
    const box: Rect =
      shape.type === 'rect'
        ? shape.rect
        : shape.type === 'circle'
          ? [shape.x - shape.r, shape.y - shape.r, 2 * shape.r, 2 * shape.r]
          : [
              Math.min(...shape.points.map((p) => p[0])) - shape.width / 2,
              Math.min(...shape.points.map((p) => p[1])) - shape.width / 2,
              Math.max(...shape.points.map((p) => p[0])) -
                Math.min(...shape.points.map((p) => p[0])) +
                shape.width,
              Math.max(...shape.points.map((p) => p[1])) -
                Math.min(...shape.points.map((p) => p[1])) +
                shape.width,
            ];
    x1 = Math.min(x1, box[0]);
    y1 = Math.min(y1, box[1]);
    x2 = Math.max(x2, box[0] + box[2]);
    y2 = Math.max(y2, box[1] + box[3]);
  }
  return Number.isFinite(x1) ? [x1, y1, x2 - x1, y2 - y1] : null;
}
