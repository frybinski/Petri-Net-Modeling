import { type PetriNet } from '@pnm/core';
import type { SimEvent } from '@pnm/sim';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_ANIMATION,
  buildDynamicScene,
  buildStaticScene,
  INSTANT,
  applyEvents,
  flowEnd,
  flowLabel,
  flowPoint,
  isAnimating,
  layoutContext,
  layoutTokens,
  netHash,
  pruneAnimation,
  sampleSprites,
  validateDomainView,
  type AnimationOptions,
  type AnimationState,
  type DomainView,
  type FlowMarker,
  type LayoutState,
} from '../src';
import { runAnimated } from './animated-run';
import { smallNet, smallView } from './helpers';

/**
 * The small net of the other tests, extended by two amounts: `work` takes 3 `steel` and puts
 * 1 `co2` on a place that is a sink by its arcs. Both are quantity places and drawn as counters.
 */
function amountsNet(): PetriNet {
  const net = smallNet();
  net.places.push(
    { id: 'steel', name: 'Steel (kg)', position: { x: 360, y: 200 }, role: 'quantity' },
    { id: 'co2', name: 'CO2e (kg)', position: { x: 520, y: 200 }, role: 'quantity' },
  );
  net.arcs.push(
    { id: 'a6', source: 'steel', target: 'work', weight: 3 },
    { id: 'a7', source: 'work', target: 'co2', weight: 1 },
  );
  net.marking['steel'] = Array.from({ length: 300 }, () => 1);
  net.transitions.find((t) => t.id === 'work')!.timing = { kind: 'fixed', value: 20 };
  net.transitions.find((t) => t.id === 't_in')!.rate = 60;
  return net;
}

function amountsView(net: PetriNet): DomainView {
  const view = structuredClone(smallView(net));
  view.netHash = netHash(net);
  view.places['steel'] = { kind: 'pool', pos: [370, 320], label: 'Steel (kg)' };
  view.places['co2'] = { kind: 'sink', box: [600, 280, 120, 70], label: 'CO2e (kg)' };
  view.arcs = {
    ...view.arcs,
    'steel>work': {
      path: [
        [370, 300],
        [370, 240],
      ],
    },
    'work>co2': {
      path: [
        [420, 210],
        [500, 250],
        [600, 300],
      ],
    },
  };
  return view;
}

const net = amountsNet();
const view = amountsView(net);
const context = layoutContext(net, view);
const options: AnimationOptions = { context, logLimit: Infinity };

const state = (patch: Partial<LayoutState>): LayoutState => ({
  time: 0,
  marking: {},
  running: [],
  ...patch,
});

const start = (
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
  consumed: [
    { placeId: 'q', tokenId: 'k0', caseId: 'C-0' },
    ...[0, 1, 2].map((i) => ({ placeId: 'steel', tokenId: `s${i}` })),
  ],
  ...patch,
});

const complete = (
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
  produced: [
    { placeId: 'done', tokenId: 'k9', caseId: 'C-0' },
    { placeId: 'co2', tokenId: 'c1' },
  ],
  ...patch,
});

const steel = (n: number) => ({
  steel: Array.from({ length: n }, (_, i) => ({ id: `s${i}`, enteredAt: 0 })),
});

describe('flow markers for amounts on quantity places', () => {
  // A case and 30 steel; the firing starts and takes the case and 3 steel.
  const before = layoutTokens(
    net,
    view,
    state({
      marking: { q: [1], steel: Array.from({ length: 30 }, () => 1) },
      meta: { q: [{ id: 'k0', caseId: 'C-0', enteredAt: 0 }], ...steel(30) },
    }),
  );
  const running = [
    { firingId: 1, transitionId: 'work', start: 0, end: 20, slot: 0, caseIds: ['C-0'] },
  ];
  const afterStart = layoutTokens(
    net,
    view,
    state({ marking: { steel: Array.from({ length: 27 }, () => 1) }, meta: steel(27), running }),
  );

  it('a start sends −3 from the counter to the station, as one marker for the three tokens', () => {
    const anim = applyEvents(EMPTY_ANIMATION, [start(5)], before, afterStart, 1000, options);
    expect(anim.flows).toHaveLength(1);
    const flow = anim.flows[0]!;
    expect(flow).toMatchObject({
      eventId: 5,
      placeId: 'steel',
      transitionId: 'work',
      direction: 'out',
      count: 3,
      startedAt: 1000,
      duration: 300,
    });
    expect(flowLabel(flow)).toBe('−3');
    // From the counter, along the connector of the view, to the slot of the station.
    expect(flow.path).toEqual([
      [370, 320],
      [370, 300],
      [370, 240],
      [370, 200],
    ]);
    expect(flowPoint(flow, 1000)).toMatchObject({ point: [370, 320], progress: 0 });
    expect(flowPoint(flow, 1300)).toMatchObject({ point: [370, 200], progress: 1 });
    expect(flowEnd(flow)).toBe(1300);
  });

  it('the amount is no object: no motion, no sprite, the case moves on its own', () => {
    const anim = applyEvents(EMPTY_ANIMATION, [start(5)], before, afterStart, 1000, options);
    expect(anim.motions.map((m) => m.tokenId)).toEqual(['f1:C-0']);
    const sprites = sampleSprites(afterStart, anim, 1000, 0);
    expect(sprites.every((s) => s.caseId === 'C-0')).toBe(true);
    // The counter shows the new amount.
    expect(anim.counters['steel']?.value).toBe(27);
    expect(anim.counters['steel']?.previous).toBe(30);
  });

  it('logs the marker with its event, next to the counter and the motion', () => {
    const anim = applyEvents(EMPTY_ANIMATION, [start(5)], before, afterStart, 1000, options);
    const flowEntries = anim.handled.filter((h) => h.kind === 'flow');
    expect(flowEntries).toEqual([{ eventId: 5, kind: 'flow', elementId: 'steel' }]);
    expect(anim.handled.some((h) => h.kind === 'motion')).toBe(true);
    expect(anim.handled.some((h) => h.kind === 'counter' && h.elementId === 'steel')).toBe(true);
    expect(anim.handled.every((h) => h.eventId === 5)).toBe(true);
  });

  it('a completion sends +1 from the station to the counter and counts up when it arrives', () => {
    const middle = afterStart;
    const done = layoutTokens(
      net,
      view,
      state({
        marking: { done: [1], co2: [1], steel: Array.from({ length: 27 }, () => 1) },
        meta: {
          done: [{ id: 'k9', caseId: 'C-0', enteredAt: 20 }],
          co2: [{ id: 'c1', enteredAt: 20 }],
          ...steel(27),
        },
      }),
    );
    const anim = applyEvents(EMPTY_ANIMATION, [complete(9)], middle, done, 2000, options);
    expect(anim.flows).toHaveLength(1);
    const flow = anim.flows[0]!;
    expect(flow).toMatchObject({ placeId: 'co2', direction: 'in', count: 1, eventId: 9 });
    expect(flowLabel(flow)).toBe('+1');
    // From the slot, along the bent connector, to the middle of the box.
    expect(flow.path).toEqual([
      [370, 200],
      [420, 210],
      [500, 250],
      [600, 300],
      [660, 315],
    ]);
    // The number changes when the marker has arrived.
    expect(anim.counters['co2']).toMatchObject({ value: 1, previous: 0, changedAt: 2300 });
    expect(anim.handled.filter((h) => h.kind === 'flow')).toHaveLength(1);
  });

  it('shows no marker and no token for a hidden quantity place, and still logs the event', () => {
    const hidden = structuredClone(view);
    hidden.places['steel'] = { kind: 'hidden', reason: 'auxiliary place' };
    const hiddenContext = layoutContext(net, hidden);
    const anim = applyEvents(EMPTY_ANIMATION, [start(5)], before, afterStart, 1000, {
      context: hiddenContext,
      logLimit: Infinity,
    });
    expect(anim.flows).toEqual([]);
    expect(anim.handled.some((h) => h.eventId === 5)).toBe(true);
    expect(anim.handled.some((h) => h.elementId === 'steel')).toBe(false);
  });

  it('with instant motion the markers are only logged', () => {
    const anim = applyEvents(EMPTY_ANIMATION, [start(5)], before, afterStart, 1000, {
      ...options,
      ...INSTANT,
    });
    expect(anim.flows).toEqual([]);
    expect(anim.handled.filter((h) => h.kind === 'flow')).toHaveLength(1);
    expect(anim.counters['steel']?.value).toBe(27);
  });

  it('limits the markers that run at once and logs the others', () => {
    const second = start(6, {
      firingId: 2,
      slot: 0,
      consumed: [0, 1, 2].map((i) => ({ placeId: 'steel', tokenId: `s${i + 3}` })),
    });
    const anim = applyEvents(EMPTY_ANIMATION, [start(5), second], before, afterStart, 1000, {
      ...options,
      maxFlows: 1,
    });
    expect(anim.flows).toHaveLength(1);
    expect(anim.flows[0]!.eventId).toBe(5);
    expect(anim.handled.filter((h) => h.kind === 'flow').map((h) => h.eventId)).toEqual([5, 6]);
  });

  it('are carried along, pruned when they end, and keep the loop running while they run', () => {
    const anim = applyEvents(EMPTY_ANIMATION, [start(5)], before, afterStart, 1000, options);
    expect(isAnimating({ ...anim, motions: [], counters: {}, flashes: [] }, 1100)).toBe(true);
    const later: AnimationState = pruneAnimation(anim, 1301);
    expect(later.flows).toEqual([]);
    // (the counter of the steel pulses until 1400)
    expect(isAnimating(later, 1500)).toBe(false);
    // A later bundle keeps a marker that has not ended.
    const next = applyEvents(anim, [], afterStart, afterStart, 1100, options);
    expect(next.flows).toEqual(anim.flows);
  });
});

describe('the dynamic scene with flow markers', () => {
  const layout = layoutTokens(net, view, state({}));
  const scene = buildStaticScene(net, view);
  const flow = (patch: Partial<FlowMarker>): FlowMarker => ({
    eventId: 1,
    placeId: 'steel',
    transitionId: 'work',
    direction: 'out',
    count: 3,
    path: [
      [370, 320],
      [370, 200],
    ],
    startedAt: 1000,
    duration: 300,
    ...patch,
  });
  const draw = (flows: FlowMarker[], now: number) =>
    buildDynamicScene(context, scene, layout, { ...EMPTY_ANIMATION, flows }, { now });
  const badges = (flows: FlowMarker[], now: number) =>
    draw(flows, now).layers.tokens.flatMap((c) => (c.op === 'badge' ? [c.text] : []));

  it('draws a dot with the number while a marker runs, and nothing before or after', () => {
    const flows = [flow({}), flow({ placeId: 'co2', direction: 'in', count: 2 })];
    expect(badges(flows, 1150)).toEqual(['\u22123', '+2']);
    expect(badges(flows, 999)).toEqual([]);
    expect(badges(flows, 1300)).toEqual([]);
    const dots = draw(flows, 1150).layers.tokens.filter((c) => c.op === 'circle');
    expect(dots).toHaveLength(2);
    expect(dots[0]).toMatchObject({ elementId: 'steel', x: 370 });
  });

  it('the marker runs between the ends of its route', () => {
    const [dot] = draw([flow({})], 1150).layers.tokens.filter((c) => c.op === 'circle');
    expect(dot).toMatchObject({ x: 370 });
    expect((dot as { y: number }).y).toBeGreaterThan(200);
    expect((dot as { y: number }).y).toBeLessThan(320);
  });

  it('draws nothing for a net without quantities', () => {
    expect(badges([], 1150)).toEqual([]);
  });
});

describe('acceptance A2 for flow markers: nothing is lost, every marker has its event', () => {
  it('in a run of the net, every start and complete with an amount leaves a marker, every marker one event', async () => {
    const runNet = amountsNet();
    const runView = amountsView(runNet);
    expect(validateDomainView(runNet, runView).diagnostics).toEqual([]);
    const seen = new Set<FlowMarker>();
    const { events, anim } = await runAnimated(runNet, runView, {
      bundle: 6,
      seconds: 1800,
      onBundle: (_bundle, state) => {
        for (const flow of state.flows) seen.add(flow);
      },
    });
    const byId = new Map(events.map((e) => [e.id, e]));
    const quantities = new Set(['steel', 'co2']);
    // 1. Every event that moves an amount through a visible station is logged as a flow.
    const logged = new Map<number, number>();
    for (const entry of anim.handled) {
      if (entry.kind === 'flow') logged.set(entry.eventId, (logged.get(entry.eventId) ?? 0) + 1);
    }
    let withAmounts = 0;
    for (const event of events) {
      const refs =
        event.type === 'start' ? event.consumed : event.type === 'complete' ? event.produced : [];
      const places = new Set(refs.filter((r) => quantities.has(r.placeId)).map((r) => r.placeId));
      if (places.size === 0) continue;
      withAmounts += 1;
      expect(logged.get(event.id), `event ${event.id}`).toBe(places.size);
    }
    expect(withAmounts).toBeGreaterThan(40);
    // 2. Every marker that ran belongs to an event of the right kind, with the right amount.
    expect(seen.size).toBeGreaterThan(40);
    for (const flow of seen) {
      const event = byId.get(flow.eventId);
      expect(event, `marker for ${flow.placeId}`).toBeDefined();
      expect(event!.type).toBe(flow.direction === 'out' ? 'start' : 'complete');
      const refs =
        event!.type === 'start'
          ? event!.consumed
          : (event as never as { produced: never[] }).produced;
      expect(
        (refs as Array<{ placeId: string }>).filter((r) => r.placeId === flow.placeId),
      ).toHaveLength(flow.count);
    }
    // 3. The counters agree with the stream: steel taken, CO2 put.
    const taken = events
      .filter((e) => e.type === 'start')
      .reduce(
        (n, e) =>
          n + (e.type === 'start' ? e.consumed.filter((r) => r.placeId === 'steel').length : 0),
        0,
      );
    const put = events
      .filter((e) => e.type === 'complete')
      .reduce(
        (n, e) =>
          n + (e.type === 'complete' ? e.produced.filter((r) => r.placeId === 'co2').length : 0),
        0,
      );
    expect(anim.counters['steel']?.value).toBe(300 - taken);
    expect(anim.counters['co2']?.value).toBe(put);
    // 4. No sprite is ever made of an amount: motions are cases only.
    expect(
      anim.handled.filter((h) => h.kind === 'motion').every((h) => h.tokenId !== undefined),
    ).toBe(true);
    for (const entry of anim.handled) {
      if (entry.kind === 'motion') expect(quantities.has(entry.elementId ?? '')).toBe(false);
    }
  });
});
