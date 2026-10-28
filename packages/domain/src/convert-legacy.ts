import { placeRoles, type Id, type PetriNet } from '@pnm/core';
import { rectCenter } from './geometry';
import { edgePoint } from './generic';
import { netHash } from './hash';
import {
  domainViewSchema,
  provenanceKey,
  type Decor,
  type DomainView,
  type PlaceView,
  type Point,
  type Provenance,
  type Rect,
  type Sprite,
  type TransitionView,
} from './schema';

/**
 * Converter for the mapping format of the first mockup (`docs/mockups/domaenenansicht.html`):
 * `as`, `lane`, `turnstile`, `diverter` with `motion`, `exit`, `trucks`, `token`, `object`.
 * It exists to move the two hand-made mappings (parcel center, smart office) into the schema; the
 * result is a starting point that is checked and adjusted by hand. Not used by the app.
 */
export interface LegacyMap {
  theme: string;
  object: string;
  viewName: string;
  token: string;
  places: Record<string, LegacyPlace>;
  transitions: Record<string, LegacyTransition>;
  arcs?: Record<string, { path: Array<Point | { x?: number; y?: number }> }>;
  decor?: LegacyDecor[];
}

export interface LegacyPlace {
  as: string;
  lane?: Point[];
  of?: string;
  box?: Rect;
  label?: string;
}

export interface LegacyTransition {
  as: string;
  pos?: Point;
  box?: Rect;
  r?: number;
  motion?: string;
  label?: string;
  sensor?: string;
  slots?: Point[];
  rooms?: Rect[];
  machines?: Rect[];
  truck?: Rect;
}

export interface LegacyDecor {
  kind: string;
  rect?: Rect;
  pos?: Point;
  from?: Point;
  to?: Point;
  text?: string;
  label?: string;
  px?: number;
  w?: number;
  segs?: Rect[];
}

export interface LegacyOptions {
  canvas: { width: number; height: number };
  /** Plural of the entity (the mockup only has the singular). */
  plural: string;
  metersPerPixel?: number;
  at: string;
}

function union(rects: Rect[], pad = 0): Rect {
  const x1 = Math.min(...rects.map((r) => r[0])) - pad;
  const y1 = Math.min(...rects.map((r) => r[1])) - pad;
  const x2 = Math.max(...rects.map((r) => r[0] + r[2])) + pad;
  const y2 = Math.max(...rects.map((r) => r[1] + r[3])) + pad;
  return [x1, y1, x2 - x1, y2 - y1];
}

function spriteOf(token: string): Sprite {
  if (token === 'person') return 'person';
  if (token === 'parcel') return 'parcel';
  return 'dot';
}

/** Evenly spaced slots along the longer side of a box. */
function slotsIn(box: Rect, count: number): Point[] {
  const n = Math.max(1, count);
  const [x, y, w, h] = box;
  const horizontal = w >= h;
  return Array.from({ length: n }, (_, i) => {
    const t = (i + 0.5) / n;
    return horizontal ? [x + w * t, y + h / 2] : [x + w / 2, y + h * t];
  });
}

function withLabel<T extends object>(view: T, label: string | undefined): T {
  return label === undefined ? view : { ...view, label };
}

export function convertLegacyMap(
  net: PetriNet,
  legacy: LegacyMap,
  options: LegacyOptions,
): DomainView {
  const resourceCount = (transitionId: Id): number => {
    for (const [placeId, place] of Object.entries(legacy.places)) {
      if (place.as === 'slots' && place.of === transitionId) {
        return net.marking[placeId]?.length ?? 0;
      }
    }
    return 0;
  };
  const roles = placeRoles(net);

  const places: Record<Id, PlaceView> = {};
  for (const [id, place] of Object.entries(legacy.places)) {
    switch (place.as) {
      case 'conveyor':
      case 'buffer':
      case 'queue':
        places[id] = withLabel({ kind: place.as, path: place.lane ?? [] }, place.label);
        break;
      case 'entry':
        places[id] = withLabel({ kind: 'queue', path: place.lane ?? [] }, place.label);
        break;
      case 'slots':
        places[id] = withLabel({ kind: 'slots', of: place.of ?? '' }, place.label);
        break;
      case 'exit':
        places[id] = withLabel({ kind: 'sink', box: place.box ?? [0, 0, 1, 1] }, place.label);
        break;
      case 'trucks': {
        // The trucks of the gates become one loading area.
        const trucks = Object.values(legacy.transitions)
          .map((t) => t.truck)
          .filter((r): r is Rect => r !== undefined);
        places[id] = {
          kind: 'sink',
          box: trucks.length > 0 ? union(trucks, 6) : [0, 0, 1, 1],
          label: place.label ?? net.places.find((p) => p.id === id)?.name ?? '',
        };
        break;
      }
      default:
        places[id] = { kind: 'hidden', reason: `Unknown legacy kind "${place.as}"` };
    }
    if (roles.get(id) === 'resource' && places[id]?.kind === 'hidden') {
      places[id] = { kind: 'pool', pos: [0, 0] };
    }
  }

  const transitions: Record<Id, TransitionView> = {};
  for (const [id, t] of Object.entries(legacy.transitions)) {
    const sensor = t.sensor;
    const extra = (view: TransitionView): TransitionView => {
      if (view.kind === 'hidden') return view;
      return {
        ...withLabel(view, t.label),
        ...(sensor !== undefined && { sensor }),
      } as TransitionView;
    };
    const count = resourceCount(id);
    switch (t.as) {
      case 'station': {
        const box = t.box ?? [0, 0, 1, 1];
        transitions[id] = extra({ kind: 'station', box, slots: slotsIn(box, count) });
        break;
      }
      case 'sorter': {
        const [x, y] = t.pos ?? [0, 0];
        const r = t.r ?? 30;
        const box: Rect = [x - r, y - r, 2 * r, 2 * r];
        transitions[id] = extra({ kind: 'machine', box, slots: [[x, y]] });
        break;
      }
      case 'gate': {
        const box = t.box ?? [0, 0, 1, 1];
        transitions[id] = extra({ kind: 'gate', box, slots: slotsIn(box, count) });
        break;
      }
      case 'turnstile': {
        const [x, y] = t.pos ?? [0, 0];
        transitions[id] = extra({
          kind: 'gate',
          box: [x - 18, y - 24, 36, 48],
          slots: t.slots ?? [[x, y]],
        });
        break;
      }
      case 'machine': {
        const box = union(t.machines ?? [[0, 0, 1, 1]], 14);
        transitions[id] = extra({
          kind: 'machine',
          box,
          slots: t.slots ?? slotsIn(box, count),
        });
        break;
      }
      case 'area': {
        const box = t.box ?? [0, 0, 1, 1];
        transitions[id] = extra({ kind: 'area', box, slots: t.slots ?? slotsIn(box, count) });
        break;
      }
      case 'rooms': {
        const rooms = t.rooms ?? [];
        transitions[id] = extra({
          kind: 'rooms',
          box: rooms.length > 0 ? union(rooms) : [0, 0, 1, 1],
          slots: t.slots ?? [],
          rooms,
        });
        break;
      }
      case 'diverter':
      case 'waypoint':
        transitions[id] = extra({
          kind: 'waypoint',
          pos: t.pos ?? [0, 0],
          ...(t.motion === 'pass' && { pass: true }),
        });
        break;
      case 'dock':
      case 'door':
        transitions[id] = extra({ kind: t.as, pos: t.pos ?? [0, 0] });
        break;
      default:
        transitions[id] = { kind: 'hidden', reason: `Unknown legacy kind "${t.as}"` };
    }
  }

  // Arc paths: the legacy format lists only the points between the two ends.
  const arcs: Record<string, { path: Point[] }> = {};
  const anchor = (id: Id, toward: Point, pathEnd: 'start' | 'end'): Point | null => {
    const t = transitions[id];
    if (t && t.kind !== 'hidden') {
      return 'box' in t ? edgePoint(t.box, toward) : t.pos;
    }
    const p = places[id];
    if (!p) return null;
    if (p.kind === 'queue' || p.kind === 'conveyor' || p.kind === 'buffer') {
      return pathEnd === 'start' ? (p.path[0] ?? null) : (p.path[p.path.length - 1] ?? null);
    }
    if (p.kind === 'sink' || p.kind === 'source') return edgePoint(p.box, toward);
    return null;
  };
  const center = (id: Id): Point | null => {
    const t = transitions[id];
    if (t && t.kind !== 'hidden') return 'box' in t ? rectCenter(t.box) : t.pos;
    const p = places[id];
    if (p && (p.kind === 'sink' || p.kind === 'source')) return rectCenter(p.box);
    if (p && (p.kind === 'queue' || p.kind === 'conveyor' || p.kind === 'buffer')) {
      return p.path[Math.floor(p.path.length / 2)] ?? null;
    }
    return null;
  };
  for (const [key, arc] of Object.entries(legacy.arcs ?? {})) {
    const [source, target] = key.split('>');
    if (source === undefined || target === undefined) continue;
    const middle: Point[] = [];
    for (const raw of arc.path) {
      if (Array.isArray(raw)) middle.push(raw);
      else {
        const previous = middle[middle.length - 1] ?? center(source) ?? [0, 0];
        middle.push([raw.x ?? previous[0], raw.y ?? previous[1]]);
      }
    }
    const first = middle[0] ?? center(target);
    const last = middle[middle.length - 1] ?? center(source);
    const from = first ? anchor(source, first, 'end') : null;
    const to = last ? anchor(target, last, 'start') : null;
    if (from && to) arcs[key] = { path: [from, ...middle, to] };
  }

  const decor: Decor[] = [];
  for (const d of legacy.decor ?? []) {
    switch (d.kind) {
      case 'text':
      case 'label':
        if (d.pos && d.text) decor.push({ kind: 'label', pos: d.pos, text: d.text });
        break;
      case 'zone':
      case 'room':
        if (d.rect) decor.push(withLabel({ kind: d.kind, rect: d.rect }, d.label));
        break;
      case 'furn':
        if (d.rect) decor.push({ kind: 'furniture', rect: d.rect });
        break;
      case 'walls':
        if (d.segs)
          decor.push({ kind: 'wall', segs: d.segs, ...(d.w !== undefined && { width: d.w }) });
        break;
      case 'walkway':
        if (d.from && d.to) {
          const pad = 14;
          decor.push(
            withLabel(
              {
                kind: 'zone' as const,
                rect: [
                  Math.min(d.from[0], d.to[0]),
                  Math.min(d.from[1], d.to[1]) - pad,
                  Math.abs(d.to[0] - d.from[0]),
                  Math.abs(d.to[1] - d.from[1]) + 2 * pad,
                ] as Rect,
              },
              d.label,
            ),
          );
        }
        break;
      case 'scale':
        if (d.pos && d.px && d.label) {
          decor.push({ kind: 'scale', pos: d.pos, px: d.px, label: d.label });
        }
        break;
      default:
        // Hazard stripes and the truck pictogram of the mockup have no counterpart in the schema.
        break;
    }
  }

  const stamp: Provenance = { source: 'user', at: options.at };
  const provenance: Record<string, Provenance> = {};
  for (const id of Object.keys(places)) provenance[provenanceKey.place(id)] = stamp;
  for (const id of Object.keys(transitions)) provenance[provenanceKey.transition(id)] = stamp;
  for (const key of Object.keys(arcs)) provenance[provenanceKey.arc(key)] = stamp;

  return domainViewSchema.parse({
    schemaVersion: 1,
    netHash: netHash(net),
    meta: {
      theme: legacy.theme,
      viewName: legacy.viewName,
      entity: { singular: legacy.object, plural: options.plural, sprite: spriteOf(legacy.token) },
      canvas: options.canvas,
      ...(options.metersPerPixel !== undefined && { metersPerPixel: options.metersPerPixel }),
    },
    places,
    transitions,
    arcs,
    decor,
    provenance,
  });
}
