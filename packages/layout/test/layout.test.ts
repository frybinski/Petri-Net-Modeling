import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEmptyNet, parseNetText, type PetriNet } from '@pnm/core';
import { describe, expect, it } from 'vitest';
import { layoutNet } from '../src';

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
