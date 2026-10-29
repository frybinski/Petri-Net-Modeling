import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNetText, type PetriNet } from '@pnm/core';
import { describe, expect, it } from 'vitest';
import {
  buildStaticScene,
  emptyMoved,
  LAYERS,
  mergeMoved,
  moveEntry,
  movedEntries,
  ref,
  sceneOnly,
  sceneWithout,
  type DomainView,
  type DrawCommand,
} from '../src';

function example(name: string): PetriNet {
  return parseNetText(
    readFileSync(
      join(import.meta.dirname, '..', '..', '..', 'examples', `${name}.pn.json`),
      'utf8',
    ),
  );
}

const net = example('parcel-center');
const view = net.domainView as DomainView;

/** The commands of a scene as sorted strings, layer by layer, so that their order does not matter. */
function flat(layers: Record<string, readonly DrawCommand[]>): Record<string, string[]> {
  return Object.fromEntries(
    LAYERS.map((layer) => [layer, (layers[layer] ?? []).map((c) => JSON.stringify(c)).sort()]),
  );
}

describe('movedEntries', () => {
  it('finds the station that moved, and nothing else when no connector touches it', () => {
    const next = moveEntry(view, ref('transitions', 't_sort'), [40, 24], { snap: 0, net });
    const moved = movedEntries(net, view, next);
    expect([...moved.elements]).toEqual(['t_sort']);
    expect(moved.decor.size).toBe(0);
  });

  it('finds the connectors that follow a node', () => {
    // A connector of the view ends at the door `t_rA`: it follows when the door moves.
    const arc = net.arcs.find((a) => a.target === 't_rA' && view.arcs?.[`${a.source}>${a.target}`]);
    expect(arc).toBeDefined();
    const next = moveEntry(view, ref('transitions', 't_rA'), [30, 20], { snap: 0, net });
    const moved = movedEntries(net, view, next);
    expect(moved.elements.has('t_rA')).toBe(true);
    expect(moved.elements.has(arc!.id)).toBe(true);
  });

  it('is empty for a view that was not changed', () => {
    const moved = movedEntries(net, view, view);
    expect(moved.elements.size + moved.decor.size).toBe(0);
  });

  it('finds a piece of decor by its index', () => {
    expect((view.decor ?? []).length).toBeGreaterThan(0);
    const next = moveEntry(view, ref('decor', 0), [16, 16], { snap: 0, net });
    const moved = movedEntries(net, view, next);
    expect([...moved.decor]).toEqual([0]);
    expect(moved.elements.size).toBe(0);
  });
});

describe('mergeMoved', () => {
  it('reports whether the set grew', () => {
    const all = emptyMoved();
    const a = { elements: new Set(['x']), decor: new Set([1]) };
    expect(mergeMoved(all, a)).toBe(true);
    expect(mergeMoved(all, a)).toBe(false);
    expect(mergeMoved(all, { elements: new Set(['y']), decor: new Set() })).toBe(true);
    expect([...all.elements]).toEqual(['x', 'y']);
  });
});

describe('splitting a scene for a drag', () => {
  const cases: Array<[string, (v: DomainView) => DomainView]> = [
    ['a station', (v) => moveEntry(v, ref('transitions', 't_sort'), [40, 24], { snap: 0, net })],
    ['a belt', (v) => moveEntry(v, ref('places', 'p_in'), [24, -16], { snap: 0, net })],
    ['a piece of decor', (v) => moveEntry(v, ref('decor', 0), [16, 16], { snap: 0, net })],
  ];
  for (const [name, change] of cases) {
    it(`gives, for ${name}, the same picture as the whole scene of the new view`, () => {
      const next = change(view);
      const moved = movedEntries(net, view, next);
      expect(moved.elements.size + moved.decor.size).toBeGreaterThan(0);
      const rest = sceneWithout(buildStaticScene(net, view), moved);
      const only = sceneOnly(buildStaticScene(net, next), moved);
      const whole = buildStaticScene(net, next);
      const together = Object.fromEntries(
        LAYERS.map((layer) => [layer, [...rest.layers[layer], ...only[layer]]]),
      );
      expect(flat(together)).toEqual(flat(whole.layers));
    });
  }

  it('keeps the hit areas of the whole scene', () => {
    const scene = buildStaticScene(net, view);
    const moved = { elements: new Set(['t_sort']), decor: new Set<number>() };
    expect(sceneWithout(scene, moved).hits).toBe(scene.hits);
  });

  it('leaves out of the rest exactly what the moved part draws', () => {
    const scene = buildStaticScene(net, view);
    const moved = { elements: new Set(['t_sort']), decor: new Set<number>() };
    const rest = sceneWithout(scene, moved);
    const only = sceneOnly(scene, moved);
    for (const layer of LAYERS) {
      expect(rest.layers[layer].length + only[layer].length).toBe(scene.layers[layer].length);
    }
    expect(LAYERS.some((layer) => only[layer].length > 0)).toBe(true);
  });
});
