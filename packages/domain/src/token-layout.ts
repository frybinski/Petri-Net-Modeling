import { placeRoles, type Id, type Marking, type PetriNet, type PlaceRole } from '@pnm/core';
import type { SimState, TokenMeta } from '@pnm/sim';
import { dedupePoints, pathLength, pointAlong, rectCenter } from './geometry';
import { tokenSpots } from './scene';
import { arcKey, type DomainView, type Point, type PlaceView, type TransitionView } from './schema';

/** A firing under way, as far as the picture needs it. `RunningView` of `@pnm/sim` fits. */
export interface LayoutFiring {
  firingId: number;
  transitionId: Id;
  /** Simulation seconds. */
  start: number;
  end: number;
  slot: number;
  /** Cases held by the firing, in order of consumption. */
  caseIds: readonly string[];
}

/** The part of the simulation state the layout of the tokens depends on. */
export interface LayoutState {
  /** Simulation seconds. */
  time: number;
  marking: Marking;
  /** Parallel to `marking`. Missing entries get an id made from the place and the position. */
  meta?: Readonly<Record<Id, readonly TokenMeta[]>>;
  running: readonly LayoutFiring[];
}

/** The layout input of a state of the simulation engine. */
export function layoutStateOf(
  state: Pick<SimState, 'time' | 'marking' | 'meta' | 'running'>,
): LayoutState {
  return {
    time: state.time,
    marking: state.marking,
    meta: state.meta,
    running: state.running.map((f) => ({
      firingId: f.id,
      transitionId: f.transitionId,
      start: f.start,
      end: f.end,
      slot: f.slot,
      caseIds: f.caseIds,
    })),
  };
}

/** The state of a net that is not simulated: the initial marking and nothing under way. */
export function staticLayoutState(net: PetriNet): LayoutState {
  return { time: 0, marking: net.marking, running: [] };
}

export type TokenState = 'waiting' | 'working' | 'traveling';

/** A case that moves along a path during a firing (`pass`), by simulation time. */
export interface Travel {
  path: Point[];
  start: number;
  end: number;
}

export interface LaidOutToken {
  /** `TokenMeta.id` for a token on a place, `f<firing>:<case>` for a case inside a firing. */
  key: string;
  /** The place the token waits on, or the transition that holds it. */
  elementId: Id;
  caseId?: string;
  pos: Point;
  /** Direction of the belt or lane at the token, for sprites that have a front. */
  direction: Point;
  state: TokenState;
  /** False for tokens that are stacked behind the counter of a full queue. */
  visible: boolean;
  /** Waiting tokens: distance from the start of the path of the place. */
  along?: number;
  firingId?: number;
  travel?: Travel;
}

export interface TokenLayout {
  /** Simulation time of the state the layout was made from. */
  time: number;
  tokens: Map<string, LaidOutToken>;
  /** Places with more waiting tokens than fit: the number left out and where the counter stands. */
  overflow: Map<Id, { extra: number; pos: Point }>;
  /** The number of tokens on every place. */
  counts: Map<Id, number>;
  running: readonly LayoutFiring[];
  /** The state the layout was made from. */
  state: LayoutState;
}

/** Everything about a net and its view that layout and animation look up again and again. */
export interface LayoutContext {
  net: PetriNet;
  view: DomainView;
  roles: Map<Id, PlaceRole>;
  /** Input and output places of every transition, in the order of the arcs. */
  inputs: Map<Id, Id[]>;
  outputs: Map<Id, Id[]>;
  /** Paths of the connectors of the view by `<source>><target>`. */
  arcs: Map<string, Point[]>;
}

const cache = new WeakMap<DomainView, WeakMap<PetriNet, LayoutContext>>();

/** The lookups for a net and its view. Cached per pair of objects. */
export function layoutContext(net: PetriNet, view: DomainView): LayoutContext {
  let byNet = cache.get(view);
  if (!byNet) {
    byNet = new WeakMap();
    cache.set(view, byNet);
  }
  const known = byNet.get(net);
  if (known) return known;
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
  const arcs = new Map<string, Point[]>();
  for (const [key, arc] of Object.entries(view.arcs ?? {})) arcs.set(key, arc.path);
  const created: LayoutContext = { net, view, roles: placeRoles(net), inputs, outputs, arcs };
  byNet.set(net, created);
  return created;
}

/** True for places drawn along a path, on which tokens stand one behind the other. */
export function isPathPlace(entry: PlaceView | undefined): entry is PlaceView & { path: Point[] } {
  return entry?.kind === 'queue' || entry?.kind === 'conveyor' || entry?.kind === 'buffer';
}

/** True for places that are only drawn as a number. */
export function isCounterPlace(entry: PlaceView | undefined): boolean {
  return entry?.kind === 'pool' || entry?.kind === 'source' || entry?.kind === 'sink';
}

export function isVisibleTransition(entry: TransitionView | undefined): entry is TransitionView {
  return entry !== undefined && entry.kind !== 'hidden';
}

/** Where the cases of firings are shown on a transition: its slot, else the middle of its card. */
export function transitionAnchor(view: DomainView, transitionId: Id, slot = 0): Point | null {
  const entry = view.transitions[transitionId];
  if (!entry || entry.kind === 'hidden') return null;
  if ('pos' in entry) return entry.pos;
  const slots = entry.slots ?? [];
  return slots[slot] ?? slots[0] ?? rectCenter(entry.box);
}

/** The middle of a place that is drawn as a box, a circle or at its path's end. */
export function placeAnchor(view: DomainView, placeId: Id): Point | null {
  const entry = view.places[placeId];
  if (!entry) return null;
  switch (entry.kind) {
    case 'pool':
      return entry.pos;
    case 'source':
    case 'sink':
      return rectCenter(entry.box);
    case 'queue':
    case 'conveyor':
    case 'buffer':
      return pointAlong(entry.path, 0).point;
    default:
      return null;
  }
}

/** The connector of an arc, or an empty path if the view has none. */
export function arcPathOf(ctx: LayoutContext, source: Id, target: Id): Point[] {
  return ctx.arcs.get(arcKey(source, target)) ?? [];
}

/** Offsets cases that share a slot, so that they are all visible. */
function spread(point: Point, index: number, count: number): Point {
  if (count <= 1) return point;
  const shift = (index - (count - 1) / 2) * 7;
  return [point[0] + shift, point[1] + shift * 0.6];
}

/** The key of a case inside a firing. */
export function firingKey(firingId: number, caseId: string): string {
  return `f${firingId}:${caseId}`;
}

/**
 * The path that a case takes during a firing of a pass-through transition (a waypoint on a route):
 * from the head of the place before, along the connectors, over the waypoint to the start of the
 * place behind.
 */
export function travelPath(ctx: LayoutContext, transitionId: Id): Point[] | null {
  const entry = ctx.view.transitions[transitionId];
  if (!entry || !('pos' in entry)) return null;
  const caseInput = (ctx.inputs.get(transitionId) ?? []).find(
    (id) => ctx.roles.get(id) !== 'resource',
  );
  const caseOutput = (ctx.outputs.get(transitionId) ?? []).find(
    (id) => ctx.roles.get(id) !== 'resource',
  );
  const points: Point[] = [];
  if (caseInput !== undefined) {
    const place = ctx.view.places[caseInput];
    if (isPathPlace(place)) points.push(pointAlong(place.path, pathLength(place.path) - 8).point);
    else {
      const anchor = placeAnchor(ctx.view, caseInput);
      if (anchor) points.push(anchor);
    }
    points.push(...arcPathOf(ctx, caseInput, transitionId));
  }
  points.push(entry.pos);
  if (caseOutput !== undefined) {
    points.push(...arcPathOf(ctx, transitionId, caseOutput));
    const place = ctx.view.places[caseOutput];
    if (isPathPlace(place)) points.push(pointAlong(place.path, 8).point);
    else {
      const anchor = placeAnchor(ctx.view, caseOutput);
      if (anchor) points.push(anchor);
    }
  }
  const cleaned = dedupePoints(points);
  return cleaned.length >= 2 ? cleaned : null;
}

/** Where a case on a travel path stands at simulation time `time`. */
export function travelPoint(travel: Travel, time: number): { point: Point; direction: Point } {
  const span = travel.end - travel.start;
  const progress = span > 0 ? Math.min(1, Math.max(0, (time - travel.start) / span)) : 1;
  return pointAlong(travel.path, progress * pathLength(travel.path));
}

function metaOf(
  state: LayoutState,
  placeId: Id,
  count: number,
): Array<{ id: string; caseId?: string; enteredAt: number }> {
  const metas = state.meta?.[placeId];
  const result: Array<{ id: string; caseId?: string; enteredAt: number }> = [];
  for (let i = 0; i < count; i += 1) {
    const meta = metas?.[i];
    result.push(meta ?? { id: `${placeId}#${i}`, enteredAt: 0 });
  }
  return result;
}

/**
 * Lays out the tokens of a simulation state on the picture of the view. Pure and deterministic:
 *
 * - On a belt, lane or buffer the tokens stand from the head backwards, 16 px apart, the oldest
 *   at the head. If not all fit, the rest are stacked at the start of the path behind a counter.
 * - A case that a firing holds stands on the slot of the firing (several cases slightly apart).
 *   On a waypoint that only lets cases pass it moves along the route while the firing lasts.
 * - Pools, sources, sinks and resource slots are only numbers (see `counts`); tokens of resources
 *   have no position.
 */
export function layoutTokens(net: PetriNet, view: DomainView, state: LayoutState): TokenLayout {
  const ctx = layoutContext(net, view);
  const tokens = new Map<string, LaidOutToken>();
  const overflow = new Map<Id, { extra: number; pos: Point }>();
  const counts = new Map<Id, number>();

  for (const place of net.places) {
    const count = state.marking[place.id]?.length ?? 0;
    counts.set(place.id, count);
    const entry = view.places[place.id];
    if (count === 0 || !isPathPlace(entry) || entry.path.length < 2) continue;
    const metas = metaOf(state, place.id, count);
    const order = metas.map((_, index) => index);
    order.sort((a, b) => metas[a]!.enteredAt - metas[b]!.enteredAt || a - b);
    const { spots, extra, next } = tokenSpots(entry.path, count);
    const length = pathLength(entry.path);
    order.forEach((index, rank) => {
      const meta = metas[index]!;
      const spot = spots[rank];
      const stacked = spot === undefined;
      tokens.set(meta.id, {
        key: meta.id,
        elementId: place.id,
        ...(meta.caseId !== undefined && { caseId: meta.caseId }),
        pos: stacked ? next : spot.point,
        direction: stacked ? (spots[spots.length - 1]?.direction ?? [1, 0]) : spot.direction,
        state: 'waiting',
        visible: !stacked,
        along: Math.max(0, length - 8 - Math.min(rank, spots.length) * 16),
      });
    });
    if (extra > 0) overflow.set(place.id, { extra, pos: next });
  }

  for (const firing of state.running) {
    const entry = view.transitions[firing.transitionId];
    if (!isVisibleTransition(entry) || firing.caseIds.length === 0) continue;
    const anchor = transitionAnchor(view, firing.transitionId, firing.slot);
    if (!anchor) continue;
    const pass = 'pass' in entry && entry.pass === true;
    const path = pass ? travelPath(ctx, firing.transitionId) : null;
    firing.caseIds.forEach((caseId, index) => {
      const key = firingKey(firing.firingId, caseId);
      if (path) {
        const travel: Travel = { path, start: firing.start, end: firing.end };
        const { point, direction } = travelPoint(travel, state.time);
        tokens.set(key, {
          key,
          elementId: firing.transitionId,
          caseId,
          pos: point,
          direction,
          state: 'traveling',
          visible: true,
          firingId: firing.firingId,
          travel,
        });
      } else {
        tokens.set(key, {
          key,
          elementId: firing.transitionId,
          caseId,
          pos: spread(anchor, index, firing.caseIds.length),
          direction: [1, 0],
          state: 'working',
          visible: true,
          firingId: firing.firingId,
        });
      }
    });
  }

  return { time: state.time, tokens, overflow, counts, running: state.running, state };
}
