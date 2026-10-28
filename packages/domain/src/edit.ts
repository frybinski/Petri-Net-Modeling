import type { Id, PetriNet } from '@pnm/core';
import { MIN_QUEUE_LENGTH, pathLength, rectCenter } from './geometry';
import { resetEntry } from './generic';
import { entryBounds, entryOf, provenanceKeyOf, type EntryRef, type HandleKind } from './handles';
import {
  arcKey,
  provenanceKey,
  type Decor,
  type DomainView,
  type PlaceView,
  type Point,
  type Rect,
  type TransitionView,
} from './schema';
import { allowedPlaceKinds, allowedTransitionKinds, loopTransitions } from './validate';

/** Grid of the editor, in sheet pixels. */
export const GRID = 8;
/** No box gets smaller than this in either direction. */
export const MIN_SIZE = 24;

export interface EditOptions {
  /** Grid to snap to; `0` or `undefined` for no snapping (coordinates are still whole numbers). */
  snap?: number;
  /** Timestamp for the provenance of changed entries. Default: now. */
  at?: string;
  /**
   * The net. With it, arcs that start or end at a moved element move their end along. Without it
   * only the addressed entry changes.
   */
  net?: PetriNet;
  /** Resize with a corner handle keeps the aspect ratio. */
  keepAspect?: boolean;
  /** For handles of a room of a `rooms` area: the index of the room. */
  room?: number;
}

type Value = PlaceView | TransitionView | { path: Point[] } | Decor;

const stamp = (options: EditOptions): string => options.at ?? new Date().toISOString();

/** Marks entries as made by hand: provenance `user`. Decor has no provenance and is skipped. */
export function markUser(view: DomainView, refs: readonly EntryRef[], at: string): DomainView {
  const provenance = { ...view.provenance };
  let changed = false;
  for (const entry of refs) {
    const key = provenanceKeyOf(entry);
    if (key === null) continue;
    provenance[key] = { source: 'user', at };
    changed = true;
  }
  return changed ? { ...view, provenance } : view;
}

function snapValue(v: number, grid: number | undefined): number {
  return grid !== undefined && grid > 0 ? Math.round(v / grid) * grid : Math.round(v);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Clamps into `[lo, hi]`; if the range is empty (`hi < lo`) the lower end wins. */
function clampRange(v: number, lo: number, hi: number): number {
  return hi < lo ? lo : clamp(v, lo, hi);
}

// ---------------------------------------------------------------------------------------------
// Geometry of entries

/** Applies a function to every point and every rectangle of an entry. */
function mapGeometry<T extends Value>(
  entry: T,
  point: (p: Point) => Point,
  rect: (r: Rect) => Rect,
): T {
  const item = entry as Value;
  if (!('kind' in item)) return { ...item, path: item.path.map(point) } as T;
  switch (item.kind) {
    case 'queue':
    case 'conveyor':
    case 'buffer':
      return { ...item, path: item.path.map(point) } as T;
    case 'pool':
    case 'door':
    case 'dock':
    case 'waypoint':
    case 'label':
    case 'scale':
      return { ...item, pos: point(item.pos) } as T;
    case 'source':
    case 'sink':
      return { ...item, box: rect(item.box) } as T;
    case 'station':
    case 'machine':
    case 'gate':
      return {
        ...item,
        box: rect(item.box),
        ...(item.slots !== undefined && { slots: item.slots.map(point) }),
      } as T;
    case 'area':
    case 'rooms':
      return {
        ...item,
        box: rect(item.box),
        slots: item.slots.map(point),
        ...(item.rooms !== undefined && { rooms: item.rooms.map(rect) }),
      } as T;
    case 'room':
    case 'zone':
    case 'furniture':
      return { ...item, rect: rect(item.rect) } as T;
    case 'wall':
      return {
        ...item,
        segs: item.segs.map((s): Rect => {
          const a = point([s[0], s[1]]);
          const b = point([s[2], s[3]]);
          return [a[0], a[1], b[0], b[1]];
        }),
      } as T;
    case 'slots':
    case 'hidden':
      return entry;
  }
}

const roundPoint = (p: Point): Point => [Math.round(p[0]), Math.round(p[1])];
const roundRect = (r: Rect): Rect => [
  Math.round(r[0]),
  Math.round(r[1]),
  Math.round(r[2]),
  Math.round(r[3]),
];

/** The box of an entry that has one (stations, areas, sources, sinks). */
function boxOf(entry: Value): Rect | null {
  if (!('kind' in entry)) return null;
  switch (entry.kind) {
    case 'station':
    case 'machine':
    case 'gate':
    case 'area':
    case 'rooms':
    case 'source':
    case 'sink':
      return entry.box;
    case 'room':
    case 'zone':
    case 'furniture':
      return entry.rect;
    default:
      return null;
  }
}

/** Brings slots into their box (with a margin, as far as the box allows). */
function clampSlots<T extends Value>(entry: T): T {
  const item = entry as Value;
  if (!('kind' in item)) return entry;
  switch (item.kind) {
    case 'station':
    case 'machine':
    case 'gate':
    case 'area':
    case 'rooms': {
      if (item.slots === undefined) return entry;
      const [x, y, w, h] = item.box;
      const mx = Math.min(8, w / 2);
      const my = Math.min(8, h / 2);
      const slots = item.slots.map((s): Point => [
        Math.round(clamp(s[0], x + mx, x + w - mx)),
        Math.round(clamp(s[1], y + my, y + h - my)),
      ]);
      return { ...item, slots } as T;
    }
    default:
      return entry;
  }
}

/** Keeps every point and rectangle of an entry inside the canvas. */
function confine<T extends Value>(entry: T, width: number, height: number): T {
  return mapGeometry(
    entry,
    (p) => [clamp(p[0], 0, width), clamp(p[1], 0, height)],
    (r) => {
      const w = Math.min(r[2], width);
      const h = Math.min(r[3], height);
      return [clamp(r[0], 0, width - w), clamp(r[1], 0, height - h), w, h];
    },
  );
}

/** The entry written into the view (a new view; the old one is not touched). */
function withEntry(view: DomainView, target: EntryRef, value: Value): DomainView {
  switch (target.section) {
    case 'places':
      return { ...view, places: { ...view.places, [target.key]: value as PlaceView } };
    case 'transitions':
      return {
        ...view,
        transitions: { ...view.transitions, [target.key]: value as TransitionView },
      };
    case 'arcs':
      return {
        ...view,
        arcs: { ...(view.arcs ?? {}), [target.key]: value as { path: Point[] } },
      };
    case 'decor': {
      const decor = [...(view.decor ?? [])];
      decor[Number(target.key)] = value as Decor;
      return { ...view, decor };
    }
  }
}

/** Writes a finished geometry edit: whole numbers, inside the canvas, slots in the box. */
function commitGeometry(
  view: DomainView,
  target: EntryRef,
  value: Value,
  options: EditOptions,
): DomainView {
  const { width, height } = view.meta.canvas;
  const rounded = mapGeometry(value, roundPoint, roundRect);
  const confined = clampSlots(confine(rounded, width, height));
  return markUser(withEntry(view, target, confined), [target], stamp(options));
}

function current(view: DomainView, target: EntryRef): Value | undefined {
  return entryOf(view, target);
}

/** The anchor that snapping aligns to the grid: the origin of the entry. */
function originOf(value: Value): Point {
  const box = boxOf(value);
  if (box) return [box[0], box[1]];
  if (!('kind' in value)) return value.path[0] ?? [0, 0];
  switch (value.kind) {
    case 'queue':
    case 'conveyor':
    case 'buffer':
      return value.path[0] ?? [0, 0];
    case 'pool':
    case 'door':
    case 'dock':
    case 'waypoint':
    case 'label':
    case 'scale':
      return value.pos;
    case 'wall': {
      const first = value.segs[0];
      return first ? [first[0], first[1]] : [0, 0];
    }
    default:
      return [0, 0];
  }
}

// ---------------------------------------------------------------------------------------------
// Moving

/** The arcs of the net that start or end at an element, with the end that touches it. */
function arcEnds(net: PetriNet, id: Id): Array<{ key: string; end: 'first' | 'last' }> {
  const out: Array<{ key: string; end: 'first' | 'last' }> = [];
  for (const arc of net.arcs) {
    if (arc.source === id) out.push({ key: arcKey(arc.source, arc.target), end: 'first' });
    else if (arc.target === id) out.push({ key: arcKey(arc.source, arc.target), end: 'last' });
  }
  return out;
}

function moveArcEnd(
  view: DomainView,
  key: string,
  end: 'first' | 'last',
  to: (old: Point) => Point,
  options: EditOptions,
): DomainView {
  const entry = view.arcs?.[key];
  if (!entry || entry.path.length < 2) return view;
  const path = entry.path.slice();
  const index = end === 'first' ? 0 : path.length - 1;
  path[index] = to(path[index]!);
  return commitGeometry(view, { section: 'arcs', key }, { path }, options);
}

/**
 * Moves an entry by `delta`: the box, the position, all points of a path, the slots and the rooms
 * together. The entry stays inside the canvas; with a grid its origin lands on it.
 */
export function moveEntry(
  view: DomainView,
  target: EntryRef,
  delta: Point,
  options: EditOptions = {},
): DomainView {
  const value = current(view, target);
  const bounds = entryBounds(view, target);
  if (!value || !bounds) return view;
  const { width, height } = view.meta.canvas;
  const origin = originOf(value);
  let dx = snapValue(origin[0] + delta[0], options.snap) - origin[0];
  let dy = snapValue(origin[1] + delta[1], options.snap) - origin[1];
  dx = clampRange(dx, -bounds[0], width - (bounds[0] + bounds[2]));
  dy = clampRange(dy, -bounds[1], height - (bounds[1] + bounds[3]));
  if (dx === 0 && dy === 0) return view;
  let next = commitGeometry(
    view,
    target,
    mapGeometry(
      value,
      (p) => [p[0] + dx, p[1] + dy],
      (r) => [r[0] + dx, r[1] + dy, r[2], r[3]],
    ),
    options,
  );
  const net = options.net;
  if (net && (target.section === 'places' || target.section === 'transitions')) {
    for (const { key, end } of arcEnds(net, target.key)) {
      next = moveArcEnd(next, key, end, (p) => [p[0] + dx, p[1] + dy], options);
    }
  }
  return next;
}

// ---------------------------------------------------------------------------------------------
// Resizing

/**
 * The rectangle after dragging the handle `side` (`nw`, `n`, ... `w`) by `delta`. The moved edges
 * snap to the grid and stay inside the canvas, the rectangle never gets smaller than `MIN_SIZE`.
 * With `keepAspect` a corner handle keeps the proportions.
 */
export function resizeRect(
  rect: Rect,
  side: string,
  delta: Point,
  canvas: { width: number; height: number },
  options: { snap?: number; keepAspect?: boolean } = {},
): Rect {
  const [x, y, w, h] = rect;
  let left = x;
  let right = x + w;
  let top = y;
  let bottom = y + h;
  const movesWest = side.includes('w');
  const movesEast = side.includes('e');
  const movesNorth = side.includes('n');
  const movesSouth = side.includes('s');
  if (movesWest) left = clamp(snapValue(left + delta[0], options.snap), 0, right - MIN_SIZE);
  if (movesEast) {
    right = clamp(snapValue(right + delta[0], options.snap), left + MIN_SIZE, canvas.width);
  }
  if (movesNorth) top = clamp(snapValue(top + delta[1], options.snap), 0, bottom - MIN_SIZE);
  if (movesSouth) {
    bottom = clamp(snapValue(bottom + delta[1], options.snap), top + MIN_SIZE, canvas.height);
  }
  const corner = (movesWest || movesEast) && (movesNorth || movesSouth);
  if (options.keepAspect === true && corner && w > 0 && h > 0) {
    const fixedX = movesWest ? x + w : x;
    const fixedY = movesNorth ? y + h : y;
    const roomX = movesWest ? fixedX : canvas.width - fixedX;
    const roomY = movesNorth ? fixedY : canvas.height - fixedY;
    let scale = Math.max((right - left) / w, (bottom - top) / h);
    scale = Math.min(scale, roomX / w, roomY / h);
    scale = Math.max(scale, MIN_SIZE / w, MIN_SIZE / h);
    const newW = w * scale;
    const newH = h * scale;
    left = movesWest ? fixedX - newW : fixedX;
    right = movesWest ? fixedX : fixedX + newW;
    top = movesNorth ? fixedY - newH : fixedY;
    bottom = movesNorth ? fixedY : fixedY + newH;
  }
  return roundRect([left, top, right - left, bottom - top]);
}

/** Maps a point of the old rectangle to the same relative place in the new one. */
function remap(p: Point, from: Rect, to: Rect): Point {
  const fx = from[2] > 0 ? (p[0] - from[0]) / from[2] : 0.5;
  const fy = from[3] > 0 ? (p[1] - from[1]) / from[3] : 0.5;
  return [to[0] + fx * to[2], to[1] + fy * to[3]];
}

function remapRect(r: Rect, from: Rect, to: Rect): Rect {
  const a = remap([r[0], r[1]], from, to);
  const scaleX = from[2] > 0 ? to[2] / from[2] : 1;
  const scaleY = from[3] > 0 ? to[3] / from[3] : 1;
  return [a[0], a[1], r[2] * scaleX, r[3] * scaleY];
}

/** Replaces the box of an entry; slots and rooms move along proportionally. */
function replaceBox(value: Value, box: Rect): Value {
  if (!('kind' in value)) return value;
  switch (value.kind) {
    case 'source':
    case 'sink':
      return { ...value, box };
    case 'room':
    case 'zone':
    case 'furniture':
      return { ...value, rect: box };
    case 'station':
    case 'machine':
    case 'gate':
      return {
        ...value,
        box,
        ...(value.slots !== undefined && {
          slots: value.slots.map((s) => remap(s, value.box, box)),
        }),
      };
    case 'area':
    case 'rooms':
      return {
        ...value,
        box,
        slots: value.slots.map((s) => remap(s, value.box, box)),
        ...(value.rooms !== undefined && {
          rooms: value.rooms.map((r) => remapRect(r, value.box, box)),
        }),
      };
    default:
      return value;
  }
}

/**
 * Resizes an entry by dragging a resize handle. Slots and rooms scale with the box. For a single
 * room of a `rooms` area pass its index as `options.room`. Dragging the east handle of a scale bar
 * changes its length.
 */
export function resizeEntry(
  view: DomainView,
  target: EntryRef,
  handle: HandleKind,
  delta: Point,
  options: EditOptions = {},
): DomainView {
  const value = current(view, target);
  if (!value || !handle.startsWith('resize-')) return view;
  const side = handle.slice('resize-'.length);
  const canvas = view.meta.canvas;
  if ('kind' in value && value.kind === 'scale') {
    const end = value.pos[0] + value.px;
    const to = clamp(snapValue(end + delta[0], options.snap), value.pos[0] + 8, canvas.width);
    return commitGeometry(view, target, { ...value, px: Math.round(to - value.pos[0]) }, options);
  }
  if (options.room !== undefined && 'kind' in value && value.kind === 'rooms') {
    const room = value.rooms?.[options.room];
    if (!room || !value.rooms) return view;
    const rooms = value.rooms.slice();
    rooms[options.room] = resizeRect(room, side, delta, canvas, options);
    return commitGeometry(view, target, { ...value, rooms }, options);
  }
  const box = boxOf(value);
  if (!box) return view;
  const next = resizeRect(box, side, delta, canvas, options);
  return commitGeometry(view, target, replaceBox(value, next), options);
}

/** Sets the box of an entry to `rect` (inside the canvas, at least `MIN_SIZE` wide and high). */
export function setBox(
  view: DomainView,
  target: EntryRef,
  rect: Rect,
  options: EditOptions = {},
): DomainView {
  const value = current(view, target);
  if (!value || !boxOf(value)) return view;
  const { width, height } = view.meta.canvas;
  const w = clamp(Math.round(rect[2]), Math.min(MIN_SIZE, width), width);
  const h = clamp(Math.round(rect[3]), Math.min(MIN_SIZE, height), height);
  const x = clamp(Math.round(rect[0]), 0, width - w);
  const y = clamp(Math.round(rect[1]), 0, height - h);
  return commitGeometry(view, target, replaceBox(value, [x, y, w, h]), options);
}

// ---------------------------------------------------------------------------------------------
// Points of paths and walls

function pointsOf(value: Value, part?: 'wall'): Point[] | null {
  if (!('kind' in value)) return value.path;
  switch (value.kind) {
    case 'queue':
    case 'conveyor':
    case 'buffer':
      return value.path;
    case 'wall':
      return part === 'wall' || part === undefined
        ? value.segs.flatMap((s): Point[] => [
            [s[0], s[1]],
            [s[2], s[3]],
          ])
        : null;
    default:
      return null;
  }
}

function withPoints(value: Value, points: Point[]): Value {
  if (!('kind' in value)) return { ...value, path: points };
  if (value.kind === 'wall') {
    const segs: Rect[] = [];
    for (let i = 0; i + 1 < points.length; i += 2) {
      const a = points[i]!;
      const b = points[i + 1]!;
      segs.push([a[0], a[1], b[0], b[1]]);
    }
    return { ...value, segs };
  }
  if (value.kind === 'queue' || value.kind === 'conveyor' || value.kind === 'buffer') {
    return { ...value, path: points };
  }
  return value;
}

/** Moves one point of a path (an arc, a queue, a belt) or an end of a wall segment to `to`. */
export function movePoint(
  view: DomainView,
  target: EntryRef,
  index: number,
  to: Point,
  options: EditOptions = {},
): DomainView {
  const value = current(view, target);
  const points = value ? pointsOf(value) : null;
  if (!value || !points || index < 0 || index >= points.length) return view;
  const { width, height } = view.meta.canvas;
  const moved: Point = [
    Math.round(clamp(snapValue(to[0], options.snap), 0, width)),
    Math.round(clamp(snapValue(to[1], options.snap), 0, height)),
  ];
  const next = points.slice();
  next[index] = moved;
  // A path without length cannot be drawn (rule V5).
  if (!('kind' in value && value.kind === 'wall') && pathLength(next) <= 0) return view;
  let result = commitGeometry(view, target, withPoints(value, next), options);
  // The arcs that end at the end of a belt follow it.
  const net = options.net;
  if (net && target.section === 'places' && value && 'kind' in value) {
    const last = points.length - 1;
    if (index === 0 || index === last) {
      for (const { key, end } of arcEnds(net, target.key)) {
        const arc = net.arcs.find((a) => arcKey(a.source, a.target) === key);
        if (!arc) continue;
        // An arc into the place ends at the start of the path, an arc out of it leaves its end.
        const atStart = arc.target === target.key;
        if ((index === 0 && atStart) || (index === last && !atStart)) {
          result = moveArcEnd(result, key, end, () => moved, options);
        }
      }
    }
  }
  return result;
}

/** Adds a point to a path after the point `segmentIndex` (default: in the middle of the segment). */
export function insertPoint(
  view: DomainView,
  target: EntryRef,
  segmentIndex: number,
  at?: Point,
  options: EditOptions = {},
): DomainView {
  const value = current(view, target);
  if (!value || ('kind' in value && value.kind === 'wall')) return view;
  const points = pointsOf(value);
  if (!points || segmentIndex < 0 || segmentIndex + 1 >= points.length) return view;
  const a = points[segmentIndex]!;
  const b = points[segmentIndex + 1]!;
  const spot: Point = at ?? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const next = points.slice();
  next.splice(segmentIndex + 1, 0, spot);
  return commitGeometry(view, target, withPoints(value, next), options);
}

/** Removes a point of a path. A path keeps at least two points. */
export function removePoint(
  view: DomainView,
  target: EntryRef,
  index: number,
  options: EditOptions = {},
): DomainView {
  const value = current(view, target);
  if (!value || ('kind' in value && value.kind === 'wall')) return view;
  const points = pointsOf(value);
  if (!points || points.length <= 2 || index < 0 || index >= points.length) return view;
  const next = points.filter((_, i) => i !== index);
  if (pathLength(next) <= 0) return view;
  return commitGeometry(view, target, withPoints(value, next), options);
}

// ---------------------------------------------------------------------------------------------
// Slots

function slotsOf(value: Value): Point[] | null {
  if (!('kind' in value)) return null;
  switch (value.kind) {
    case 'station':
    case 'machine':
    case 'gate':
      return value.slots ?? [];
    case 'area':
    case 'rooms':
      return value.slots;
    default:
      return null;
  }
}

function withSlots(value: Value, slots: Point[]): Value {
  if (!('kind' in value)) return value;
  switch (value.kind) {
    case 'station':
    case 'machine':
    case 'gate': {
      const { slots: _old, ...rest } = value;
      return slots.length > 0 ? { ...rest, slots } : rest;
    }
    case 'area':
    case 'rooms':
      return { ...value, slots };
    default:
      return value;
  }
}

/** Moves a slot (a place for a resource) inside the box of its station. */
export function moveSlot(
  view: DomainView,
  target: EntryRef,
  index: number,
  to: Point,
  options: EditOptions = {},
): DomainView {
  const value = current(view, target);
  const slots = value ? slotsOf(value) : null;
  const box = value ? boxOf(value) : null;
  if (!value || !slots || !box || index < 0 || index >= slots.length) return view;
  const next = slots.slice();
  next[index] = [snapValue(to[0], options.snap), snapValue(to[1], options.snap)];
  return commitGeometry(view, target, withSlots(value, next), options);
}

/** Adds a slot at `at`, or at the first free spot of the box. */
export function addSlot(
  view: DomainView,
  target: EntryRef,
  at?: Point,
  options: EditOptions = {},
): DomainView {
  const value = current(view, target);
  const slots = value ? slotsOf(value) : null;
  const box = value ? boxOf(value) : null;
  if (!value || !slots || !box) return view;
  let spot = at;
  if (!spot) {
    const pitch = 24;
    const [x, y, w, h] = box;
    const free = (p: Point): boolean =>
      slots.every((s) => Math.hypot(s[0] - p[0], s[1] - p[1]) >= 20);
    search: for (let row = 0; y + 12 + row * pitch <= y + h - 8; row += 1) {
      for (let column = 0; x + 12 + column * pitch <= x + w - 8; column += 1) {
        const candidate: Point = [x + 12 + column * pitch, y + 12 + row * pitch];
        if (free(candidate)) {
          spot = candidate;
          break search;
        }
      }
    }
    spot ??= rectCenter(box);
  }
  return commitGeometry(view, target, withSlots(value, [...slots, spot]), options);
}

export function removeSlot(
  view: DomainView,
  target: EntryRef,
  index: number,
  options: EditOptions = {},
): DomainView {
  const value = current(view, target);
  const slots = value ? slotsOf(value) : null;
  if (!value || !slots || index < 0 || index >= slots.length) return view;
  return commitGeometry(
    view,
    target,
    withSlots(
      value,
      slots.filter((_, i) => i !== index),
    ),
    options,
  );
}

// ---------------------------------------------------------------------------------------------
// Labels, fields, hiding

/**
 * Sets the label of an entry (the text of a label piece of decor). An empty text removes the
 * label of places, transitions, rooms and zones, so that the name of the element shows again.
 */
export function setLabel(
  view: DomainView,
  target: EntryRef,
  label: string | undefined,
  options: EditOptions = {},
): DomainView {
  const value = current(view, target);
  if (!value || !('kind' in value)) return view;
  const text = label === undefined || label.trim() === '' ? undefined : label;
  let next: Value;
  switch (value.kind) {
    case 'hidden':
    case 'furniture':
    case 'wall':
      return view;
    case 'label':
      if (text === undefined) return view;
      next = { ...value, text };
      break;
    case 'scale':
      if (text === undefined) return view;
      next = { ...value, label: text };
      break;
    default:
      next = withLabel(value, text);
  }
  return markUser(withEntry(view, target, next), [target], stamp(options));
}

function withLabel(value: Value, text: string | undefined): Value {
  const { label: _old, ...rest } = value as Value & { label?: string };
  return (text === undefined ? rest : { ...rest, label: text }) as Value;
}

/** Sets the sensor name of a transition (`undefined` removes it). */
export function setSensor(
  view: DomainView,
  target: EntryRef,
  sensor: string | undefined,
  options: EditOptions = {},
): DomainView {
  const value = current(view, target);
  if (target.section !== 'transitions' || !value || !('kind' in value)) return view;
  if (value.kind === 'hidden') return view;
  const { sensor: _old, ...rest } = value as TransitionView & { sensor?: string };
  const text = sensor === undefined || sensor.trim() === '' ? undefined : sensor;
  const next = (text === undefined ? rest : { ...rest, sensor: text }) as TransitionView;
  return markUser(withEntry(view, target, next), [target], stamp(options));
}

/** Sets the `pass` flag of a door, dock or waypoint (`undefined` removes it). */
export function setPass(
  view: DomainView,
  target: EntryRef,
  pass: boolean | undefined,
  options: EditOptions = {},
): DomainView {
  const value = current(view, target);
  if (target.section !== 'transitions' || !value || !('kind' in value)) return view;
  if (value.kind !== 'door' && value.kind !== 'dock' && value.kind !== 'waypoint') return view;
  const { pass: _old, ...rest } = value;
  const next: TransitionView = pass === undefined ? rest : { ...rest, pass };
  return markUser(withEntry(view, target, next), [target], stamp(options));
}

/**
 * Hides a place or transition: the entry becomes `hidden` with a reason. The element stays in
 * the net. Arcs that touch it lose their path (nothing is left to connect to).
 */
export function hideEntry(
  view: DomainView,
  net: PetriNet,
  target: EntryRef,
  reason = 'hidden by user',
  options: EditOptions = {},
): DomainView {
  if (target.section !== 'places' && target.section !== 'transitions') return view;
  const value = current(view, target);
  if (!value || ('kind' in value && value.kind === 'hidden')) return view;
  let next = withEntry(view, target, { kind: 'hidden', reason });
  if (next.arcs) {
    const arcs = { ...next.arcs };
    const provenance = { ...next.provenance };
    for (const { key } of arcEnds(net, target.key)) {
      delete arcs[key];
      delete provenance[provenanceKey.arc(key)];
    }
    next = { ...next, arcs, provenance };
  }
  return markUser(next, [target], stamp(options));
}

/** Shows a hidden place or transition again, at the position of the generic view. */
export function showEntry(
  view: DomainView,
  net: PetriNet,
  target: EntryRef,
  options: EditOptions = {},
): DomainView {
  if (target.section !== 'places' && target.section !== 'transitions') return view;
  return resetEntry(
    net,
    view,
    { section: target.section, key: target.key },
    { at: stamp(options) },
  );
}

// ---------------------------------------------------------------------------------------------
// Decor

/** A new piece of decor of the given kind around `at`, snapped and inside the canvas. */
export function newDecor(
  kind: Decor['kind'],
  at: Point,
  canvas: { width: number; height: number },
  snap: number = GRID,
): Decor {
  const place = (w: number, h: number): Rect => {
    const ww = Math.min(w, canvas.width);
    const hh = Math.min(h, canvas.height);
    return [
      clamp(snapValue(at[0] - ww / 2, snap), 0, canvas.width - ww),
      clamp(snapValue(at[1] - hh / 2, snap), 0, canvas.height - hh),
      ww,
      hh,
    ];
  };
  const spot = (): Point => [
    clamp(snapValue(at[0], snap), 0, canvas.width),
    clamp(snapValue(at[1], snap), 0, canvas.height),
  ];
  switch (kind) {
    case 'room':
      return { kind, rect: place(240, 160), label: 'Room' };
    case 'zone':
      return { kind, rect: place(200, 120), label: 'Zone' };
    case 'furniture':
      return { kind, rect: place(64, 32) };
    case 'label':
      return { kind, pos: spot(), text: 'Label' };
    case 'scale': {
      const px = Math.min(100, canvas.width);
      const p = spot();
      return { kind, pos: [Math.min(p[0], canvas.width - px), p[1]], px, label: '10 m' };
    }
    case 'wall': {
      const length = Math.min(160, canvas.width);
      const p = spot();
      const x = Math.min(Math.max(0, p[0] - length / 2), canvas.width - length);
      return { kind, segs: [[x, p[1], x + length, p[1]]] };
    }
  }
}

/** Adds a piece of decor on top of the others. Returns the new view and the index of the piece. */
export function addDecor(view: DomainView, decor: Decor): { view: DomainView; index: number } {
  const list = [...(view.decor ?? []), decor];
  return { view: { ...view, decor: list }, index: list.length - 1 };
}

/** Removes a piece of decor. Decor is the only thing in the view that can really be removed. */
export function removeDecor(view: DomainView, index: number): DomainView {
  const list = view.decor ?? [];
  if (index < 0 || index >= list.length) return view;
  return { ...view, decor: list.filter((_, i) => i !== index) };
}

// ---------------------------------------------------------------------------------------------
// Kinds

/** The middle of an entry: of its box, its position, or half way along its path. */
function centerOf(view: DomainView, value: Value): Point {
  const fallback: Point = [view.meta.canvas.width / 2, view.meta.canvas.height / 2];
  if (!('kind' in value)) return fallback;
  switch (value.kind) {
    case 'queue':
    case 'conveyor':
    case 'buffer': {
      const path = value.path;
      const half = pathLength(path) / 2;
      let walked = 0;
      for (let i = 1; i < path.length; i += 1) {
        const a = path[i - 1]!;
        const b = path[i]!;
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (walked + length >= half && length > 0) {
          const t = (half - walked) / length;
          return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        }
        walked += length;
      }
      return path[0] ?? fallback;
    }
    case 'pool':
    case 'door':
    case 'dock':
    case 'waypoint':
      return value.pos;
    case 'slots': {
      const card = view.transitions[value.of];
      return card && 'box' in card ? rectCenter(card.box) : fallback;
    }
    default: {
      const box = boxOf(value);
      return box ? rectCenter(box) : fallback;
    }
  }
}

function boxAround(
  center: Point,
  w: number,
  h: number,
  canvas: { width: number; height: number },
): Rect {
  const ww = Math.min(w, canvas.width);
  const hh = Math.min(h, canvas.height);
  return roundRect([
    clamp(center[0] - ww / 2, 0, canvas.width - ww),
    clamp(center[1] - hh / 2, 0, canvas.height - hh),
    ww,
    hh,
  ]);
}

function pathAround(center: Point, canvas: { width: number; height: number }): Point[] {
  const length = Math.min(MIN_QUEUE_LENGTH, canvas.width);
  const x = clamp(center[0] - length / 2, 0, canvas.width - length);
  const y = clamp(center[1], 0, canvas.height);
  return [
    [Math.round(x), Math.round(y)],
    [Math.round(x + length), Math.round(y)],
  ];
}

function isPathKind(kind: string): kind is 'queue' | 'conveyor' | 'buffer' {
  return kind === 'queue' || kind === 'conveyor' || kind === 'buffer';
}

function convertPlace(
  view: DomainView,
  net: PetriNet,
  id: Id,
  value: PlaceView,
  kind: Exclude<PlaceView['kind'], 'hidden'>,
): PlaceView {
  const canvas = view.meta.canvas;
  const label = 'label' in value ? value.label : undefined;
  const withLabelText = <T extends PlaceView>(entry: T): PlaceView =>
    label !== undefined ? ({ ...entry, label } as PlaceView) : entry;
  if (isPathKind(kind)) {
    if ('path' in value) return withLabelText({ kind, path: value.path });
    return withLabelText({ kind, path: pathAround(centerOf(view, value), canvas) });
  }
  const center = centerOf(view, value);
  switch (kind) {
    case 'pool':
      return withLabelText({ kind, pos: roundPoint(center) });
    case 'source':
    case 'sink':
      return withLabelText({ kind, box: boxAround(center, 72, 40, canvas) });
    case 'slots': {
      const of = loopTransitions(net, id)[0] ?? '';
      return withLabelText({ kind, of });
    }
  }
}

function convertTransition(
  view: DomainView,
  value: TransitionView,
  kind: Exclude<TransitionView['kind'], 'hidden'>,
): TransitionView {
  if (value.kind === 'hidden') return value;
  const canvas = view.meta.canvas;
  const label = value.label;
  const sensor = value.sensor;
  const common = {
    ...(label !== undefined && { label }),
    ...(sensor !== undefined && { sensor }),
  };
  const box = boxOf(value);
  const slots = slotsOf(value);
  const center = centerOf(view, value);
  switch (kind) {
    case 'station':
    case 'machine':
    case 'gate':
      return {
        kind,
        box: box ?? boxAround(center, 56, 56, canvas),
        ...(slots !== null && slots.length > 0 && { slots }),
        ...common,
      };
    case 'area':
    case 'rooms': {
      const rooms = value.kind === 'rooms' && kind === 'rooms' ? value.rooms : undefined;
      return {
        kind,
        box: box ?? boxAround(center, 96, 72, canvas),
        slots: slots ?? [],
        ...(rooms !== undefined && { rooms }),
        ...common,
      };
    }
    case 'door':
    case 'dock':
    case 'waypoint': {
      const pass = 'pass' in value ? value.pass : undefined;
      return {
        kind,
        pos: roundPoint(center),
        ...(pass !== undefined && { pass }),
        ...common,
      };
    }
  }
}

/**
 * Changes the kind of an entry, converting the geometry: a box becomes a point at its center, a
 * point becomes a box around it, a path becomes a pool at its middle. Only kinds that rule V4
 * allows for the role of the element are accepted; for others the view is returned unchanged. A
 * hidden element is shown first (generic position).
 */
export function setEntryKind(
  view: DomainView,
  net: PetriNet,
  target: EntryRef,
  kind: string,
  options: EditOptions = {},
): DomainView {
  if (target.section === 'places') {
    const allowed = allowedPlaceKinds(net, target.key);
    const wanted = allowed.find((k) => k === kind);
    const value = view.places[target.key];
    if (!wanted || !value) return view;
    if (value.kind === wanted) return view;
    let base = view;
    if (value.kind === 'hidden') base = showEntry(view, net, target, options);
    const shown = base.places[target.key];
    if (!shown || shown.kind === 'hidden') return view;
    if (shown.kind === wanted) return markUser(base, [target], stamp(options));
    return commitGeometry(
      base,
      target,
      convertPlace(base, net, target.key, shown, wanted),
      options,
    );
  }
  if (target.section === 'transitions') {
    const allowed = allowedTransitionKinds(net, target.key);
    const wanted = allowed.find((k) => k === kind);
    const value = view.transitions[target.key];
    if (!wanted || !value) return view;
    if (value.kind === wanted) return view;
    let base = view;
    if (value.kind === 'hidden') base = showEntry(view, net, target, options);
    const shown = base.transitions[target.key];
    if (!shown || shown.kind === 'hidden') return view;
    if (shown.kind === wanted) return markUser(base, [target], stamp(options));
    return commitGeometry(base, target, convertTransition(base, shown, wanted), options);
  }
  return view;
}

/** The kinds the entry can be switched to (the current one included), for the lists in the UI. */
export function kindChoices(net: PetriNet, target: EntryRef): string[] {
  if (target.section === 'places') return allowedPlaceKinds(net, target.key);
  if (target.section === 'transitions') return allowedTransitionKinds(net, target.key);
  return [];
}
