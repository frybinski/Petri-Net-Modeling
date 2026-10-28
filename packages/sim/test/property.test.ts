import { createEmptyNet, type PetriNet } from '@pnm/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createSimulation, type SimEvent } from '../src';

interface Spec {
  tokens: number[];
  durations: number[];
  arcs: Array<{ place: number; transition: number; towards: boolean; weight: number }>;
}

const spec = fc.record({
  tokens: fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 2, maxLength: 5 }),
  durations: fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 1, maxLength: 4 }),
  arcs: fc.array(
    fc.record({
      place: fc.nat(4),
      transition: fc.nat(3),
      towards: fc.boolean(),
      weight: fc.integer({ min: 1, max: 3 }),
    }),
    { minLength: 1, maxLength: 12 },
  ),
});

function build({ tokens, durations, arcs }: Spec): PetriNet {
  const net = createEmptyNet('random');
  tokens.forEach((n, i) => {
    net.places.push({ id: `p${i}`, name: `p${i}`, position: { x: i * 100, y: 0 } });
    if (n > 0) net.marking[`p${i}`] = Array.from({ length: n }, () => 1);
  });
  durations.forEach((d, i) => {
    net.transitions.push({
      id: `t${i}`,
      name: `t${i}`,
      position: { x: i * 100, y: 100 },
      ...(d > 0 && { timing: { kind: 'fixed' as const, value: d } }),
    });
  });
  const seen = new Set<string>();
  for (const arc of arcs) {
    const place = `p${arc.place % tokens.length}`;
    const transition = `t${arc.transition % durations.length}`;
    const source = arc.towards ? place : transition;
    const target = arc.towards ? transition : place;
    if (seen.has(`${source}>${target}`)) continue;
    seen.add(`${source}>${target}`);
    net.arcs.push({ id: `a${net.arcs.length}`, source, target, weight: arc.weight });
  }
  return net;
}

describe('token bookkeeping', () => {
  it('marking = initial + completed output - started input, with the weights of the arcs', async () => {
    await fc.assert(
      fc.asyncProperty(spec, fc.integer({ min: 1, max: 1000 }), async (s, seed) => {
        const net = build(s);
        const sim = createSimulation(net, { seed, maxFiringsPerInstant: 40 });
        const events: SimEvent[] = [];
        for (let i = 0; i < 25; i += 1) {
          const step = await sim.step();
          events.push(...step);
          if (step.some((e) => e.type === 'idle')) break;
        }
        const expected: Record<string, number> = {};
        for (const [placeId, tokens] of Object.entries(net.marking))
          expected[placeId] = tokens.length;
        const problems: string[] = [];
        const weight = (source: string, target: string): number =>
          net.arcs.find((a) => a.source === source && a.target === target)?.weight ?? 0;
        for (const e of events) {
          if (e.type === 'start') {
            const taken: Record<string, number> = {};
            for (const ref of e.consumed) taken[ref.placeId] = (taken[ref.placeId] ?? 0) + 1;
            for (const place of net.places) {
              if ((taken[place.id] ?? 0) !== weight(place.id, e.transitionId)) {
                problems.push(
                  `start ${e.transitionId} took ${taken[place.id] ?? 0} from ${place.id}`,
                );
              }
              expected[place.id] = (expected[place.id] ?? 0) - (taken[place.id] ?? 0);
            }
          } else if (e.type === 'complete') {
            const put: Record<string, number> = {};
            for (const ref of e.produced) put[ref.placeId] = (put[ref.placeId] ?? 0) + 1;
            for (const place of net.places) {
              if ((put[place.id] ?? 0) !== weight(e.transitionId, place.id)) {
                problems.push(
                  `complete ${e.transitionId} put ${put[place.id] ?? 0} on ${place.id}`,
                );
              }
              expected[place.id] = (expected[place.id] ?? 0) + (put[place.id] ?? 0);
            }
          }
        }
        for (const place of net.places) {
          const marked = sim.state.marking[place.id]?.length ?? 0;
          const metas = sim.state.meta[place.id]?.length ?? 0;
          if (marked !== (expected[place.id] ?? 0) || metas !== marked) {
            problems.push(
              `${place.id}: ${marked} tokens, ${metas} metadata, expected ${expected[place.id] ?? 0}`,
            );
          }
        }
        expect(problems).toEqual([]);
        // Nothing is ever negative and running firings are exactly the unfinished starts.
        const open = new Set<number>();
        for (const e of events) {
          if (e.type === 'start') open.add(e.firingId);
          if (e.type === 'complete') open.delete(e.firingId);
        }
        expect(sim.state.running.map((f) => f.id).sort()).toEqual([...open].sort());
      }),
      { numRuns: 120, verbose: 0 },
    );
  });
});
