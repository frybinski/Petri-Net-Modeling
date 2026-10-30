import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNetText } from '@pnm/core';
import { describe, expect, it } from 'vitest';
import {
  DARK_PALETTE,
  DISPLAY_ICONS,
  LAYERS,
  LIGHT_PALETTE,
  SPRITES,
  SpriteCache,
  TINTS,
  TINT_TONES,
  buildDynamicScene,
  buildScene,
  buildStaticScene,
  drawIcon,
  drawSprite,
  layoutContext,
  paintBackdrop,
  paintLayers,
  paintScene,
  shade,
  spriteSize,
  type DomainView,
  type DrawCommand,
} from '../src';
import { runAnimated } from './animated-run';

const bikes = parseNetText(
  readFileSync(
    join(import.meta.dirname, '..', '..', '..', 'examples', 'bike-frames.pn.json'),
    'utf8',
  ),
);
const bikeView = bikes.domainView as DomainView;

/** A context that records the calls and the colors that were set. */
function recordingContext() {
  const calls = new Map<string, number>();
  const colors = new Set<string>();
  const ctx = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'measureText') return () => ({ width: 20 });
        return () => {
          calls.set(prop, (calls.get(prop) ?? 0) + 1);
        };
      },
      set(_target, prop: string, value: unknown) {
        if ((prop === 'fillStyle' || prop === 'strokeStyle') && typeof value === 'string') {
          colors.add(value);
        }
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, colors };
}

describe('shade', () => {
  it('darkens a #rrggbb color and leaves others as they are', () => {
    expect(shade('#ffffff', 0.5)).toBe('#808080');
    expect(shade('#ff8000', 0)).toBe('#ff8000');
    expect(shade('#4f46e5', 1)).toBe('#000000');
    expect(shade('rgba(0, 0, 0, 0.2)', 0.5)).toBe('rgba(0, 0, 0, 0.2)');
    expect(shade('red', 0.5)).toBe('red');
  });
});

describe('tints are tokens of the palette', () => {
  it('every tint names a color that both themes have, and the themes differ for it', () => {
    for (const tint of TINTS) {
      const tone = TINT_TONES[tint];
      expect(typeof LIGHT_PALETTE[tone], tint).toBe('string');
      expect(typeof DARK_PALETTE[tone], tint).toBe('string');
      expect(LIGHT_PALETTE[tone]).toMatch(/^#[0-9a-f]{6}$/i);
    }
    // The grey of raw material is the same mid grey in both themes, the colored tints follow the theme.
    expect(LIGHT_PALETTE[TINT_TONES.neutral]).toBe(DARK_PALETTE[TINT_TONES.neutral]);
    expect(LIGHT_PALETTE[TINT_TONES.accent]).not.toBe(DARK_PALETTE[TINT_TONES.accent]);
  });

  it('a tinted sprite is drawn in the color of its token and its shade, never in a color of its own', () => {
    for (const [name, palette] of [
      ['light', LIGHT_PALETTE],
      ['dark', DARK_PALETTE],
    ] as const) {
      for (const sprite of [
        'frame',
        'bicycle',
        'bars',
        'parcel',
        'document',
        'dot',
        'person',
        'vehicle',
      ] as const) {
        for (const tint of TINTS) {
          const { ctx, colors } = recordingContext();
          drawSprite(ctx, sprite, 10, 10, spriteSize(sprite), palette, 0, tint);
          const body = palette[TINT_TONES[tint]];
          expect(colors.has(body), `${name} ${sprite} ${tint}`).toBe(true);
          expect(colors.has(shade(body, 0.5)), `${name} ${sprite} ${tint} edge`).toBe(true);
        }
      }
    }
  });
});

describe('the new sprites and the symbols', () => {
  it('draw something in both themes, at their size and at 16 px, with the state of the context kept', () => {
    for (const palette of [LIGHT_PALETTE, DARK_PALETTE]) {
      for (const sprite of SPRITES) {
        for (const size of [16, spriteSize(sprite), 40]) {
          const { ctx, calls } = recordingContext();
          drawSprite(ctx, sprite, 20, 20, size, palette);
          expect((calls.get('fill') ?? 0) + (calls.get('stroke') ?? 0), sprite).toBeGreaterThan(1);
          expect(calls.get('save')).toBe(calls.get('restore'));
        }
      }
      for (const icon of DISPLAY_ICONS) {
        const { ctx, calls } = recordingContext();
        drawIcon(ctx, icon, 20, 20, 18, palette);
        expect((calls.get('fill') ?? 0) + (calls.get('stroke') ?? 0), icon).toBeGreaterThan(0);
        expect(calls.get('save')).toBe(calls.get('restore'));
      }
    }
  });

  it('a partly filled symbol is the whole one faintly and its left part in full, clipped', () => {
    const whole = recordingContext();
    drawIcon(whole.ctx, 'co2', 20, 20, 18, LIGHT_PALETTE, 1);
    const part = recordingContext();
    drawIcon(part.ctx, 'co2', 20, 20, 18, LIGHT_PALETTE, 0.4);
    expect(whole.calls.get('clip') ?? 0).toBe(0);
    expect(part.calls.get('clip')).toBe(1);
    expect(part.calls.get('fill')!).toBeGreaterThanOrEqual(2 * whole.calls.get('fill')!);
    expect(part.calls.get('save')).toBe(part.calls.get('restore'));
    const none = recordingContext();
    drawIcon(none.ctx, 'co2', 20, 20, 18, LIGHT_PALETTE, 0);
    expect(none.calls.get('clip') ?? 0).toBe(0);
  });
});

describe('painting the fill, the symbols, the curve and the stages of the bicycle frame production', () => {
  for (const [theme, palette] of [
    ['light', LIGHT_PALETTE],
    ['dark', DARK_PALETTE],
  ] as const) {
    it(`paints the scene with the marking, and the frames of a run, in ${theme} mode`, async () => {
      const { ctx, calls } = recordingContext();
      paintBackdrop(ctx, 800, 600, palette);
      paintScene(ctx, buildScene(bikes, bikeView, bikes.marking), palette, { scale: 2 });
      expect(calls.get('clip') ?? 0).toBeGreaterThan(0);
      const context = layoutContext(bikes, bikeView);
      const staticScene = buildStaticScene(bikes, bikeView);
      let ops = new Set<DrawCommand['op']>();
      await runAnimated(bikes, bikeView, {
        bundle: 120,
        seconds: 3 * 3600,
        wallStep: 400,
        onBundle: (_bundle, anim, layout, now) => {
          const frame = buildDynamicScene(context, staticScene, layout, anim, {
            now,
            simTime: layout.time,
          });
          const recorder = recordingContext();
          paintLayers(recorder.ctx, frame.layers, palette, { scale: 2 });
          expect(recorder.calls.get('save')).toBe(recorder.calls.get('restore'));
          ops = new Set([...ops, ...LAYERS.flatMap((l) => frame.layers[l].map((c) => c.op))]);
        },
      });
      for (const op of ['fill', 'icon', 'spark', 'sprite', 'badge'] as const) {
        expect(ops.has(op), op).toBe(true);
      }
    }, 30_000);
  }

  it('the cache renders each symbol and each fraction once, and blits afterwards', () => {
    const created: number[] = [];
    const inner = recordingContext();
    const cache = new SpriteCache((width, height) => {
      created.push(width);
      return { width, height, getContext: () => inner.ctx };
    });
    const { ctx, calls } = recordingContext();
    const icons: DrawCommand[] = [
      { layer: 'tokens', op: 'icon', icon: 'co2', x: 10, y: 10, size: 18 },
      { layer: 'tokens', op: 'icon', icon: 'co2', x: 40, y: 10, size: 18 },
      { layer: 'tokens', op: 'icon', icon: 'co2', x: 70, y: 10, size: 18, fraction: 0.6 },
      { layer: 'tokens', op: 'icon', icon: 'waste', x: 100, y: 10, size: 18 },
      { layer: 'tokens', op: 'sprite', sprite: 'frame', x: 10, y: 40, size: 20, tint: 'accent' },
      { layer: 'tokens', op: 'sprite', sprite: 'frame', x: 40, y: 40, size: 20, tint: 'neutral' },
      {
        layer: 'tokens',
        op: 'sprite',
        sprite: 'frame',
        x: 70,
        y: 40,
        size: 20,
        tint: 'accent',
        alpha: 0.5,
      },
    ];
    const layers = {
      decor: [],
      arcs: [],
      places: [],
      transitions: [],
      tokens: icons,
      labels: [],
      highlight: [],
    };
    paintLayers(ctx, layers, LIGHT_PALETTE, { scale: 2, sprites: cache });
    paintLayers(ctx, layers, LIGHT_PALETTE, { scale: 2, sprites: cache });
    // Images: co2 whole, co2 partly, waste, frame accent, frame neutral.
    expect(created).toHaveLength(5);
    expect(calls.get('drawImage')).toBe(14);
    expect(calls.get('save') ?? 0).toBe(calls.get('restore') ?? 0);
  });
});
