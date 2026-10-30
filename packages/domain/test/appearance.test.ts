import { createEmptyNet, type PetriNet } from '@pnm/core';
import { createReplay, createSimulation, type LogEvent, type SimEvent } from '@pnm/sim';
import { describe, expect, it } from 'vitest';
import {
  APPEARANCE_MS,
  applyEvents,
  appearanceOfPlace,
  buildDynamicScene,
  buildStaticScene,
  defaultAppearance,
  EMPTY_ANIMATION,
  firingKey,
  heldAppearance,
  INSTANT,
  layoutContext,
  layoutTokens,
  netHash,
  sameAppearance,
  sampleSprites,
  spriteSize,
  validateDomainView,
  type Appearance,
  type DomainView,
  type DrawCommand,
  type LayoutState,
} from '../src';
import { runAnimated } from './animated-run';

/**
 * A case goes through three stations: an order (a document) is cut (bars), welded (a raw frame),
 * and shipped. Each place says how the case looks on it.
 */
function stageNet(): PetriNet {
  const net = createEmptyNet('Stages');
  net.places = [
    { id: 'orders', name: 'Orders', position: { x: 0, y: 0 } },
    { id: 'cut', name: 'Cut', position: { x: 0, y: 0 } },
    { id: 'welded', name: 'Welded', position: { x: 0, y: 0 } },
    { id: 'shipped', name: 'Shipped', position: { x: 0, y: 0 } },
    { id: 'saw', name: 'Saw', position: { x: 0, y: 0 } },
    { id: 'welder', name: 'Welder', position: { x: 0, y: 0 } },
    { id: 'van', name: 'Van', position: { x: 0, y: 0 } },
  ];
  net.transitions = [
    { id: 't_cut', name: 'Cut', position: { x: 0, y: 0 }, timing: { kind: 'fixed', value: 20 } },
    { id: 't_weld', name: 'Weld', position: { x: 0, y: 0 }, timing: { kind: 'fixed', value: 30 } },
    { id: 't_ship', name: 'Ship', position: { x: 0, y: 0 }, timing: { kind: 'fixed', value: 10 } },
  ];
  net.arcs = [
    { id: 'a1', source: 'orders', target: 't_cut', weight: 1 },
    { id: 'a2', source: 't_cut', target: 'cut', weight: 1 },
    { id: 'a3', source: 'cut', target: 't_weld', weight: 1 },
    { id: 'a4', source: 't_weld', target: 'welded', weight: 1 },
    { id: 'a5', source: 'welded', target: 't_ship', weight: 1 },
    { id: 'a6', source: 't_ship', target: 'shipped', weight: 1 },
    { id: 'r1', source: 'saw', target: 't_cut', weight: 1 },
    { id: 'r2', source: 't_cut', target: 'saw', weight: 1 },
    { id: 'r3', source: 'welder', target: 't_weld', weight: 1 },
    { id: 'r4', source: 't_weld', target: 'welder', weight: 1 },
    { id: 'r5', source: 'van', target: 't_ship', weight: 1 },
    { id: 'r6', source: 't_ship', target: 'van', weight: 1 },
  ];
  // Eight orders and one machine each: the stations work one after the other for a few minutes.
  net.marking = { orders: Array.from({ length: 8 }, () => 1), saw: [1], welder: [1], van: [1] };
  return net;
}

function stageView(net: PetriNet, withLooks = true): DomainView {
  const looks = (appearance: Appearance) => (withLooks ? { appearance } : {});
  return {
    schemaVersion: 1,
    netHash: netHash(net),
    meta: {
      theme: 'Test',
      viewName: 'Line',
      entity: { singular: 'Frame', plural: 'Frames', sprite: 'frame' },
      canvas: { width: 900, height: 300 },
    },
    places: {
      orders: {
        kind: 'queue',
        path: [
          [20, 100],
          [200, 100],
        ],
        ...looks({ sprite: 'document' }),
      },
      cut: {
        kind: 'conveyor',
        path: [
          [300, 100],
          [480, 100],
        ],
        ...looks({ sprite: 'bars' }),
      },
      welded: {
        kind: 'conveyor',
        path: [
          [580, 100],
          [760, 100],
        ],
        ...looks({ sprite: 'frame', tint: 'neutral' }),
      },
      shipped: { kind: 'sink', box: [800, 60, 80, 80] },
      saw: { kind: 'slots', of: 't_cut' },
      welder: { kind: 'slots', of: 't_weld' },
      van: { kind: 'slots', of: 't_ship' },
    },
    transitions: {
      t_cut: { kind: 'station', box: [210, 60, 80, 80], slots: [[250, 100]] },
      t_weld: { kind: 'station', box: [490, 60, 80, 80], slots: [[530, 100]] },
      t_ship: { kind: 'station', box: [700, 160, 80, 80], slots: [[740, 200]] },
    },
    provenance: {},
  };
}

const net = stageNet();
const view = stageView(net);
const context = layoutContext(net, view);

const DOCUMENT: Appearance = { sprite: 'document' };
const BARS: Appearance = { sprite: 'bars' };
const RAW: Appearance = { sprite: 'frame', tint: 'neutral' };

const state = (patch: Partial<LayoutState>): LayoutState => ({
  time: 0,
  marking: {},
  running: [],
  ...patch,
});

const metas = (place: string, ids: string[]) =>
  ids.map((id, i) => ({ id: `${place}-${id}`, caseId: id, enteredAt: i }));

describe('the look of a place', () => {
  it('is its appearance, else the entity of the view', () => {
    expect(appearanceOfPlace(view, 'orders')).toEqual(DOCUMENT);
    expect(appearanceOfPlace(view, 'welded')).toEqual(RAW);
    expect(appearanceOfPlace(view, 'shipped')).toEqual({ sprite: 'frame' });
    expect(defaultAppearance(view)).toEqual({ sprite: 'frame' });
    // Cached: the same object each time.
    expect(appearanceOfPlace(view, 'shipped')).toBe(defaultAppearance(view));
    expect(sameAppearance(RAW, { sprite: 'frame', tint: 'neutral' })).toBe(true);
    expect(sameAppearance(RAW, { sprite: 'frame' })).toBe(false);
    expect(sameAppearance(RAW, { sprite: 'frame', tint: 'accent' })).toBe(false);
  });

  it('is the look of the input place for a case that a firing holds', () => {
    expect(heldAppearance(context, 't_cut', 0)).toEqual(DOCUMENT);
    expect(heldAppearance(context, 't_weld', 0)).toEqual(BARS);
    expect(heldAppearance(context, 't_ship', 0)).toEqual(RAW);
    // An index beyond the inputs takes the last one.
    expect(heldAppearance(context, 't_weld', 5)).toEqual(BARS);
  });

  it('is the look of the output place for an arrival, which has no input', () => {
    const arrivals = createEmptyNet('Arrivals');
    arrivals.places = [{ id: 'p', name: 'P', position: { x: 0, y: 0 } }];
    arrivals.transitions = [{ id: 't', name: 'T', position: { x: 0, y: 0 }, rate: 60 }];
    arrivals.arcs = [{ id: 'a', source: 't', target: 'p', weight: 1 }];
    const arrivalView = stageView(arrivals);
    arrivalView.places = {
      p: {
        kind: 'queue',
        path: [
          [0, 0],
          [200, 0],
        ],
        appearance: { sprite: 'parcel', tint: 'ok' },
      },
    };
    arrivalView.transitions = { t: { kind: 'dock', pos: [0, 0] } };
    expect(heldAppearance(layoutContext(arrivals, arrivalView), 't', 0)).toEqual({
      sprite: 'parcel',
      tint: 'ok',
    });
  });

  it('a view that is valid for the net says nothing against it', () => {
    expect(validateDomainView(net, view).diagnostics).toEqual([]);
  });
});

describe('the layout gives every case the look of the place it lies on', () => {
  const layout = layoutTokens(
    net,
    view,
    state({
      time: 5,
      marking: { orders: [1, 1], cut: [1], welded: [1] },
      meta: {
        orders: metas('orders', ['C-1', 'C-2']),
        cut: metas('cut', ['C-3']),
        welded: metas('welded', ['C-4']),
      },
      running: [
        { firingId: 1, transitionId: 't_weld', start: 0, end: 30, slot: 0, caseIds: ['C-5'] },
      ],
    }),
  );

  it('waiting cases look like their place', () => {
    expect(layout.tokens.get('orders-C-1')!.appearance).toEqual(DOCUMENT);
    expect(layout.tokens.get('cut-C-3')!.appearance).toEqual(BARS);
    expect(layout.tokens.get('welded-C-4')!.appearance).toEqual(RAW);
  });

  it('a case in a firing keeps the look of the place it was taken from', () => {
    expect(layout.tokens.get(firingKey(1, 'C-5'))!.appearance).toEqual(BARS);
  });
});

describe('the change of look at the end of a firing', () => {
  // The firing of t_cut completes: the case goes from the slot onto the belt `cut`.
  const running = [
    { firingId: 1, transitionId: 't_cut', start: 0, end: 20, slot: 0, caseIds: ['C-1'] },
  ];
  const before = layoutTokens(
    net,
    view,
    state({
      time: 19,
      marking: { orders: [1] },
      meta: { orders: metas('orders', ['C-2']) },
      running,
    }),
  );
  const after = layoutTokens(
    net,
    view,
    state({
      time: 20,
      marking: { orders: [1], cut: [1] },
      meta: { orders: metas('orders', ['C-2']), cut: metas('cut', ['C-1']) },
    }),
  );
  const complete: SimEvent = {
    id: 9,
    t: 20,
    type: 'complete',
    transitionId: 't_cut',
    firingId: 1,
    slot: 0,
    caseIds: ['C-1'],
    produced: [{ placeId: 'cut', tokenId: 'cut-C-1', caseId: 'C-1' }],
  };
  const anim = applyEvents(EMPTY_ANIMATION, [complete], before, after, 1000, { context });

  it('is a motion that says from which look to which', () => {
    const motion = anim.motions.find((m) => m.tokenId === 'cut-C-1')!;
    expect(motion.eventId).toBe(9);
    expect(motion.appearance).toEqual({ from: DOCUMENT, to: BARS });
  });

  it('keeps the old look until the event, then fades into the new one within 250 ms', () => {
    const fallback = defaultAppearance(view);
    const at = (now: number) =>
      sampleSprites(after, anim, now, 20, fallback).find((s) => s.key === 'cut-C-1')!;
    // Before the event the case sat on the slot with the input look.
    const held = sampleSprites(before, EMPTY_ANIMATION, 999, 19, fallback).find(
      (s) => s.key === firingKey(1, 'C-1'),
    )!;
    expect(held.appearance).toEqual(DOCUMENT);
    expect(held.blend).toBeUndefined();
    // At the event: the new look has come 0 of the way, the old one is still drawn.
    expect(at(1000).appearance).toEqual(BARS);
    expect(at(1000).blend).toEqual({ from: DOCUMENT, mix: 0 });
    expect(at(1000 + APPEARANCE_MS / 2).blend!.mix).toBeCloseTo(0.5, 5);
    // From 250 ms on it is the new look alone, while the case is still on its way (300 ms).
    expect(APPEARANCE_MS).toBe(250);
    expect(at(1000 + 250).blend).toBeUndefined();
    expect(at(1000 + 250).moving).toBe(true);
    expect(at(1000 + 299).appearance).toEqual(BARS);
    // Afterwards it rests on the belt with the look of the belt.
    const rest = sampleSprites(after, anim, 1400, 20, fallback).find((s) => s.key === 'cut-C-1')!;
    expect(rest).toMatchObject({ moving: false, appearance: BARS, elementId: 'cut' });
    expect(rest.blend).toBeUndefined();
  });

  it('takes at most the time of a shorter move', () => {
    const quick = applyEvents(EMPTY_ANIMATION, [complete], before, after, 1000, {
      context,
      duration: 100,
    });
    const sample = (now: number) =>
      sampleSprites(after, quick, now, 20).find((s) => s.key === 'cut-C-1')!;
    expect(sample(1050).blend!.mix).toBeCloseTo(0.5, 5);
    expect(sample(1099).blend!.mix).toBeGreaterThan(0.95);
  });

  it('is instant when tokens jump (reduced motion, top speed)', () => {
    const instant = applyEvents(EMPTY_ANIMATION, [complete], before, after, 1000, {
      context,
      ...INSTANT,
    });
    expect(instant.motions).toEqual([]);
    const sample = sampleSprites(after, instant, 1000, 20).find((s) => s.key === 'cut-C-1')!;
    expect(sample).toMatchObject({ moving: false, appearance: BARS });
    expect(sample.blend).toBeUndefined();
  });

  it('draws the old sprite under the new one, which has the opacity of the change', () => {
    const scene = buildStaticScene(net, view);
    // Only this case is on the sheet: no other sprite is in the way.
    const alone = layoutTokens(
      net,
      view,
      state({ time: 20, marking: { cut: [1] }, meta: { cut: metas('cut', ['C-1']) } }),
    );
    const frame = (now: number) =>
      buildDynamicScene(context, scene, alone, anim, { now, simTime: 20 });
    const sprites = (now: number): DrawCommand[] =>
      frame(now).layers.tokens.filter((c) => c.op === 'sprite');
    const early = sprites(1000 + 125);
    expect(early.map((c) => c.op === 'sprite' && c.sprite)).toEqual(['document', 'bars']);
    const top = early[1]!;
    expect(top.op === 'sprite' && top.alpha).toBeCloseTo(0.5, 5);
    const first = early[0]!;
    expect(first.op === 'sprite' && first.alpha).toBeUndefined();
    // After the change only the new sprite is drawn, with the size of its picture.
    const late = sprites(1000 + 280);
    expect(late).toHaveLength(1);
    expect(late[0]).toMatchObject({ sprite: 'bars', size: spriteSize('bars') });
    expect(late[0]).not.toHaveProperty('alpha');
    expect(late[0]).not.toHaveProperty('tint');
  });
});

describe('the look during a firing, and the tint', () => {
  it('a case on the slot looks like its input place, and a tint reaches the sprite command', () => {
    const scene = buildStaticScene(net, view);
    const layout = layoutTokens(
      net,
      view,
      state({
        time: 5,
        marking: {},
        running: [
          { firingId: 3, transitionId: 't_ship', start: 0, end: 10, slot: 0, caseIds: ['C-9'] },
        ],
      }),
    );
    const frame = buildDynamicScene(context, scene, layout, EMPTY_ANIMATION, {
      now: 0,
      simTime: 5,
    });
    const sprites = frame.layers.tokens.filter((c) => c.op === 'sprite');
    expect(sprites).toHaveLength(1);
    // Shipping holds a case of the belt `welded`: a raw frame, tinted with the palette token.
    expect(sprites[0]).toMatchObject({ sprite: 'frame', tint: 'neutral', x: 740, y: 200 });
    expect(frame.sprites[0]).toMatchObject({ appearance: RAW, elementId: 't_ship', size: 20 });
  });

  it('a case that goes into a counter without a look of its own is absorbed as it is', () => {
    const before = layoutTokens(
      net,
      view,
      state({
        time: 9,
        running: [
          { firingId: 3, transitionId: 't_ship', start: 0, end: 10, slot: 0, caseIds: ['C-9'] },
        ],
      }),
    );
    const after = layoutTokens(net, view, state({ time: 10, marking: { shipped: [1] } }));
    const complete: SimEvent = {
      id: 4,
      t: 10,
      type: 'complete',
      transitionId: 't_ship',
      firingId: 3,
      slot: 0,
      caseIds: ['C-9'],
      produced: [{ placeId: 'shipped', tokenId: 's1', caseId: 'C-9' }],
    };
    const anim = applyEvents(EMPTY_ANIMATION, [complete], before, after, 0, { context });
    const motion = anim.motions.find((m) => m.absorbed)!;
    expect(motion.appearance).toEqual({ from: RAW, to: RAW });
    const sprite = sampleSprites(after, anim, 100, 10).find((s) => s.moving)!;
    expect(sprite.appearance).toEqual(RAW);
    expect(sprite.blend).toBeUndefined();
  });

  it('a view without appearances draws every case as the entity, with no change', async () => {
    const plain = stageView(net, false);
    const { motions } = await runAnimated(net, plain, { bundle: 5, seconds: 400 });
    expect(motions.length).toBeGreaterThan(10);
    for (const motion of motions) {
      if (motion.appearance) {
        expect(sameAppearance(motion.appearance.from, motion.appearance.to)).toBe(true);
        expect(motion.appearance.to).toEqual({ sprite: 'frame' });
      }
    }
  });
});

describe('every case has the right look at every moment of a run', () => {
  /** The place that a token rests on, or the transition that holds it, from its sample. */
  const looks = (net_: PetriNet, view_: DomainView) => layoutContext(net_, view_);

  it('A: at rest the look of the place, in a station the look of the input place, and the change starts with the complete event', async () => {
    const ctx = looks(net, view);
    // The cases whose firing completed in a bundle, by the time (`now`) of that bundle.
    const completed = new Set<string>();
    const checked = { rest: 0, held: 0, changes: 0 };
    const { motions } = await runAnimated(net, view, {
      bundle: 4,
      seconds: 300,
      // The moves of one bundle are over before the next one comes.
      wallStep: 400,
      onBundle: (bundle, anim, layout, now) => {
        for (const event of bundle) {
          if (event.type === 'complete') {
            for (const caseId of event.caseIds) completed.add(`${caseId}@${now}`);
          }
        }
        for (const sample of sampleSprites(
          layout,
          anim,
          now,
          layout.time,
          defaultAppearance(view),
        )) {
          if (sample.moving || sample.elementId === undefined) continue;
          if (view.places[sample.elementId] !== undefined) {
            expect(sample.appearance).toEqual(appearanceOfPlace(view, sample.elementId));
            checked.rest += 1;
          } else {
            // Inside a station: the look of the input place.
            expect(sample.appearance).toEqual(heldAppearance(ctx, sample.elementId, 0));
            checked.held += 1;
          }
        }
      },
    });
    for (const motion of motions) {
      if (!motion.appearance || sameAppearance(motion.appearance.from, motion.appearance.to)) {
        continue;
      }
      // The change starts in the bundle in which the firing of the case completed, not before.
      expect(completed.has(`${motion.caseId}@${motion.startedAt}`)).toBe(true);
      checked.changes += 1;
    }
    expect(checked.rest).toBeGreaterThan(50);
    expect(checked.held).toBeGreaterThan(20);
    // Four cases, three stations: cut, weld and ship change the look, except the last (absorbed).
    expect(checked.changes).toBeGreaterThanOrEqual(8);
  }, 30_000);

  it('B: the same in a replay of the log of that run', async () => {
    const engine = createSimulation(net, { seed: 1 });
    const events: SimEvent[] = [...engine.initialEvents, ...(await engine.advance(400))];
    const names = new Map(net.transitions.map((t) => [t.id, t.name]));
    const log: LogEvent[] = events.flatMap((event) =>
      event.type === 'start' || event.type === 'complete'
        ? event.caseIds.map((caseId) => ({
            caseId,
            activity: names.get(event.transitionId) ?? event.transitionId,
            time: event.t,
            lifecycle: event.type,
          }))
        : [],
    );
    const mapping = Object.fromEntries(net.transitions.map((t) => [t.name, t.id]));
    const { motions } = await runAnimated(net, view, {
      bundle: 7,
      seconds: 400,
      wallStep: 400,
      simulation: (n) => createReplay(n, log, { mapping }),
    });
    const changes = motions.filter(
      (m) => m.appearance && !sameAppearance(m.appearance.from, m.appearance.to),
    );
    expect(changes.length).toBeGreaterThanOrEqual(8);
    // Cut: document to bars; weld: bars to a raw frame.
    const kinds = new Set(
      changes.map((m) => `${m.appearance!.from.sprite}>${m.appearance!.to.sprite}`),
    );
    expect(kinds).toContain('document>bars');
    expect(kinds).toContain('bars>frame');
  }, 30_000);
});
