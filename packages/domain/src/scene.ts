import { placeRoles, type Id, type Marking, type PetriNet, type PlaceRole } from '@pnm/core';
import {
  distance,
  distanceToPath,
  pointAlong,
  pointInRect,
  pathLength,
  TOKEN_SPACING,
} from './geometry';
import { appearanceOfPlace, heldAppearance, type AppearanceContext } from './appearance';
import {
  counterArea,
  counterInfo,
  counterLayout,
  dynamicCounterCommands,
  graphicDisplay,
  staticCounterCommands,
  type CounterEntry,
} from './counter-graphic';
import type { HistoryPoint } from './history';
import type { Tone } from './palette';
import {
  arcKey,
  type Appearance,
  type Decor,
  type DisplayIcon,
  type DomainView,
  type Point,
  type Rect,
  type Sprite,
  type Tint,
} from './schema';

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
/**
 * `reserved`: a firing has taken the slot but its case is still on the way there (hatched, no
 * progress yet).
 */
export type CellState = 'free' | 'busy' | 'reserved' | 'off';

interface Base {
  layer: Layer;
  /** The place, transition or arc of the net the command belongs to. */
  elementId?: Id;
  /** The index in `view.decor` of the piece of decor the command belongs to. */
  decor?: number;
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
        /** Fill with diagonal hatching in the `stroke` tone instead of a flat `fill`. */
        hatch?: boolean;
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
    | {
        op: 'sprite';
        sprite: Sprite;
        x: number;
        y: number;
        size: number;
        angle?: number;
        /** A token of the palette that colors the body of the sprite (appearance of a stage). */
        tint?: Tint;
        alpha?: number;
      }
    | {
        op: 'badge';
        x: number;
        y: number;
        text: string;
        accent?: boolean;
        /** Fills the badge with this color instead (a warning). */
        tone?: Tone;
      }
    /** The picture of an amount or an object; a `fraction` below 1 fills it from the left only. */
    | {
        op: 'icon';
        icon: DisplayIcon;
        x: number;
        y: number;
        size: number;
        fraction?: number;
        alpha?: number;
      }
    /** The liquid of a container: the lower `value` (0 to 1) of the rectangle, clipped to its corners. */
    | {
        op: 'fill';
        x: number;
        y: number;
        w: number;
        h: number;
        radius: number;
        value: number;
        tone: Tone;
      }
    /** A curve of a count over time as a step line; its area down to `base` is lightly filled. */
    | { op: 'spark'; points: Point[]; base: number; tone: Tone }
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
  /** The count over time of counters with `display.history`, and the time of its right end. */
  history?: Readonly<Record<Id, readonly HistoryPoint[]>>;
  time?: number;
}

const BELT_WIDTH = 24;
const BUFFER_WIDTH = 30;
const LANE_WIDTH = 18;

/**
 * The size of a case on the canvas, 14 to 22 px depending on how much room the picture needs. The
 * thin pictures of a frame and a bicycle are drawn larger, so that their tubes stay readable.
 */
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
    case 'bars':
      return 18;
    case 'frame':
      return 20;
    case 'bicycle':
      return 24;
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

/** The region for hover and clicks of a counter with a graphic, and its label below it. */
function buildCounterHitAndLabel(
  b: Builder,
  placeId: Id,
  entry: CounterEntry,
  display: NonNullable<ReturnType<typeof graphicDisplay>>,
): void {
  const area = counterArea(entry, display);
  const [x, y, w, h] = area;
  b.hit(placeId, 'place', { type: 'rect', rect: area }, PRIORITY.box);
  // A large box carries its label inside, as a title.
  if (!entry.label || counterLayout(area, display, 0, entry, true).title) return;
  textLines(
    b,
    'labels',
    placeId,
    wrapLabel(entry.label, 11, Math.max(w + 20, entry.kind === 'pool' ? 110 : 100)),
    x + w / 2,
    y + h + 6,
    { size: 11, weight: 500, tone: 'ink2', align: 'center', anchor: 'below', halo: true },
  );
}

/** The roles and arcs of a net in the form that the look of a case in a firing is found from. */
function appearanceContextOf(
  net: PetriNet,
  view: DomainView,
  roles: ReadonlyMap<Id, PlaceRole>,
): AppearanceContext {
  const placeIds = new Set(net.places.map((p) => p.id));
  const inputs = new Map<Id, Id[]>();
  const outputs = new Map<Id, Id[]>();
  for (const transition of net.transitions) {
    inputs.set(transition.id, []);
    outputs.set(transition.id, []);
  }
  for (const arc of net.arcs) {
    if (placeIds.has(arc.source)) inputs.get(arc.target)?.push(arc.source);
    else outputs.get(arc.source)?.push(arc.target);
  }
  return { view, roles, inputs, outputs };
}

/** A case drawn as a sprite on a belt or lane, or on the slot of a station. */
function caseSprite(
  layer: Layer,
  elementId: Id,
  look: Appearance,
  point: Point,
  direction?: Point,
): DrawCommand {
  const oriented = look.sprite === 'person' || look.sprite === 'vehicle';
  return {
    layer,
    elementId,
    op: 'sprite',
    sprite: look.sprite,
    x: point[0],
    y: point[1],
    size: spriteSize(look.sprite),
    ...(oriented && direction !== undefined ? { angle: directionAngle(direction) } : {}),
    ...(look.tint !== undefined && { tint: look.tint }),
  };
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

  /** Set while the decor of the view is built: its commands remember which piece they are. */
  decorIndex: number | null = null;

  push(command: DrawCommand): void {
    this.layers[command.layer].push(
      this.decorIndex === null ? command : { ...command, decor: this.decorIndex },
    );
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
  for (const [index, item] of decor.entries()) {
    b.decorIndex = index;
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
  b.decorIndex = null;
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
/** How the number of a counter box (a source or sink) is laid out in its box. */
export interface CounterBoxLayout {
  /** A box too small for the big glyph: the number sits at the right edge. */
  small: boolean;
  /** A large box (200 x 72 px or more): its number is drawn big, as a headline figure. */
  large: boolean;
  glyph: Point;
  glyphSize: number;
  text: Point;
  textSize: number;
  align: 'center' | 'right';
}

/** The layout of the glyph and the number in a counter box. Static and dynamic scene agree on it. */
export function counterBoxLayout(box: Rect): CounterBoxLayout {
  const [x, y, w, h] = box;
  const small = h < 56 || w < 70;
  const large = !small && w >= 200 && h >= 72;
  if (large) {
    return {
      small,
      large,
      glyph: [x + w / 2, y + h * 0.3],
      glyphSize: 26,
      text: [x + w / 2, y + h * 0.7],
      textSize: 32,
      align: 'center',
    };
  }
  return {
    small,
    large,
    glyph: [x + (small ? 14 : w / 2), small ? y + h / 2 : y + h / 2 - 12],
    glyphSize: small ? 16 : 26,
    text: [small ? x + w - 8 : x + w / 2, small ? y + h / 2 : y + h / 2 + 14],
    textSize: small ? 13 : 15,
    align: small ? 'right' : 'center',
  };
}

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
  let roles: Map<Id, PlaceRole> | null = null;
  let appearanceContext: AppearanceContext | null = null;
  for (const place of net.places) {
    const entry = view.places[place.id];
    if (!entry) continue;
    const count = countOf(place.id);
    // A counter that shows its amount as a fill level, a pictogram or a curve (N2).
    const graphic = graphicDisplay(entry);
    if (
      graphic !== null &&
      (entry.kind === 'pool' || entry.kind === 'source' || entry.kind === 'sink')
    ) {
      roles ??= placeRoles(net);
      const role = roles.get(place.id);
      const info = counterInfo(
        place.id,
        entry,
        graphic,
        net,
        view,
        role !== 'quantity' && role !== 'resource',
      );
      for (const command of staticCounterCommands(info)) b.push(command);
      for (const command of dynamicCounterCommands(info, {
        count,
        ...(options.history?.[place.id] && { history: options.history[place.id]! }),
        ...(options.time !== undefined && { time: options.time }),
      })) {
        b.push(command);
      }
      buildCounterHitAndLabel(b, place.id, entry, graphic);
      continue;
    }
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
        const look = appearanceOfPlace(view, place.id);
        for (const spot of spots) {
          b.push(caseSprite('tokens', place.id, look, spot.point, spot.direction));
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
        const counter = counterBoxLayout(entry.box);
        b.push({
          layer: 'places',
          elementId: place.id,
          op: 'glyph',
          glyph,
          x: counter.glyph[0],
          y: counter.glyph[1],
          size: counter.glyphSize,
          tone: 'ink2',
        });
        b.push({
          layer: 'tokens',
          elementId: place.id,
          op: 'text',
          x: counter.text[0],
          y: counter.text[1],
          text: String(count),
          size: counter.textSize,
          weight: 700,
          tone: 'ink',
          align: counter.align,
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
        // The case keeps the look of the place it was taken from while the station works.
        roles ??= placeRoles(net);
        appearanceContext ??= appearanceContextOf(net, view, roles);
        b.push(caseSprite('tokens', id, heldAppearance(appearanceContext, id, 0), slot));
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
