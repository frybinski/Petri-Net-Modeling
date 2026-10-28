import {
  isSourceTransition,
  placeRoles,
  type Id,
  type PetriNet,
  type PlaceRole,
  type Position,
} from '@pnm/core';
import { layoutNet } from '@pnm/layout';
import { distance, lerp, MIN_QUEUE_LENGTH, pathLength, rectCenter } from './geometry';
import { netHash } from './hash';
import {
  arcKey,
  domainViewSchema,
  provenanceKey,
  type Decor,
  type DomainMeta,
  type DomainView,
  type PlaceView,
  type Point,
  type Provenance,
  type Rect,
  type Sprite,
  type TransitionView,
} from './schema';
import { validateDomainView } from './validate';

export interface GenericOptions {
  canvas?: { width: number; height: number };
  theme?: string;
  /** Timestamp for the provenance entries. Default: now. */
  at?: string;
}

export const DEFAULT_CANVAS = { width: 1200, height: 700 };

/** Space between the nodes of the net and the border of the canvas. */
const MARGIN = 80;
const STATION_SIZE = 56;
const SINK_SIZE: [number, number] = [56, 40];
const SLOT_PITCH = 24;
const MAX_SLOTS = 36;
/** How far a path runs when it has no neighbour to lead to. */
const OPEN_END = 80;
const MAX_SCALE = 2.5;

type Pt = Point;

function sub(a: Pt, b: Pt): Pt {
  return [a[0] - b[0], a[1] - b[1]];
}
function add(a: Pt, b: Pt, factor = 1): Pt {
  return [a[0] + b[0] * factor, a[1] + b[1] * factor];
}
function unit(v: Pt, fallback: Pt = [1, 0]): Pt {
  const length = Math.hypot(v[0], v[1]);
  return length < 1e-9 ? fallback : [v[0] / length, v[1] / length];
}
function mean(points: Pt[]): Pt | null {
  if (points.length === 0) return null;
  return [
    points.reduce((s, p) => s + p[0], 0) / points.length,
    points.reduce((s, p) => s + p[1], 0) / points.length,
  ];
}
function round(n: number): number {
  return Math.round(n * 10) / 10;
}
function roundPoint(p: Pt): Pt {
  return [round(p[0]), round(p[1])];
}

/** Moves (and if necessary shrinks) a rectangle into the canvas. */
function fitRect(rect: Rect, width: number, height: number): Rect {
  const w = Math.max(1, Math.min(rect[2], width));
  const h = Math.max(1, Math.min(rect[3], height));
  const x = Math.min(Math.max(rect[0], 0), width - w);
  const y = Math.min(Math.max(rect[1], 0), height - h);
  return [round(x), round(y), round(w), round(h)];
}

function clampPoint(p: Pt, width: number, height: number): Pt {
  return [round(Math.min(Math.max(p[0], 0), width)), round(Math.min(Math.max(p[1], 0), height))];
}

/** A point on the border of `rect`, in the direction of `toward` as seen from the center. */
export function edgePoint(rect: Rect, toward: Pt): Pt {
  const c = rectCenter(rect);
  const d = sub(toward, c);
  if (Math.abs(d[0]) < 1e-9 && Math.abs(d[1]) < 1e-9) return c;
  const sx = d[0] === 0 ? Infinity : rect[2] / 2 / Math.abs(d[0]);
  const sy = d[1] === 0 ? Infinity : rect[3] / 2 / Math.abs(d[1]);
  const s = Math.min(sx, sy);
  return [c[0] + d[0] * s, c[1] + d[1] * s];
}

/**
 * Positions of all nodes scaled into the canvas. The aspect ratio is kept and the net is
 * centered; nodes without a usable position are placed on a grid in the order of the net.
 */
function scaledPositions(
  net: PetriNet,
  width: number,
  height: number,
): { places: Map<Id, Pt>; transitions: Map<Id, Pt> } {
  const raw = new Map<Id, Pt>();
  let missing = 0;
  const nodes = [...net.places, ...net.transitions];
  for (const node of nodes) {
    // `position` is required by the model; documents from other sources may lack it.
    const position = node.position as Position | undefined;
    if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
      raw.set(node.id, [position.x, position.y]);
    } else {
      missing += 1;
    }
  }
  if (missing > 0) {
    const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
    nodes.forEach((node, index) => {
      raw.set(node.id, [(index % columns) * 160, Math.floor(index / columns) * 160]);
    });
  }
  const values = [...raw.values()];
  const minX = Math.min(...values.map((p) => p[0]));
  const maxX = Math.max(...values.map((p) => p[0]));
  const minY = Math.min(...values.map((p) => p[1]));
  const maxY = Math.max(...values.map((p) => p[1]));
  const boxW = maxX - minX;
  const boxH = maxY - minY;
  const availW = Math.max(1, width - 2 * MARGIN);
  const availH = Math.max(1, height - 2 * MARGIN);
  let scale = MAX_SCALE;
  if (boxW > 0) scale = Math.min(scale, availW / boxW);
  if (boxH > 0) scale = Math.min(scale, availH / boxH);
  if (values.length === 0) scale = 1;
  const offsetX = width / 2 - ((minX + maxX) / 2) * scale;
  const offsetY = height / 2 - ((minY + maxY) / 2) * scale;
  const place = (id: Id): Pt => {
    const p = raw.get(id) ?? [0, 0];
    return clampPoint([p[0] * scale + offsetX, p[1] * scale + offsetY], width, height);
  };
  return {
    places: new Map(net.places.map((p) => [p.id, place(p.id)])),
    transitions: new Map(net.transitions.map((t) => [t.id, place(t.id)])),
  };
}

/** A path of at least `MIN_QUEUE_LENGTH` pixels: the ends are pulled apart where needed. */
function lengthen(path: Pt[], fallbackIn: Pt, fallbackOut: Pt): Pt[] {
  const length = pathLength(path);
  // A little slack, so that rounding the coordinates cannot bring it below the minimum.
  const wanted = MIN_QUEUE_LENGTH + 4;
  if (length >= wanted || path.length < 2) return path;
  const deficit = wanted - length;
  const first = path[0]!;
  const second = path[1]!;
  const last = path[path.length - 1]!;
  const beforeLast = path[path.length - 2]!;
  const back = unit(sub(first, second), fallbackIn);
  const forward = unit(sub(last, beforeLast), fallbackOut);
  const out = path.slice();
  out[0] = add(first, back, deficit / 2);
  out[out.length - 1] = add(last, forward, deficit / 2);
  return out;
}

/** Brings every point of a path into the canvas and makes sure it has a length. */
function finishPath(path: Pt[], width: number, height: number): Point[] {
  const clamped = path.map((p) => clampPoint(p, width, height));
  const start = clamped[0] ?? [0, 0];
  if (clamped.length < 2 || pathLength(clamped) <= 0) {
    const toRight = start[0] + 40 <= width;
    return [start, [toRight ? start[0] + 40 : start[0] - 40, start[1]]];
  }
  return clamped;
}

function slotGrid(count: number, center: Pt): { box: Rect; slots: Point[] } {
  const n = Math.max(1, Math.min(count, MAX_SLOTS));
  const columns = n <= 1 ? 1 : Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / columns);
  const width = Math.max(STATION_SIZE, columns * SLOT_PITCH + 24);
  const height = Math.max(STATION_SIZE, rows * SLOT_PITCH + 24);
  const box: Rect = [center[0] - width / 2, center[1] - height / 2, width, height];
  const slots: Point[] = [];
  for (let i = 0; i < n; i += 1) {
    const column = i % columns;
    const row = Math.floor(i / columns);
    // The last row may be shorter: center it.
    const inRow = row === rows - 1 ? n - row * columns : columns;
    const x = center[0] + (column - (inRow - 1) / 2) * SLOT_PITCH;
    const y = center[1] + (row - (rows - 1) / 2) * SLOT_PITCH;
    slots.push([x, y]);
  }
  return { box, slots };
}

function entityFor(net: PetriNet): { singular: string; plural: string; sprite: Sprite } {
  const prefix = net.simulation?.caseIdPrefix ?? '';
  if (prefix.startsWith('P-')) return { singular: 'Parcel', plural: 'Parcels', sprite: 'parcel' };
  if (prefix.startsWith('M-')) return { singular: 'Person', plural: 'People', sprite: 'person' };
  return { singular: 'Case', plural: 'Cases', sprite: 'dot' };
}

/** The anchor of an element for an arc, at its border toward the other end. */
interface Anchors {
  place(id: Id, role: 'start' | 'end', toward: Pt): Pt | null;
  transition(id: Id, toward: Pt): Pt | null;
}

function anchorsOf(
  places: Record<Id, PlaceView>,
  transitions: Record<Id, TransitionView>,
): Anchors {
  return {
    place(id, role, toward) {
      const view = places[id];
      if (!view) return null;
      switch (view.kind) {
        case 'queue':
        case 'conveyor':
        case 'buffer': {
          const path = view.path;
          return role === 'end' ? (path[path.length - 1] ?? null) : (path[0] ?? null);
        }
        case 'source':
        case 'sink':
          return edgePoint(view.box, toward);
        case 'pool':
          return view.pos;
        case 'slots':
        case 'hidden':
          return null;
      }
    },
    transition(id, toward) {
      const view = transitions[id];
      if (!view) return null;
      switch (view.kind) {
        case 'station':
        case 'machine':
        case 'gate':
        case 'area':
        case 'rooms':
          return edgePoint(view.box, toward);
        case 'door':
        case 'dock':
        case 'waypoint':
          return view.pos;
        case 'hidden':
          return null;
      }
    },
  };
}

function centerOfPlace(view: PlaceView | undefined): Pt | null {
  if (!view) return null;
  switch (view.kind) {
    case 'queue':
    case 'conveyor':
    case 'buffer':
      return view.path[Math.floor(view.path.length / 2)] ?? null;
    case 'source':
    case 'sink':
      return rectCenter(view.box);
    case 'pool':
      return view.pos;
    default:
      return null;
  }
}

function centerOfTransition(view: TransitionView | undefined): Pt | null {
  if (!view) return null;
  switch (view.kind) {
    case 'station':
    case 'machine':
    case 'gate':
    case 'area':
    case 'rooms':
      return rectCenter(view.box);
    case 'door':
    case 'dock':
    case 'waypoint':
      return view.pos;
    case 'hidden':
      return null;
  }
}

/**
 * Paths for arcs from the entries of places and transitions: from the border (or path end) of
 * one element to the border (or path start) of the other. Arcs of resource slots (they sit inside
 * their transition) and of hidden elements get no path.
 */
function arcPaths(
  net: PetriNet,
  places: Record<Id, PlaceView>,
  transitions: Record<Id, TransitionView>,
  only: (arcId: Id, source: Id, target: Id) => boolean,
  width: number,
  height: number,
): Record<string, { path: Point[] }> {
  const anchors = anchorsOf(places, transitions);
  const placeIds = new Set(net.places.map((p) => p.id));
  const out: Record<string, { path: Point[] }> = {};
  for (const arc of net.arcs) {
    if (!only(arc.id, arc.source, arc.target)) continue;
    const fromPlace = placeIds.has(arc.source);
    const placeId = fromPlace ? arc.source : arc.target;
    const transitionId = fromPlace ? arc.target : arc.source;
    if (!placeIds.has(placeId)) continue;
    const placeCenter = centerOfPlace(places[placeId]);
    const transitionCenter = centerOfTransition(transitions[transitionId]);
    if (!placeCenter || !transitionCenter) continue;
    const placeEnd = anchors.place(placeId, fromPlace ? 'end' : 'start', transitionCenter);
    const transitionEnd = anchors.transition(transitionId, placeCenter);
    if (!placeEnd || !transitionEnd) continue;
    const from = fromPlace ? placeEnd : transitionEnd;
    const to = fromPlace ? transitionEnd : placeEnd;
    if (distance(from, to) < 1) continue;
    out[arcKey(arc.source, arc.target)] = {
      path: [clampPoint(from, width, height), clampPoint(to, width, height)],
    };
  }
  return out;
}

interface GenericParts {
  places: Record<Id, PlaceView>;
  transitions: Record<Id, TransitionView>;
}

function genericParts(net: PetriNet, width: number, height: number): GenericParts {
  const positions = scaledPositions(net, width, height);
  const roles = placeRoles(net);
  const placeIds = new Set(net.places.map((p) => p.id));
  const posOfTransition = (id: Id): Pt => positions.transitions.get(id) ?? [width / 2, height / 2];

  // Which transitions a place is in front of and behind.
  const pre = new Map<Id, Id[]>();
  const post = new Map<Id, Id[]>();
  for (const place of net.places) {
    pre.set(place.id, []);
    post.set(place.id, []);
  }
  for (const arc of net.arcs) {
    if (placeIds.has(arc.target) && !placeIds.has(arc.source)) {
      const list = pre.get(arc.target)!;
      if (!list.includes(arc.source)) list.push(arc.source);
    }
    if (placeIds.has(arc.source) && !placeIds.has(arc.target)) {
      const list = post.get(arc.source)!;
      if (!list.includes(arc.target)) list.push(arc.target);
    }
  }

  // Resources: the first one that loops with a transition becomes its slots, others are pools.
  const slotsOf = new Map<Id, Id>(); // place id -> transition id
  const claimed = new Map<Id, Id>(); // transition id -> place id
  for (const place of net.places) {
    if (roles.get(place.id) !== 'resource') continue;
    const loop = (post.get(place.id) ?? []).find((t) => (pre.get(place.id) ?? []).includes(t));
    if (loop !== undefined && !claimed.has(loop)) {
      slotsOf.set(place.id, loop);
      claimed.set(loop, place.id);
    }
  }

  const transitions: Record<Id, TransitionView> = {};
  for (const transition of net.transitions) {
    const center = posOfTransition(transition.id);
    if (isSourceTransition(net, transition.id)) {
      transitions[transition.id] = {
        kind: 'door',
        pos: roundPoint(center),
        label: transition.name,
      };
      continue;
    }
    const resource = claimed.get(transition.id);
    const count = resource === undefined ? 1 : Math.max(1, net.marking[resource]?.length ?? 0);
    const grid = slotGrid(count, center);
    const box = fitRect(grid.box, width, height);
    const dx = box[0] - grid.box[0];
    const dy = box[1] - grid.box[1];
    transitions[transition.id] = {
      kind: 'station',
      box,
      slots: grid.slots.map((s) => roundPoint([s[0] + dx, s[1] + dy])),
      label: transition.name,
    };
  }

  const places: Record<Id, PlaceView> = {};
  for (const place of net.places) {
    const role: PlaceRole = roles.get(place.id) ?? 'case';
    const center = positions.places.get(place.id) ?? [width / 2, height / 2];
    const before = (pre.get(place.id) ?? []).map(posOfTransition);
    const after = (post.get(place.id) ?? []).map(posOfTransition);
    const label = place.name;

    if (role === 'resource') {
      const of = slotsOf.get(place.id);
      places[place.id] =
        of !== undefined
          ? { kind: 'slots', of, label }
          : { kind: 'pool', pos: roundPoint(center), label };
      continue;
    }
    if (role === 'sink') {
      places[place.id] = {
        kind: 'sink',
        box: fitRect(
          [center[0] - SINK_SIZE[0] / 2, center[1] - SINK_SIZE[1] / 2, SINK_SIZE[0], SINK_SIZE[1]],
          width,
          height,
        ),
        label,
      };
      continue;
    }
    if (role === 'source') {
      const target = after[0];
      let end: Pt;
      if (target) {
        const direction = unit(sub(target, center));
        const reach = Math.max(0, distance(center, target) - 44);
        end = add(center, direction, reach);
      } else {
        end = add(center, [1, 0], OPEN_END * 2);
      }
      const path = lengthen([center, end], [-1, 0], [1, 0]);
      places[place.id] = { kind: 'queue', path: finishPath(path, width, height), label };
      continue;
    }
    // A place that holds cases: a belt from the middle between the transition in front of it
    // and the place to the middle between the place and the transition behind it.
    const a = mean(before);
    const b = mean(after);
    let into = a ? unit(sub(center, a)) : null;
    let out = b ? unit(sub(b, center)) : null;
    into ??= out ?? [1, 0];
    out ??= into;
    const start = a ? lerp(a, center, 0.5) : add(center, into, -OPEN_END);
    const end = b ? lerp(center, b, 0.5) : add(center, out, OPEN_END);
    const turn = into[0] * out[0] + into[1] * out[1];
    const raw: Pt[] = turn > 0.995 ? [start, end] : [start, center, end];
    const path = lengthen(raw, into.map((v) => -v) as Pt, out);
    places[place.id] = {
      kind: 'conveyor',
      path: finishPath(path.map(roundPoint), width, height),
      label,
    };
  }
  return { places, transitions };
}

function stamp(at: string): Provenance {
  return { source: 'generic', at };
}

/**
 * A domain view for any net: stations, belts and queues placed where the net has its nodes.
 * Deterministic. Passes the rules V1 to V5; V6 may warn about crowded nets.
 */
export function genericDomainView(net: PetriNet, options: GenericOptions = {}): DomainView {
  const { width, height } = options.canvas ?? DEFAULT_CANVAS;
  const at = options.at ?? new Date().toISOString();
  const { places, transitions } = genericParts(net, width, height);
  const arcs = arcPaths(net, places, transitions, () => true, width, height);

  const provenance: Record<string, Provenance> = {};
  for (const id of Object.keys(places)) provenance[provenanceKey.place(id)] = stamp(at);
  for (const id of Object.keys(transitions)) provenance[provenanceKey.transition(id)] = stamp(at);
  for (const key of Object.keys(arcs)) provenance[provenanceKey.arc(key)] = stamp(at);

  const title = net.name.trim() === '' ? 'Untitled net' : net.name;
  const scaleWidth = Math.min(100, Math.max(10, width / 4));
  const decor: Decor[] = [
    { kind: 'label', pos: [24, 32], text: title },
    {
      kind: 'scale',
      pos: [round(width - 24 - scaleWidth), round(height - 24)],
      px: round(scaleWidth),
      label: '10 m',
    },
  ];
  const meta: DomainMeta = {
    theme: options.theme ?? title,
    viewName: 'Generic view',
    entity: entityFor(net),
    canvas: { width, height },
    metersPerPixel: 0.1,
  };
  return {
    schemaVersion: 1,
    netHash: netHash(net),
    meta,
    places,
    transitions,
    arcs,
    decor,
    provenance,
  };
}

/**
 * Like `genericDomainView`, but nodes that sit on top of each other (no usable editor positions)
 * are first laid out with ELK.
 */
export async function genericDomainViewWithLayout(
  net: PetriNet,
  options: GenericOptions = {},
): Promise<DomainView> {
  const nodes = [...net.places, ...net.transitions];
  const spots = new Set(nodes.map((n) => `${n.position?.x}:${n.position?.y}`));
  if (nodes.length > 1 && spots.size === 1) {
    const positions = await layoutNet(net, { direction: 'RIGHT' });
    const moved: PetriNet = {
      ...net,
      places: net.places.map((p) => ({ ...p, position: positions[p.id] ?? p.position })),
      transitions: net.transitions.map((t) => ({ ...t, position: positions[t.id] ?? t.position })),
    };
    return genericDomainView(moved, options);
  }
  return genericDomainView(net, options);
}

/**
 * Completes a view for the current net: entries of elements that no longer exist are dropped,
 * missing entries and entries that break the rules V2 to V5 are replaced by generic ones (with
 * the provenance `generic`). Everything else, including `netHash`, stays as it is.
 */
export function fillMissing(
  net: PetriNet,
  view: DomainView,
  options: GenericOptions = {},
): DomainView {
  const { width, height } = view.meta.canvas;
  const at = options.at ?? new Date().toISOString();
  const generic = genericParts(net, width, height);
  const placeIds = new Set(net.places.map((p) => p.id));
  const transitionIds = new Set(net.transitions.map((t) => t.id));
  const arcKeys = new Set(net.arcs.map((a) => arcKey(a.source, a.target)));

  const places: Record<Id, PlaceView> = {};
  const transitions: Record<Id, TransitionView> = {};
  const arcs: Record<string, { path: Point[] }> = {};
  const provenance: Record<string, Provenance> = {};
  for (const [id, entry] of Object.entries(view.places)) if (placeIds.has(id)) places[id] = entry;
  for (const [id, entry] of Object.entries(view.transitions)) {
    if (transitionIds.has(id)) transitions[id] = entry;
  }
  for (const [key, entry] of Object.entries(view.arcs ?? {}))
    if (arcKeys.has(key)) arcs[key] = entry;
  for (const [key, entry] of Object.entries(view.provenance)) {
    const rest = key.slice(key.indexOf('.') + 1);
    const known =
      (key.startsWith('places.') && placeIds.has(rest)) ||
      (key.startsWith('transitions.') && transitionIds.has(rest)) ||
      (key.startsWith('arcs.') && arcKeys.has(rest));
    if (known) provenance[key] = entry;
  }

  // Entries that break a rule are replaced; the rules are checked on what is left.
  const broken = validateDomainView(net, { ...view, places, transitions, arcs, provenance });
  const badElements = new Set(
    broken.diagnostics
      .filter((d) => d.severity === 'error' && d.elementId !== undefined)
      .map((d) => d.elementId!),
  );
  const badArcs = new Set(
    broken.diagnostics
      .filter((d) => d.severity === 'error' && d.path.startsWith('arcs.'))
      .map((d) => d.path.split('.')[1] ?? ''),
  );
  const replaced = new Set<Id>();
  for (const place of net.places) {
    if (!(place.id in places) || badElements.has(place.id)) {
      const entry = generic.places[place.id];
      if (entry) {
        places[place.id] = entry;
        provenance[provenanceKey.place(place.id)] = stamp(at);
        replaced.add(place.id);
      }
    }
  }
  for (const transition of net.transitions) {
    if (!(transition.id in transitions) || badElements.has(transition.id)) {
      const entry = generic.transitions[transition.id];
      if (entry) {
        transitions[transition.id] = entry;
        provenance[provenanceKey.transition(transition.id)] = stamp(at);
        replaced.add(transition.id);
      }
    }
  }
  for (const key of badArcs) {
    delete arcs[key];
    delete provenance[provenanceKey.arc(key)];
  }
  // Arcs next to a new element get a path; all other arcs keep what they have (or nothing).
  const fresh = arcPaths(
    net,
    places,
    transitions,
    (_id, source, target) =>
      (replaced.has(source) || replaced.has(target)) && !(arcKey(source, target) in arcs),
    width,
    height,
  );
  for (const [key, entry] of Object.entries(fresh)) {
    arcs[key] = entry;
    provenance[provenanceKey.arc(key)] = stamp(at);
  }

  return domainViewSchema.parse({ ...view, places, transitions, arcs, provenance });
}

/** The view with the hash of the current net. */
export function withNetHash(net: PetriNet, view: DomainView): DomainView {
  return { ...view, netHash: netHash(net) };
}
