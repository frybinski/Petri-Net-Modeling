import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  computeBindings,
  enabledTransitions,
  enabledTransitionsHigher,
  findEnabled,
  fire,
  fireBinding,
  markingToCounts,
  type PetriNet,
} from '../src';
import { makeJsonNet, makeNet } from './helpers';

const values = async (net: PetriNet, transitionId: string) =>
  (await computeBindings(net, net.marking, transitionId)).bindings.map((b) => b.binding);

describe('computeBindings', () => {
  it('binds one variable to each token of the place', async () => {
    const net = makeJsonNet({
      places: [{ id: 'p', tokens: [3, 1, 2] }, { id: 'q' }],
      transitions: [{ id: 't' }],
      arcs: [
        { from: 'p', to: 't', inscription: '$x' },
        { from: 't', to: 'q', inscription: '$x * 10' },
      ],
    });
    const result = await computeBindings(net, net.marking, 't');
    expect(result.bindings.map((b) => b.binding)).toEqual([{ x: 1 }, { x: 2 }, { x: 3 }]);
    expect(result.bindings[1]!.consumes).toEqual({ p: [2] });
    expect(result.bindings[1]!.produces).toEqual({ q: [20] });
    expect(result.truncated).toBe(false);
  });

  it('binds two variables on one edge to different token instances', async () => {
    const net = makeJsonNet({
      places: [{ id: 'p', tokens: ['a', 'b', 'c'] }],
      transitions: [{ id: 't' }],
      arcs: [{ from: 'p', to: 't', inscription: '$x, $y' }],
    });
    const bindings = await values(net, 't');
    expect(bindings).toHaveLength(6);
    expect(bindings).toContainEqual({ x: 'a', y: 'b' });
    expect(bindings).toContainEqual({ x: 'b', y: 'a' });
    expect(bindings).not.toContainEqual({ x: 'a', y: 'a' });
  });

  it('uses two instances of equal value for two variables', async () => {
    const twice = makeJsonNet({
      places: [{ id: 'p', tokens: [7, 7] }],
      transitions: [{ id: 't' }],
      arcs: [{ from: 'p', to: 't', inscription: '$x, $y' }],
    });
    expect(await values(twice, 't')).toEqual([{ x: 7, y: 7 }]);
    const once = makeJsonNet({
      places: [{ id: 'p', tokens: [7] }],
      transitions: [{ id: 't' }],
      arcs: [{ from: 'p', to: 't', inscription: '$x, $y' }],
    });
    expect(await values(once, 't')).toEqual([]);
  });

  it('unifies a variable across two edges', async () => {
    const net = makeJsonNet({
      places: [
        { id: 'a', tokens: [1, 2, 3] },
        { id: 'b', tokens: [2, 3, 4] },
      ],
      transitions: [{ id: 't' }],
      arcs: [
        { from: 'a', to: 't', inscription: '$n' },
        { from: 'b', to: 't', inscription: '$n' },
      ],
    });
    expect(await values(net, 't')).toEqual([{ n: 2 }, { n: 3 }]);
  });

  it('compares objects structurally, ignoring key order', async () => {
    const net = makeJsonNet({
      places: [
        { id: 'a', tokens: [{ id: 1, x: 'u' }] },
        { id: 'b', tokens: [{ x: 'u', id: 1 }] },
      ],
      transitions: [{ id: 't' }],
      arcs: [
        { from: 'a', to: 't', inscription: '$v' },
        { from: 'b', to: 't', inscription: '$v' },
      ],
    });
    expect(await values(net, 't')).toHaveLength(1);
  });

  it('filters bindings by the guard', async () => {
    const net = makeJsonNet({
      places: [{ id: 'p', tokens: [{ amount: 5 }, { amount: -1 }, { amount: 0 }] }],
      transitions: [{ id: 't', guard: '$o.amount > 0' }],
      arcs: [{ from: 'p', to: 't', inscription: '$o' }],
    });
    expect(await values(net, 't')).toEqual([{ o: { amount: 5 } }]);
  });

  it('joins two places through the guard', async () => {
    const net = makeJsonNet({
      places: [
        {
          id: 'orders',
          tokens: [
            { id: 'o1', customer: 'c1' },
            { id: 'o2', customer: 'c2' },
          ],
        },
        { id: 'customers', tokens: [{ id: 'c2' }, { id: 'c3' }] },
        { id: 'invoices' },
      ],
      transitions: [{ id: 't', guard: '$o.customer = $c.id' }],
      arcs: [
        { from: 'orders', to: 't', inscription: '$o' },
        { from: 'customers', to: 't', inscription: '$c' },
        { from: 't', to: 'invoices', inscription: '{ "order": $o.id, "to": $c.id }' },
      ],
    });
    const result = await computeBindings(net, net.marking, 't');
    expect(result.bindings).toHaveLength(1);
    expect(result.bindings[0]!.produces).toEqual({ invoices: [{ order: 'o2', to: 'c2' }] });
  });

  it('creates several tokens from an array result', async () => {
    const net = makeJsonNet({
      places: [{ id: 'p', tokens: [3] }, { id: 'q' }],
      transitions: [{ id: 't' }],
      arcs: [
        { from: 'p', to: 't', inscription: '$n' },
        { from: 't', to: 'q', inscription: '[$n, $n + 1]' },
      ],
    });
    const [binding] = (await computeBindings(net, net.marking, 't')).bindings;
    expect(binding!.produces).toEqual({ q: [3, 4] });
    expect(fireBinding(net, net.marking, binding!)).toEqual({ q: [3, 4] });
  });

  it('invalidates a binding whose output violates the place type', async () => {
    const net = makeJsonNet({
      types: { Positive: { type: 'integer', minimum: 1 } },
      places: [
        { id: 'p', tokens: [-2, 2] },
        { id: 'q', type: 'Positive' },
      ],
      transitions: [{ id: 't' }],
      arcs: [
        { from: 'p', to: 't', inscription: '$n' },
        { from: 't', to: 'q', inscription: '$n' },
      ],
    });
    const result = await computeBindings(net, net.marking, 't');
    expect(result.bindings.map((b) => b.binding)).toEqual([{ n: 2 }]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'TOKEN_TYPE_MISMATCH',
      elementId: 'arc1',
    });
    expect(result.diagnostics[0]!.message).toMatch(/>= 1/);
  });

  it('respects capacities with the weak rule', async () => {
    const net = makeJsonNet({
      places: [
        { id: 'p', tokens: [1, 2] },
        { id: 'q', tokens: ['x'], capacity: 1 },
      ],
      transitions: [{ id: 't' }],
      arcs: [
        { from: 'p', to: 't', inscription: '$n' },
        { from: 't', to: 'q', inscription: '$n' },
      ],
    });
    expect(await values(net, 't')).toEqual([]);
    const loop = makeJsonNet({
      places: [{ id: 'q', tokens: ['x'], capacity: 1 }],
      transitions: [{ id: 't' }],
      arcs: [
        { from: 'q', to: 't', inscription: '$v' },
        { from: 't', to: 'q', inscription: '$v' },
      ],
    });
    expect(await values(loop, 't')).toEqual([{ v: 'x' }]);
  });

  it('deduplicates equal bindings from equal tokens', async () => {
    const net = makeJsonNet({
      places: [{ id: 'p', tokens: [1, 1, 1, 2] }],
      transitions: [{ id: 't' }],
      arcs: [{ from: 'p', to: 't', inscription: '$x' }],
    });
    expect(await values(net, 't')).toEqual([{ x: 1 }, { x: 2 }]);
  });

  it('limits the number of bindings and flags truncation', async () => {
    const net = makeJsonNet({
      places: [{ id: 'p', tokens: Array.from({ length: 50 }, (_, i) => i) }],
      transitions: [{ id: 't' }],
      arcs: [{ from: 'p', to: 't', inscription: '$x' }],
    });
    const result = await computeBindings(net, net.marking, 't', { maxBindings: 10 });
    expect(result.bindings).toHaveLength(10);
    expect(result.truncated).toBe(true);
    const all = await computeBindings(net, net.marking, 't', { maxBindings: 50 });
    expect(all.bindings).toHaveLength(50);
    expect(all.truncated).toBe(false);
  });

  it('limits the candidates tried when the guard rejects almost everything', async () => {
    const net = makeJsonNet({
      places: [{ id: 'p', tokens: Array.from({ length: 30 }, (_, i) => i) }],
      transitions: [{ id: 't', guard: 'false' }],
      arcs: [{ from: 'p', to: 't', inscription: '$x, $y' }],
    });
    const result = await computeBindings(net, net.marking, 't', { maxCandidates: 100 });
    expect(result.bindings).toEqual([]);
    expect(result.truncated).toBe(true);
  });

  it('mixes arcs with and without inscription', async () => {
    const net = makeJsonNet({
      places: [{ id: 'p', tokens: ['a', 'b', 'c'] }, { id: 'q', tokens: [1, 1] }, { id: 'r' }],
      transitions: [{ id: 't' }],
      arcs: [
        { from: 'p', to: 't', inscription: '$x' },
        { from: 'q', to: 't', weight: 2 },
        { from: 't', to: 'r', inscription: '$x' },
      ],
    });
    const result = await computeBindings(net, net.marking, 't');
    expect(result.bindings).toHaveLength(3);
    expect(result.bindings[0]!.consumes).toEqual({ p: ['a'], q: [1, 1] });
    const next = fireBinding(net, net.marking, result.bindings[0]!);
    expect(next).toEqual({ p: ['b', 'c'], r: ['a'] });
  });

  it('serves plain arcs only with tokens not taken by variables', async () => {
    const net = makeJsonNet({
      places: [{ id: 'p', tokens: ['a', 'b'] }],
      transitions: [{ id: 't' }],
      arcs: [
        { from: 'p', to: 't', inscription: '$x' },
        { from: 'p', to: 't', weight: 2 },
      ],
    });
    expect(await values(net, 't')).toEqual([]);
  });

  it('creates weight tokens with value 1 for output arcs without inscription', async () => {
    const net = makeJsonNet({
      places: [{ id: 'p', tokens: ['a'] }, { id: 'q' }],
      transitions: [{ id: 't' }],
      arcs: [
        { from: 'p', to: 't', inscription: '$x' },
        { from: 't', to: 'q', weight: 3 },
      ],
    });
    const [binding] = (await computeBindings(net, net.marking, 't')).bindings;
    expect(binding!.produces).toEqual({ q: [1, 1, 1] });
  });

  it('is not enabled on an empty marking', async () => {
    const net = makeJsonNet({
      places: [{ id: 'p' }],
      transitions: [{ id: 't' }],
      arcs: [{ from: 'p', to: 't', inscription: '$x' }],
    });
    expect(await values(net, 't')).toEqual([]);
  });

  it('enables a transition without input arcs under a single empty binding', async () => {
    const net = makeJsonNet({
      places: [{ id: 'q' }],
      transitions: [{ id: 't' }],
      arcs: [{ from: 't', to: 'q', inscription: '"hello"' }],
    });
    const result = await computeBindings(net, net.marking, 't');
    expect(result.bindings).toHaveLength(1);
    expect(result.bindings[0]!.produces).toEqual({ q: ['hello'] });
  });

  it('reports each failing expression once, not once per binding', async () => {
    const net = makeJsonNet({
      places: [{ id: 'p', tokens: [1, 2, 3] }, { id: 'q' }],
      transitions: [{ id: 't' }],
      arcs: [
        { from: 'p', to: 't', inscription: '$x' },
        { from: 't', to: 'q', inscription: '$x + "a"' },
      ],
    });
    const result = await computeBindings(net, net.marking, 't');
    expect(result.bindings).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ code: 'INSCRIPTION_ERROR', elementId: 'arc1' });
  });

  it('reports guards that do not yield a boolean', async () => {
    const net = makeJsonNet({
      places: [{ id: 'p', tokens: [{ a: 1 }] }],
      transitions: [{ id: 't', guard: '$o.missing' }],
      arcs: [{ from: 'p', to: 't', inscription: '$o' }],
    });
    const result = await computeBindings(net, net.marking, 't');
    expect(result.bindings).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({ code: 'GUARD_ERROR', elementId: 't' });
  });

  it('does not enable a transition with a syntax error and says why', async () => {
    const net = makeJsonNet({
      places: [{ id: 'p', tokens: [1] }],
      transitions: [{ id: 't', guard: '$x >' }],
      arcs: [{ from: 'p', to: 't', inscription: '$x' }],
    });
    const result = await computeBindings(net, net.marking, 't');
    expect(result.bindings).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({ code: 'GUARD_SYNTAX', elementId: 't' });

    const bad = makeJsonNet({
      places: [{ id: 'p', tokens: [1] }],
      transitions: [{ id: 't' }],
      arcs: [{ from: 'p', to: 't', inscription: 'x' }],
    });
    const badResult = await computeBindings(bad, bad.marking, 't');
    expect(badResult.diagnostics[0]).toMatchObject({ code: 'INSCRIPTION_SYNTAX' });
  });

  it('sorts bindings by variable name and then by value', async () => {
    const net = makeJsonNet({
      places: [
        { id: 'p', tokens: [10, 9, 2] },
        { id: 'q', tokens: ['b', 'a'] },
      ],
      transitions: [{ id: 't' }],
      arcs: [
        { from: 'p', to: 't', inscription: '$n' },
        { from: 'q', to: 't', inscription: '$s' },
      ],
    });
    const bindings = await values(net, 't');
    expect(bindings.map((b) => `${String(b.n)}${String(b.s)}`)).toEqual([
      '2a',
      '2b',
      '9a',
      '9b',
      '10a',
      '10b',
    ]);
  });

  it('returns nothing for unknown transitions', async () => {
    const net = makeJsonNet({ transitions: [{ id: 't' }] });
    expect((await computeBindings(net, net.marking, 'nope')).bindings).toEqual([]);
  });
});

describe('fireBinding', () => {
  const net = makeJsonNet({
    places: [
      { id: 'p', tokens: [1, 2] },
      { id: 'q', tokens: ['x'] },
    ],
    transitions: [{ id: 't' }],
    arcs: [
      { from: 'p', to: 't', inscription: '$n' },
      { from: 't', to: 'q', inscription: '$n + 100' },
    ],
  });

  it('moves the consumed tokens and adds the produced ones without touching the input', async () => {
    const before = structuredClone(net.marking);
    const result = await computeBindings(net, net.marking, 't');
    const next = fireBinding(net, net.marking, result.bindings[0]!);
    expect(next).toEqual({ p: [2], q: ['x', 101] });
    expect(net.marking).toEqual(before);
  });

  it('rejects stale bindings', async () => {
    const result = await computeBindings(net, net.marking, 't');
    const binding = result.bindings[0]!;
    const next = fireBinding(net, net.marking, binding);
    expect(() => fireBinding(net, next, binding)).toThrow(/stale/);
  });
});

describe('findEnabled', () => {
  it('uses the P/T rule for pt-net and reports one empty binding', async () => {
    const net = makeNet({
      places: [['a', 2], ['b']],
      transitions: ['t', 'u'],
      arcs: [
        ['a', 't', 2],
        ['t', 'b'],
        ['b', 'u'],
      ],
    });
    const { enabled } = await findEnabled(net, net.marking);
    expect([...enabled.keys()]).toEqual(['t']);
    const [binding] = enabled.get('t')!.bindings;
    expect(binding!.binding).toEqual({});
    expect(fireBinding(net, net.marking, binding!)).toEqual({ b: [1] });
  });

  it('uses bindings for json-net and collects diagnostics of disabled transitions', async () => {
    const net = makeJsonNet({
      places: [{ id: 'p', tokens: [1] }],
      transitions: [{ id: 't' }, { id: 'u', guard: '(' }],
      arcs: [
        { from: 'p', to: 't', inscription: '$x' },
        { from: 'p', to: 'u', inscription: '$x' },
      ],
    });
    const { enabled, diagnostics } = await findEnabled(net, net.marking);
    expect([...enabled.keys()]).toEqual(['t']);
    expect(diagnostics.map((d) => d.code)).toEqual(['GUARD_SYNTAX']);
    expect((await enabledTransitionsHigher(net, net.marking)).enabled.size).toBe(1);
  });
});

describe('P/T equivalence', () => {
  const netArb = fc
    .record({
      placeCount: fc.integer({ min: 1, max: 4 }),
      transitionCount: fc.integer({ min: 1, max: 4 }),
      tokens: fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 4, maxLength: 4 }),
      capacities: fc.array(fc.option(fc.integer({ min: 1, max: 4 }), { nil: undefined }), {
        minLength: 4,
        maxLength: 4,
      }),
      arcs: fc.array(
        fc.record({
          p: fc.integer({ min: 0, max: 3 }),
          t: fc.integer({ min: 0, max: 3 }),
          toTransition: fc.boolean(),
          weight: fc.integer({ min: 1, max: 3 }),
        }),
        { maxLength: 10 },
      ),
    })
    .map((spec) => {
      const places = Array.from({ length: spec.placeCount }, (_, i): [string, number, number?] => [
        `p${i}`,
        spec.tokens[i]!,
        spec.capacities[i],
      ]);
      const transitions = Array.from({ length: spec.transitionCount }, (_, i) => `t${i}`);
      const arcs = spec.arcs
        .filter((a) => a.p < spec.placeCount && a.t < spec.transitionCount)
        .map((a): [string, string, number] =>
          a.toTransition ? [`p${a.p}`, `t${a.t}`, a.weight] : [`t${a.t}`, `p${a.p}`, a.weight],
        );
      return makeNet({ places, transitions, arcs });
    });

  it('enables the same transitions as the P/T rule, in a json-net without inscriptions', async () => {
    await fc.assert(
      fc.asyncProperty(netArb, async (ptNet) => {
        const jsonNet: PetriNet = { ...ptNet, profile: 'json-net' };
        const expected = enabledTransitions(ptNet, ptNet.marking);
        const higher = await enabledTransitionsHigher(jsonNet, jsonNet.marking);
        const facade = await findEnabled(ptNet, ptNet.marking);
        expect([...higher.enabled.keys()]).toEqual(expected);
        expect([...facade.enabled.keys()]).toEqual(expected);
      }),
      { numRuns: 150 },
    );
  });

  it('reaches the same marking when firing', async () => {
    await fc.assert(
      fc.asyncProperty(netArb, async (ptNet) => {
        const jsonNet: PetriNet = { ...ptNet, profile: 'json-net' };
        const { enabled } = await enabledTransitionsHigher(jsonNet, jsonNet.marking);
        for (const [id, result] of enabled) {
          expect(result.bindings).toHaveLength(1);
          const viaBinding = fireBinding(jsonNet, jsonNet.marking, result.bindings[0]!);
          expect(markingToCounts(viaBinding)).toEqual(
            markingToCounts(fire(ptNet, ptNet.marking, id)),
          );
        }
      }),
      { numRuns: 100 },
    );
  });
});
