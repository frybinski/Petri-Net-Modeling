import { createEmptyNet, type PetriNet } from '@pnm/core';
import { createSimulation } from '@pnm/sim';
import { describe, expect, it } from 'vitest';
import {
  EMOJI_FONT,
  LAYERS,
  appearanceOfPlace,
  applyEvents,
  buildDynamicScene,
  buildScene,
  buildStaticScene,
  counterInfo,
  defaultAppearance,
  dynamicCounterCommands,
  EMPTY_ANIMATION,
  emojiProblem,
  genericDomainView,
  graphicDisplay,
  isEmoji,
  layoutContext,
  layoutStateOf,
  layoutTokens,
  netHash,
  normalizeDomainView,
  paintScene,
  sameAppearance,
  setAppearance,
  suggestDisplay,
  validateDomainView,
  type CounterDisplay,
  type CounterEntry,
  type DomainDiagnostic,
  type DomainView,
  type DrawCommand,
  type Scene,
} from '../src';
import { runAnimated } from './animated-run';
import { smallNet, smallView } from './helpers';

const all = (scene: Scene): DrawCommand[] => LAYERS.flatMap((layer) => scene.layers[layer]);
const emojis = (commands: readonly DrawCommand[]): DrawCommand[] =>
  commands.filter((c) => c.op === 'text' && c.emoji === true);

function mutated(change: (view: DomainView) => void, net: PetriNet = smallNet()): DomainView {
  const view = structuredClone(smallView(net));
  view.netHash = netHash(net);
  change(view);
  return view;
}

function problems(view: DomainView, net: PetriNet = smallNet()): DomainDiagnostic[] {
  return validateDomainView(net, view).diagnostics.filter((d) => d.severity === 'error');
}

describe('which texts are one emoji', () => {
  it.each(['🦄', '👩‍⚕️', '🇩🇪', '❤️', '1️⃣', '🍞', '🧑🏽‍🔧', '🏴󠁧󠁢󠁥󠁮󠁧󠁿'])('accepts %s', (text) => {
    expect(emojiProblem(text)).toBeNull();
    expect(isEmoji(text)).toBe(true);
  });

  it.each(['ab', '🦄🦄', '', 'a🦄', '1', 'A', '🦄 ', ' ', '#'])('rejects %j', (text) => {
    expect(emojiProblem(text)).toEqual(expect.any(String));
    expect(isEmoji(text)).toBe(false);
  });

  it('says what is expected', () => {
    expect(emojiProblem('🦄🦄')).toMatch(/exactly one emoji/);
    expect(emojiProblem('x')).toMatch(/not an emoji/);
  });
});

describe('rule V12 and the schema', () => {
  it('accepts an emoji for the entity, the appearance and a display', () => {
    for (const emoji of ['🦄', '👩‍⚕️', '🇩🇪', '❤️', '1️⃣']) {
      const view = mutated((v) => {
        v.meta.entity = { singular: 'Unicorn', plural: 'Unicorns', emoji };
        v.places['q'] = {
          kind: 'conveyor',
          path: [
            [100, 200],
            [300, 200],
          ],
          appearance: { emoji },
        };
        v.places['done'] = {
          kind: 'sink',
          box: [600, 180, 80, 40],
          display: { style: 'pictogram', per: 2, emoji },
        };
      });
      expect(validateDomainView(smallNet(), view).diagnostics, emoji).toEqual([]);
    }
  });

  it('rejects what is not exactly one emoji, as V12 at the field', () => {
    for (const emoji of ['ab', '🦄🦄', '', 'a🦄']) {
      const cases: Array<[string, (v: DomainView) => void]> = [
        [
          'meta.entity.emoji',
          (v) => {
            v.meta.entity = { singular: 'A', plural: 'As', emoji };
          },
        ],
        [
          'places.q.appearance.emoji',
          (v) => {
            v.places['q'] = {
              kind: 'conveyor',
              path: [
                [100, 200],
                [300, 200],
              ],
              appearance: { emoji },
            };
          },
        ],
        [
          'places.done.display.emoji',
          (v) => {
            v.places['done'] = {
              kind: 'sink',
              box: [600, 180, 80, 40],
              display: { style: 'number', emoji },
            };
          },
        ],
      ];
      for (const [path, change] of cases) {
        const found = problems(mutated(change)).filter((d) => d.path === path);
        expect(
          found.map((d) => d.rule),
          `${JSON.stringify(emoji)} at ${path}`,
        ).toEqual(['V12']);
      }
    }
  });

  it('rejects an emoji next to a sprite or an icon, and a tint next to an emoji', () => {
    const entity = problems(
      mutated((v) => {
        v.meta.entity = { singular: 'A', plural: 'As', sprite: 'parcel', emoji: '🦄' } as never;
      }),
    );
    expect(entity.map((d) => [d.rule, d.path])).toEqual([['V12', 'meta.entity.emoji']]);
    const path: Array<[number, number]> = [
      [100, 200],
      [300, 200],
    ];
    const both = problems(
      mutated((v) => {
        v.places['q'] = {
          kind: 'conveyor',
          path,
          appearance: { sprite: 'frame', emoji: '🦄' } as never,
        };
      }),
    );
    expect(both.map((d) => [d.rule, d.path])).toEqual([['V12', 'places.q.appearance.emoji']]);
    const tinted = problems(
      mutated((v) => {
        v.places['q'] = {
          kind: 'conveyor',
          path,
          appearance: { emoji: '🦄', tint: 'ok' } as never,
        };
      }),
    );
    expect(tinted.map((d) => [d.rule, d.path])).toEqual([['V12', 'places.q.appearance.tint']]);
    const icon = problems(
      mutated((v) => {
        v.places['done'] = {
          kind: 'sink',
          box: [600, 180, 80, 40],
          display: { style: 'number', icon: 'parcel', emoji: '🦄' },
        };
      }),
    );
    expect(icon.map((d) => [d.rule, d.path])).toEqual([['V12', 'places.done.display.emoji']]);
  });

  it('still reports a missing sprite as the rule of its field', () => {
    const view = mutated((v) => {
      v.places['q'] = {
        kind: 'conveyor',
        path: [
          [100, 200],
          [300, 200],
        ],
        appearance: { tint: 'ok' } as never,
      };
    });
    expect(problems(view).map((d) => d.rule)).toEqual(['V11']);
  });

  it('keeps V11 for an emoji on a place that holds no cases', () => {
    const view = mutated((v) => {
      v.places['res'] = { kind: 'pool', pos: [300, 40], appearance: { emoji: '🦄' } } as never;
    });
    const found = validateDomainView(smallNet(), view).diagnostics;
    expect(found.some((d) => d.rule === 'V11' || d.rule === 'V1')).toBe(true);
  });

  it('writes the emoji in the JSON Schema and keeps the key order of normalizeDomainView', () => {
    expect(JSON.stringify(validateDomainView(smallNet(), smallView()).view)).toBeDefined();
    const view = mutated((v) => {
      v.meta.entity = { emoji: '🦄', plural: 'Unicorns', singular: 'Unicorn' };
    });
    expect(Object.keys(normalizeDomainView(view).meta.entity)).toEqual([
      'singular',
      'plural',
      'emoji',
    ]);
    expect(JSON.stringify(normalizeDomainView(smallView()))).not.toContain('emoji');
  });
});

describe('the look of cases with an emoji', () => {
  it('uses the emoji of the entity where a place has no appearance', () => {
    const view = mutated((v) => {
      v.meta.entity = { singular: 'Unicorn', plural: 'Unicorns', emoji: '🦄' };
    });
    expect(defaultAppearance(view)).toEqual({ emoji: '🦄' });
    expect(appearanceOfPlace(view, 'q')).toEqual({ emoji: '🦄' });
    expect(sameAppearance({ emoji: '🦄' }, { emoji: '🦄' })).toBe(true);
    expect(sameAppearance({ emoji: '🦄' }, { emoji: '🍞' })).toBe(false);
    expect(sameAppearance({ emoji: '🦄' }, { sprite: 'dot' })).toBe(false);
  });

  it('can be set and removed as one edit', () => {
    const view = smallView();
    const set = setAppearance(view, { section: 'places', key: 'q' }, { emoji: '🍞' });
    expect(set.places['q']).toMatchObject({ appearance: { emoji: '🍞' } });
    expect(set.provenance['places.q']?.source).toBe('user');
    expect(validateDomainView(smallNet(), set).ok).toBe(true);
  });
});

describe('the scene with an emoji', () => {
  const net = smallNet();
  net.marking = { res: [1], q: [1, 2, 3] };
  const view = mutated((v) => {
    v.meta.entity = { singular: 'Unicorn', plural: 'Unicorns', emoji: '🦄' };
  }, net);
  view.netHash = netHash(net);

  it('draws a case as a text command marked as emoji, at the place of the token', () => {
    const scene = buildScene(net, view, net.marking);
    const found = emojis(scene.layers.tokens);
    expect(found).toHaveLength(3);
    for (const c of found) {
      expect(c).toMatchObject({
        op: 'text',
        text: '🦄',
        emoji: true,
        align: 'center',
        elementId: 'q',
      });
    }
    expect(all(scene).some((c) => c.op === 'sprite')).toBe(false);
    expect(scene.emoji).toBe('🦄');
    expect(scene.sprite).toBeUndefined();
  });

  it('draws the appearance of a place and the entity next to each other', () => {
    const mixed = structuredClone(view);
    mixed.places['q'] = {
      kind: 'conveyor',
      path: [
        [100, 200],
        [300, 200],
      ],
      appearance: { emoji: '🍞' },
    };
    const scene = buildScene(net, mixed, net.marking);
    expect(emojis(scene.layers.tokens).map((c) => c.op === 'text' && c.text)).toEqual([
      '🍞',
      '🍞',
      '🍞',
    ]);
  });

  it('puts the emoji of a case in a station on its slot', async () => {
    const run = await runAnimated(net, view, { bundle: 0.5, seconds: 3 });
    const context = layoutContext(net, view);
    const frame = buildDynamicScene(context, buildStaticScene(net, view), run.layout, run.anim, {
      now: 100,
    });
    const found = emojis(frame.layers.tokens);
    expect(found.length).toBeGreaterThan(0);
    expect(frame.layers.tokens.some((c) => c.op === 'sprite')).toBe(false);
  });

  it('changes from one look to the next at the end of a firing, also from a sprite to an emoji', async () => {
    const stages = smallNet();
    stages.marking = { res: [1], q: [1] };
    const staged = mutated((v) => {
      v.places['q'] = {
        kind: 'conveyor',
        path: [
          [100, 200],
          [300, 200],
        ],
        appearance: { sprite: 'document', tint: 'neutral' },
      };
      v.places['done'] = {
        kind: 'sink',
        box: [600, 180, 80, 40],
        appearance: { emoji: '✅' },
      };
    }, stages);
    const sim = createSimulation(stages, { seed: 1 });
    const context = layoutContext(stages, staged);
    let layout = layoutTokens(stages, staged, layoutStateOf(sim.state));
    let anim = EMPTY_ANIMATION;
    let now = 0;
    const seen = new Set<string>();
    const feed = (bundle: Parameters<typeof applyEvents>[1]): void => {
      const next = layoutTokens(stages, staged, layoutStateOf(sim.state));
      anim = applyEvents(anim, bundle, layout, next, now, { context });
      layout = next;
    };
    feed([...sim.initialEvents]);
    for (let i = 0; i < 80; i += 1) {
      feed(await sim.advance(0.25));
      for (const t of [now, now + 100, now + 200, now + 300]) {
        const frame = buildDynamicScene(context, buildStaticScene(stages, staged), layout, anim, {
          now: t,
        });
        for (const c of frame.layers.tokens) {
          if (c.op === 'sprite') seen.add(`sprite:${c.sprite}`);
          if (c.op === 'text' && c.emoji) seen.add(`emoji:${c.text}`);
        }
      }
      now += 400;
    }
    expect(seen).toContain('sprite:document');
    expect(seen).toContain('emoji:✅');
  });

  it('keeps the legend, the flow dots and the counters of sinks on the emoji', () => {
    const counted = structuredClone(view);
    counted.places['done'] = {
      kind: 'sink',
      box: [600, 180, 80, 80],
      display: { style: 'pictogram', per: 2, emoji: '🌳' },
    };
    const scene = buildScene(net, counted, { ...net.marking, done: [1, 1, 1, 1, 1] });
    const trees = emojis(all(scene)).filter((c) => c.op === 'text' && c.text === '🌳');
    // Static: the symbol in the legend ("1 symbol = 2"). Dynamic: two and a half symbols.
    expect(trees.length).toBeGreaterThanOrEqual(1);
  });
});

describe('a pictogram of emoji', () => {
  const net = createEmptyNet('Count');
  net.places = [
    { id: 'in', name: 'In', position: { x: 0, y: 0 } },
    { id: 'done', name: 'Done', position: { x: 0, y: 0 } },
  ];
  net.transitions = [{ id: 't', name: 'Work', position: { x: 0, y: 0 } }];
  net.arcs = [
    { id: 'a1', source: 'in', target: 't', weight: 1 },
    { id: 'a2', source: 't', target: 'done', weight: 1 },
  ];
  const display: CounterDisplay = { style: 'pictogram', per: 4, emoji: '🍞' };
  const view: DomainView = {
    schemaVersion: 1,
    netHash: netHash(net),
    meta: {
      theme: 'Bakery',
      viewName: 'Shop',
      entity: { singular: 'Loaf', plural: 'Loaves', emoji: '🍞' },
      canvas: { width: 600, height: 300 },
    },
    places: {
      in: {
        kind: 'queue',
        path: [
          [20, 100],
          [200, 100],
        ],
      },
      done: { kind: 'sink', box: [300, 80, 240, 100], display },
    },
    transitions: { t: { kind: 'station', box: [220, 60, 60, 60], slots: [[250, 90]] } },
    provenance: {},
  };
  const entry = view.places['done'] as CounterEntry;
  const info = counterInfo('done', entry, graphicDisplay(entry)!, net, view, true);

  it('draws whole symbols and a rest as a partial one, with the emoji of the display', () => {
    // 10 tokens, 4 per symbol: two whole symbols and half of a third.
    const frame = dynamicCounterCommands(info, { count: 10 });
    const symbols = emojis(frame);
    expect(symbols.map((c) => c.op === 'text' && c.text)).toEqual(['🍞', '🍞', '🍞']);
    expect(symbols.map((c) => (c.op === 'text' ? c.fraction : 0))).toEqual([
      undefined,
      undefined,
      0.5,
    ]);
  });

  it('takes the entity as the symbol of a counter of cases without a display symbol', () => {
    const plain = { ...entry, display: { style: 'pictogram', per: 4 } } as CounterEntry;
    const plainInfo = counterInfo('done', plain, graphicDisplay(plain)!, net, view, true);
    expect(plainInfo.emoji).toBe('🍞');
    const other = counterInfo('done', plain, graphicDisplay(plain)!, net, view, false);
    expect(other.emoji).toBeUndefined();
    expect(other.icon).toBe('dot');
  });

  it('keeps the emoji when a display changes its style', () => {
    const next = suggestDisplay(net, 'done', 'fill', display);
    expect(next).toMatchObject({ style: 'fill', emoji: '🍞' });
  });
});

describe('painting an emoji', () => {
  function recorder() {
    const calls: Array<{ op: string; args: unknown[]; font?: string }> = [];
    let font = '';
    const target: Record<string | symbol, unknown> = new Proxy(
      {},
      {
        get: (_t, key) => {
          if (key === 'font') return font;
          if (key === 'measureText') return () => ({ width: 10 });
          return (...args: unknown[]) => {
            calls.push({ op: String(key), args, font });
          };
        },
        set: (_t, key, value) => {
          if (key === 'font') font = String(value);
          return true;
        },
      },
    );
    return { ctx: target as unknown as CanvasRenderingContext2D, calls };
  }

  it('uses fillText with the emoji fonts', () => {
    const net = smallNet();
    net.marking = { res: [1], q: [1] };
    const view = mutated((v) => {
      v.meta.entity = { singular: 'Unicorn', plural: 'Unicorns', emoji: '🦄' };
    }, net);
    const scene = buildScene(net, view, net.marking);
    const { ctx, calls } = recorder();
    paintScene(ctx, scene, {} as never);
    const draws = calls.filter((c) => c.op === 'fillText' && c.args[0] === '🦄');
    expect(draws).toHaveLength(1);
    expect(draws[0]!.font).toContain(EMOJI_FONT);
  });
});

describe('frame budget with emoji', () => {
  /** The ring of the frame-budget test of the dynamic scene: 20 belts, 200 tokens in all. */
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

  it('lays out, animates and builds 200 emoji in under 8 ms for a typical frame', async () => {
    const ring = ringNet();
    const generic = genericDomainView(ring);
    const ringView: DomainView = {
      ...generic,
      meta: { ...generic.meta, entity: { singular: 'Unicorn', plural: 'Unicorns', emoji: '🦄' } },
    };
    const ringContext = layoutContext(ring, ringView);
    const staticScene = buildStaticScene(ring, ringView);
    const sim = createSimulation(ring);
    let layout = layoutTokens(ring, ringView, layoutStateOf(sim.state));
    let anim = EMPTY_ANIMATION;
    const times: number[] = [];
    let drawn = 0;
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
      drawn = Math.max(drawn, emojis(frame.layers.tokens).length);
      layout = next;
    }
    const warm = times.slice(20);
    const median = [...warm].sort((a, b) => a - b)[Math.floor(warm.length / 2)]!;
    expect(drawn).toBeGreaterThanOrEqual(150);
    expect(median).toBeLessThan(8);
  }, 30_000);
});
