import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNetText, type PetriNet } from '@pnm/core';
import {
  createReplay,
  createSimulation,
  type LogEvent,
  type SimEvent,
  type Simulation,
} from '@pnm/sim';
import { describe, expect, it } from 'vitest';
import {
  applyEvents,
  buildDynamicScene,
  buildStaticScene,
  EMPTY_ANIMATION,
  INSTANT,
  layoutContext,
  layoutTokens,
  type DomainView,
  type DrawCommand,
} from '../src';
import { runAnimated } from './animated-run';
import { smallNet, smallView } from './helpers';

const root = join(import.meta.dirname, '..', '..', '..');
const example = (name: string): PetriNet =>
  parseNetText(readFileSync(join(root, 'examples', `${name}.pn.json`), 'utf8'));

/** The events of an engine run as an event log, with the names of the transitions as activities. */
async function engineLog(net: PetriNet, seconds: number): Promise<LogEvent[]> {
  const sim = createSimulation(net, { seed: 1 });
  const events: SimEvent[] = [...sim.initialEvents, ...(await sim.advance(seconds))];
  const names = new Map(net.transitions.map((t) => [t.id, t.name]));
  return events.flatMap((event) =>
    event.type === 'start' || event.type === 'complete'
      ? event.caseIds.map((caseId) => ({
          caseId,
          activity: names.get(event.transitionId) ?? event.transitionId,
          time: event.t,
          lifecycle: event.type,
        }))
      : [],
  );
}

const mappingOf = (net: PetriNet): Record<string, string> =>
  Object.fromEntries(net.transitions.map((t) => [t.name, t.id]));

describe('acceptance A2 for events of a replay (parcel center, 30 minutes)', () => {
  const net = example('parcel-center');
  const view = net.domainView as DomainView;
  const replayOf =
    (log: LogEvent[]) =>
    (n: PetriNet): Simulation =>
      createReplay(n, log, { mapping: mappingOf(n) });

  for (const bundle of [0.4, 6, 90]) {
    it(`every event has a motion, flash or counter and every motion belongs to an event: bundles of ${bundle} s`, async () => {
      const log = await engineLog(net, 1800);
      const { events, anim, motions } = await runAnimated(net, view, {
        bundle,
        seconds: 1800,
        simulation: replayOf(log),
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
      // Every start, complete and spawn at an element of the view is handled.
      const visible = events.filter((e) => {
        if (e.type === 'start' || e.type === 'complete') {
          return view.transitions[e.transitionId]?.kind !== 'hidden';
        }
        return e.type === 'spawn';
      });
      expect(visible.filter((e) => !handled.has(e.id))).toEqual([]);
      // Tokens move for starts and completes of the replay, as they do for the engine's.
      expect(motions.length).toBeGreaterThan(50);
      const byId = new Map(events.map((e) => [e.id, e]));
      for (const motion of motions) {
        expect(['start', 'complete']).toContain(byId.get(motion.eventId)?.type);
      }
      expect(anim.counters['p_done']?.value ?? 0).toBe(
        events.filter(
          (e) => e.type === 'complete' && e.produced.some((p) => p.placeId === 'p_done'),
        ).length,
      );
      // Nothing deviates: nothing flashes red.
      expect(events.some((e) => e.type === 'deviation')).toBe(false);
    });
  }

  it('a deviation makes the element flash red, once per event, and is logged', async () => {
    const log = (await engineLog(net, 1200)).filter((e) => e.activity !== 'Scannen');
    const red: Array<{ elementId: string; eventId: number }> = [];
    const { events, anim } = await runAnimated(net, view, {
      bundle: 6,
      seconds: 1200,
      simulation: replayOf(log),
      onBundle: (_bundle, state) => {
        for (const flash of state.flashes) {
          if (flash.deviation === true)
            red.push({ elementId: flash.elementId, eventId: flash.eventId });
        }
      },
    });
    const deviations = events.filter((e) => e.type === 'deviation');
    expect(deviations.length).toBeGreaterThan(10);
    expect(red.length).toBeGreaterThan(10);
    const ids = new Set(deviations.map((e) => e.id));
    for (const flash of red) expect(ids.has(flash.eventId)).toBe(true);
    // The station of the activity that found no token flashes.
    expect(red.some((f) => f.elementId === 't_sort')).toBe(true);
    // Every deviation is in the log of handled events, as a flash of the element it concerns.
    const logged = new Set(
      anim.handled.filter((h) => h.kind === 'flash' && ids.has(h.eventId)).map((h) => h.eventId),
    );
    expect(logged.size).toBe(deviations.length);

    // And it is drawn in the danger colour, fading like any flash.
    const flash = { elementId: 't_sort', eventId: 1, startedAt: 100, deviation: true as const };
    const ordinary = { ...flash, deviation: undefined };
    const layout = layoutTokens(net, view, { time: 0, marking: {}, running: [] });
    const draw = (f: typeof flash | typeof ordinary): DrawCommand[] =>
      buildDynamicScene(
        layoutContext(net, view),
        buildStaticScene(net, view),
        layout,
        {
          motions: [],
          flows: [],
          flashes: [f as never],
          counters: {},
          handled: [],
        },
        { now: 300 },
      ).layers.tokens.filter((c) => c.elementId === 't_sort');
    expect(draw(flash).some((c) => 'stroke' in c && c.stroke === 'danger')).toBe(true);
    expect(draw(ordinary).some((c) => 'stroke' in c && c.stroke === 'ok')).toBe(true);
    expect(draw(ordinary).some((c) => 'stroke' in c && c.stroke === 'danger')).toBe(false);
  });
});

describe('deviation events in the animation of a small view', () => {
  const net = smallNet();
  const view = smallView(net);
  const context = layoutContext(net, view);
  const resting = layoutTokens(net, view, { time: 0, marking: {}, running: [] });
  const options = { context, logLimit: Infinity };
  const deviation = (
    id: number,
    patch: Partial<Extract<SimEvent, { type: 'deviation' }>> = {},
  ): SimEvent => ({
    id,
    t: 0,
    type: 'deviation',
    kind: 'missing',
    message: 'no token',
    caseId: 'C-1',
    ...patch,
  });

  it('flashes the station and the place that the deviation concerns', () => {
    const anim = applyEvents(
      EMPTY_ANIMATION,
      [deviation(1, { transitionId: 'work', placeId: 'q' })],
      resting,
      resting,
      0,
      options,
    );
    expect(anim.flashes.map((f) => [f.elementId, f.deviation])).toEqual([
      ['q', true],
      ['work', true],
    ]);
    expect(anim.handled).toEqual([
      { eventId: 1, kind: 'flash', elementId: 'q' },
      { eventId: 1, kind: 'flash', elementId: 'work' },
    ]);
    expect(anim.motions).toEqual([]);
  });

  it('logs a deviation that concerns nothing that is drawn as hidden, and does not flash', () => {
    const none = applyEvents(
      EMPTY_ANIMATION,
      [deviation(1, { kind: 'ignored', activity: 'Label' })],
      resting,
      resting,
      0,
      options,
    );
    expect(none.handled).toEqual([{ eventId: 1, kind: 'hidden' }]);
    expect(none.flashes).toEqual([]);
    const hiddenView = structuredClone(view);
    hiddenView.transitions['work'] = { kind: 'hidden', reason: 'not drawn' };
    const hidden = applyEvents(
      EMPTY_ANIMATION,
      [deviation(2, { transitionId: 'work' })],
      resting,
      resting,
      0,
      { context: layoutContext(net, hiddenView), logLimit: Infinity },
    );
    expect(hidden.handled).toEqual([{ eventId: 2, kind: 'hidden', elementId: 'work' }]);
    expect(hidden.flashes).toEqual([]);
  });

  it('shows no red flash with the flash switched off, and keeps red against an ordinary flash', () => {
    const instant = applyEvents(
      EMPTY_ANIMATION,
      [deviation(1, { transitionId: 'work' })],
      resting,
      resting,
      0,
      { ...options, ...INSTANT },
    );
    expect(instant.flashes).toEqual([]);
    expect(instant.handled).toEqual([{ eventId: 1, kind: 'flash', elementId: 'work' }]);
    // An ordinary event at the same station right after does not paint over the red.
    const both = applyEvents(
      EMPTY_ANIMATION,
      [
        deviation(1, { transitionId: 'work' }),
        { id: 2, t: 0, type: 'spawn', transitionId: 'work', caseId: 'C-2' },
      ],
      resting,
      resting,
      0,
      options,
    );
    expect(both.flashes.filter((f) => f.elementId === 'work')).toEqual([
      { elementId: 'work', eventId: 1, startedAt: 0, deviation: true },
    ]);
  });
});
