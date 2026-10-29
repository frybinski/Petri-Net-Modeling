import {
  enabledTransitions,
  findEnabled,
  fire,
  fireBinding,
  markingToCounts,
  type Marking,
  type PetriNet,
} from '@pnm/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  analyzeBehaviour,
  buildCoverabilityGraph,
  buildStateSpace,
  compilePt,
  markingKey,
  ptEnabled,
  ptFire,
  traceTo,
} from '../src';
import { example, ptNet, type NetSpec } from './helpers';

const idOf = (net: PetriNet, name: string): string => {
  const found = [...net.places, ...net.transitions].find((n) => n.name === name);
  if (!found) throw new Error(`no element named ${name}`);
  return found.id;
};
const nameOf = (net: PetriNet, id: string): string =>
  [...net.places, ...net.transitions].find((n) => n.id === id)?.name ?? id;
const count = (marking: Marking, id: string): number => marking[id]?.length ?? 0;

describe('proof: producer/consumer', () => {
  // State = (producer in {idle, ready}, tokens in the buffer 0..3, consumer in {idle, received}).
  // produce: idle -> ready. deliver: ready -> idle and buffer + 1 (needs buffer < 3 because of the
  // capacity). remove: buffer - 1 and consumer idle -> received (needs buffer >= 1). consume:
  // received -> idle. Every combination is reachable: 2 * 4 * 2 = 16 states.
  // Edges: produce 8 (producer idle: 1 * 4 * 2), deliver 6 (ready, buffer 0..2, 2 consumer
  // states), remove 6 (2 producer states, buffer 1..3, consumer idle), consume 8 (2 * 4 * 1) = 28.
  const net = example('producer-consumer');
  it('has 16 states, 28 edges, bound 3 on the buffer, no deadlock, is live and reversible', async () => {
    const space = await buildStateSpace(net);
    expect(space.truncated).toBe(false);
    const result = analyzeBehaviour(net, space);
    expect(result.states).toBe(16);
    expect(result.edges).toBe(28);
    expect(result.bounds).toEqual({
      prod_idle: 1,
      prod_ready: 1,
      buffer: 3,
      cons_idle: 1,
      cons_ready: 1,
    });
    expect(result.bounded).toBe(true);
    expect(result.deadlockCount).toBe(0);
    expect(result.deadlockFree).toBe(true);
    expect(result.transitions.map((t) => t.liveness)).toEqual(['L4', 'L4', 'L4', 'L4']);
    expect(result.live).toBe(true);
    expect(result.reversible).toBe(true);
    // One strongly connected component: every state is a home state.
    expect(result.components).toBe(1);
    expect(result.homeStates).toHaveLength(16);
  });

  it('respects the capacity: the buffer never holds a fourth item', async () => {
    const space = await buildStateSpace(net);
    expect(Math.max(...space.states.map((s) => count(s.marking, 'buffer')))).toBe(3);
  });

  it('is bounded according to the coverability graph as well', () => {
    const graph = buildCoverabilityGraph(net);
    expect(graph.bounded).toBe(true);
    expect(graph.unboundedPlaces).toEqual([]);
    expect(graph.nodes).toHaveLength(16);
  });
});

describe('proof: dining philosophers (3)', () => {
  // Philosopher i is thinking (T), holds the left fork (L) or eats (E). Fork i belongs to
  // philosopher i (left) and i-1 (right), so E at i forces T at i+1. That leaves 8 states without
  // an E (each philosopher T or L) and 3 * 2 with exactly one E (the next one T, the third free
  // to be T or L): 14 states. No state with two E exists.
  // Enabled: take-left i if philosopher i-1 does not eat, take-right i if i is L and i+1 is T,
  // release i if i eats. Edges: states without E: TTT 3, one L 3 each (3 states), two L 2 each
  // (3 states), LLL 0 -> 18; one E: (E,T,T) 2 and (E,T,L) 1 per rotation -> 9. Total 27.
  // The only state without an enabled transition is LLL: everybody holds the left fork. The
  // shortest way there takes the three left forks: length 3.
  const net = example('dining-philosophers-3');
  it('has 14 states, 27 edges and exactly one deadlock, reached after 3 steps', async () => {
    const space = await buildStateSpace(net);
    expect(space.truncated).toBe(false);
    const result = analyzeBehaviour(net, space);
    expect(result.states).toBe(14);
    expect(result.edges).toBe(27);
    expect(result.deadlockCount).toBe(1);
    expect(result.deadlockFree).toBe(false);
    const witness = result.deadlocks[0]!;
    expect(witness.trace).toHaveLength(3);
    expect(witness.trace.map((s) => nameOf(net, s.transitionId))).toEqual([
      'P1 takes left fork',
      'P2 takes left fork',
      'P3 takes left fork',
    ]);
    const left = [
      'Philosopher 1 has left fork',
      'Philosopher 2 has left fork',
      'Philosopher 3 has left fork',
    ];
    for (const name of left) expect(count(witness.marking, idOf(net, name))).toBe(1);
    expect(Object.keys(witness.marking)).toHaveLength(3);
  });

  it('is not live and not reversible, but every transition can fire', async () => {
    const result = analyzeBehaviour(net, await buildStateSpace(net));
    expect(result.live).toBe(false);
    expect(result.reversible).toBe(false);
    // On a cycle through the initial marking, so L3; the deadlock is the only terminal component.
    expect(result.transitions.every((t) => t.liveness === 'L3')).toBe(true);
    expect(result.components).toBe(2);
    expect(result.terminalComponents).toBe(1);
    expect(result.homeStates).toHaveLength(1);
  });
});

describe('proof: mutual exclusion', () => {
  // Each process is idle (i), waiting (w) or critical (c); never both critical: 3 * 3 - 1 = 8 states.
  // Edges: request 3 + 3 (processes idle), enter 2 + 2 (waiting, the other one not critical),
  // leave 2 + 2 (critical) = 14.
  const net = example('mutual-exclusion');
  it('has 8 states and 14 edges and never lets both processes be critical', async () => {
    const space = await buildStateSpace(net);
    const result = analyzeBehaviour(net, space);
    expect(result.states).toBe(8);
    expect(result.edges).toBe(14);
    const c1 = idOf(net, 'Process 1 critical');
    const c2 = idOf(net, 'Process 2 critical');
    expect(space.states.some((s) => count(s.marking, c1) > 0 && count(s.marking, c2) > 0)).toBe(
      false,
    );
    expect(space.states.some((s) => count(s.marking, c1) > 0)).toBe(true);
    expect(result.deadlockFree).toBe(true);
    expect(result.live).toBe(true);
    expect(result.reversible).toBe(true);
    expect(Math.max(...Object.values(result.bounds))).toBe(1);
  });
});

describe('proof: traffic light', () => {
  // A marked graph with one token circulating through six transitions: the six states are the six
  // positions in the cycle, each with one enabled transition: 6 states, 6 edges.
  const net = example('traffic-light');
  it('is bounded (1), live, reversible and has a cycle of six states', async () => {
    const space = await buildStateSpace(net);
    const result = analyzeBehaviour(net, space);
    expect(result.states).toBe(6);
    expect(result.edges).toBe(6);
    expect(space.states.every((s) => s.enabled.length === 1)).toBe(true);
    expect(Math.max(...Object.values(result.bounds))).toBe(1);
    expect(result.live).toBe(true);
    expect(result.reversible).toBe(true);
    expect(result.deadlockCount).toBe(0);
  });
});

describe('proof: an unbounded net', () => {
  const source = ptNet({
    places: [['p']],
    transitions: ['arrive'],
    arcs: [['arrive', 'p']],
  });

  it('truncates the state space and finds ω in the coverability graph', async () => {
    const space = await buildStateSpace(source, { maxStates: 25 });
    expect(space.truncated).toBe(true);
    expect(space.reason).toContain('state limit');
    expect(space.states).toHaveLength(25);
    const result = analyzeBehaviour(source, space);
    expect(result.complete).toBe(false);
    expect(result.bounded).toBeNull();
    expect(result.deadlockFree).toBeNull();
    expect(result.transitions[0]?.liveness).toBe('L1');

    // Hand construction: root [0]; arrive gives [1] >= [0] and larger, so [ω]; arrive again gives [ω].
    const graph = buildCoverabilityGraph(source);
    expect(graph.bounded).toBe(false);
    expect(graph.unboundedPlaces).toEqual(['p']);
    expect(graph.bounds).toEqual({ p: 'ω' });
    expect(graph.nodes.map((n) => n.marking)).toEqual([{ p: 0 }, { p: 'ω' }]);
    expect(graph.edges).toEqual([
      { from: 0, to: 1, transitionId: 'arrive' },
      { from: 1, to: 1, transitionId: 'arrive' },
    ]);
  });

  it('finds out which of two places is unbounded', () => {
    // arrive -> a, move: a -> b, and b can be drained by drain only once: b is unbounded as well,
    // c is a bounded resource.
    const net = ptNet({
      places: [['a'], ['b'], ['c', 1]],
      transitions: ['arrive', 'move', 'toggle'],
      arcs: [
        ['arrive', 'a'],
        ['a', 'move'],
        ['move', 'b'],
        ['c', 'toggle'],
        ['toggle', 'c'],
      ],
    });
    const graph = buildCoverabilityGraph(net);
    expect(graph.unboundedPlaces).toEqual(['a', 'b']);
    expect(graph.bounds).toEqual({ a: 'ω', b: 'ω', c: 1 });
  });

  it('the parcel center is unbounded where the parcels pile up and bounded in its resources', () => {
    const net = example('parcel-center');
    const graph = buildCoverabilityGraph(net);
    expect(graph.bounded).toBe(false);
    expect(graph.unboundedPlaces.map((id) => nameOf(net, id)).sort()).toEqual(
      [
        'Eingangspuffer',
        'Gescannt',
        'Sortiert',
        'Verladen',
        'Zone A',
        'Zone B',
        'Zone Express',
      ].sort(),
    );
    expect(graph.bounds[idOf(net, 'Scanner')]).toBe(2);
  });

  it('a capacity keeps a place bounded although its input grows', () => {
    const net = ptNet({
      places: [['p', 0, 2]],
      transitions: ['arrive'],
      arcs: [['arrive', 'p']],
    });
    const graph = buildCoverabilityGraph(net);
    expect(graph.bounded).toBe(true);
    expect(graph.bounds).toEqual({ p: 2 });
  });

  it('reports JSON nets as not applicable', () => {
    const graph = buildCoverabilityGraph(example('order-processing'));
    expect(graph.applicable).toBe(false);
  });
});

describe('proof: order processing (JSON net)', () => {
  // Orders A-1, A-2 and A-4 wait for approval (incoming, approved, invoiced: 3 stages), A-3 has a
  // negative amount (incoming, rejected: 2 stages), A-0 and A-9 are approved already (approved,
  // invoiced: 2 stages). The orders move independently and the customer token is put back, so the
  // states are the products: 3^3 * 2 * 2^2 = 216. Every move of an order is one edge in every
  // combination of the other orders: a three-stage order has 2 moves * 72 combinations, the
  // others 1 move * 108 combinations: 3 * 144 + 108 + 2 * 108 = 756 edges. All orders end in
  // their last stage in exactly one state, which is the only deadlock; every path has 9 steps.
  const net = example('order-processing');
  it('has 216 states, 756 edges and one deadlock in which everything is processed', async () => {
    const space = await buildStateSpace(net);
    expect(space.truncated).toBe(false);
    expect(space.diagnostics).toEqual([]);
    const result = analyzeBehaviour(net, space);
    expect(result.states).toBe(216);
    expect(result.edges).toBe(756);
    expect(result.deadlockCount).toBe(1);
    const witness = result.deadlocks[0]!;
    expect(witness.trace).toHaveLength(9);
    expect(count(witness.marking, idOf(net, 'Invoices'))).toBe(5);
    expect(count(witness.marking, idOf(net, 'Rejected orders'))).toBe(1);
    expect(count(witness.marking, idOf(net, 'Customers'))).toBe(2);
    expect(count(witness.marking, idOf(net, 'Incoming orders'))).toBe(0);
    expect(count(witness.marking, idOf(net, 'Approved orders'))).toBe(0);
    // Edges carry the binding that fired.
    const approve = space.edges.find((e) => nameOf(net, e.transitionId) === 'Approve');
    expect(approve?.binding).toHaveProperty('o');
    expect(result.reversible).toBe(false);
    expect(result.live).toBe(false);
    expect(result.transitions.map((t) => t.liveness)).toEqual(['L1', 'L1', 'L1']);
  });

  it('a trace to the deadlock is a firing sequence that reaches exactly that marking', async () => {
    const space = await buildStateSpace(net);
    const witness = analyzeBehaviour(net, space).deadlocks[0]!;
    let marking: Marking = net.marking;
    for (const step of witness.trace) {
      const found = await findEnabled(net, marking);
      const options = found.enabled.get(step.transitionId)?.bindings ?? [];
      const chosen = options.find(
        (b) => JSON.stringify(b.binding) === JSON.stringify(step.binding),
      );
      expect(chosen).toBeDefined();
      marking = fireBinding(net, marking, chosen!);
    }
    expect(markingKey(net, marking)).toBe(markingKey(net, witness.marking));
  });
});

describe('proof: token ring (JSON net with guards)', () => {
  // Tokens 0 and 3 move through A -> B -> C -> A with $n + 1 while $n < 10 and run through the
  // values 0..10 and 3..10. They are interchangeable once they have the same value, so the
  // states are the unordered pairs {x, y} with y >= 3 (66 - 6 = 60); token 7 at station C runs
  // through 7..10 on its own cycle phase and never meets the others: 60 * 4 = 240 states.
  // Edges: for each state one per distinct movable value: pairs contribute 101 over the 60
  // multisets (42 pairs x < y <= 9 with two movable values, 10 pairs with y = 10 with one, 7
  // equal pairs below 10 with one), token 7 contributes 3 of 4 values: 4 * 101 + 60 * 3 = 584.
  // Deadlock: everything at value 10, once.
  it('has 240 states, 584 edges and one deadlock', async () => {
    const net = example('token-ring');
    const space = await buildStateSpace(net);
    const result = analyzeBehaviour(net, space);
    expect(space.truncated).toBe(false);
    expect(result.states).toBe(240);
    expect(result.edges).toBe(584);
    expect(result.deadlockCount).toBe(1);
  });
});

describe('limits and options', () => {
  it('stops at the time limit and keeps the part that was explored', async () => {
    const net = ptNet({ places: [['p']], transitions: ['arrive'], arcs: [['arrive', 'p']] });
    const space = await buildStateSpace(net, { maxTimeMs: 20, maxStates: 10_000_000 });
    expect(space.truncated).toBe(true);
    expect(space.reason).toContain('time limit');
    expect(space.states.length).toBeGreaterThan(10);
  });

  it('can be cancelled', async () => {
    const net = ptNet({ places: [['p']], transitions: ['arrive'], arcs: [['arrive', 'p']] });
    const controller = new AbortController();
    const promise = buildStateSpace(net, {
      maxStates: 10_000_000,
      maxTimeMs: 60_000,
      signal: controller.signal,
      onProgress: () => controller.abort(),
    });
    await expect(promise).rejects.toThrow(/cancelled/);
  });

  it('reports progress', async () => {
    const net = ptNet({ places: [['p']], transitions: ['arrive'], arcs: [['arrive', 'p']] });
    const seen: number[] = [];
    await buildStateSpace(net, { maxStates: 100, onProgress: (p) => seen.push(p.states) });
    expect(seen.at(-1)).toBe(100);
  });

  it('marks states with given markings as final', async () => {
    const net = example('traffic-light');
    const target = (await buildStateSpace(net)).states[3]!.marking;
    const space = await buildStateSpace(net, { final: { markings: [target] } });
    expect(space.states.filter((s) => s.final).map((s) => s.id)).toEqual([3]);
    expect(traceTo(space, 3)).toHaveLength(3);
  });

  it('a transition with an invalid arc weight never fires, like in the core', async () => {
    const net = ptNet({ places: [['p', 1]], transitions: ['t'], arcs: [['p', 't', 0]] });
    const space = await buildStateSpace(net);
    expect(space.states[0]?.deadlock).toBe(true);
  });
});

// --- property tests --------------------------------------------------------------------------

const specArbitrary: fc.Arbitrary<NetSpec> = fc
  .tuple(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 1, max: 4 }))
  .chain(([places, transitions]) =>
    fc.record({
      pre: fc.array(
        fc.array(fc.constantFrom(0, 0, 0, 1, 1, 2), {
          minLength: transitions,
          maxLength: transitions,
        }),
        { minLength: places, maxLength: places },
      ),
      post: fc.array(
        fc.array(fc.constantFrom(0, 0, 0, 1, 1, 2), {
          minLength: transitions,
          maxLength: transitions,
        }),
        { minLength: places, maxLength: places },
      ),
      tokens: fc.array(fc.integer({ min: 0, max: 3 }), { minLength: places, maxLength: places }),
      capacity: fc.array(fc.constantFrom(undefined, undefined, 1, 2, 3, 4), {
        minLength: places,
        maxLength: places,
      }),
    }),
  )
  .map(({ pre, post, tokens, capacity }) => {
    const arcs: NetSpec['arcs'] = [];
    pre.forEach((row, p) => row.forEach((w, t) => w > 0 && arcs.push([`p${p}`, `t${t}`, w])));
    post.forEach((row, p) => row.forEach((w, t) => w > 0 && arcs.push([`t${t}`, `p${p}`, w])));
    return {
      places: tokens.map((n, p): [string, number, number | undefined] => [`p${p}`, n, capacity[p]]),
      transitions: pre[0]!.map((_, t) => `t${t}`),
      arcs,
    };
  });

/** Breadth-first search with the firing rule of the core, straight from the definition. */
function naive(
  net: PetriNet,
  limit: number,
): { keys: Set<string>; edges: number; deadlocks: number } | null {
  const key = (m: Marking): string => JSON.stringify(Object.entries(markingToCounts(m)).sort());
  const seen = new Map<string, Marking>([[key(net.marking), net.marking]]);
  const queue: Marking[] = [net.marking];
  let edges = 0;
  let deadlocks = 0;
  while (queue.length > 0) {
    const marking = queue.shift()!;
    const enabled = enabledTransitions(net, marking);
    if (enabled.length === 0) deadlocks += 1;
    for (const t of enabled) {
      edges += 1;
      const next = fire(net, marking, t);
      const k = key(next);
      if (!seen.has(k)) {
        if (seen.size >= limit) return null;
        seen.set(k, next);
        queue.push(next);
      }
    }
  }
  return { keys: new Set(seen.keys()), edges, deadlocks };
}

describe('property: the compiled firing rule equals the core', () => {
  it('agrees on enabled transitions and successors for random markings', () => {
    fc.assert(
      fc.property(
        specArbitrary,
        fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 4, maxLength: 4 }),
        (spec, tokens) => {
          const net = ptNet(spec);
          const model = compilePt(net);
          const counts = net.places.map((_, i) => tokens[i] ?? 0);
          const marking: Marking = {};
          net.places.forEach((p, i) => {
            if (counts[i]! > 0) marking[p.id] = Array.from({ length: counts[i]! }, () => 1);
          });
          const enabled = enabledTransitions(net, marking);
          const mine = model.transitionIds.filter((_, t) => ptEnabled(model, counts, t));
          expect(mine).toEqual(enabled);
          for (const id of enabled) {
            const t = model.transitionIds.indexOf(id);
            expect(ptFire(model, counts, t)).toEqual(
              net.places.map((p) => fire(net, marking, id)[p.id]?.length ?? 0),
            );
          }
        },
      ),
      { numRuns: 400 },
    );
  });
});

describe('property: the state space equals naive enumeration', () => {
  it('has the same markings, edges and deadlocks', async () => {
    await fc.assert(
      fc.asyncProperty(specArbitrary, async (spec) => {
        const net = ptNet(spec);
        const expected = naive(net, 300);
        fc.pre(expected !== null);
        const space = await buildStateSpace(net, { maxStates: 1000 });
        expect(space.truncated).toBe(false);
        expect(
          new Set(
            space.states.map((s) =>
              JSON.stringify(Object.entries(markingToCounts(s.marking)).sort()),
            ),
          ),
        ).toEqual(expected!.keys);
        expect(space.states).toHaveLength(expected!.keys.size);
        expect(space.edges).toHaveLength(expected!.edges);
        expect(space.states.filter((s) => s.deadlock)).toHaveLength(expected!.deadlocks);
        // Every state is reached by its recorded shortest trace.
        for (const state of space.states) {
          let marking: Marking = net.marking;
          for (const step of traceTo(space, state.id))
            marking = fire(net, marking, step.transitionId);
          expect(markingKey(net, marking)).toBe(state.key);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('agrees with the coverability graph on boundedness and bounds', async () => {
    await fc.assert(
      fc.asyncProperty(specArbitrary, async (spec) => {
        const net = ptNet(spec);
        const graph = buildCoverabilityGraph(net, { maxNodes: 2000 });
        const space = await buildStateSpace(net, { maxStates: 1500 });
        if (graph.bounded === false) expect(space.truncated || space.states.length > 0).toBe(true);
        if (!space.truncated) {
          // A finite state space means a bounded net, with exactly the bounds of the graph.
          expect(graph.bounded).toBe(true);
          const result = analyzeBehaviour(net, space);
          expect(graph.bounds).toEqual(result.bounds);
        } else if (graph.bounded === true) {
          // Bounded but large: the graph's bounds cover everything the cut-off space has seen.
          const result = analyzeBehaviour(net, space);
          for (const [id, seen] of Object.entries(result.bounds)) {
            expect(seen).toBeLessThanOrEqual(graph.bounds[id] as number);
          }
        }
      }),
      { numRuns: 150 },
    );
  });
});
