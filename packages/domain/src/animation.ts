import { isCaselessRole, type Id } from '@pnm/core';
import type { SimEvent, TokenRef } from '@pnm/sim';
import { appearanceOfPlace, heldAppearance, sameAppearance } from './appearance';
import { dedupePoints, distance, pathLength, pointAlong, subPath } from './geometry';
import {
  HISTORY_LIMIT,
  HISTORY_WINDOW_SECONDS,
  compactHistory,
  trimHistory,
  type HistoryPoint,
} from './history';
import {
  arcPathOf,
  firingKey,
  isCounterPlace,
  isPathPlace,
  isVisibleTransition,
  placeAnchor,
  transitionAnchor,
  travelPoint,
  type LaidOutToken,
  type LayoutContext,
  type TokenLayout,
} from './token-layout';
import type { Appearance, DisplayIcon, Point } from './schema';
import { spriteSize } from './scene';

/** How long a token needs for one move, in milliseconds of wall-clock time. */
export const MOTION_MS = 300;
/** How long a flash lasts. */
export const FLASH_MS = 650;
/** At most this many tokens move at the same time; further moves jump. */
export const MAX_MOTIONS = 60;
/** At most this many flow markers run at the same time; further ones are only logged. */
export const MAX_FLOWS = 40;
/** Handled events kept for the log (see `AnimationState.handled`). */
export const DEFAULT_LOG_LIMIT = 4000;
/**
 * A case changes its look within this time, in milliseconds: the picture of the place it came
 * from fades into that of the place it goes to while it leaves the station.
 */
export const APPEARANCE_MS = 250;

/** A token that moves along a route. Every motion belongs to exactly one event. */
export interface Motion {
  tokenId: string;
  /** The event that moved the token. */
  eventId: number;
  from: Point;
  to: Point;
  /** The whole route from `from` to `to`; absent for a straight line. */
  path?: Point[];
  /** Wall-clock milliseconds (the clock the caller passes as `now`). */
  startedAt: number;
  duration: number;
  /** The token ends in a sink or pool and is not drawn at rest. */
  absorbed?: boolean;
  caseId?: string;
  /**
   * How the case looks at the start and at the end of the move. If they differ, the first fades
   * into the second within `APPEARANCE_MS` (or the length of the move if that is shorter).
   */
  appearance?: { from: Appearance; to: Appearance };
}

/**
 * A small marker that runs along a connector for one firing and one quantity place: the amount a
 * firing takes from the place (`out`, when it starts) or puts on it (`in`, when it completes).
 * Quantities are no objects, so this is what moves instead of a token. Every marker belongs to
 * exactly one event.
 */
export interface FlowMarker {
  /** The event that moved the amount. */
  eventId: number;
  placeId: Id;
  transitionId: Id;
  direction: 'in' | 'out';
  /** The number of tokens (the amount) that moves. */
  count: number;
  /** The symbol of the amount, from the `display.icon` of the place; without one a plain dot runs. */
  icon?: DisplayIcon;
  /** From the place to the transition (`out`) or from the transition to the place (`in`). */
  path: Point[];
  /** Wall-clock milliseconds (the clock the caller passes as `now`). */
  startedAt: number;
  duration: number;
}

/** A short light-up of an element for an event that moves no token. */
export interface Flash {
  elementId: Id;
  eventId: number;
  startedAt: number;
  /** The flash marks a deviation of a replay from the net (drawn in red). */
  deviation?: true;
}

/** The number shown at a place that is only drawn as a number. */
export interface CounterState {
  value: number;
  /** What was shown before `changedAt`. */
  previous: number;
  /** The new value is shown from this wall-clock time on (a token may still be on its way). */
  changedAt: number;
}

export type HandledKind = 'motion' | 'flash' | 'counter' | 'flow' | 'hidden';

/** What the renderer did with an event. The proof that no event is lost (acceptance A2). */
export interface Handled {
  eventId: number;
  kind: HandledKind;
  elementId?: Id;
  tokenId?: string;
}

export interface AnimationState {
  motions: Motion[];
  /** Markers of amounts on their way along connectors (quantity places). */
  flows: FlowMarker[];
  flashes: Flash[];
  counters: Record<Id, CounterState>;
  /**
   * The count over the simulated time of the counters with `display.history`: one point per
   * change at an event, the last eight hours, at most 500 points per counter. Absent in a state
   * made by hand, which has none.
   */
  history?: Record<Id, HistoryPoint[]>;
  /** Log of handled events, newest last, cut to `AnimationOptions.logLimit`. */
  handled: Handled[];
}

export const EMPTY_ANIMATION: AnimationState = {
  motions: [],
  flows: [],
  flashes: [],
  counters: {},
  history: {},
  handled: [],
};

export interface AnimationOptions {
  context: LayoutContext;
  /** Milliseconds per move. 0 makes tokens jump (speed "max", reduced motion). Default 300. */
  duration?: number;
  /** Milliseconds per flash; 0 shows none. Default 650. */
  flash?: number;
  /** Default 60. */
  maxMotions?: number;
  /** Flow markers moving at the same time. Default 40. */
  maxFlows?: number;
  /** Entries kept in `handled`. Default 4000. */
  logLimit?: number;
}

/** Options for tokens that jump and elements that do not flash. */
export const INSTANT = { duration: 0, flash: 0 } as const;

const EPSILON = 0.75;

function easeInOut(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Wall-clock milliseconds after which the move has ended. */
export function motionEnd(motion: Motion): number {
  return motion.startedAt + motion.duration;
}

/** Wall-clock milliseconds after which a flow marker has ended. */
export function flowEnd(flow: FlowMarker): number {
  return flow.startedAt + flow.duration;
}

/** The text of a flow marker: `+3` for an amount put on a place, `−3` for one taken from it. */
export function flowLabel(flow: Pick<FlowMarker, 'direction' | 'count'>): string {
  return `${flow.direction === 'in' ? '+' : '\u2212'}${flow.count}`;
}

/** Where a flow marker is at `now`, and how far along its way (0 to 1). */
export function flowPoint(flow: FlowMarker, now: number): { point: Point; progress: number } {
  const progress =
    flow.duration <= 0 ? 1 : Math.min(1, Math.max(0, (now - flow.startedAt) / flow.duration));
  const { point } = pointAlong(flow.path, easeInOut(progress) * pathLength(flow.path));
  return { point, progress };
}

function routeOf(motion: Motion): Point[] {
  return motion.path ?? [motion.from, motion.to];
}

/** Where a moving token is at `now`, and the direction it moves in. */
export function motionPoint(motion: Motion, now: number): { point: Point; direction: Point } {
  const route = routeOf(motion);
  const progress =
    motion.duration <= 0 ? 1 : Math.min(1, Math.max(0, (now - motion.startedAt) / motion.duration));
  const length = pathLength(route);
  const { point, direction } = pointAlong(route, easeInOut(progress) * length);
  return { point, direction };
}

/** True while something is still moving, flashing or counting up. */
export function isAnimating(state: AnimationState, now: number, flashMs = FLASH_MS): boolean {
  return (
    state.motions.some((m) => now < motionEnd(m)) ||
    state.flows.some((f) => now < flowEnd(f)) ||
    state.flashes.some((f) => now - f.startedAt < flashMs) ||
    Object.values(state.counters).some((c) => now < c.changedAt + 400)
  );
}

/** The state without what has ended by `now`. */
export function pruneAnimation(
  state: AnimationState,
  now: number,
  flashMs = FLASH_MS,
): AnimationState {
  const motions = state.motions.filter((m) => now < motionEnd(m));
  const flows = state.flows.filter((f) => now < flowEnd(f));
  const flashes = state.flashes.filter((f) => now - f.startedAt < flashMs);
  if (
    motions.length === state.motions.length &&
    flows.length === state.flows.length &&
    flashes.length === state.flashes.length
  ) {
    return state;
  }
  return { ...state, motions, flows, flashes };
}

/** The number to show at a place that is only drawn as a number. */
export function shownCount(
  state: AnimationState,
  placeId: Id,
  actual: number,
  now: number,
): number {
  const counter = state.counters[placeId];
  if (!counter || counter.value !== actual) return actual;
  return now >= counter.changedAt ? counter.value : counter.previous;
}

export interface SpriteSample {
  key: string;
  caseId?: string;
  /** The place the case waits on, or the transition that holds it. */
  elementId?: Id;
  point: Point;
  direction: Point;
  moving: boolean;
  /** The sprite stands in a station or travels, as opposed to waiting on a belt. */
  state: LaidOutToken['state'];
  /** How the case looks now. */
  appearance: Appearance;
  /** The size of the sprite in sheet pixels. */
  size: number;
  /**
   * While a case changes its look: the one it had before, and how far the new one has come (0 to
   * 1). The old one is drawn first, the new one on top of it with that opacity.
   */
  blend?: { from: Appearance; mix: number };
}

/** How far the change of look of a move has come at `now`; `null` if there is none. */
function blendOf(motion: Motion, now: number): { from: Appearance; mix: number } | null {
  const looks = motion.appearance;
  if (!looks || sameAppearance(looks.from, looks.to)) return null;
  const span = Math.min(APPEARANCE_MS, motion.duration);
  const mix = span <= 0 ? 1 : Math.min(1, Math.max(0, (now - motion.startedAt) / span));
  return mix >= 1 ? null : { from: looks.from, mix };
}

/**
 * The sprites to draw at `now`: tokens at rest at their place in the layout (cases on a travel
 * route at the position for `simTime`), tokens under way at the interpolated position of their
 * motion. A token with a motion is not drawn at its place. Each one has the look of the place it
 * lies on; a case that leaves a station changes it within `APPEARANCE_MS` (`blend`). `fallback`
 * is the look of a token that has none (the entity of the view).
 */
export function sampleSprites(
  layout: TokenLayout,
  anim: AnimationState,
  now: number,
  simTime?: number,
  fallback: Appearance = { sprite: 'dot' },
): SpriteSample[] {
  const moving = new Map<string, Motion>();
  for (const motion of anim.motions) {
    if (now < motionEnd(motion)) moving.set(motion.tokenId, motion);
  }
  const samples: SpriteSample[] = [];
  for (const token of layout.tokens.values()) {
    if (!token.visible || moving.has(token.key)) continue;
    let point = token.pos;
    let direction = token.direction;
    if (token.travel && simTime !== undefined) {
      const travelled = travelPoint(token.travel, simTime);
      point = travelled.point;
      direction = travelled.direction;
    }
    const appearance = token.appearance ?? fallback;
    samples.push({
      key: token.key,
      ...(token.caseId !== undefined && { caseId: token.caseId }),
      elementId: token.elementId,
      point,
      direction,
      moving: false,
      state: token.state,
      appearance,
      size: spriteSize(appearance.sprite),
    });
  }
  for (const motion of moving.values()) {
    const { point, direction } = motionPoint(motion, now);
    const laid = layout.tokens.get(motion.tokenId);
    const appearance = motion.appearance?.to ?? laid?.appearance ?? fallback;
    const blend = blendOf(motion, now);
    samples.push({
      key: motion.tokenId,
      ...(motion.caseId !== undefined && { caseId: motion.caseId }),
      ...(laid !== undefined && { elementId: laid.elementId }),
      point,
      direction,
      moving: true,
      state: laid?.state ?? 'waiting',
      appearance,
      size: Math.max(spriteSize(appearance.sprite), blend ? spriteSize(blend.from.sprite) : 0),
      ...(blend && { blend }),
    });
  }
  return samples;
}

/** The positions of all sprites at `now`, by token key. */
export function sampleTokens(
  layout: TokenLayout,
  anim: AnimationState,
  now: number,
  simTime?: number,
): Record<string, Point> {
  const positions: Record<string, Point> = {};
  for (const sample of sampleSprites(layout, anim, now, simTime))
    positions[sample.key] = sample.point;
  return positions;
}

// --- Events to motions -------------------------------------------------------------------------

/** The way a token has made so far in the events of one bundle. */
interface Route {
  points: Point[];
  /** The route ends at the start of the path of this place (the token has just entered it). */
  entered: Id | null;
  /** The route ends in a place that is only a number: the token is absorbed there. */
  sink: Id | null;
}

/** How the case looks where a route starts and where it ends. */
interface Looks {
  from: Appearance;
  to: Appearance;
}

function lastOf(points: readonly Point[]): Point {
  return points[points.length - 1] ?? [0, 0];
}

/**
 * Turns the events of one bundle into motions, flashes and counters.
 *
 * The motion of a token is the difference between the layout before and after the bundle, linked
 * through the events: a `start` takes a token from its place onto a slot (the case continues under
 * the key `f<firing>:<case>`), a `complete` puts it on the next place. Chains inside one bundle
 * (start and complete, or a token that is taken again at once) become one route. Every motion,
 * flash and counter carries the id of the event that caused it, and every event that concerns an
 * element of the picture leaves an entry in `handled`.
 */
export function applyEvents(
  prev: AnimationState,
  events: readonly SimEvent[],
  before: TokenLayout,
  after: TokenLayout,
  now: number,
  options: AnimationOptions,
): AnimationState {
  const ctx = options.context;
  const view = ctx.view;
  const duration = options.duration ?? MOTION_MS;
  const flashMs = options.flash ?? FLASH_MS;
  const maxMotions = options.maxMotions ?? MAX_MOTIONS;
  const maxFlows = options.maxFlows ?? MAX_FLOWS;
  const logLimit = options.logLimit ?? DEFAULT_LOG_LIMIT;

  const live = new Map<string, Motion>();
  for (const motion of prev.motions) {
    if (now < motionEnd(motion)) live.set(motion.tokenId, motion);
  }
  const retired = new Set<string>();
  const routes = new Map<string, Route>();
  const origin = new Map<string, number>();
  const cause = new Map<Id, number>();
  const touchedCounters = new Map<Id, Set<number>>();
  const touch = (placeId: Id, eventId: number): void => {
    const set = touchedCounters.get(placeId) ?? new Set<number>();
    set.add(eventId);
    touchedCounters.set(placeId, set);
  };

  const currentPoint = (key: string): Point | undefined => {
    const motion = live.get(key);
    if (motion) return motionPoint(motion, now).point;
    return before.tokens.get(key)?.pos;
  };
  const headOf = (placeId: Id): Point | undefined => {
    const entry = view.places[placeId];
    return isPathPlace(entry)
      ? pointAlong(entry.path, pathLength(entry.path) - 8).point
      : undefined;
  };

  /** The route of a token that leaves `placeId`, or null if nothing is known about it. */
  const leave = (key: string, placeId: Id): Route | null => {
    const known = routes.get(key);
    const entry = view.places[placeId];
    let route: Route | null = known ?? null;
    if (!route) {
      const here = currentPoint(key);
      const was = before.tokens.get(key);
      if (here && was?.along !== undefined && !live.has(key) && isPathPlace(entry)) {
        // Along the belt to its head, around the bends.
        const points = subPath(entry.path, was.along, pathLength(entry.path) - 8);
        return { points, entered: null, sink: null };
      }
      if (here) route = { points: [here], entered: null, sink: null };
      else if (isCounterPlace(entry)) {
        const anchor = placeAnchor(view, placeId);
        if (anchor) route = { points: [anchor], entered: null, sink: null };
      }
    }
    if (!route) return null;
    const head = headOf(placeId);
    if (head) route.points.push(head);
    route.entered = null;
    route.sink = null;
    return route;
  };

  const retire = (key: string): void => {
    retired.add(key);
  };

  /** Events that concern a visible element, with what they did to it. */
  const elementOf = new Map<
    number,
    { elementId: Id | undefined; visible: boolean; deviation?: Id[] }
  >();
  const created: Motion[] = [];
  // How the case of a route looks at its start and at its end, by the key of the route.
  const looks = new Map<string, Looks>();

  // Amounts on quantity places do not move as tokens: a marker runs along the connector instead.
  const pendingFlows: Array<Omit<FlowMarker, 'startedAt' | 'duration'>> = [];
  const flowsOf = (
    event: { id: number; transitionId: Id; slot: number },
    refs: readonly TokenRef[],
    direction: FlowMarker['direction'],
  ): void => {
    const amounts = new Map<Id, number>();
    for (const ref of refs) {
      if (ctx.roles.get(ref.placeId) !== 'quantity') continue;
      amounts.set(ref.placeId, (amounts.get(ref.placeId) ?? 0) + 1);
    }
    const station = transitionAnchor(view, event.transitionId, event.slot);
    for (const [placeId, count] of amounts) {
      const anchor = placeAnchor(view, placeId);
      if (!anchor || !station) continue;
      const connector =
        direction === 'out'
          ? arcPathOf(ctx, placeId, event.transitionId)
          : arcPathOf(ctx, event.transitionId, placeId);
      const path = dedupePoints(
        direction === 'out' ? [anchor, ...connector, station] : [station, ...connector, anchor],
      );
      if (path.length < 2) continue;
      const shown = view.places[placeId];
      const icon = shown !== undefined && 'display' in shown ? shown.display?.icon : undefined;
      pendingFlows.push({
        eventId: event.id,
        placeId,
        transitionId: event.transitionId,
        direction,
        count,
        ...(icon !== undefined && { icon }),
        path,
      });
    }
  };

  for (const event of events) {
    switch (event.type) {
      case 'spawn': {
        let elementId = event.transitionId;
        if (elementId === undefined) {
          elementId = placeOfCase(after, event.caseId);
        }
        const visible =
          elementId !== undefined &&
          (event.transitionId !== undefined
            ? isVisibleTransition(view.transitions[elementId])
            : view.places[elementId] !== undefined && view.places[elementId]!.kind !== 'hidden');
        elementOf.set(event.id, { elementId, visible });
        break;
      }
      case 'start': {
        const entry = view.transitions[event.transitionId];
        const visible = isVisibleTransition(entry);
        elementOf.set(event.id, { elementId: event.transitionId, visible });
        for (const ref of event.consumed) {
          cause.set(ref.placeId, event.id);
          if (isCounterPlace(view.places[ref.placeId]) && visible) touch(ref.placeId, event.id);
        }
        if (!visible) {
          for (const ref of event.consumed) retire(ref.tokenId);
          break;
        }
        flowsOf(event, event.consumed, 'out');
        const pass = 'pass' in entry && entry.pass === true;
        const slotPoint = transitionAnchor(view, event.transitionId, event.slot);
        const claimed = new Set<string>();
        for (const ref of event.consumed) {
          if (isCaselessRole(ctx.roles.get(ref.placeId)) || ref.caseId === undefined) continue;
          const key = firingKey(event.firingId, ref.caseId);
          const route = leave(ref.tokenId, ref.placeId);
          retire(ref.tokenId);
          routes.delete(ref.tokenId);
          if (claimed.has(key)) continue;
          claimed.add(key);
          if (!route) {
            if (slotPoint) routes.set(key, { points: [slotPoint], entered: null, sink: null });
            continue;
          }
          if (!pass) {
            route.points.push(...arcPathOf(ctx, ref.placeId, event.transitionId));
            if (slotPoint) route.points.push(slotPoint);
          }
          routes.set(key, route);
          origin.set(key, event.id);
          // The case leaves its place and keeps its look in the station. A token that was put on
          // the place a moment ago, in the same bundle, goes on from the look it had before that.
          const taken = looks.get(ref.tokenId)?.from ?? appearanceOfPlace(view, ref.placeId);
          looks.set(key, {
            from: taken,
            to: heldAppearance(
              ctx,
              event.transitionId,
              Math.max(0, event.caseIds.indexOf(ref.caseId)),
            ),
          });
        }
        // Cases that enter here without a token (an arrival at a door) appear on the slot.
        for (const caseId of event.caseIds) {
          const key = firingKey(event.firingId, caseId);
          if (!claimed.has(key) && slotPoint) {
            routes.set(key, { points: [slotPoint], entered: null, sink: null });
          }
        }
        break;
      }
      case 'complete': {
        const entry = view.transitions[event.transitionId];
        const visible = isVisibleTransition(entry);
        elementOf.set(event.id, { elementId: event.transitionId, visible });
        if (visible) flowsOf(event, event.produced, 'in');
        const pass = visible && 'pass' in entry && entry.pass === true;
        const slotPoint = transitionAnchor(view, event.transitionId, event.slot);
        const held = event.caseIds.map((caseId) => firingKey(event.firingId, caseId));
        const unused = new Set(held);
        // The route of the case that the firing holds, and the key under which it was held.
        const takeSource = (ref: TokenRef): { route: Route | null; key: string | null } => {
          const wanted =
            ref.caseId !== undefined ? firingKey(event.firingId, ref.caseId) : undefined;
          const key =
            wanted !== undefined && unused.has(wanted) ? wanted : held.find((k) => unused.has(k));
          if (key === undefined) return { route: null, key: null };
          unused.delete(key);
          const known = routes.get(key);
          routes.delete(key);
          retire(key);
          if (known) return { route: known, key };
          const laid = before.tokens.get(key);
          if (laid?.travel) {
            return {
              route: { points: [lastOf(laid.travel.path)], entered: null, sink: null },
              key,
            };
          }
          const here = currentPoint(key);
          return { route: here ? { points: [here], entered: null, sink: null } : null, key };
        };
        for (const ref of event.produced) {
          const entryPlace = view.places[ref.placeId];
          cause.set(ref.placeId, event.id);
          if (isCounterPlace(entryPlace) && visible) touch(ref.placeId, event.id);
          // Resources and quantities are no objects: they are not drawn as moving tokens.
          if (!visible || isCaselessRole(ctx.roles.get(ref.placeId))) continue;
          const taken = takeSource(ref);
          let route = taken.route;
          if (!route && slotPoint) route = { points: [slotPoint], entered: null, sink: null };
          if (!route) continue;
          // At the end of the firing the case takes the look of the place it is put on. Until
          // then it kept the one of the place it was taken from.
          const heldKey = taken.key;
          const heldLook =
            (heldKey !== null ? looks.get(heldKey)?.to : undefined) ??
            (heldKey !== null ? before.tokens.get(heldKey)?.appearance : undefined) ??
            heldAppearance(
              ctx,
              event.transitionId,
              Math.max(0, event.caseIds.indexOf(ref.caseId ?? '')),
            );
          // A case that goes into a counter without an appearance of its own is absorbed as it is.
          const target = view.places[ref.placeId];
          const keeps =
            isCounterPlace(target) &&
            !(target !== undefined && 'appearance' in target && target.appearance);
          looks.set(ref.tokenId, {
            from: heldLook,
            to: keeps ? heldLook : appearanceOfPlace(view, ref.placeId),
          });
          if (heldKey !== null) looks.delete(heldKey);
          if (!pass) route.points.push(...arcPathOf(ctx, event.transitionId, ref.placeId));
          if (isPathPlace(entryPlace)) {
            route.points.push(pointAlong(entryPlace.path, 0).point);
            route.entered = ref.placeId;
          } else if (isCounterPlace(entryPlace)) {
            const anchor = placeAnchor(view, ref.placeId);
            if (anchor) route.points.push(anchor);
            route.sink = ref.placeId;
          } else {
            continue;
          }
          routes.set(ref.tokenId, route);
          origin.set(ref.tokenId, event.id);
        }
        break;
      }
      case 'marking-edited': {
        const entry = view.places[event.placeId];
        const visible = entry !== undefined && entry.kind !== 'hidden';
        elementOf.set(event.id, { elementId: event.placeId, visible });
        cause.set(event.placeId, event.id);
        if (visible && isCounterPlace(entry)) touch(event.placeId, event.id);
        break;
      }
      case 'deviation': {
        // A replay found the log not to fit the net: the places and stations concerned flash red.
        const drawn = [event.placeId, event.transitionId].filter(
          (id): id is Id =>
            id !== undefined &&
            (view.places[id] !== undefined
              ? view.places[id]!.kind !== 'hidden'
              : isVisibleTransition(view.transitions[id])),
        );
        elementOf.set(event.id, {
          elementId: drawn[0] ?? event.placeId ?? event.transitionId,
          visible: drawn.length > 0,
          deviation: drawn,
        });
        break;
      }
      default:
        break;
    }
  }

  // Moves from the routes of the events.
  const motionsByEvent = new Map<number, Motion[]>();
  const record = (motion: Motion): void => {
    created.push(motion);
    const list = motionsByEvent.get(motion.eventId) ?? [];
    list.push(motion);
    motionsByEvent.set(motion.eventId, list);
  };
  const make = (
    key: string,
    eventId: number,
    route: Point[],
    caseId: string | undefined,
    absorbed: boolean,
  ): void => {
    const points = dedupePoints(route);
    if (points.length < 2) return;
    const look = looks.get(key);
    record({
      tokenId: key,
      eventId,
      from: points[0]!,
      to: lastOf(points),
      path: points,
      startedAt: now,
      duration,
      ...(absorbed && { absorbed: true }),
      ...(caseId !== undefined && { caseId }),
      ...(look && { appearance: look }),
    });
  };

  const caseOf = (key: string): string | undefined =>
    after.tokens.get(key)?.caseId ?? before.tokens.get(key)?.caseId;

  for (const [key, route] of routes) {
    const target = after.tokens.get(key);
    const eventId = origin.get(key);
    if (eventId === undefined) continue;
    if (target) {
      if (target.state === 'traveling') {
        // On a route the case moves by simulation time; only what leads up to it is a motion.
        make(key, eventId, route.points, caseOf(key), false);
        continue;
      }
      const points = [...route.points];
      if (route.entered !== null) {
        const entry = view.places[route.entered];
        if (isPathPlace(entry) && target.along !== undefined) {
          points.push(...subPath(entry.path, 0, target.along));
        }
      }
      points.push(target.pos);
      make(key, eventId, points, caseOf(key), false);
    } else if (route.sink !== null) {
      make(key, eventId, route.points, caseOf(key), true);
    }
  }

  // Tokens that stay on their place but move on (a queue closes up after its head left).
  for (const [key, token] of after.tokens) {
    if (routes.has(key) || token.state !== 'waiting') continue;
    const was = before.tokens.get(key);
    const motion = live.get(key);
    if (!was) continue;
    // Already on the way to the right spot, or already there.
    if (
      motion ? distance(motion.to, token.pos) < EPSILON : distance(was.pos, token.pos) < EPSILON
    ) {
      continue;
    }
    const eventId = cause.get(token.elementId);
    if (eventId === undefined) continue;
    const here = currentPoint(key);
    if (!here) continue;
    const entry = view.places[token.elementId];
    let points: Point[] = [here, token.pos];
    if (
      isPathPlace(entry) &&
      motion === undefined &&
      was.along !== undefined &&
      token.along !== undefined &&
      was.elementId === token.elementId
    ) {
      points = subPath(entry.path, was.along, token.along);
    }
    make(key, eventId, points, token.caseId, false);
  }

  // The limit of simultaneous moves: the others jump.
  const carried: Motion[] = [];
  for (const motion of live.values()) {
    if (retired.has(motion.tokenId)) continue;
    // A new move of the same token replaces the one in progress.
    if (created.some((c) => c.tokenId === motion.tokenId)) continue;
    // The token is gone or has not moved on: let the move end.
    carried.push(motion);
  }
  const fresh: Motion[] = [];
  let room = maxMotions - carried.length;
  const loggedMotions: Motion[] = [];
  for (const motion of created) {
    loggedMotions.push(motion);
    if (motion.duration > 0 && room > 0) {
      fresh.push(motion);
      room -= 1;
    }
  }

  // The markers of amounts, with their own limit.
  const carriedFlows = prev.flows.filter((flow) => now < flowEnd(flow));
  const freshFlows: FlowMarker[] = [];
  const flowsByEvent = new Map<number, FlowMarker[]>();
  let flowRoom = maxFlows - carriedFlows.length;
  for (const pending of pendingFlows) {
    const flow: FlowMarker = { ...pending, startedAt: now, duration };
    const list = flowsByEvent.get(flow.eventId) ?? [];
    list.push(flow);
    flowsByEvent.set(flow.eventId, list);
    if (flow.duration > 0 && flowRoom > 0) {
      freshFlows.push(flow);
      flowRoom -= 1;
    }
  }

  // Counters of places that are only numbers.
  const counters: Record<Id, CounterState> = { ...prev.counters };
  const arrivals = new Map<Id, number>();
  for (const [key, route] of routes) {
    if (route.sink === null) continue;
    const motion = fresh.find((m) => m.tokenId === key);
    const delay = motion ? motion.duration : 0;
    arrivals.set(route.sink, Math.max(arrivals.get(route.sink) ?? 0, delay));
  }
  // An amount that flows into a counter shows up when the marker arrives.
  for (const flow of freshFlows) {
    if (flow.direction !== 'in') continue;
    arrivals.set(flow.placeId, Math.max(arrivals.get(flow.placeId) ?? 0, flow.duration));
  }
  for (const place of ctx.net.places) {
    if (!isCounterPlace(view.places[place.id])) continue;
    const was = before.counts.get(place.id) ?? 0;
    const is = after.counts.get(place.id) ?? 0;
    if (was === is) continue;
    const shown = shownCount(prev, place.id, was, now);
    counters[place.id] = {
      value: is,
      previous: shown,
      // Without flashes (reduced motion, top speed) a number is simply right at once.
      changedAt: flashMs === 0 ? Number.NEGATIVE_INFINITY : now + (arrivals.get(place.id) ?? 0),
    };
  }

  // The log: what happened to every event.
  const handled: Handled[] = [];
  // One flash per element: a newer event at an element lets the flash start over.
  const flashing = new Map<Id, Flash>();
  for (const f of prev.flashes) {
    if (now - f.startedAt < flashMs) flashing.set(f.elementId, f);
  }
  const flash = (elementId: Id, eventId: number, deviation = false): void => {
    if (flashMs <= 0) return;
    // A red flash is not painted over by an ordinary one that follows within its time.
    if (!deviation && flashing.get(elementId)?.deviation === true) return;
    flashing.set(elementId, {
      elementId,
      eventId,
      startedAt: now,
      ...(deviation && { deviation: true as const }),
    });
  };
  const counterEvents = new Map<number, Id[]>();
  for (const [placeId, ids] of touchedCounters) {
    for (const id of ids) {
      const list = counterEvents.get(id) ?? [];
      list.push(placeId);
      counterEvents.set(id, list);
    }
  }
  for (const event of events) {
    const info = elementOf.get(event.id);
    if (!info) continue;
    const element = info.elementId;
    if (!info.visible) {
      handled.push({
        eventId: event.id,
        kind: 'hidden',
        ...(element !== undefined && { elementId: element }),
      });
      continue;
    }
    if (info.deviation !== undefined) {
      for (const id of info.deviation) {
        flash(id, event.id, true);
        handled.push({ eventId: event.id, kind: 'flash', elementId: id });
      }
      continue;
    }
    const moved = motionsByEvent.get(event.id) ?? [];
    for (const motion of moved) {
      handled.push({
        eventId: event.id,
        kind: 'motion',
        ...(element !== undefined && { elementId: element }),
        tokenId: motion.tokenId,
      });
    }
    const flowed = flowsByEvent.get(event.id) ?? [];
    for (const flow of flowed) {
      handled.push({ eventId: event.id, kind: 'flow', elementId: flow.placeId });
    }
    const counted = counterEvents.get(event.id) ?? [];
    for (const placeId of counted) {
      handled.push({ eventId: event.id, kind: 'counter', elementId: placeId });
    }
    const shown = moved.length + flowed.length + counted.length;
    if (shown === 0 && element !== undefined) {
      flash(element, event.id);
      handled.push({ eventId: event.id, kind: 'flash', elementId: element });
    } else if (shown === 0) {
      handled.push({ eventId: event.id, kind: 'hidden' });
    }
  }

  const log = [...prev.handled, ...handled];
  const history = extendHistory(prev.history, ctx, events, before, after);
  return {
    motions: [...carried, ...fresh],
    flows: [...carriedFlows, ...freshFlows],
    flashes: [...flashing.values()],
    counters,
    ...(history !== undefined && { history }),
    handled: log.length > logLimit ? log.slice(log.length - logLimit) : log,
  };
}

// --- History of counters ----------------------------------------------------------------------

const historyIds = new WeakMap<LayoutContext, Id[]>();

/** The places whose counter asks for a curve of its count (`display.history`). */
function historyPlaces(ctx: LayoutContext): Id[] {
  let ids = historyIds.get(ctx);
  if (!ids) {
    ids = ctx.net.places
      .filter((place) => {
        const entry = ctx.view.places[place.id];
        return (
          entry !== undefined &&
          (entry.kind === 'pool' || entry.kind === 'source' || entry.kind === 'sink') &&
          entry.display?.history === true
        );
      })
      .map((place) => place.id);
    historyIds.set(ctx, ids);
  }
  return ids;
}

/** By how many tokens an event changes the count of a place. */
function deltaOf(event: SimEvent, placeId: Id): number {
  let delta = 0;
  switch (event.type) {
    case 'start':
      for (const ref of event.consumed) if (ref.placeId === placeId) delta -= 1;
      break;
    case 'complete':
      for (const ref of event.produced) if (ref.placeId === placeId) delta += 1;
      break;
    case 'spawn':
      for (const ref of event.tokens ?? []) if (ref.placeId === placeId) delta += 1;
      break;
    case 'marking-edited':
      if (event.placeId === placeId) delta += event.delta;
      break;
    default:
      break;
  }
  return delta;
}

/** Adds a point to a list that the caller owns. A second point at one instant replaces the first. */
function pushPoint(series: HistoryPoint[], point: HistoryPoint): void {
  const last = series[series.length - 1];
  if (last !== undefined && last.t === point.t) {
    const before = series[series.length - 2];
    if (before !== undefined && before.v === point.v) series.pop();
    else series[series.length - 1] = point;
    return;
  }
  if (last !== undefined && last.v === point.v) return;
  series.push(point);
}

/**
 * The history after a bundle of events: for every counter that has one, a point at each event
 * that changed its count, and at the end the count of the layout, which is the one that is shown.
 * Counters that did not change keep the list they had. Returns `undefined` for a view with no
 * history at all, so that its state stays as it was.
 */
function extendHistory(
  prev: AnimationState['history'],
  ctx: LayoutContext,
  events: readonly SimEvent[],
  before: TokenLayout,
  after: TokenLayout,
): AnimationState['history'] {
  const ids = historyPlaces(ctx);
  if (ids.length === 0) return prev;
  const next: Record<Id, HistoryPoint[]> = { ...prev };
  for (const id of ids) {
    const known = prev?.[id];
    const series: HistoryPoint[] = known ? known.slice() : [];
    let count = before.counts.get(id) ?? 0;
    // The first point is where the series starts: the count of the layout before the events.
    if (series.length === 0) series.push({ t: before.time, v: count });
    else count = series[series.length - 1]!.v;
    let changed = known === undefined;
    for (const event of events) {
      const delta = deltaOf(event, id);
      if (delta === 0) continue;
      count += delta;
      pushPoint(series, { t: event.t, v: count });
      changed = true;
    }
    const actual = after.counts.get(id) ?? 0;
    const last = series[series.length - 1]!;
    if (last.v !== actual) {
      pushPoint(series, { t: Math.max(after.time, last.t), v: actual });
      changed = true;
    }
    if (!changed) continue;
    let kept = series;
    if (kept[0]!.t < after.time - HISTORY_WINDOW_SECONDS) kept = trimHistory(kept, after.time);
    next[id] = kept.length > HISTORY_LIMIT ? compactHistory(kept) : kept;
  }
  return next;
}

/**
 * The history after a jump of the simulation (reset, step back, a state set from outside): the
 * points up to the time of the new state stay, those after it are cut away, and the last point is
 * the count of the new state. A reset to time 0 thus leaves a single point.
 */
export function rewindHistory(
  prev: AnimationState['history'],
  ctx: LayoutContext,
  layout: TokenLayout,
): AnimationState['history'] {
  const ids = historyPlaces(ctx);
  if (ids.length === 0) return undefined;
  const result: Record<Id, HistoryPoint[]> = {};
  for (const id of ids) {
    const series = (prev?.[id] ?? []).filter((point) => point.t <= layout.time);
    const actual = layout.counts.get(id) ?? 0;
    const last = series[series.length - 1];
    if (last === undefined || last.t < layout.time) series.push({ t: layout.time, v: actual });
    else series[series.length - 1] = { t: last.t, v: actual };
    result[id] = series;
  }
  return result;
}

/** The place that holds the token of a case, for events that name no element. */
function placeOfCase(layout: TokenLayout, caseId: string): Id | undefined {
  for (const token of layout.tokens.values()) {
    if (token.caseId === caseId && token.state === 'waiting') return token.elementId;
  }
  const meta = layout.state.meta ?? {};
  for (const [placeId, tokens] of Object.entries(meta)) {
    if (tokens.some((t) => t.caseId === caseId)) return placeId;
  }
  return undefined;
}
