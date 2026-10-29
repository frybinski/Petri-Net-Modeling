import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REPO, example, pnm, tempDir } from './helpers';

let scratch: ReturnType<typeof tempDir>;
beforeAll(() => {
  scratch = tempDir();
});
afterAll(() => {
  scratch.cleanup();
});
const tmp = (name: string): string => join(scratch.dir, name);

const names = readdirSync(join(REPO, 'examples'))
  .filter((f) => f.endsWith('.pn.json'))
  .map((f) => f.replace('.pn.json', ''));

describe('pnm analyze', () => {
  it.each(names)('runs on the example %s', async (name) => {
    const result = await pnm(['analyze', example(name), '--states', '3000']);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Structure');
    expect(result.stdout).toContain('State space');
  });

  it('prints the results for the producer/consumer net', async () => {
    const result = await pnm(['analyze', example('producer-consumer')]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('16 states, 28 edges (complete)');
    expect(result.stdout).toContain('1·Buffer + 1·Buffer (free) = 3');
    expect(result.stdout).toContain('bounded: yes, at most 3 tokens on a place');
    expect(result.stdout).toContain('deadlocks: none');
    expect(result.stdout).toContain('live: yes');
    expect(result.stdout).toContain('reversible: yes');
  });

  it('finds the deadlock of the dining philosophers with its trace', async () => {
    const result = await pnm(['analyze', example('dining-philosophers-3')]);
    expect(result.stdout).toContain('deadlocks: 1');
    expect(result.stdout).toContain(
      'after 3 steps: P1 takes left fork -> P2 takes left fork -> P3 takes left fork',
    );
    expect(result.stdout).toContain('live: no');
  });

  it('prints JSON with the same numbers', async () => {
    const result = await pnm(['analyze', example('order-processing'), '--json']);
    expect(result.status).toBe(0);
    const json = JSON.parse(result.stdout) as {
      stateSpace: { states: number; edges: number; deadlockCount: number; complete: boolean };
      structure: { stronglyConnected: boolean };
    };
    expect(json.stateSpace).toMatchObject({
      states: 216,
      edges: 756,
      deadlockCount: 1,
      complete: true,
    });
    expect(json.structure.stronglyConnected).toBe(false);
  });

  it('cuts off the state space of an unbounded net and finds ω in the coverability graph', async () => {
    const result = await pnm(['analyze', example('parcel-center'), '--states', '200']);
    expect(result.stdout).toContain('(cut off: state limit of 200 reached)');
    expect(result.stdout).toContain('Coverability graph');
    expect(result.stdout).toContain('unbounded places (ω): Eingangspuffer');
    const json = JSON.parse(
      (await pnm(['analyze', example('parcel-center'), '--states', '200', '--json'])).stdout,
    ) as { coverability: { bounded: boolean } };
    expect(json.coverability.bounded).toBe(false);
  });

  it('computes the coverability graph on request and only the structure when asked', async () => {
    const withGraph = await pnm(['analyze', example('traffic-light'), '--coverability']);
    expect(withGraph.stdout).toContain('Coverability graph');
    const only = await pnm(['analyze', example('traffic-light'), '--structure-only']);
    expect(only.stdout).not.toContain('State space');
    expect(only.stdout).toContain('Place invariants');
  });

  it('rejects wrong usage and nets with errors', async () => {
    expect((await pnm(['analyze'])).status).toBe(2);
    expect((await pnm(['analyze', example('traffic-light'), '--states', '0'])).status).toBe(2);
    expect((await pnm(['analyze', tmp('missing.pn.json')])).status).toBe(1);
    const broken = tmp('broken.pn.json');
    const net = JSON.parse(readFileSync(example('traffic-light'), 'utf8')) as {
      arcs: Array<{ weight: number }>;
    };
    net.arcs[0]!.weight = 0;
    writeFileSync(broken, JSON.stringify(net));
    const result = await pnm(['analyze', broken]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('the net has errors');
  });

  it('reads a PNML file from standard input', async () => {
    const pnml = (await pnm(['export', example('mutual-exclusion'), '--format', 'pnml'])).stdout;
    const result = await pnm(['analyze', '-', '--json'], { stdin: pnml });
    expect(result.status).toBe(0);
    expect(
      (JSON.parse(result.stdout) as { stateSpace: { states: number } }).stateSpace.states,
    ).toBe(8);
  });
});

describe('pnm check', () => {
  it('exits 0 when the properties hold and 1 with a counterexample when one is violated', async () => {
    const holds = await pnm([
      'check',
      example('order-processing'),
      '--declare',
      'response(Approve, Create invoice)',
    ]);
    expect(holds.status).toBe(0);
    expect(holds.stdout).toContain('holds');
    expect(holds.stdout).toContain('216 states');

    const violated = await pnm([
      'check',
      example('order-processing'),
      '--declare',
      'response(Approve, Create invoice)',
      '--declare',
      'precedence(Reject, Create invoice)',
    ]);
    expect(violated.status).toBe(1);
    expect(violated.stdout).toContain('VIOLATED precedence(Reject, Create invoice)');
    expect(violated.stdout).toContain('counterexample (9 steps):');
    expect(violated.stdout).toMatch(/1\. (Approve|Create invoice|Reject)/);
  });

  it('checks LTLf formulas', async () => {
    const result = await pnm([
      'check',
      example('dining-philosophers-3'),
      '--ltlf',
      'F "P1 takes right fork"',
      '--json',
    ]);
    expect(result.status).toBe(1);
    const json = JSON.parse(result.stdout) as {
      ok: boolean;
      properties: Array<{
        verdict: string;
        counterexample: { steps: Array<{ transition: string }> };
      }>;
    };
    expect(json.ok).toBe(false);
    expect(json.properties[0]?.verdict).toBe('violated');
    expect(json.properties[0]?.counterexample.steps.map((s) => s.transition)).toEqual([
      'P1 takes left fork',
      'P2 takes left fork',
      'P3 takes left fork',
    ]);
  });

  it('checks the properties stored in the net when none are given', async () => {
    const stored = tmp('stored.pn.json');
    const net = JSON.parse(readFileSync(example('order-processing'), 'utf8')) as object;
    writeFileSync(
      stored,
      JSON.stringify({
        ...net,
        properties: [
          {
            id: 'a',
            kind: 'declare',
            template: 'response',
            activities: ['Approve', 'Create invoice'],
          },
          { id: 'b', kind: 'ltlf', formula: 'F Reject' },
        ],
      }),
    );
    const result = await pnm(['check', stored]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('response(Approve, Create invoice)');
    expect(result.stdout).toContain('F Reject');
    const none = await pnm(['check', example('traffic-light')]);
    expect(none.status).toBe(2);
    expect(none.stderr).toContain('No properties to check');
    // The example shows the feature: its stored properties give one holding and one violated.
    const demo = await pnm(['check', example('order-processing')]);
    expect(demo.status).toBe(1);
    expect(demo.stdout).toContain('No invoice before a rejection');
  });

  it('treats unreadable properties and unknown activities as usage errors', async () => {
    const order = example('order-processing');
    const syntax = await pnm(['check', order, '--ltlf', 'G(Approve ->']);
    expect(syntax.status).toBe(2);
    expect(syntax.stderr).toContain('position');
    const template = await pnm(['check', order, '--declare', 'frobnicate(a, b)']);
    expect(template.status).toBe(2);
    const unknown = await pnm(['check', order, '--declare', 'response(Approve, Ship)']);
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain('Unknown activity: "Ship"');
  });

  it('checks every prefix with --final all, and reports a vacuous result otherwise', async () => {
    const net = example('producer-consumer');
    const vacuous = await pnm(['check', net, '--declare', 'response(produce, deliver)']);
    expect(vacuous.status).toBe(0);
    expect(vacuous.stdout).toContain('vacuously');
    expect(vacuous.stdout).toContain('infinite runs without a final state');
    const prefixes = await pnm([
      'check',
      net,
      '--declare',
      'response(produce, deliver)',
      '--final',
      'all',
    ]);
    expect(prefixes.status).toBe(1);
    expect(prefixes.stdout).toContain('1. produce');
  });

  it('takes end markings from a file, by place name', async () => {
    const markings = tmp('markings.json');
    writeFileSync(
      markings,
      JSON.stringify([{ 'Producer idle': 1, 'Consumer idle': 1, Buffer: 1 }]),
    );
    const result = await pnm([
      'check',
      example('producer-consumer'),
      '--declare',
      'existence(consume, 1)',
      '--final',
      markings,
    ]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('1. produce');
    expect(result.stdout).toContain('2. deliver');
    writeFileSync(markings, JSON.stringify([{ Nowhere: 1 }]));
    const bad = await pnm([
      'check',
      example('producer-consumer'),
      '--declare',
      'existence(produce)',
      '--final',
      markings,
    ]);
    expect(bad.status).toBe(2);
  });

  it('reports an incomplete state space as not verified', async () => {
    const result = await pnm([
      'check',
      example('parcel-center'),
      '--declare',
      'absence(Anlieferung, 50)',
      '--states',
      '30',
      '--final',
      'all',
    ]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('unknown');
    expect(result.stdout).toContain('incomplete');
  });

  it('checks an event log of the simulation', async () => {
    const csv = tmp('parcel.csv');
    const sim = await pnm([
      'simulate',
      example('parcel-center'),
      '--seconds',
      '7200',
      '--seed',
      '7',
      '--csv',
      csv,
      '-q',
    ]);
    expect(sim.status).toBe(0);
    const result = await pnm([
      'check',
      example('parcel-center'),
      '--declare',
      'succession(Scannen, Sortieren)',
      '--declare',
      'init(Anlieferung)',
      '--log',
      csv,
    ]);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('still open and left out');
    expect(result.stdout).toMatch(/of \d+ cases satisfy it \(100 %\)/);

    const strict = await pnm([
      'check',
      example('parcel-center'),
      '--declare',
      'response(Scannen, Verladen Tor 1)',
      '--log',
      csv,
      '--json',
    ]);
    expect(strict.status).toBe(1);
    const json = JSON.parse(strict.stdout) as {
      properties: Array<{ ratio: number; violatingCount: number }>;
    };
    expect(json.properties[0]!.ratio).toBeLessThan(1);
    expect(json.properties[0]!.violatingCount).toBeGreaterThan(0);
    const missing = await pnm([
      'check',
      example('parcel-center'),
      '--declare',
      'init(Anlieferung)',
      '--log',
      tmp('nope.csv'),
    ]);
    expect(missing.status).toBe(1);
  });
});
