import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNetText, type PetriNet } from '@pnm/core';
import { describe, expect, it } from 'vitest';
import {
  buildScene,
  DARK_PALETTE,
  elementBounds,
  genericDomainView,
  hitTest,
  LAYERS,
  LIGHT_PALETTE,
  paintBackdrop,
  paintScene,
  tokenSpots,
  validateDomainView,
  withHighlight,
  wrapLabel,
  type DrawCommand,
  type DomainView,
  type Scene,
} from '../src';
import { smallNet, smallView } from './helpers';

const root = join(import.meta.dirname, '..', '..', '..');
const example = (name: string): PetriNet =>
  parseNetText(readFileSync(join(root, 'examples', `${name}.pn.json`), 'utf8'));

function all(scene: Scene): DrawCommand[] {
  return LAYERS.flatMap((layer) => scene.layers[layer]);
}

const ones = (n: number): number[] => Array.from({ length: n }, () => 1);

describe('tokenSpots', () => {
  const path: Array<[number, number]> = [
    [100, 200],
    [300, 200],
  ];

  it('puts tokens at the end of the path, 16 px apart', () => {
    const { spots, extra } = tokenSpots(path, 3);
    expect(extra).toBe(0);
    expect(spots.map((s) => s.point[0])).toEqual([292, 276, 260]);
    expect(spots.every((s) => s.point[1] === 200)).toBe(true);
  });

  it('shows as many as fit and counts the rest', () => {
    // 200 px hold 12 tokens; one place is kept for the counter.
    const { spots, extra } = tokenSpots(path, 30);
    expect(spots).toHaveLength(11);
    expect(extra).toBe(19);
    const exactly = tokenSpots(path, 12);
    expect(exactly.spots).toHaveLength(12);
    expect(exactly.extra).toBe(0);
  });

  it('follows the bends of the path', () => {
    const bent = tokenSpots(
      [
        [0, 0],
        [40, 0],
        [40, 100],
      ],
      8,
    );
    const last = bent.spots[0]!;
    expect(last.point).toEqual([40, 92]);
    expect(last.direction).toEqual([0, 1]);
    const turned = bent.spots[7]!;
    expect(turned.point[1]).toBe(0);
  });
});

describe('buildScene', () => {
  const net = smallNet();
  const view = smallView(net);

  it('draws tokens of a conveyor and counts the overflow', () => {
    const few = buildScene(net, view, { q: ones(4) });
    const sprites = few.layers.tokens.filter((c) => c.op === 'sprite' && c.elementId === 'q');
    expect(sprites).toHaveLength(4);
    expect(few.layers.tokens.some((c) => c.op === 'badge')).toBe(false);

    const many = buildScene(net, view, { q: ones(40) });
    const spriteCount = many.layers.tokens.filter((c) => c.op === 'sprite' && c.elementId === 'q');
    expect(spriteCount).toHaveLength(11);
    const badge = many.layers.tokens.find((c) => c.op === 'badge');
    expect(badge).toMatchObject({ text: '+29', elementId: 'q' });
  });

  it('draws the sprite of the entity', () => {
    const scene = buildScene(net, view, { q: ones(1) });
    expect(scene.layers.tokens.find((c) => c.op === 'sprite')).toMatchObject({ sprite: 'parcel' });
    const person = structuredClone(view);
    person.meta.entity.sprite = 'person';
    const withPerson = buildScene(net, person, { q: ones(1) });
    expect(withPerson.layers.tokens.find((c) => c.op === 'sprite')).toMatchObject({
      sprite: 'person',
    });
  });

  it('shows free, busy and unavailable slots', () => {
    const two = structuredClone(view);
    two.transitions['work'] = {
      kind: 'station',
      box: [320, 160, 100, 80],
      slots: [
        [340, 200],
        [370, 200],
        [400, 200],
      ],
    };
    const states = (scene: Scene): string[] =>
      scene.layers.tokens.flatMap((c) => (c.op === 'cell' ? [c.state] : []));
    // One free resource of three slots.
    expect(states(buildScene(net, two, { res: [1] }))).toEqual(['free', 'off', 'off']);
    // One firing under way on slot 1: that slot is busy, a sprite stands on it.
    const running = buildScene(
      net,
      two,
      { res: [] },
      { running: [{ transitionId: 'work', slot: 1 }] },
    );
    expect(states(running)).toEqual(['off', 'busy', 'off']);
    const sprite = running.layers.tokens.find((c) => c.op === 'sprite');
    expect(sprite).toMatchObject({ x: 370, y: 200, elementId: 'work' });
    // The card of a transition with a firing under way is outlined as active.
    const card = running.layers.transitions.find((c) => c.op === 'rect' && c.elementId === 'work');
    expect(card).toMatchObject({ stroke: 'ok' });
  });

  it('counts firings that have no slot on a badge', () => {
    const scene = buildScene(
      net,
      view,
      {},
      {
        running: [
          { transitionId: 'work', slot: 0 },
          { transitionId: 'work', slot: 1 },
          { transitionId: 't_in', slot: 0 },
        ],
      },
    );
    const badges = scene.layers.tokens.filter((c) => c.op === 'badge');
    expect(badges.map((b) => (b.op === 'badge' ? [b.elementId, b.text] : []))).toEqual([
      ['t_in', '1'],
      ['work', '1'],
    ]);
  });

  it('shows the counts of sinks and pools as text', () => {
    const scene = buildScene(net, view, { done: ones(7) });
    const text = scene.layers.tokens.find((c) => c.op === 'text' && c.elementId === 'done');
    expect(text).toMatchObject({ text: '7' });
  });

  it('ignores entries for elements the net does not have and skips hidden ones', () => {
    const odd = structuredClone(view);
    odd.places['ghost'] = { kind: 'pool', pos: [10, 10] };
    odd.places['done'] = { kind: 'hidden', reason: 'x' };
    const scene = buildScene(net, odd, { done: ones(3) });
    expect(all(scene).some((c) => c.elementId === 'ghost')).toBe(false);
    expect(all(scene).some((c) => c.elementId === 'done')).toBe(false);
  });

  it('puts every command on its own layer', () => {
    const scene = buildScene(net, view, { q: ones(3), res: [1] });
    for (const layer of LAYERS) {
      expect(scene.layers[layer].every((c) => c.layer === layer)).toBe(true);
    }
    expect(scene.layers.places.length).toBeGreaterThan(0);
    expect(scene.layers.transitions.length).toBeGreaterThan(0);
    expect(scene.layers.labels.length).toBeGreaterThan(0);
  });

  it('draws arcs as connectors and ties them to the net arc', () => {
    const scene = buildScene(net, view, {});
    const arc = scene.layers.arcs[0];
    expect(arc).toMatchObject({ op: 'path', elementId: 'a5', arrow: true });
  });
});

describe('hitTest', () => {
  const net = smallNet();
  const view = smallView(net);
  const scene = buildScene(net, view, { res: [1] });

  it('finds the transition under a point of its card', () => {
    expect(hitTest(scene, [330, 170])).toEqual({ elementId: 'work', kind: 'transition' });
  });

  it('prefers a resource slot over the card it lies on', () => {
    expect(hitTest(scene, [370, 200])).toEqual({ elementId: 'res', kind: 'place' });
  });

  it('finds belts and sinks', () => {
    expect(hitTest(scene, [200, 200])).toEqual({ elementId: 'q', kind: 'place' });
    expect(hitTest(scene, [640, 200])).toEqual({ elementId: 'done', kind: 'place' });
    expect(hitTest(scene, [52, 200])?.elementId).toBe('t_in');
  });

  it('finds an arc only on its line and with some slack', () => {
    expect(hitTest(scene, [500, 200])).toEqual({ elementId: 'a5', kind: 'arc' });
    expect(hitTest(scene, [500, 207])).toBeNull();
    expect(hitTest(scene, [500, 207], 4)).toEqual({ elementId: 'a5', kind: 'arc' });
  });

  it('returns null on empty floor', () => {
    expect(hitTest(scene, [700, 60])).toBeNull();
  });

  it('knows where an element is', () => {
    expect(elementBounds(scene, 'done')).toEqual([600, 180, 80, 40]);
    expect(elementBounds(scene, 'nothing')).toBeNull();
  });
});

describe('withHighlight', () => {
  const net = smallNet();
  const scene = buildScene(net, smallView(net), {});

  it('has no highlight without hover and selection', () => {
    expect(scene.layers.highlight).toEqual([]);
  });

  it('outlines hover and selection', () => {
    const lit = withHighlight(scene, { hover: 'work', selection: ['q'] });
    const ids = new Set(lit.layers.highlight.map((c) => c.elementId));
    expect(ids).toEqual(new Set(['work', 'q']));
    // The other layers are shared, not copied.
    expect(lit.layers.places).toBe(scene.layers.places);
  });

  it('does not outline a selected element twice', () => {
    const lit = withHighlight(scene, { hover: 'work', selection: ['work'] });
    const rects = lit.layers.highlight.filter((c) => c.op === 'rect');
    expect(rects).toHaveLength(1);
  });
});

describe('wrapLabel', () => {
  it('wraps into at most two lines and shortens the rest', () => {
    expect(wrapLabel('Short', 12, 100)).toEqual(['Short']);
    expect(wrapLabel('Two words here', 12, 70)).toHaveLength(2);
    const long = wrapLabel('a very long label that cannot possibly fit', 12, 80);
    expect(long).toHaveLength(2);
    expect(long[1]!.endsWith('…')).toBe(true);
  });
});

/** A canvas context that records which methods were called. */
function recordingContext(): { ctx: CanvasRenderingContext2D; calls: Map<string, number> } {
  const calls = new Map<string, number>();
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get(store, key: string) {
      if (key in store) return store[key];
      if (key === 'measureText') return () => ({ width: 24 });
      return (...args: unknown[]) => {
        void args;
        calls.set(key, (calls.get(key) ?? 0) + 1);
      };
    },
    set(store, key: string, value: unknown) {
      store[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe('paintScene', () => {
  const cases: Array<[string, PetriNet, DomainView]> = [
    ['small', smallNet(), smallView()],
    ['parcel center', example('parcel-center'), example('parcel-center').domainView as DomainView],
    ['smart office', example('smart-office'), example('smart-office').domainView as DomainView],
    [
      'complaint handling (generic)',
      example('complaint-handling'),
      genericDomainView(example('complaint-handling')),
    ],
  ];

  for (const [name, net, view] of cases) {
    for (const [theme, palette] of [
      ['light', LIGHT_PALETTE],
      ['dark', DARK_PALETTE],
    ] as const) {
      it(`paints ${name} in ${theme} mode`, () => {
        const marking = { ...net.marking };
        for (const place of net.places) marking[place.id] = [...(marking[place.id] ?? []), 1, 1, 1];
        const scene = buildScene(net, view, marking, {
          running: net.transitions.map((t) => ({ transitionId: t.id, slot: 0 })),
          hover: net.transitions[0]?.id ?? null,
          selection: net.places[0] ? [net.places[0].id] : [],
        });
        const { ctx, calls } = recordingContext();
        paintBackdrop(ctx, 800, 600, palette);
        paintScene(ctx, scene, palette, { scale: 2 });
        expect(calls.get('fill') ?? 0).toBeGreaterThan(5);
        expect(calls.get('stroke') ?? 0).toBeGreaterThan(5);
        expect(calls.get('fillText') ?? 0).toBeGreaterThan(0);
        // Every save has its restore.
        expect(calls.get('save')).toBe(calls.get('restore'));
      });
    }
  }
});

describe('the example views', () => {
  // Acceptance 5: the hand-made views are clean, the generic one has no errors.
  for (const name of ['parcel-center', 'smart-office']) {
    it(`${name} has a domain view without errors and warnings`, () => {
      const net = example(name);
      const result = validateDomainView(net, net.domainView);
      expect(result.diagnostics).toEqual([]);
      expect(result.view?.provenance['transitions.' + net.transitions[0]!.id]?.source).toBe('user');
    });
  }

  it('complaint handling has no domain view of its own, and the generic one is clean', () => {
    const net = example('complaint-handling');
    expect(net.domainView).toBeUndefined();
    const result = validateDomainView(net, genericDomainView(net));
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('draws every place and transition of the examples somewhere on the sheet', () => {
    for (const name of ['parcel-center', 'smart-office']) {
      const net = example(name);
      const view = net.domainView as DomainView;
      const scene = buildScene(net, view, net.marking);
      for (const place of net.places) {
        expect(elementBounds(scene, place.id), `${name}: ${place.id}`).not.toBeNull();
      }
      for (const transition of net.transitions) {
        expect(elementBounds(scene, transition.id), `${name}: ${transition.id}`).not.toBeNull();
      }
    }
  });
});
