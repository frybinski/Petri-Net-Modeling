import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEmptyNet, parseNetText, type PetriNet } from '@pnm/core';
import { describe, expect, it } from 'vitest';
import { layoutGraph, layoutNet } from '../src';

const examplesDir = join(import.meta.dirname, '..', '..', '..', 'examples');
const examples = readdirSync(examplesDir)
  .filter((f) => f.endsWith('.pn.json'))
  .map((f): [string, PetriNet] => [f, parseNetText(readFileSync(join(examplesDir, f), 'utf8'))]);

describe('layoutNet', () => {
  it('returns no positions for an empty net', async () => {
    expect(await layoutNet(createEmptyNet('empty'))).toEqual({});
  });

  it.each(examples)('lays out %s with finite, distinct positions', async (_file, net) => {
    const positions = await layoutNet(net);
    const nodes = [...net.places, ...net.transitions];
    expect(Object.keys(positions).sort()).toEqual(nodes.map((n) => n.id).sort());
    const seen = new Set<string>();
    for (const node of nodes) {
      const pos = positions[node.id];
      expect(pos).toBeDefined();
      expect(Number.isFinite(pos?.x)).toBe(true);
      expect(Number.isFinite(pos?.y)).toBe(true);
      seen.add(`${pos?.x},${pos?.y}`);
    }
    expect(seen.size).toBe(nodes.length);
  });

  it('does not modify the net', async () => {
    const [, net] = examples[0] as [string, PetriNet];
    const before = JSON.stringify(net);
    await layoutNet(net);
    expect(JSON.stringify(net)).toBe(before);
  });

  it('flows left to right by default and top to bottom for DOWN', async () => {
    const net = parseNetText(readFileSync(join(examplesDir, 'producer-consumer.pn.json'), 'utf8'));
    const right = await layoutNet(net, { direction: 'RIGHT' });
    const down = await layoutNet(net, { direction: 'DOWN' });
    const xs = Object.values(right).map((p) => p.x);
    const ys = Object.values(right).map((p) => p.y);
    const dxs = Object.values(down).map((p) => p.x);
    const dys = Object.values(down).map((p) => p.y);
    const span = (v: number[]): number => Math.max(...v) - Math.min(...v);
    expect(span(xs)).toBeGreaterThan(span(ys) * 0.5);
    expect(span(dys)).toBeGreaterThan(span(dxs) * 0.5);
    // The first transition of the producer must come after its input place.
    expect(right.produce!.x).toBeGreaterThan(right.prod_idle!.x);
    expect(down.produce!.y).toBeGreaterThan(down.prod_idle!.y);
  });

  it('respects the spacing option', async () => {
    const [, net] = examples[0] as [string, PetriNet];
    const tight = await layoutNet(net, { spacing: 20 });
    const wide = await layoutNet(net, { spacing: 120 });
    const extent = (r: Record<string, { x: number; y: number }>): number => {
      const v = Object.values(r);
      return (
        Math.max(...v.map((p) => p.x)) -
        Math.min(...v.map((p) => p.x)) +
        Math.max(...v.map((p) => p.y)) -
        Math.min(...v.map((p) => p.y))
      );
    };
    expect(extent(wide)).toBeGreaterThan(extent(tight));
  });

  it('ignores arcs with missing ends', async () => {
    const net = createEmptyNet('x');
    net.places.push({ id: 'p', name: 'p', position: { x: 0, y: 0 } });
    net.arcs.push({ id: 'a', source: 'p', target: 'ghost', weight: 1 });
    expect(Object.keys(await layoutNet(net))).toEqual(['p']);
  });
});

describe('layoutGraph', () => {
  const nodes = ['a', 'b', 'c', 'd'].map((id, i) => ({
    id,
    width: 100,
    height: 40,
    first: i === 0,
  }));
  // a -> b -> c -> a is a cycle; d hangs off b.
  const edges = [
    { id: 'e1', source: 'a', target: 'b' },
    { id: 'e2', source: 'b', target: 'c' },
    { id: 'e3', source: 'c', target: 'a' },
    { id: 'e4', source: 'b', target: 'd' },
    { id: 'e5', source: 'd', target: 'd' },
  ];

  it('places every node, keeps the first one in the first layer and routes the edges', async () => {
    const { positions, routes } = await layoutGraph(nodes, edges);
    expect(Object.keys(positions).sort()).toEqual(['a', 'b', 'c', 'd']);
    // Direction RIGHT: the layers go from left to right and `a` is in the first one.
    for (const id of ['b', 'c', 'd']) expect(positions['a']!.x).toBeLessThan(positions[id]!.x);
    // No two nodes overlap.
    const ids = Object.keys(positions);
    for (const x of ids) {
      for (const y of ids) {
        if (x >= y) continue;
        const p = positions[x]!;
        const q = positions[y]!;
        const apart = Math.abs(p.x - q.x) >= 100 || Math.abs(p.y - q.y) >= 40;
        expect(apart).toBe(true);
      }
    }
    // Self-loops are left out; the others have routes of at least two points.
    expect(routes['e5']).toBeUndefined();
    for (const id of ['e1', 'e2', 'e3', 'e4']) expect(routes[id]!.length).toBeGreaterThanOrEqual(2);
  });

  it('handles the empty graph and ignores edges to unknown nodes', async () => {
    expect(await layoutGraph([], [])).toEqual({ positions: {}, routes: {} });
    const result = await layoutGraph([nodes[0]!], [{ id: 'x', source: 'a', target: 'zzz' }]);
    expect(Object.keys(result.positions)).toEqual(['a']);
  });
});
