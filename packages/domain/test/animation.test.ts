import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNetText, type PetriNet } from '@pnm/core';
import type { SimEvent } from '@pnm/sim';
import { describe, expect, it } from 'vitest';
import {
  applyEvents,
  EMPTY_ANIMATION,
  firingKey,
  genericDomainView,
  INSTANT,
  isAnimating,
  layoutContext,
  layoutTokens,
  motionPoint,
  pruneAnimation,
  sampleSprites,
  sampleTokens,
  shownCount,
  type AnimationOptions,
  type DomainView,
  type LayoutState,
} from '../src';
import { runAnimated } from './animated-run';
import { smallNet, smallView } from './helpers';

const root = join(import.meta.dirname, '..', '..', '..');
const example = (name: string): PetriNet =>
  parseNetText(readFileSync(join(root, 'examples', `${name}.pn.json`), 'utf8'));

const net = smallNet();
const view = smallView(net);
const context = layoutContext(net, view);
const options: AnimationOptions = { context, logLimit: Infinity };

const metas = (n: number, prefix = 'k') =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, caseId: `C-${i}`, enteredAt: i }));

const state = (patch: Partial<LayoutState>): LayoutState => ({
  time: 0,
  marking: {},
  running: [],
  ...patch,
});

const startEvent = (
  id: number,
  patch: Partial<Extract<SimEvent, { type: 'start' }>> = {},
): SimEvent => ({
  id,
  t: 0,
  type: 'start',
  transitionId: 'work',
  firingId: 1,
  slot: 0,
  caseIds: ['C-0'],
  binding: {},
  consumed: [{ placeId: 'q', tokenId: 'k0', caseId: 'C-0' }],
  ...patch,
});

const completeEvent = (
  id: number,
  patch: Partial<Extract<SimEvent, { type: 'complete' }>> = {},
): SimEvent => ({
  id,
  t: 20,
  type: 'complete',
  transitionId: 'work',
  firingId: 1,
  slot: 0,
  caseIds: ['C-0'],
  produced: [{ placeId: 'done', tokenId: 'k9', caseId: 'C-0' }],
  ...patch,
});

describe('applyEvents: a case enters a station', () => {
  // Three cases wait; the oldest is taken by a firing on slot 0.
  const before = layoutTokens(
    net,
    view,
    state({ marking: { q: [1, 1, 1] }, meta: { q: metas(3) } }),
  );
  const after = layoutTokens(
    net,
    view,
    state({
      marking: { q: [1, 1] },
      meta: { q: metas(3).slice(1) },
      running: [
        { firingId: 1, transitionId: 'work', start: 0, end: 20, slot: 0, caseIds: ['C-0'] },
      ],
    }),
  );
  const anim = applyEvents(EMPTY_ANIMATION, [startEvent(5)], before, after, 1000, options);

  it('moves the case from the head of the queue to the slot', () => {
    const motion = anim.motions.find((m) => m.tokenId === firingKey(1, 'C-0'))!;
    expect(motion).toBeDefined();
    expect(motion.eventId).toBe(5);
    expect(motion.from).toEqual([292, 200]);
    expect(motion.to).toEqual([370, 200]);
    expect(motion.duration).toBe(300);
    expect(motion.startedAt).toBe(1000);
    expect(motion.caseId).toBe('C-0');
  });

  it('closes up the queue behind the head', () => {
    const second = anim.motions.find((m) => m.tokenId === 'k1')!;
    expect(second.eventId).toBe(5);
    expect(second.from).toEqual([276, 200]);
    expect(second.to).toEqual([292, 200]);
    const third = anim.motions.find((m) => m.tokenId === 'k2')!;
    expect(third.from).toEqual([260, 200]);
    expect(third.to).toEqual([276, 200]);
  });

  it('logs the event as handled by motions', () => {
    expect(anim.handled.every((h) => h.eventId === 5)).toBe(true);
    expect(anim.handled.every((h) => h.kind === 'motion')).toBe(true);
    expect(anim.handled).toHaveLength(anim.motions.length);
    expect(anim.flashes).toEqual([]);
  });

  it('interpolates with ease-in-out and ends at the target', () => {
    const motion = anim.motions.find((m) => m.tokenId === firingKey(1, 'C-0'))!;
    expect(motionPoint(motion, 1000).point).toEqual([292, 200]);
    const half = motionPoint(motion, 1150).point;
    expect(half[0]).toBeCloseTo(331, 5);
    const quarter = motionPoint(motion, 1075).point;
    // Slow at the start: less than a quarter of the way after a quarter of the time.
    expect(quarter[0] - 292).toBeLessThan((370 - 292) * 0.25);
    expect(motionPoint(motion, 1300).point).toEqual([370, 200]);
    expect(motionPoint(motion, 5000).point).toEqual([370, 200]);
  });

  it('samples sprites: moving ones on their route, resting ones at their place', () => {
    const early = sampleTokens(after, anim, 1000);
    expect(early[firingKey(1, 'C-0')]).toEqual([292, 200]);
    expect(early['k1']).toEqual([276, 200]);
    const late = sampleTokens(after, anim, 1400);
    expect(late[firingKey(1, 'C-0')]).toEqual([370, 200]);
    expect(late['k1']).toEqual([292, 200]);
    // No sprite is drawn twice.
    const sprites = sampleSprites(after, anim, 1100);
    expect(new Set(sprites.map((s) => s.key)).size).toBe(sprites.length);
    expect(sprites.filter((s) => s.moving)).toHaveLength(anim.motions.length);
  });
});

describe('applyEvents: a case leaves a station', () => {
  const before = layoutTokens(
    net,
    view,
    state({
      time: 20,
      marking: {},
      running: [
        { firingId: 1, transitionId: 'work', start: 0, end: 20, slot: 0, caseIds: ['C-0'] },
      ],
    }),
  );
  const after = layoutTokens(
    net,
    view,
    state({
      time: 20,
      marking: { done: [1] },
      meta: { done: [{ id: 'k9', caseId: 'C-0', enteredAt: 20 }] },
    }),
  );
  const anim = applyEvents(EMPTY_ANIMATION, [completeEvent(8)], before, after, 500, options);

  it('follows the connector of the view into the sink and is absorbed there', () => {
    const motion = anim.motions.find((m) => m.tokenId === 'k9')!;
    expect(motion.eventId).toBe(8);
    expect(motion.absorbed).toBe(true);
    expect(motion.from).toEqual([370, 200]);
    // Slot, then the connector 'work>done' of the view, then the middle of the sink box.
    expect(motion.path).toEqual([
      [370, 200],
      [420, 200],
      [600, 200],
      [640, 200],
    ]);
  });

  it('lets the counter of the sink count up when the case arrives', () => {
    expect(anim.counters['done']).toEqual({ value: 1, previous: 0, changedAt: 800 });
    expect(shownCount(anim, 'done', 1, 600)).toBe(0);
    expect(shownCount(anim, 'done', 1, 800)).toBe(1);
    expect(anim.handled.map((h) => h.kind).sort()).toEqual(['counter', 'motion']);
    expect(anim.handled.every((h) => h.eventId === 8)).toBe(true);
    // An absorbed case is not drawn once it has arrived.
    expect(sampleTokens(after, anim, 900)['k9']).toBeUndefined();
  });

  it('does not show a stale counter once the real number differs', () => {
    expect(shownCount(anim, 'done', 3, 600)).toBe(3);
  });
});

describe('applyEvents: start and complete in one bundle', () => {
  it('draws one route over the station into the next queue', () => {
    const before = layoutTokens(net, view, state({ marking: { q: [1] }, meta: { q: metas(1) } }));
    const after = layoutTokens(
      net,
      view,
      state({
        time: 0,
        marking: { done: [1] },
        meta: { done: [{ id: 'k9', caseId: 'C-0', enteredAt: 0 }] },
      }),
    );
    const events = [startEvent(1), completeEvent(2, { t: 0 })];
    const anim = applyEvents(EMPTY_ANIMATION, events, before, after, 0, options);
    expect(anim.motions).toHaveLength(1);
    const motion = anim.motions[0]!;
    expect(motion.tokenId).toBe('k9');
    expect(motion.eventId).toBe(2);
    expect(motion.from).toEqual([292, 200]);
    expect(motion.path).toContainEqual([370, 200]);
    // The start has no motion of its own; it lights up the station.
    const kinds = anim.handled.map((h) => [h.eventId, h.kind]);
    expect(kinds).toContainEqual([1, 'flash']);
    expect(kinds).toContainEqual([2, 'motion']);
    expect(anim.flashes).toEqual([{ elementId: 'work', eventId: 1, startedAt: 0 }]);
  });
});

describe('applyEvents: limits and modes', () => {
  const many = (n: number) => {
    const before = layoutTokens(
      net,
      view,
      state({ marking: { q: Array(n).fill(1) }, meta: { q: metas(n) } }),
    );
    const after = layoutTokens(
      net,
      view,
      state({
        marking: { q: Array(n - 1).fill(1) },
        meta: { q: metas(n).slice(1) },
        running: [
          { firingId: 1, transitionId: 'work', start: 0, end: 20, slot: 0, caseIds: ['C-0'] },
        ],
      }),
    );
    return { before, after };
  };

  it('lets at most the maximum number of tokens move; the others jump but are logged', () => {
    const { before, after } = many(11);
    const capped = applyEvents(EMPTY_ANIMATION, [startEvent(1)], before, after, 0, {
      ...options,
      maxMotions: 4,
    });
    expect(capped.motions).toHaveLength(4);
    expect(capped.handled.filter((h) => h.kind === 'motion')).toHaveLength(11);
    const sprites = sampleTokens(after, capped, 10);
    // Everything is somewhere, moving or at rest.
    expect(Object.keys(sprites).length).toBe(11);
  });

  it('counts the moves in progress against the limit', () => {
    const { before, after } = many(11);
    const first = applyEvents(EMPTY_ANIMATION, [startEvent(1)], before, after, 0, {
      ...options,
      maxMotions: 12,
    });
    expect(first.motions).toHaveLength(11);
    const again = applyEvents(first, [], after, after, 100, { ...options, maxMotions: 12 });
    // Nothing new, the moves in progress are kept.
    expect(again.motions).toHaveLength(11);
  });

  it('makes tokens jump and shows no flash when durations are 0', () => {
    const { before, after } = many(5);
    const jump = applyEvents(EMPTY_ANIMATION, [startEvent(1)], before, after, 0, {
      ...options,
      ...INSTANT,
    });
    expect(jump.motions).toEqual([]);
    expect(jump.handled.filter((h) => h.kind === 'motion').length).toBeGreaterThan(0);
    const flashing = applyEvents(
      EMPTY_ANIMATION,
      [{ id: 3, t: 0, type: 'spawn', transitionId: 't_in', caseId: 'C-9' }],
      before,
      before,
      0,
      { ...options, ...INSTANT },
    );
    expect(flashing.flashes).toEqual([]);
    expect(flashing.handled).toEqual([{ eventId: 3, kind: 'flash', elementId: 't_in' }]);
  });

  it('restarts a move in progress from where the token is when a new one arrives', () => {
    const { before, after } = many(4);
    const first = applyEvents(EMPTY_ANIMATION, [startEvent(1)], before, after, 0, options);
    const moving = first.motions.find((m) => m.tokenId === 'k1')!;
    // The next head leaves while k1 is half way.
    const afterTwo = layoutTokens(
      net,
      view,
      state({
        marking: { q: [1, 1] },
        meta: { q: metas(4).slice(2) },
        running: [
          { firingId: 1, transitionId: 'work', start: 0, end: 20, slot: 0, caseIds: ['C-0'] },
          { firingId: 2, transitionId: 'work', start: 0, end: 20, slot: 1, caseIds: ['C-1'] },
        ],
      }),
    );
    const next = applyEvents(
      first,
      [
        startEvent(2, {
          firingId: 2,
          slot: 1,
          caseIds: ['C-1'],
          consumed: [{ placeId: 'q', tokenId: 'k1', caseId: 'C-1' }],
        }),
      ],
      after,
      afterTwo,
      150,
      options,
    );
    const here = motionPoint(moving, 150).point;
    const restarted = next.motions.find((m) => m.tokenId === firingKey(2, 'C-1'))!;
    // k1 became the case of firing 2: its move starts where k1 was seen at that moment.
    expect(restarted.from[0]).toBeCloseTo(here[0], 5);
    expect(restarted.eventId).toBe(2);
    // The old move of k1 is gone, the one of k2 was replaced.
    expect(next.motions.filter((m) => m.tokenId === 'k1')).toHaveLength(0);
    expect(next.motions.filter((m) => m.tokenId === 'k2')).toHaveLength(1);
    expect(next.motions.find((m) => m.tokenId === 'k2')!.startedAt).toBe(150);
  });

  it('prunes what has ended and knows when nothing moves', () => {
    const { before, after } = many(3);
    const anim = applyEvents(EMPTY_ANIMATION, [startEvent(1)], before, after, 0, options);
    expect(isAnimating(anim, 100)).toBe(true);
    const pruned = pruneAnimation(anim, 1000);
    expect(pruned.motions).toEqual([]);
    expect(isAnimating(pruned, 1000)).toBe(false);
    expect(isAnimating(EMPTY_ANIMATION, 0)).toBe(false);
  });

  it('keeps only the newest entries of the log', () => {
    const { before, after } = many(11);
    const anim = applyEvents(EMPTY_ANIMATION, [startEvent(1)], before, after, 0, {
      ...options,
      logLimit: 3,
    });
    expect(anim.handled).toHaveLength(3);
  });
});

describe('applyEvents: other events', () => {
  const resting = layoutTokens(net, view, state({ marking: { q: [1] }, meta: { q: metas(1) } }));

  it('lights up a door for an arrival and a place for an edited marking', () => {
    const anim = applyEvents(
      EMPTY_ANIMATION,
      [
        { id: 1, t: 0, type: 'spawn', transitionId: 't_in', caseId: 'C-0' },
        { id: 2, t: 0, type: 'marking-edited', placeId: 'q', delta: 1, reason: 'user' },
        { id: 3, t: 0, type: 'idle' },
      ],
      resting,
      resting,
      50,
      options,
    );
    expect(anim.handled).toEqual([
      { eventId: 1, kind: 'flash', elementId: 't_in' },
      { eventId: 2, kind: 'flash', elementId: 'q' },
    ]);
    expect(anim.flashes.map((f) => f.elementId)).toEqual(['t_in', 'q']);
    expect(isAnimating(anim, 100)).toBe(true);
    expect(isAnimating(anim, 50 + 700)).toBe(false);
  });

  it('finds the place of a case of the initial marking', () => {
    const anim = applyEvents(
      EMPTY_ANIMATION,
      [{ id: 1, t: 0, type: 'spawn', caseId: 'C-0' }],
      resting,
      resting,
      0,
      options,
    );
    expect(anim.handled).toEqual([{ eventId: 1, kind: 'flash', elementId: 'q' }]);
  });

  it('logs events at hidden elements as hidden and draws nothing for them', () => {
    const hidden: DomainView = structuredClone(view);
    hidden.transitions['work'] = { kind: 'hidden', reason: 'not drawn' };
    const hiddenContext = layoutContext(net, hidden);
    const before = layoutTokens(net, hidden, state({ marking: { q: [1] }, meta: { q: metas(1) } }));
    const after = layoutTokens(net, hidden, state({ marking: {} }));
    const anim = applyEvents(EMPTY_ANIMATION, [startEvent(1)], before, after, 0, {
      ...options,
      context: hiddenContext,
    });
    expect(anim.handled).toEqual([{ eventId: 1, kind: 'hidden', elementId: 'work' }]);
    expect(anim.motions).toEqual([]);
    expect(anim.flashes).toEqual([]);
  });

  it('does not change the state it is given', () => {
    const frozen = Object.freeze({
      motions: Object.freeze([]) as never,
      flashes: Object.freeze([]) as never,
      counters: Object.freeze({}) as never,
      handled: Object.freeze([]) as never,
    });
    const anim = applyEvents(
      frozen,
      [{ id: 1, t: 0, type: 'spawn', transitionId: 't_in', caseId: 'C-0' }],
      resting,
      resting,
      0,
      options,
    );
    expect(anim.handled).toHaveLength(1);
    expect(frozen.handled).toHaveLength(0);
  });
});

/** Ids of the events that concern an element the view draws. */
function visibleEventIds(
  events: readonly SimEvent[],
  view: DomainView,
  layout: ReturnType<typeof layoutTokens>,
): number[] {
  const ids: number[] = [];
  for (const event of events) {
    if (event.type === 'start' || event.type === 'complete') {
      if (view.transitions[event.transitionId]?.kind !== 'hidden') ids.push(event.id);
    } else if (event.type === 'spawn') {
      if (event.transitionId !== undefined) {
        if (view.transitions[event.transitionId]?.kind !== 'hidden') ids.push(event.id);
      } else if (layout) ids.push(event.id);
    }
  }
  return ids;
}

describe('acceptance A2: the renderer log against the event stream (parcel center, 30 minutes)', () => {
  const parcel = example('parcel-center');
  const parcelView = parcel.domainView as DomainView;

  for (const [name, bundle] of [
    ['bundles of 0.4 s (10x)', 0.4],
    ['bundles of 6 s (60x)', 6],
    ['bundles of 90 s (large jumps)', 90],
  ] as const) {
    it(`every event has an animation or state change, every animation one event: ${name}`, async () => {
      const { events, anim, layout, motions } = await runAnimated(parcel, parcelView, {
        bundle,
        seconds: 1800,
      });
      expect(events.length).toBeGreaterThan(300);
      const ids = new Set(events.map((e) => e.id));
      const handled = new Map<number, Set<string>>();
      for (const entry of anim.handled) {
        expect(ids.has(entry.eventId)).toBe(true);
        const kinds = handled.get(entry.eventId) ?? new Set<string>();
        kinds.add(entry.kind);
        handled.set(entry.eventId, kinds);
      }
      // 1. Every spawn, start and complete at a visible element is handled.
      const missing = visibleEventIds(events, parcelView, layout).filter((id) => !handled.has(id));
      expect(missing).toEqual([]);
      // 2. Every motion belongs to an event of the stream, and to an event of the right kind.
      const byId = new Map(events.map((e) => [e.id, e]));
      expect(motions.length).toBeGreaterThan(50);
      for (const motion of motions) {
        const event = byId.get(motion.eventId);
        expect(event, `motion ${motion.tokenId}`).toBeDefined();
        expect(['start', 'complete', 'marking-edited']).toContain(event!.type);
        expect(handled.get(motion.eventId)?.has('motion')).toBe(true);
      }
      // 3. Flashes and counters belong to events too.
      for (const flash of anim.flashes) expect(ids.has(flash.eventId)).toBe(true);
      // 4. Whatever the log says is a motion has a move behind it; nothing is logged twice as
      //    different kinds for one move.
      const motionEntries = anim.handled.filter((h) => h.kind === 'motion');
      expect(motionEntries.every((h) => h.tokenId !== undefined)).toBe(true);
      // 5. The counters of the sink agree with the stream.
      const sink = anim.counters['p_done'];
      const completed = events.filter(
        (e) => e.type === 'complete' && e.produced.some((p) => p.placeId === 'p_done'),
      ).length;
      expect(sink?.value ?? 0).toBe(completed);
    });
  }

  it('with durations of 0 every event is handled as well, and nothing is left moving', async () => {
    const { events, anim, layout } = await runAnimated(parcel, parcelView, {
      bundle: 6,
      seconds: 1800,
      animation: INSTANT,
    });
    const handled = new Set(anim.handled.map((h) => h.eventId));
    expect(visibleEventIds(events, parcelView, layout).filter((id) => !handled.has(id))).toEqual(
      [],
    );
    expect(anim.motions).toEqual([]);
    expect(anim.flashes).toEqual([]);
  });

  it('events of hidden stations are logged as hidden', async () => {
    const hidden: DomainView = structuredClone(parcelView);
    hidden.transitions['t_sort'] = { kind: 'hidden', reason: 'not drawn' };
    const { events, anim } = await runAnimated(parcel, hidden, { bundle: 6, seconds: 1800 });
    const sortEvents = events.filter(
      (e) => (e.type === 'start' || e.type === 'complete') && e.transitionId === 't_sort',
    );
    expect(sortEvents.length).toBeGreaterThan(10);
    const kinds = new Map(
      anim.handled.filter((h) => h.elementId === 't_sort').map((h) => [h.eventId, h.kind]),
    );
    for (const event of sortEvents) expect(kinds.get(event.id)).toBe('hidden');
  });
});

describe('acceptance A1: two hours of simulated time with layout and animation', () => {
  const cases: Array<[string, PetriNet, DomainView]> = [
    ['parcel center', example('parcel-center'), example('parcel-center').domainView as DomainView],
    ['smart office', example('smart-office'), example('smart-office').domainView as DomainView],
    [
      'complaint handling (generic view)',
      example('complaint-handling'),
      genericDomainView(example('complaint-handling')),
    ],
  ];

  for (const [name, caseNet, caseView] of cases) {
    it(`${name} runs without errors and keeps the invariants`, async () => {
      let bundles = 0;
      let maxSprites = 0;
      const { events, anim } = await runAnimated(caseNet, caseView, {
        bundle: 6,
        seconds: 7200,
        onBundle: (_bundle, state, layout, now) => {
          bundles += 1;
          // Every sprite has a finite position; nothing moves more than 60 at a time.
          expect(state.motions.length).toBeLessThanOrEqual(60);
          const sprites = sampleSprites(layout, state, now + 100, layout.time);
          maxSprites = Math.max(maxSprites, sprites.length);
          for (const sprite of sprites) {
            expect(Number.isFinite(sprite.point[0]) && Number.isFinite(sprite.point[1])).toBe(true);
          }
        },
      });
      expect(bundles).toBeGreaterThan(1000);
      expect(events.length).toBeGreaterThan(100);
      expect(maxSprites).toBeGreaterThan(0);
      const ids = new Set(events.map((e) => e.id));
      expect(anim.handled.every((h) => ids.has(h.eventId))).toBe(true);
    }, 20_000);
  }

  it('runs all examples with their generic views', async () => {
    for (const name of [
      'producer-consumer',
      'order-processing',
      'traffic-light',
      'mutual-exclusion',
      'token-ring',
      'dining-philosophers-3',
    ]) {
      const exampleNet = example(name);
      const { events } = await runAnimated(exampleNet, genericDomainView(exampleNet), {
        bundle: 6,
        seconds: 600,
      });
      expect(events.length, name).toBeGreaterThan(0);
    }
  }, 20_000);
});
