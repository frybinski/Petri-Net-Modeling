import type { Id, PetriNet } from '@pnm/core';
import { distance, distanceToPath, distanceToSegment, pointInRect, rectCenter } from './geometry';
import { genericEntries } from './generic';
import { estimateTextWidth } from './scene';
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

/** The part of a view that an entry lives in. `decor` entries are addressed by their index. */
export type EntrySection = 'places' | 'transitions' | 'arcs' | 'decor';

/** One entry of a view: a place, a transition, an arc path or a piece of decor. */
export interface EntryRef {
  section: EntrySection;
  /** The id of the place or transition, the arc key `source>target`, or the index in `decor`. */
  key: string;
}

export type HandleKind =
  | 'move'
  | 'resize-nw'
  | 'resize-ne'
  | 'resize-sw'
  | 'resize-se'
  | 'resize-n'
  | 'resize-s'
  | 'resize-e'
  | 'resize-w'
  | 'point'
  | 'segment'
  | 'slot'
  | 'pos';

/** What a handle belongs to when it is not the main geometry of the entry. */
export type HandlePart = 'room' | 'wall';

export interface Handle {
  /** Unique within the handles of one entry. */
  id: string;
  kind: HandleKind;
  target: EntryRef;
  /**
   * Point: index of the point (for a wall `2 * segment + end`). Segment: index of the point that
   * starts the segment. Slot: index of the slot. Room handles: index of the room.
   */
  index?: number;
  part?: HandlePart;
  /** Where the handle is, in sheet pixels. For `move` handles: the center of the surface. */
  at: Point;
  /** The surface of a `move` handle; the whole area counts as the handle. */
  area?: Rect;
  /** CSS cursor while the pointer is over the handle. */
  cursor: string;
}

export function ref(section: EntrySection, key: string | number): EntryRef {
  return { section, key: String(key) };
}

export function sameRef(a: EntryRef | null | undefined, b: EntryRef | null | undefined): boolean {
  return a != null && b != null && a.section === b.section && a.key === b.key;
}

/** The key of the provenance record of an entry, or `null` for decor (it has none). */
export function provenanceKeyOf(entry: EntryRef): string | null {
  switch (entry.section) {
    case 'places':
      return provenanceKey.place(entry.key);
    case 'transitions':
      return provenanceKey.transition(entry.key);
    case 'arcs':
      return provenanceKey.arc(entry.key);
    case 'decor':
      return null;
  }
}

/** The entry a reference points at, or `undefined`. */
export function entryOf(
  view: DomainView,
  entry: EntryRef,
): PlaceView | TransitionView | { path: Point[] } | Decor | undefined {
  switch (entry.section) {
    case 'places':
      return view.places[entry.key];
    case 'transitions':
      return view.transitions[entry.key];
    case 'arcs':
      return view.arcs?.[entry.key];
    case 'decor':
      return view.decor?.[Number(entry.key)];
  }
}

/** The entry that edits of a selected element of the net apply to. */
export function refOfElement(net: PetriNet, view: DomainView, id: Id): EntryRef | null {
  const place = view.places[id];
  if (place) {
    // The cells of a resource sit on the card of their transition; that card is what moves.
    if (place.kind === 'slots') {
      return view.transitions[place.of] ? ref('transitions', place.of) : null;
    }
    return ref('places', id);
  }
  if (view.transitions[id]) return ref('transitions', id);
  const arc = net.arcs.find((a) => a.id === id);
  if (arc) {
    const key = arcKey(arc.source, arc.target);
    if (view.arcs?.[key]) return ref('arcs', key);
  }
  return null;
}

/** The id of the net element an entry stands for (an arc: the id of the arc). */
export function elementOfRef(net: PetriNet, entry: EntryRef): Id | null {
  switch (entry.section) {
    case 'places':
      return net.places.some((p) => p.id === entry.key) ? entry.key : null;
    case 'transitions':
      return net.transitions.some((t) => t.id === entry.key) ? entry.key : null;
    case 'arcs':
      return net.arcs.find((a) => arcKey(a.source, a.target) === entry.key)?.id ?? null;
    case 'decor':
      return null;
  }
}

const RESIZE_CURSOR: Record<string, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

const CORNERS = ['nw', 'ne', 'sw', 'se'] as const;
const EDGES = ['n', 's', 'e', 'w'] as const;

/** The position of a resize handle on a rectangle. */
export function resizeAnchor(rect: Rect, side: string): Point {
  const [x, y, w, h] = rect;
  const left = x;
  const right = x + w;
  const top = y;
  const bottom = y + h;
  const midX = x + w / 2;
  const midY = y + h / 2;
  switch (side) {
    case 'nw':
      return [left, top];
    case 'ne':
      return [right, top];
    case 'sw':
      return [left, bottom];
    case 'se':
      return [right, bottom];
    case 'n':
      return [midX, top];
    case 's':
      return [midX, bottom];
    case 'e':
      return [right, midY];
    default:
      return [left, midY];
  }
}

function boxHandles(
  target: EntryRef,
  rect: Rect,
  options: { part?: HandlePart; index?: number; corners?: boolean } = {},
): Handle[] {
  const { part, index } = options;
  const suffix = part === undefined ? '' : `:${part}${index ?? 0}`;
  const extra = { ...(part !== undefined && { part }), ...(index !== undefined && { index }) };
  const sides: string[] = options.corners === true ? [...CORNERS] : [...CORNERS, ...EDGES];
  return [
    {
      id: `${target.section}.${target.key}${suffix}:move`,
      kind: 'move',
      target,
      ...extra,
      at: rectCenter(rect),
      area: rect,
      cursor: 'move',
    },
    ...sides.map((side): Handle => ({
      id: `${target.section}.${target.key}${suffix}:resize-${side}`,
      kind: `resize-${side}` as HandleKind,
      target,
      ...extra,
      at: resizeAnchor(rect, side),
      cursor: RESIZE_CURSOR[side] ?? 'default',
    })),
  ];
}

function pathHandles(target: EntryRef, path: readonly Point[]): Handle[] {
  const handles: Handle[] = [];
  for (let i = 0; i + 1 < path.length; i += 1) {
    const a = path[i]!;
    const b = path[i + 1]!;
    handles.push({
      id: `${target.section}.${target.key}:segment${i}`,
      kind: 'segment',
      target,
      index: i,
      at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      cursor: 'copy',
    });
  }
  path.forEach((point, i) => {
    handles.push({
      id: `${target.section}.${target.key}:point${i}`,
      kind: 'point',
      target,
      index: i,
      at: point,
      cursor: 'crosshair',
    });
  });
  return handles;
}

function slotHandles(target: EntryRef, slots: readonly Point[]): Handle[] {
  return slots.map((slot, i) => ({
    id: `${target.section}.${target.key}:slot${i}`,
    kind: 'slot' as const,
    target,
    index: i,
    at: slot,
    cursor: 'move',
  }));
}

function posHandle(target: EntryRef, pos: Point): Handle {
  return {
    id: `${target.section}.${target.key}:pos`,
    kind: 'pos',
    target,
    at: pos,
    cursor: 'move',
  };
}

/**
 * The handles of one entry, in the order in which they are drawn (the topmost last): surfaces
 * first, then corner and edge handles, segment middles, points and slots.
 */
export function handlesFor(view: DomainView, entry: EntryRef): Handle[] {
  const found = entryOf(view, entry);
  if (!found) return [];
  if (entry.section === 'arcs') return pathHandles(entry, (found as { path: Point[] }).path);
  if (entry.section === 'decor') return decorHandles(entry, found as Decor);
  const item = found as PlaceView | TransitionView;
  switch (item.kind) {
    case 'queue':
    case 'conveyor':
    case 'buffer':
      return pathHandles(entry, item.path);
    case 'pool':
      return [posHandle(entry, item.pos)];
    case 'source':
    case 'sink':
      return boxHandles(entry, item.box);
    case 'slots':
    case 'hidden':
      return [];
    case 'station':
    case 'machine':
    case 'gate':
      return [...boxHandles(entry, item.box), ...slotHandles(entry, item.slots ?? [])];
    case 'area':
    case 'rooms': {
      const rooms: Handle[] = [];
      if (item.kind === 'rooms') {
        (item.rooms ?? []).forEach((room, i) => {
          rooms.push(...boxHandles(entry, room, { part: 'room', index: i, corners: true }));
        });
      }
      // Rooms lie on top of the box: their surfaces come after the one of the box.
      const box = boxHandles(entry, item.box);
      const surface = box.filter((h) => h.kind === 'move');
      const rest = box.filter((h) => h.kind !== 'move');
      return [...surface, ...rooms, ...rest, ...slotHandles(entry, item.slots)];
    }
    case 'door':
    case 'dock':
    case 'waypoint':
      return [posHandle(entry, item.pos)];
  }
}

function decorHandles(entry: EntryRef, decor: Decor): Handle[] {
  switch (decor.kind) {
    case 'room':
    case 'zone':
    case 'furniture':
      return boxHandles(entry, decor.rect);
    case 'label':
      return [posHandle(entry, decor.pos)];
    case 'scale':
      return [
        posHandle(entry, decor.pos),
        {
          id: `${entry.section}.${entry.key}:resize-e`,
          kind: 'resize-e',
          target: entry,
          at: [decor.pos[0] + decor.px, decor.pos[1]],
          cursor: 'ew-resize',
        },
      ];
    case 'wall': {
      const handles: Handle[] = [];
      decor.segs.forEach((seg, i) => {
        handles.push(
          {
            id: `${entry.section}.${entry.key}:wall${2 * i}`,
            kind: 'point',
            target: entry,
            part: 'wall',
            index: 2 * i,
            at: [seg[0], seg[1]],
            cursor: 'crosshair',
          },
          {
            id: `${entry.section}.${entry.key}:wall${2 * i + 1}`,
            kind: 'point',
            target: entry,
            part: 'wall',
            index: 2 * i + 1,
            at: [seg[2], seg[3]],
            cursor: 'crosshair',
          },
        );
      });
      return handles;
    }
  }
}

/**
 * The handle under a point of the sheet, or `null`. Points, slots and resize handles win over
 * segment middles, which win over surfaces; of several surfaces the smallest wins. `tolerance` is
 * the reach of a handle in sheet pixels (it depends on the zoom).
 */
export function hitHandle(handles: readonly Handle[], p: Point, tolerance: number): Handle | null {
  let best: Handle | null = null;
  let bestScore = Infinity;
  for (const handle of handles) {
    if (handle.kind === 'move') continue;
    const d = distance(p, handle.at);
    if (d > tolerance) continue;
    // Points and slots beat segment middles that lie close by.
    const score = d + (handle.kind === 'segment' ? tolerance : 0);
    if (score < bestScore) {
      best = handle;
      bestScore = score;
    }
  }
  if (best) return best;
  let smallest = Infinity;
  for (const handle of handles) {
    if (handle.kind !== 'move' || !handle.area) continue;
    if (!pointInRect(p, handle.area)) continue;
    const size = handle.area[2] * handle.area[3];
    if (size <= smallest) {
      best = handle;
      smallest = size;
    }
  }
  return best;
}

/** Height of the text of a `label` piece of decor, for hit tests. */
const LABEL_SIZE = 14;

/** The screen-independent bounds of a text decor: where its text is. */
export function labelBounds(decor: Extract<Decor, { kind: 'label' }>): Rect {
  const width = estimateTextWidth(decor.text, LABEL_SIZE, 600);
  return [decor.pos[0], decor.pos[1] - LABEL_SIZE, width, LABEL_SIZE * 1.4];
}

/** The bounds of one entry in sheet pixels (all of its geometry), or `null` without geometry. */
export function entryBounds(view: DomainView, entry: EntryRef): Rect | null {
  const found = entryOf(view, entry);
  if (!found) return null;
  const points: Point[] = [];
  const rects: Rect[] = [];
  if (entry.section === 'arcs') points.push(...(found as { path: Point[] }).path);
  else if (entry.section === 'decor') {
    const decor = found as Decor;
    switch (decor.kind) {
      case 'room':
      case 'zone':
      case 'furniture':
        rects.push(decor.rect);
        break;
      case 'label':
        rects.push(labelBounds(decor));
        break;
      case 'scale':
        points.push(decor.pos, [decor.pos[0] + decor.px, decor.pos[1]]);
        break;
      case 'wall':
        for (const seg of decor.segs) points.push([seg[0], seg[1]], [seg[2], seg[3]]);
        break;
    }
  } else {
    const item = found as PlaceView | TransitionView;
    switch (item.kind) {
      case 'queue':
      case 'conveyor':
      case 'buffer':
        points.push(...item.path);
        break;
      case 'pool':
      case 'door':
      case 'dock':
      case 'waypoint':
        points.push(item.pos);
        break;
      case 'source':
      case 'sink':
        rects.push(item.box);
        break;
      case 'station':
      case 'machine':
      case 'gate':
        rects.push(item.box);
        points.push(...(item.slots ?? []));
        break;
      case 'area':
      case 'rooms':
        rects.push(item.box, ...(item.rooms ?? []));
        points.push(...item.slots);
        break;
      case 'slots':
      case 'hidden':
        return null;
    }
  }
  if (points.length === 0 && rects.length === 0) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const [x, y] of points) {
    x1 = Math.min(x1, x);
    y1 = Math.min(y1, y);
    x2 = Math.max(x2, x);
    y2 = Math.max(y2, y);
  }
  for (const [x, y, w, h] of rects) {
    x1 = Math.min(x1, x);
    y1 = Math.min(y1, y);
    x2 = Math.max(x2, x + w);
    y2 = Math.max(y2, y + h);
  }
  return [x1, y1, x2 - x1, y2 - y1];
}

/**
 * The piece of decor under a point (the one drawn on top wins, small pieces beat large ones that
 * contain them), or `null`. Decor has no regions in the scene, so edits find it here.
 */
export function decorAt(view: DomainView, p: Point, slack = 0): number | null {
  const decor = view.decor ?? [];
  let best: number | null = null;
  let bestSize = Infinity;
  decor.forEach((item, index) => {
    let size: number | null = null;
    switch (item.kind) {
      case 'room':
      case 'zone':
      case 'furniture':
        if (pointInRect(p, item.rect, slack)) size = item.rect[2] * item.rect[3];
        break;
      case 'label':
        if (pointInRect(p, labelBounds(item), slack)) size = 1;
        break;
      case 'scale':
        if (distanceToSegment(p, item.pos, [item.pos[0] + item.px, item.pos[1]]) <= 6 + slack) {
          size = 1;
        }
        break;
      case 'wall': {
        const reach = (item.width ?? 4) / 2 + slack;
        if (
          item.segs.some(
            (s) =>
              distanceToPath(p, [
                [s[0], s[1]],
                [s[2], s[3]],
              ]) <= reach,
          )
        ) {
          size = 1;
        }
        break;
      }
    }
    // Later pieces are drawn later, so they win a tie.
    if (size !== null && size <= bestSize) {
      best = index;
      bestSize = size;
    }
  });
  return best;
}

/** An element that the view hides, shown as a dashed outline where a generic view would put it. */
export interface Placeholder {
  entry: EntryRef;
  elementId: Id;
  name: string;
  rect: Rect;
}

/** Size of the outline of a hidden element that has no area (a point). */
const PLACEHOLDER_SIZE = 40;

/**
 * Placeholders for the places and transitions that the view hides, at the position that the
 * generic view gives them. They let the user find hidden elements and show them again.
 */
export function hiddenPlaceholders(net: PetriNet, view: DomainView): Placeholder[] {
  const out: Placeholder[] = [];
  const hiddenPlaces = net.places.filter((p) => view.places[p.id]?.kind === 'hidden');
  const hiddenTransitions = net.transitions.filter(
    (t) => view.transitions[t.id]?.kind === 'hidden',
  );
  if (hiddenPlaces.length === 0 && hiddenTransitions.length === 0) return out;
  const generic = genericEntries(net, view.meta.canvas);
  const around = (p: Point): Rect => [
    p[0] - PLACEHOLDER_SIZE / 2,
    p[1] - PLACEHOLDER_SIZE / 2,
    PLACEHOLDER_SIZE,
    PLACEHOLDER_SIZE,
  ];
  for (const place of hiddenPlaces) {
    const entry = generic.places[place.id];
    if (!entry) continue;
    let rect: Rect | null = null;
    switch (entry.kind) {
      case 'queue':
      case 'conveyor':
      case 'buffer': {
        const xs = entry.path.map((q) => q[0]);
        const ys = entry.path.map((q) => q[1]);
        const x1 = Math.min(...xs);
        const y1 = Math.min(...ys);
        rect = [x1 - 12, y1 - 12, Math.max(...xs) - x1 + 24, Math.max(...ys) - y1 + 24];
        break;
      }
      case 'pool':
        rect = around(entry.pos);
        break;
      case 'source':
      case 'sink':
        rect = entry.box;
        break;
      case 'slots': {
        const card = generic.transitions[entry.of];
        rect = card && 'box' in card ? card.box : null;
        break;
      }
      case 'hidden':
        break;
    }
    if (rect) {
      out.push({ entry: ref('places', place.id), elementId: place.id, name: place.name, rect });
    }
  }
  for (const transition of hiddenTransitions) {
    const entry = generic.transitions[transition.id];
    if (!entry || entry.kind === 'hidden') continue;
    const rect = 'box' in entry ? entry.box : around(entry.pos);
    out.push({
      entry: ref('transitions', transition.id),
      elementId: transition.id,
      name: transition.name,
      rect,
    });
  }
  return out;
}

/** The placeholder under a point, if any (the smallest wins). */
export function placeholderAt(
  placeholders: readonly Placeholder[],
  p: Point,
  slack = 0,
): Placeholder | null {
  let best: Placeholder | null = null;
  let bestSize = Infinity;
  for (const placeholder of placeholders) {
    if (!pointInRect(p, placeholder.rect, slack)) continue;
    const size = placeholder.rect[2] * placeholder.rect[3];
    if (size <= bestSize) {
      best = placeholder;
      bestSize = size;
    }
  }
  return best;
}
