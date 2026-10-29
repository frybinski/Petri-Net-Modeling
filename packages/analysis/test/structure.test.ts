import { describe, expect, it } from 'vitest';
import { analyzeStructure } from '../src';
import { example, ptNet } from './helpers';

const names = (net: ReturnType<typeof example>, ids: string[]): string[] =>
  ids
    .map(
      (id) =>
        net.places.find((p) => p.id === id)?.name ??
        net.transitions.find((t) => t.id === id)?.name ??
        id,
    )
    .sort();

describe('incidence matrix', () => {
  it('is Post minus Pre, with weights', () => {
    const net = ptNet({
      places: [['p', 2], ['q']],
      transitions: ['t'],
      arcs: [
        ['p', 't', 2],
        ['t', 'q', 3],
      ],
    });
    const result = analyzeStructure(net);
    expect(result.incidence).toEqual({
      places: ['p', 'q'],
      transitions: ['t'],
      matrix: [[-2], [3]],
    });
  });
});

describe('structural classes', () => {
  // Hand-checked on the drawings of the examples.
  it('traffic light is a marked graph and not a state machine', () => {
    // Each of the 8 places has exactly one input and one output transition, but "A to red" has two
    // output places and "A to green" two input places.
    const result = analyzeStructure(example('traffic-light'));
    expect(result.markedGraph).toBe(true);
    expect(result.stateMachine).toBe(false);
    expect(result.freeChoice).toBe(true);
    expect(result.stronglyConnected).toBe(true);
    expect(result.conflicts).toEqual([]);
    expect(result.commoner).toEqual({ holds: true, violating: [] });
  });

  it('a state machine has one input and one output place per transition', () => {
    const net = ptNet({
      places: [['a', 1], ['b']],
      transitions: ['go', 'back'],
      arcs: [
        ['a', 'go'],
        ['go', 'b'],
        ['b', 'back'],
        ['back', 'a'],
      ],
    });
    const result = analyzeStructure(net);
    expect(result.stateMachine).toBe(true);
    expect(result.markedGraph).toBe(true);
  });

  it('detects a conflict that is free choice and one that is not', () => {
    const choice = ptNet({
      places: [['p', 1], ['q'], ['r']],
      transitions: ['t', 'u'],
      arcs: [
        ['p', 't'],
        ['p', 'u'],
        ['t', 'q'],
        ['u', 'r'],
      ],
    });
    const free = analyzeStructure(choice);
    expect(free.conflicts).toEqual([{ placeId: 'p', transitionIds: ['t', 'u'] }]);
    expect(free.freeChoice).toBe(true);
    expect(free.markedGraph).toBe(false);

    // t needs p and s, u needs only p: not free choice, not even extended free choice.
    const confusion = ptNet({
      places: [['p', 1], ['s', 1], ['q']],
      transitions: ['t', 'u'],
      arcs: [
        ['p', 't'],
        ['s', 't'],
        ['p', 'u'],
        ['t', 'q'],
        ['u', 'q'],
      ],
    });
    const bad = analyzeStructure(confusion);
    expect(bad.freeChoice).toBe(false);
    expect(bad.extendedFreeChoice).toBe(false);
  });

  it('is extended free choice when transitions share all their input places', () => {
    const net = ptNet({
      places: [['p', 1], ['s', 1], ['q']],
      transitions: ['t', 'u'],
      arcs: [
        ['p', 't'],
        ['s', 't'],
        ['p', 'u'],
        ['s', 'u'],
        ['t', 'q'],
        ['u', 'q'],
      ],
    });
    const result = analyzeStructure(net);
    expect(result.freeChoice).toBe(false);
    expect(result.extendedFreeChoice).toBe(true);
  });

  it('lists sources, sinks, isolated nodes and loops', () => {
    const net = ptNet({
      places: [['in'], ['out'], ['res', 1], ['lonely']],
      transitions: ['arrive', 'work', 'leave', 'idle'],
      arcs: [
        ['arrive', 'in'],
        ['in', 'work'],
        ['res', 'work'],
        ['work', 'res'],
        ['work', 'out'],
        ['out', 'leave'],
      ],
    });
    const result = analyzeStructure(net);
    expect(result.sourceTransitions).toEqual(['arrive']);
    expect(result.sinkTransitions).toEqual(['leave']);
    // `in` has the input transition `arrive`, so no place is a source or a sink.
    expect(result.sourcePlaces).toEqual([]);
    expect(result.sinkPlaces).toEqual([]);
    expect(result.isolated.sort()).toEqual(['idle', 'lonely']);
    expect(result.loops).toEqual([{ placeId: 'res', transitionId: 'work' }]);
    expect(result.pure).toBe(false);
    expect(result.connected).toBe(false);
    // {arrive, in, work, res, out, leave}, {idle} and {lonely}.
    expect(result.components).toBe(3);
  });

  it('reports arc weights as not ordinary', () => {
    const net = ptNet({ places: [['p', 2]], transitions: ['t'], arcs: [['p', 't', 2]] });
    const result = analyzeStructure(net);
    expect(result.ordinary).toBe(false);
    expect(result.freeChoice).toBe(false);
    expect(result.checks.find((c) => c.key === 'ordinary')?.holds).toBe(false);
  });

  it('an empty net has no components', () => {
    const result = analyzeStructure(ptNet({ places: [], transitions: [], arcs: [] }));
    expect(result.components).toBe(0);
    expect(result.siphons).toEqual([]);
  });
});

describe('strong connectivity', () => {
  it('says that a capacity can make a bounded net that is not strongly connected', () => {
    const result = analyzeStructure(example('producer-consumer'));
    const check = result.checks.find((c) => c.key === 'stronglyConnected');
    expect(check?.holds).toBe(false);
    expect(check?.explanation).toContain('capacit');
    const plain = analyzeStructure(example('order-processing'));
    expect(plain.checks.find((c) => c.key === 'stronglyConnected')?.explanation).toContain(
      'cannot be both live and bounded',
    );
  });
});

describe('siphons and traps', () => {
  it('finds the minimal siphons and traps of a cycle', () => {
    // a -> t1 -> b -> t2 -> a: the only minimal siphon and trap is {a, b}.
    const net = ptNet({
      places: [['a', 1], ['b']],
      transitions: ['t1', 't2'],
      arcs: [
        ['a', 't1'],
        ['t1', 'b'],
        ['b', 't2'],
        ['t2', 'a'],
      ],
    });
    const result = analyzeStructure(net);
    expect(result.siphons).toEqual([['a', 'b']]);
    expect(result.traps).toEqual([['a', 'b']]);
    expect(result.commoner).toEqual({ holds: true, violating: [] });
  });

  it('the unmarked siphon of the dining philosophers deadlock is found', () => {
    // After all three philosophers took the left fork, the places "has left fork" and the forks
    // are an unmarked siphon in the state of the deadlock; structurally the net has siphons that
    // are not traps containing a marked trap: Commoner's condition fails (the net is not live).
    const net = example('dining-philosophers-3');
    const result = analyzeStructure(net);
    expect(result.setsTruncated).toBe(false);
    expect(result.commoner?.holds).toBe(false);
    const violating = result.commoner?.violating ?? [];
    expect(violating.length).toBeGreaterThan(0);
    // Every violating siphon is a siphon: each transition that fills it also empties it.
    for (const siphon of violating) {
      const set = new Set(siphon);
      for (const transition of net.transitions) {
        const outputs = net.arcs.filter((a) => a.source === transition.id).map((a) => a.target);
        const inputs = net.arcs.filter((a) => a.target === transition.id).map((a) => a.source);
        if (outputs.some((p) => set.has(p))) expect(inputs.some((p) => set.has(p))).toBe(true);
      }
    }
    expect(names(net, violating[0] ?? [])).not.toEqual([]);
  });

  it('a source place is a siphon of its own', () => {
    const net = ptNet({
      places: [['p'], ['q']],
      transitions: ['t'],
      arcs: [
        ['p', 't'],
        ['t', 'q'],
      ],
    });
    const result = analyzeStructure(net);
    expect(result.siphons).toContainEqual(['p']);
  });
});
