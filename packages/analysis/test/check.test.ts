import {
  enabledTransitions,
  fire,
  fireBinding,
  findEnabled,
  type Marking,
  type PetriNet,
} from '@pnm/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  activityLabels,
  buildStateSpace,
  checkCompiled,
  checkProperties,
  compileProperty,
  declareDfa,
  evaluateLtlf,
  markingKey,
  parseDeclare,
  parseLtlf,
  parseProperties,
  satisfies,
  stronglyConnectedComponents,
  type PropertySpec,
} from '../src';
import { example, ptNet, type NetSpec } from './helpers';

const declare = (id: string, text: string): PropertySpec => {
  const parsed = parseDeclare(text);
  return {
    id,
    kind: 'declare',
    template: parsed.template,
    activities: parsed.activities,
    ...(parsed.n !== undefined && { n: parsed.n }),
  };
};
const ltlf = (id: string, formula: string): PropertySpec => ({ id, kind: 'ltlf', formula });

describe('order example (JSON net)', () => {
  const net = example('order-processing');

  it('response(Approve, Create invoice) holds, precedence(Reject, Create invoice) is violated with a replayable counterexample', async () => {
    // All 216 states are reachable and the only deadlock is the state where everything is
    // processed. Every approved order must be invoiced before that (Approved orders is empty at
    // the deadlock), so every complete run contains a Create invoice after each Approve.
    // Create invoice also happens in runs without any Reject before it: the 9-step runs that
    // invoice A-0 first never contain a Reject before that step.
    const space = await buildStateSpace(net);
    const [response, precedence] = await checkProperties(net, space, [
      declare('p1', 'response(Approve, Create invoice)'),
      declare('p2', 'precedence(Reject, Create invoice)'),
    ]);
    expect(response?.verdict).toBe('holds');
    expect(response?.vacuous).toBe(false);
    expect(precedence?.verdict).toBe('violated');
    const counter = precedence!.counterexample!;
    expect(counter.steps).toHaveLength(9); // every complete run has 9 steps
    // The activities show a Create invoice before any Reject.
    const firstInvoice = counter.activities.indexOf('Create invoice');
    const firstReject = counter.activities.indexOf('Reject');
    expect(firstInvoice).toBeGreaterThanOrEqual(0);
    expect(firstReject === -1 || firstInvoice < firstReject).toBe(true);

    // Replaying the steps with the recorded bindings reaches the reported marking.
    let marking: Marking = net.marking;
    for (const step of counter.steps) {
      const found = await findEnabled(net, marking);
      const chosen = found.enabled
        .get(step.transitionId)
        ?.bindings.find((b) => JSON.stringify(b.binding) === JSON.stringify(step.binding));
      expect(chosen).toBeDefined();
      marking = fireBinding(net, marking, chosen!);
    }
    expect(markingKey(net, marking)).toBe(markingKey(net, counter.marking));
    expect(space.states[counter.stateId]?.deadlock).toBe(true);
  });

  it('checks free LTLf formulas, also with quoted activities', async () => {
    const space = await buildStateSpace(net);
    const results = await checkProperties(net, space, [
      ltlf('a', 'G("Approve" -> F "Create invoice")'),
      ltlf('b', 'F "Reject"'),
      ltlf('c', 'G !"Reject"'),
      ltlf('d', 'F Approve & F Reject'),
    ]);
    expect(results.map((r) => r.verdict)).toEqual(['holds', 'holds', 'violated', 'holds']);
    // Reject always happens in a complete run (A-3 is rejected), so G !Reject fails right away on
    // any complete run; the shortest has 9 steps.
    expect(results[2]?.counterexample?.steps).toHaveLength(9);
  });

  it('reports unknown activities and syntax errors instead of throwing', async () => {
    const space = await buildStateSpace(net);
    const [unknown, syntax, template] = await checkProperties(net, space, [
      declare('u', 'response(Approve, Ship)'),
      ltlf('s', 'G(Approve ->'),
      { id: 't', kind: 'declare', template: 'response', activities: ['Approve'] },
    ]);
    expect(unknown?.verdict).toBe('unknown');
    expect(unknown?.error).toMatch(/Unknown activity: "Ship"/);
    expect(syntax?.error).toMatch(/position/);
    expect(template?.error).toMatch(/two activities/);
  });
});

describe('dining philosophers', () => {
  const net = example('dining-philosophers-3');

  it('response(takes left, takes right) fails at the deadlock with the 3-step counterexample', async () => {
    // Complete runs end in the only deadlock LLL, reached after three left forks; in that run P1
    // took its left fork and never its right one. No shorter complete run exists.
    const space = await buildStateSpace(net);
    const [result] = await checkProperties(net, space, [
      declare('p', 'response(P1 takes left fork, P1 takes right fork)'),
    ]);
    expect(result?.verdict).toBe('violated');
    expect(result?.counterexample?.activities).toEqual([
      'P1 takes left fork',
      'P2 takes left fork',
      'P3 takes left fork',
    ]);
    expect(result?.infiniteRuns).toBe(true);
    expect(result?.warnings.join(' ')).toContain('infinite runs without a final state');
  });

  it('a property of the deadlock run holds: every complete run takes three left forks', async () => {
    const space = await buildStateSpace(net);
    const [result] = await checkProperties(net, space, [
      ltlf('p', 'F "P1 takes left fork" & F "P2 takes left fork" & F "P3 takes left fork"'),
    ]);
    expect(result?.verdict).toBe('holds');
  });
});

describe('end states and prefixes', () => {
  const net = example('producer-consumer');

  it('with deadlocks as end states a net without deadlock holds vacuously and warns', async () => {
    const space = await buildStateSpace(net);
    const [result] = await checkProperties(net, space, [
      declare('p', 'response(produce, consume)'),
    ]);
    expect(result?.verdict).toBe('holds');
    expect(result?.vacuous).toBe(true);
    expect(result?.infiniteRuns).toBe(true);
    expect(result?.explanation).toMatch(/vacuously/);
  });

  it('with every state as end state each prefix is checked', async () => {
    const space = await buildStateSpace(net);
    const [violated] = await checkProperties(
      net,
      space,
      [declare('p', 'response(produce, deliver)')],
      {
        final: 'all',
      },
    );
    // The prefix "produce" has an unanswered produce.
    expect(violated?.verdict).toBe('violated');
    expect(violated?.counterexample?.activities).toEqual(['produce']);
    const [holds] = await checkProperties(
      net,
      space,
      [declare('q', 'precedence(produce, deliver)')],
      {
        final: 'all',
      },
    );
    expect(holds?.verdict).toBe('holds');
    expect(holds?.vacuous).toBe(false);
    expect(holds?.infiniteRuns).toBe(false);
  });

  it('with given markings as end states the traces end there', async () => {
    const space = await buildStateSpace(net);
    // After produce and deliver the net is in the marking with one item in the buffer.
    const after = space.states[space.edges.find((e) => e.from === 0)!.to]!;
    const second = space.edges.find((e) => e.from === after.id)!;
    const target = space.states[second.to]!.marking;
    const [fine, bad] = await checkProperties(
      net,
      space,
      [declare('a', 'succession(produce, deliver)'), declare('b', 'existence(consume, 1)')],
      { final: { markings: [target] } },
    );
    expect(fine?.verdict).toBe('holds');
    // The shortest path to the marking is produce, deliver without any consume.
    expect(bad?.verdict).toBe('violated');
    expect(bad?.counterexample?.activities).toEqual(['produce', 'deliver']);
  });

  it('an initial marking that already ends the run gives the empty counterexample', async () => {
    const stuck = ptNet({ places: [['p']], transitions: ['t'], arcs: [['p', 't']] });
    const space = await buildStateSpace(stuck);
    const [result] = await checkProperties(stuck, space, [declare('a', 'existence(t, 1)')]);
    expect(result?.verdict).toBe('violated');
    expect(result?.counterexample?.steps).toEqual([]);
    const [empty] = await checkProperties(stuck, space, [declare('b', 'absence(t, 0)')]);
    expect(empty?.verdict).toBe('holds');
  });

  it('is unknown when the state space is incomplete and no violation was found', async () => {
    const source = ptNet({ places: [['p']], transitions: ['arrive'], arcs: [['arrive', 'p']] });
    const space = await buildStateSpace(source, { maxStates: 10 });
    const [short] = await checkProperties(source, space, [declare('b', 'absence(arrive, 3)')], {
      final: 'all',
    });
    // ... and a violation is certain even though the space is cut off.
    expect(short?.verdict).toBe('violated');
    expect(short?.counterexample?.steps).toHaveLength(4);
    const [open] = await checkProperties(source, space, [declare('c', 'absence(arrive, 30)')], {
      final: 'all',
    });
    expect(open?.verdict).toBe('unknown');
    expect(open?.explanation).toMatch(/incomplete/);
  });
});

describe('labels', () => {
  it('uses the id when names are empty or duplicated', () => {
    const net = ptNet({ places: [], transitions: ['x', 'y', 'z'], arcs: [] });
    net.transitions[0]!.name = 'Same';
    net.transitions[1]!.name = 'Same';
    net.transitions[2]!.name = '';
    const { labelOf, labels } = activityLabels(net);
    expect(labels).toEqual(['x', 'y', 'z']);
    expect(labelOf.get('x')).toBe('x');
    net.transitions[0]!.name = 'Unique';
    expect(activityLabels(net).labelOf.get('x')).toBe('Unique');
  });
});

describe('parseProperties', () => {
  it('keeps valid entries and reports the others', () => {
    const { properties, errors } = parseProperties([
      { id: 'a', kind: 'declare', template: 'response', activities: ['x', 'y'], name: 'R' },
      { id: 'b', kind: 'ltlf', formula: 'F x' },
      { id: 'a', kind: 'ltlf', formula: 'F y' },
      { id: 'c', kind: 'declare', template: 'nope', activities: [] },
      { kind: 'ltlf', formula: 'F x' },
      'text',
      { id: 'd', kind: 'ltlf' },
    ]);
    expect(properties.map((p) => p.id)).toEqual(['a', 'b']);
    expect(errors).toHaveLength(5);
    expect(parseProperties(undefined)).toEqual({ properties: [], errors: [] });
    expect(parseProperties({}).errors).toHaveLength(1);
  });
});

// --- property tests --------------------------------------------------------------------------

const specArbitrary: fc.Arbitrary<NetSpec> = fc
  .tuple(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 1, max: 4 }))
  .chain(([places, transitions]) =>
    fc.record({
      pre: fc.array(
        fc.array(fc.constantFrom(0, 0, 0, 1, 1), {
          minLength: transitions,
          maxLength: transitions,
        }),
        { minLength: places, maxLength: places },
      ),
      post: fc.array(
        fc.array(fc.constantFrom(0, 0, 0, 1, 1), {
          minLength: transitions,
          maxLength: transitions,
        }),
        { minLength: places, maxLength: places },
      ),
      tokens: fc.array(fc.integer({ min: 0, max: 2 }), { minLength: places, maxLength: places }),
    }),
  )
  .map(({ pre, post, tokens }) => {
    const arcs: NetSpec['arcs'] = [];
    pre.forEach((row, p) => row.forEach((w, t) => w > 0 && arcs.push([`p${p}`, `t${t}`, w])));
    post.forEach((row, p) => row.forEach((w, t) => w > 0 && arcs.push([`t${t}`, `p${p}`, w])));
    return {
      places: tokens.map((n, p): [string, number] => [`p${p}`, n]),
      transitions: pre[0]!.map((_, t) => `t${t}`),
      arcs,
    };
  });

const propertyArbitrary: fc.Arbitrary<PropertySpec> = fc.oneof(
  fc
    .tuple(
      fc.constantFrom(
        'response',
        'precedence',
        'succession',
        'alternateResponse',
        'chainResponse',
        'notSuccession',
        'respondedExistence',
        'choice',
        'exclusiveChoice',
      ),
      fc.constantFrom('t0', 't1', 't2', 't3'),
      fc.constantFrom('t0', 't1', 't2', 't3'),
    )
    .filter(([, a, b]) => a !== b)
    .map(([template, a, b]): PropertySpec => ({
      id: 'p',
      kind: 'declare',
      template: template as 'response',
      activities: [a, b],
    })),
  fc
    .constantFrom(
      'F t0',
      'G !t1',
      'G(t0 -> F t1)',
      't0 U t1',
      'F t0 & F t1',
      'G(t0 -> X t1)',
      'Xw false',
      'F(t1 & Xw false)',
    )
    .map((formula): PropertySpec => ({ id: 'p', kind: 'ltlf', formula })),
);

/** All maximal runs of an acyclic state space, found by walking the net with the core firing rule. */
function allRuns(net: PetriNet, limit: number): string[][] | null {
  const runs: string[][] = [];
  let work = 0;
  const walk = (marking: Marking, trace: string[]): boolean => {
    work += 1;
    if (work > limit) return false;
    const enabled = enabledTransitions(net, marking);
    if (enabled.length === 0) {
      runs.push(trace);
      return true;
    }
    for (const t of enabled) {
      if (!walk(fire(net, marking, t), [...trace, t])) return false;
    }
    return true;
  };
  return walk(net.marking, []) ? runs : null;
}

describe('property: the product search equals checking every run', () => {
  it('finds a violation exactly if some run to a deadlock violates the property, and a shortest one', async () => {
    await fc.assert(
      fc.asyncProperty(specArbitrary, propertyArbitrary, async (spec, property) => {
        const net = ptNet(spec);
        const space = await buildStateSpace(net, { maxStates: 200 });
        fc.pre(!space.truncated);
        // Only nets whose state space has no cycle: then every run is finite and can be listed.
        const { count, componentOf } = stronglyConnectedComponents(
          space.states.length,
          space.edges,
        );
        fc.pre(count === space.states.length && space.edges.every((e) => e.from !== e.to));
        void componentOf;
        const runs = allRuns(net, 5000);
        fc.pre(runs !== null);
        const compiled = compileProperty(
          property,
          net.transitions.map((t) => t.id),
        );
        fc.pre(compiled.error === null);
        const result = await checkCompiled(net, space, compiled);
        const failing = runs!.filter((run) => !satisfies(compiled, run));
        // The direct evaluation agrees with the automaton on every run.
        if (compiled.formula) {
          for (const run of runs!)
            expect(satisfies(compiled, run)).toBe(evaluateLtlf(compiled.formula, run));
        }
        if (failing.length === 0) {
          expect(result.verdict).toBe('holds');
        } else {
          expect(result.verdict).toBe('violated');
          const counter = result.counterexample!.activities;
          expect(satisfies(compiled, counter)).toBe(false);
          expect(Math.min(...failing.map((run) => run.length))).toBe(counter.length);
          // The counterexample is a run of the net that ends in a deadlock.
          let marking: Marking = net.marking;
          for (const step of result.counterexample!.steps)
            marking = fire(net, marking, step.transitionId);
          expect(enabledTransitions(net, marking)).toEqual([]);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('the DECLARE automaton of a parsed text equals the compiled one', () => {
    const spec = parseDeclare('succession(a, b)');
    expect(declareDfa(spec).accepts(['a', 'b'])).toBe(true);
    expect(
      satisfies(compileProperty({ id: 'x', kind: 'declare', ...spec }, null), ['a', 'b']),
    ).toBe(true);
    expect(parseLtlf('F a').op).toBe('eventually');
  });
});
