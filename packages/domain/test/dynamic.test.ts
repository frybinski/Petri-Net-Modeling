import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEmptyNet, parseNetText, type PetriNet } from '@pnm/core';
import { createSimulation } from '@pnm/sim';
import { describe, expect, it } from 'vitest';
import {
  applyEvents,
  buildDynamicScene,
  buildStaticScene,
  DARK_PALETTE,
  EMPTY_ANIMATION,
  firingKey,
  genericDomainView,
  hitSprite,
  LAYERS,
  LIGHT_PALETTE,
  layoutContext,
  layoutStateOf,
  layoutTokens,
  paintBackdrop,
  paintLayers,
  paintScene,
  SpriteCache,
  type DomainView,
  type DrawCommand,
  type LayoutState,
  type Point,
} from '../src';
import { runAnimated } from './animated-run';
import { smallNet, smallView } from './helpers';

const root = join(import.meta.dirname, '..', '..', '..');
const example = (name: string): PetriNet =>
  parseNetText(readFileSync(join(root, 'examples', `${name}.pn.json`), 'utf8'));

const net = smallNet();
const view = smallView(net);
const context = layoutContext(net, view);
const scene = buildStaticScene(net, view);

const dynamic = (
  state: Partial<LayoutState>,
  options: Partial<Parameters<typeof buildDynamicScene>[4]> = {},
  anim = EMPTY_ANIMATION,
) =>
  buildDynamicScene(
    context,
    scene,
    layoutTokens(net, view, { time: 0, marking: {}, running: [], ...state }),
    anim,
    { now: 0, ...options },
  );

const all = (layers: Record<string, DrawCommand[]>): DrawCommand[] =>
  LAYERS.flatMap((l) => layers[l]!);
const metas = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `k${i}`, caseId: `C-${i}`, enteredAt: i }));
const firing = { firingId: 1, transitionId: 'work', start: 0, end: 20, slot: 0, caseIds: ['C-1'] };

describe('buildStaticScene', () => {
  it('has the sheet content without tokens, counters, cells and progress bars', () => {
    expect(scene.layers.tokens).toEqual([]);
    expect(all(scene.layers).some((c) => c.op === 'progress' || c.op === 'cell')).toBe(false);
    expect(scene.layers.places.length).toBeGreaterThan(0);
    expect(scene.layers.transitions.length).toBeGreaterThan(0);
    expect(scene.hits.length).toBeGreaterThan(0);
  });

  it('does not depend on the marking', () => {
    const other = { ...net, marking: { q: [1, 1, 1], res: [1] } };
    expect(buildStaticScene(other, view)).toEqual(scene);
  });
});

describe('buildDynamicScene', () => {
  it('draws a sprite for every visible token and the +n counter of a full queue', () => {
    const few = dynamic({ marking: { q: [1, 1, 1] }, meta: { q: metas(3) } });
    expect(few.layers.tokens.filter((c) => c.op === 'sprite')).toHaveLength(3);
    expect(few.sprites).toHaveLength(3);
    const marking = { q: Array(40).fill(1) as number[] };
    const many = dynamic({ marking, meta: { q: metas(40) } });
    expect(many.layers.tokens.filter((c) => c.op === 'sprite')).toHaveLength(11);
    expect(many.layers.tokens.find((c) => c.op === 'badge')).toMatchObject({ text: '+29' });
  });

  it('colors a queue yellow from 6 tokens and red from 10, with the thresholds of the key figures', () => {
    const tint = (n: number, thresholds?: { warn: number; critical: number }) =>
      dynamic(
        { marking: { q: Array(n).fill(1) as number[] }, meta: { q: metas(n) } },
        thresholds ? { thresholds } : {},
      ).layers.places.find((c) => c.op === 'path' && c.elementId === 'q');
    expect(tint(5)).toBeUndefined();
    expect(tint(6)).toMatchObject({ stroke: 'warn' });
    expect(tint(9)).toMatchObject({ stroke: 'warn' });
    expect(tint(10)).toMatchObject({ stroke: 'danger' });
    expect(tint(3, { warn: 3, critical: 4 })).toMatchObject({ stroke: 'warn' });
    expect(tint(4, { warn: 3, critical: 4 })).toMatchObject({ stroke: 'danger' });
  });

  it('shows free, busy and unavailable cells and a progress ring on the busy one', () => {
    const wide = structuredClone(view);
    wide.transitions['work'] = {
      kind: 'station',
      box: [320, 160, 100, 80],
      slots: [
        [340, 200],
        [370, 200],
        [400, 200],
      ],
    };
    const wideContext = layoutContext(net, wide);
    const build = (state: Partial<LayoutState>, simTime?: number) =>
      buildDynamicScene(
        wideContext,
        buildStaticScene(net, wide),
        layoutTokens(net, wide, { time: 0, marking: {}, running: [], ...state }),
        EMPTY_ANIMATION,
        { now: 0, ...(simTime !== undefined && { simTime }) },
      );
    const states = (s: ReturnType<typeof build>) =>
      s.layers.tokens.flatMap((c) => (c.op === 'cell' ? [c.state] : []));
    expect(states(build({ marking: { res: [1] } }))).toEqual(['free', 'off', 'off']);
    const busy = build({ marking: {}, running: [{ ...firing, slot: 1 }] }, 5);
    expect(states(busy)).toEqual(['off', 'busy', 'off']);
    const ring = busy.layers.tokens.find((c) => c.op === 'ring');
    expect(ring).toMatchObject({ x: 370, y: 200, value: 0.25, tone: 'ok' });
    // The sprite of the case stands on the busy slot.
    expect(busy.sprites.map((s) => s.point)).toEqual([[370, 200]]);
    // The ring runs with the simulation time, not with the time of the layout.
    const later = build({ marking: {}, running: [{ ...firing, slot: 1 }] }, 15);
    expect(later.layers.tokens.find((c) => c.op === 'ring')).toMatchObject({ value: 0.75 });
  });

  describe('a slot that waits for its case', () => {
    const slots: Point[] = [
      [340, 200],
      [370, 200],
    ];
    const moving = {
      ...EMPTY_ANIMATION,
      motions: [
        {
          tokenId: 'f1:C-1',
          eventId: 1,
          from: [100, 200] as Point,
          to: [370, 200] as Point,
          startedAt: 1000,
          duration: 300,
        },
      ],
    };
    /** The scene with the firing on slot 1; `withCells` gives the station a resource place that draws its slots. */
    const build = (now: number, withCells: boolean, anim = moving) => {
      const shaped = structuredClone(view);
      shaped.transitions['work'] = { kind: 'station', box: [320, 160, 100, 80], slots };
      if (!withCells) delete shaped.places['res'];
      return buildDynamicScene(
        layoutContext(net, shaped),
        buildStaticScene(net, shaped),
        layoutTokens(net, shaped, { time: 0, marking: {}, running: [{ ...firing, slot: 1 }] }),
        anim,
        { now, simTime: 5 },
      );
    };
    type Built = ReturnType<typeof build>;
    const cells = (s: Built) => s.layers.tokens.flatMap((c) => (c.op === 'cell' ? [c.state] : []));
    const rings = (s: Built) => s.layers.tokens.filter((c) => c.op === 'ring');
    const hatched = (s: Built) =>
      s.layers.transitions.filter((c) => c.op === 'circle' && c.hatch === true);

    it('shows the cell as reserved, without a ring, until the case has arrived', () => {
      const during = build(1100, true);
      expect(cells(during)).toEqual(['off', 'reserved']);
      expect(rings(during)).toEqual([]);
      // The moment the move has ended the cell is busy and the ring runs.
      const after = build(1300, true);
      expect(cells(after)).toEqual(['off', 'busy']);
      expect(rings(after)).toHaveLength(1);
    });

    it('hatches the plain mark of a slot without a resource place', () => {
      expect(hatched(build(1100, false))).toHaveLength(1);
      expect(rings(build(1100, false))).toEqual([]);
      expect(hatched(build(1300, false))).toHaveLength(0);
    });

    it('has nothing to wait for when tokens jump (top speed, reduced motion)', () => {
      const instant = build(1100, true, EMPTY_ANIMATION);
      expect(cells(instant)).toEqual(['off', 'busy']);
      expect(rings(instant)).toHaveLength(1);
    });
  });

  it('marks a station busy with a green frame, full with an amber one and blocked with a red one', () => {
    const busy = dynamic({ time: 5, marking: {}, running: [firing] });
    const card = (s: ReturnType<typeof dynamic>) =>
      s.layers.transitions.filter((c) => c.op === 'rect' && c.elementId === 'work');
    expect(card(busy)).toEqual([expect.objectContaining({ stroke: 'ok' })]);
    expect(busy.stations.get('work')!.status).toBe('busy');
    const blocked = dynamic({
      time: 5,
      marking: { q: [1, 1] },
      meta: { q: metas(2) },
      running: [firing],
    });
    // One or two waiting cases are not a bottleneck yet: amber.
    expect(blocked.stations.get('work')!.status).toBe('busy-full');
    expect(card(blocked).some((c) => c.op === 'rect' && c.stroke === 'warn')).toBe(true);
    expect(card(blocked).some((c) => c.op === 'rect' && c.stroke === 'danger')).toBe(false);
    expect(blocked.layers.transitions.find((c) => c.op === 'progress')).toMatchObject({
      tone: 'warn',
    });
    // From the yellow limit of the queues on it is red.
    const long = dynamic({
      time: 5,
      marking: { q: Array.from({ length: 6 }, () => 1) },
      meta: { q: metas(6) },
      running: [firing],
    });
    expect(long.stations.get('work')!.status).toBe('blocked');
    expect(card(long).some((c) => c.op === 'rect' && c.stroke === 'danger')).toBe(true);
    expect(long.layers.transitions.find((c) => c.op === 'progress')).toMatchObject({
      tone: 'danger',
    });
    const idle = dynamic({ marking: {} });
    expect(card(idle)).toEqual([]);
    expect(idle.layers.transitions.find((c) => c.op === 'progress')).toMatchObject({ value: 0 });
  });

  it('shows the counter of a sink as it is meant to be seen at that moment', () => {
    const marking = { done: [1, 1, 1] };
    const meta = { done: metas(3) };
    const text = (s: ReturnType<typeof dynamic>) =>
      s.layers.tokens.find((c) => c.op === 'text' && c.elementId === 'done');
    expect(text(dynamic({ marking, meta }))).toMatchObject({ text: '3' });
    const anim = {
      ...EMPTY_ANIMATION,
      counters: { done: { value: 3, previous: 2, changedAt: 100 } },
    };
    expect(text(dynamic({ marking, meta }, { now: 50 }, anim))).toMatchObject({ text: '2' });
    expect(text(dynamic({ marking, meta }, { now: 150 }, anim))).toMatchObject({ text: '3' });
    // A short light background while the number is new.
    expect(
      dynamic({ marking, meta }, { now: 150 }, anim).layers.tokens.some(
        (c) => c.op === 'rect' && c.elementId === 'done',
      ),
    ).toBe(true);
    expect(
      dynamic({ marking, meta }, { now: 1000 }, anim).layers.tokens.some(
        (c) => c.op === 'rect' && c.elementId === 'done',
      ),
    ).toBe(false);
  });

  it('rings the followed case and frames the stations it visited', () => {
    const state = { time: 5, marking: { q: [1] }, meta: { q: metas(1) }, running: [firing] };
    const plain = dynamic(state);
    const followed = dynamic(state, { followCase: 'C-1', visited: ['work'] });
    const rings = (s: ReturnType<typeof dynamic>) =>
      s.layers.tokens.filter((c) => c.op === 'circle' && c.stroke === 'accent');
    expect(rings(plain)).toHaveLength(0);
    expect(rings(followed)).toHaveLength(1);
    expect(followed.layers.transitions.some((c) => c.op === 'rect' && c.stroke === 'accent')).toBe(
      true,
    );
    expect(plain.layers.transitions.some((c) => c.op === 'rect' && c.stroke === 'accent')).toBe(
      false,
    );
  });

  it('outlines a flash for a short time and adds hover and selection', () => {
    const anim = {
      ...EMPTY_ANIMATION,
      flashes: [{ elementId: 'work', eventId: 1, startedAt: 100 }],
    };
    const during = dynamic({}, { now: 300, hover: 'q', selection: ['work'] }, anim);
    expect(during.layers.tokens.some((c) => c.op === 'rect' && c.elementId === 'work')).toBe(true);
    expect(during.layers.highlight.length).toBeGreaterThan(0);
    const after = dynamic({}, { now: 2000 }, anim);
    expect(after.layers.tokens.some((c) => c.op === 'rect' && c.elementId === 'work')).toBe(false);
    expect(after.layers.highlight).toEqual([]);
  });

  it('turns the sprites of person and vehicle cases in the direction of travel', () => {
    const person = structuredClone(view);
    person.meta.entity.sprite = 'person';
    const personScene = buildStaticScene(net, person);
    const result = buildDynamicScene(
      layoutContext(net, person),
      personScene,
      layoutTokens(net, person, {
        time: 0,
        marking: { q: [1] },
        meta: { q: metas(1) },
        running: [],
      }),
      EMPTY_ANIMATION,
      { now: 0 },
    );
    expect(result.layers.tokens.find((c) => c.op === 'sprite')).toMatchObject({
      sprite: 'person',
      angle: 0,
    });
  });

  it('finds the sprite under a point', () => {
    const result = dynamic({ marking: { q: [1, 1] }, meta: { q: metas(2) } });
    expect(hitSprite(result.sprites, [292, 200], 16)?.key).toBe('k0');
    expect(hitSprite(result.sprites, [276, 203], 16)?.key).toBe('k1');
    expect(hitSprite(result.sprites, [500, 300], 16)).toBeNull();
  });

  it('draws the cases that are moving through a firing without a station in the way', () => {
    const before = layoutTokens(net, view, {
      time: 0,
      marking: { q: [1] },
      meta: { q: metas(1) },
      running: [],
    });
    const after = layoutTokens(net, view, {
      time: 0,
      marking: {},
      running: [{ ...firing, caseIds: ['C-0'] }],
    });
    const anim = applyEvents(
      EMPTY_ANIMATION,
      [
        {
          id: 1,
          t: 0,
          type: 'start',
          transitionId: 'work',
          firingId: 1,
          slot: 0,
          caseIds: ['C-0'],
          binding: {},
          consumed: [{ placeId: 'q', tokenId: 'k0', caseId: 'C-0' }],
        },
      ],
      before,
      after,
      0,
      { context },
    );
    const halfway = buildDynamicScene(context, scene, after, anim, { now: 150 });
    expect(halfway.sprites).toHaveLength(1);
    expect(halfway.sprites[0]!.key).toBe(firingKey(1, 'C-0'));
    expect(halfway.sprites[0]!.moving).toBe(true);
    expect(halfway.sprites[0]!.point[0]).toBeGreaterThan(292);
    expect(halfway.sprites[0]!.point[0]).toBeLessThan(370);
  });
});

/** A context that records the calls made to it. */
function recordingContext() {
  const calls = new Map<string, number>();
  const count = (name: string) => () => {
    calls.set(name, (calls.get(name) ?? 0) + 1);
  };
  const ctx = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'measureText') return () => ({ width: 20 });
        return count(prop);
      },
      set() {
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe('painting the layers', () => {
  const cases: Array<[string, PetriNet, DomainView]> = [
    ['parcel center', example('parcel-center'), example('parcel-center').domainView as DomainView],
    ['smart office', example('smart-office'), example('smart-office').domainView as DomainView],
    [
      'complaint handling (generic)',
      example('complaint-handling'),
      genericDomainView(example('complaint-handling')),
    ],
  ];
  for (const [name, caseNet, caseView] of cases) {
    for (const [theme, palette] of [
      ['light', LIGHT_PALETTE],
      ['dark', DARK_PALETTE],
    ] as const) {
      it(`paints static and dynamic layers of ${name} in ${theme} mode`, async () => {
        const { layout, anim } = await runAnimated(caseNet, caseView, { bundle: 6, seconds: 1800 });
        const caseContext = layoutContext(caseNet, caseView);
        const staticScene = buildStaticScene(caseNet, caseView);
        const frame = buildDynamicScene(caseContext, staticScene, layout, anim, {
          now: 100,
          hover: caseNet.transitions[0]?.id ?? null,
          selection: caseNet.places[0] ? [caseNet.places[0].id] : [],
        });
        const { ctx, calls } = recordingContext();
        paintBackdrop(ctx, 800, 600, palette);
        paintScene(ctx, staticScene, palette, { scale: 2 });
        const drawn = calls.get('fill') ?? 0;
        paintLayers(ctx, frame.layers, palette, { scale: 2 });
        expect((calls.get('fill') ?? 0) + (calls.get('stroke') ?? 0)).toBeGreaterThan(drawn);
        expect(calls.get('save')).toBe(calls.get('restore'));
      });
    }
  }
});

describe('frame budget', () => {
  /** A ring of 20 belts and stations with 200 tokens in all. */
  function ringNet(): PetriNet {
    const ring = createEmptyNet('Ring');
    const n = 20;
    for (let i = 0; i < n; i += 1) {
      ring.places.push({
        id: `p${i}`,
        name: `P${i}`,
        position: { x: (i % 10) * 160, y: Math.floor(i / 10) * 200 },
      });
      ring.transitions.push({
        id: `t${i}`,
        name: `T${i}`,
        position: { x: (i % 10) * 160 + 80, y: Math.floor(i / 10) * 200 + 60 },
        timing: { kind: 'uniform', min: 1, max: 3 },
      });
      ring.marking[`p${i}`] = Array(10).fill(1) as number[];
    }
    for (let i = 0; i < n; i += 1) {
      ring.arcs.push({ id: `a${i}`, source: `p${i}`, target: `t${i}`, weight: 1 });
      ring.arcs.push({ id: `b${i}`, source: `t${i}`, target: `p${(i + 1) % n}`, weight: 1 });
    }
    return ring;
  }

  it('lays out, animates and builds 200 tokens in under 8 ms on average', async () => {
    const ring = ringNet();
    const ringView = genericDomainView(ring);
    const ringContext = layoutContext(ring, ringView);
    const staticScene = buildStaticScene(ring, ringView);
    const sim = createSimulation(ring);
    let layout = layoutTokens(ring, ringView, layoutStateOf(sim.state));
    let anim = EMPTY_ANIMATION;
    const times: number[] = [];
    let sprites = 0;
    for (let step = 0; step < 300; step += 1) {
      const events = await sim.advance(0.5);
      const started = performance.now();
      const next = layoutTokens(ring, ringView, layoutStateOf(sim.state));
      anim = applyEvents(anim, events, layout, next, step * 40, { context: ringContext });
      const frame = buildDynamicScene(ringContext, staticScene, next, anim, {
        now: step * 40 + 10,
        simTime: next.time,
      });
      times.push(performance.now() - started);
      sprites = Math.max(sprites, frame.sprites.length);
      layout = next;
    }
    const warm = times.slice(20);
    const mean = warm.reduce((a, b) => a + b, 0) / warm.length;
    expect(sprites).toBeGreaterThanOrEqual(150);
    expect(mean).toBeLessThan(8);
    // Kept for the record of the milestone (docs/domain-view.md): a few tenths of a millisecond.
    expect(Number.isFinite(mean)).toBe(true);
    if (process.env['PNM_REPORT_FRAME_BUDGET']) {
      process.stdout.write(
        `frame budget: mean ${mean.toFixed(3)} ms, max ${Math.max(...warm).toFixed(3)} ms, ${sprites} sprites\n`,
      );
    }
  }, 30_000);
});

describe('rooms', () => {
  it('light up one by one, by the firings in their slots', () => {
    const office = example('smart-office');
    const officeView = office.domainView as DomainView;
    const officeContext = layoutContext(office, officeView);
    const officeScene = buildStaticScene(office, officeView);
    const meet = officeView.transitions['o_meet'];
    if (meet?.kind !== 'rooms') throw new Error('o_meet is not a rooms transition');
    const frame = buildDynamicScene(
      officeContext,
      officeScene,
      layoutTokens(office, officeView, {
        time: 10,
        marking: {},
        running: [
          { firingId: 1, transitionId: 'o_meet', start: 0, end: 900, slot: 1, caseIds: ['M-1'] },
        ],
      }),
      EMPTY_ANIMATION,
      { now: 0 },
    );
    const frames = frame.layers.transitions.filter(
      (c) => c.op === 'rect' && c.elementId === 'o_meet' && c.stroke === 'ok',
    );
    expect(meet.rooms!.length).toBeGreaterThan(1);
    expect(frames).toHaveLength(1);
  });
});

describe('the sprite cache', () => {
  it('renders each sprite once and blits it afterwards', () => {
    const created: number[] = [];
    const { ctx: inner } = recordingContext();
    const cache = new SpriteCache((width, height) => {
      created.push(width, height);
      return { width, height, getContext: () => inner };
    });
    const { ctx, calls } = recordingContext();
    const frame = dynamic({
      marking: { q: [1, 1, 1, 1] },
      meta: { q: metas(4) },
    });
    paintLayers(ctx, frame.layers, LIGHT_PALETTE, { scale: 2, sprites: cache });
    paintLayers(ctx, frame.layers, LIGHT_PALETTE, { scale: 2, sprites: cache });
    // One image for the parcel, eight blits (4 sprites, two frames).
    expect(created).toHaveLength(2);
    expect(calls.get('drawImage')).toBe(8);
    // Without the cache the sprites are drawn as paths.
    const plain = recordingContext();
    paintLayers(plain.ctx, frame.layers, LIGHT_PALETTE, { scale: 2 });
    expect(plain.calls.get('drawImage') ?? 0).toBe(0);
    expect(plain.calls.get('save')).toBe(plain.calls.get('restore'));
  });

  it('keeps separate images per direction for sprites that have a front', () => {
    const created: number[] = [];
    const { ctx: inner } = recordingContext();
    const cache = new SpriteCache((width, height) => {
      created.push(width);
      return { width, height, getContext: () => inner };
    });
    const { ctx } = recordingContext();
    const person = (angle: number): DrawCommand => ({
      layer: 'tokens',
      op: 'sprite',
      sprite: 'person',
      x: 10,
      y: 10,
      size: 18,
      angle,
    });
    const layers = {
      decor: [],
      arcs: [],
      places: [],
      transitions: [],
      tokens: [person(0), person(0.01), person(Math.PI / 2), person(-Math.PI / 2)],
      labels: [],
      highlight: [],
    };
    paintLayers(ctx, layers, LIGHT_PALETTE, { scale: 1, sprites: cache });
    expect(created).toHaveLength(3);
  });
});
