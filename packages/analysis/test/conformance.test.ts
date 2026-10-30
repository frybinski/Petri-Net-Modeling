import { createSimulation } from '@pnm/sim';
import { eventLogRows, parseEventLogCsv, toEventLogCsv } from '@pnm/io';
import { describe, expect, it } from 'vitest';
import {
  checkLog,
  endActivities,
  parseDeclare,
  tracesFromRows,
  type LogTrace,
  type PropertySpec,
} from '../src';
import { example } from './helpers';

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

const trace = (caseId: string, text: string): LogTrace => ({
  caseId,
  activities: text === '' ? [] : text.split(' '),
});

describe('checkLog', () => {
  const log = [trace('c1', 'a b'), trace('c2', 'a c b'), trace('c3', 'a'), trace('c4', 'b a')];

  it('counts the cases that satisfy a property and lists the others', () => {
    const [result] = checkLog(log, [declare('r', 'response(a, b)')]).properties;
    // c1 and c2 answer every a; c3 has an a without b; c4 has the a after the b.
    expect(result).toMatchObject({ total: 4, satisfied: 2, violatingCount: 2, ratio: 0.5 });
    expect(result?.violating.map((v) => v.caseId)).toEqual(['c3', 'c4']);
    // Activations: a occurs 1 + 1 + 1 + 1 times; c1 and c2 are fulfilled.
    expect(result?.activation).toEqual({ activations: 4, fulfilled: 2 });
    expect(result?.violating[0]?.activation).toEqual({ activations: 1, fulfilled: 0 });
  });

  it('evaluates LTLf formulas and unknown activities', () => {
    const result = checkLog(
      log,
      [
        { id: 'l', kind: 'ltlf', formula: 'F a' },
        { id: 'x', kind: 'ltlf', formula: 'F z' },
        { id: 'e', kind: 'ltlf', formula: 'G(' },
      ],
      { activities: ['a', 'b', 'c'] },
    );
    expect(result.properties[0]).toMatchObject({ satisfied: 4, ratio: 1 });
    expect(result.properties[1]?.error).toMatch(/Unknown activity/);
    expect(result.properties[2]?.error).toBeDefined();
  });

  it('can leave out cases that are still open', () => {
    const result = checkLog(log, [declare('r', 'response(a, b)')], { endActivities: ['b'] });
    // c3 ends with a and c4 with a: both are open. c1 and c2 end with b.
    expect(result.open).toBe(2);
    expect(result.properties[0]).toMatchObject({ total: 2, satisfied: 2, ratio: 1 });
  });

  it('an empty log satisfies everything with ratio 1', () => {
    expect(checkLog([], [declare('r', 'response(a, b)')]).properties[0]).toMatchObject({
      total: 0,
      ratio: 1,
    });
  });

  it('limits the list of violating cases', () => {
    const many = Array.from({ length: 10 }, (_, i) => trace(`c${i}`, 'a'));
    const [result] = checkLog(many, [declare('r', 'response(a, b)')], {
      maxViolating: 3,
    }).properties;
    expect(result?.violating).toHaveLength(3);
    expect(result?.violatingCount).toBe(10);
  });
});

describe('tracesFromRows', () => {
  it('groups by case and keeps complete events by default', () => {
    const rows = [
      { caseId: 'x', activity: 'A', lifecycle: 'start' as const },
      { caseId: 'y', activity: 'A', lifecycle: 'start' as const },
      { caseId: 'x', activity: 'A', lifecycle: 'complete' as const },
      { caseId: 'x', activity: 'B', lifecycle: 'complete' as const },
      { caseId: 'y', activity: 'A', lifecycle: 'complete' as const },
    ];
    expect(tracesFromRows(rows)).toEqual([
      { caseId: 'x', activities: ['A', 'B'] },
      { caseId: 'y', activities: ['A'] },
    ]);
    expect(tracesFromRows(rows, { lifecycle: 'all' })[0]?.activities).toEqual(['A', 'A', 'B']);
    expect(tracesFromRows(rows, { lifecycle: 'start' })[1]?.activities).toEqual(['A']);
  });
});

describe('conformance of a simulated parcel center', () => {
  // A log from the simulation of the parcel center (seed 7, two hours). Every parcel goes through
  // Anlieferung, Scannen, Sortieren, one Weiche and one Verladen; the model allows nothing else.
  async function simulate(): Promise<{ csv: string; traces: LogTrace[] }> {
    const net = example('parcel-center');
    const sim = createSimulation(net, { seed: 7 });
    const events = [...sim.initialEvents, ...(await sim.advance(2 * 3600))];
    const csv = toEventLogCsv(events, net);
    return { csv, traces: tracesFromRows(parseEventLogCsv(csv)) };
  }

  it('finds the end activities of the model: the three loading transitions', () => {
    expect(endActivities(example('parcel-center')).sort()).toEqual([
      'Verladen Express',
      'Verladen Tor 1',
      'Verladen Tor 2',
    ]);
    // A net without a sink place has none.
    expect(endActivities(example('traffic-light'))).toEqual([]);
  });

  it('does not take a quantity place for the end of a case', () => {
    // The scanner also puts a token on `CO2`, a place that nothing empties.
    const amounts = example('parcel-center');
    expect(endActivities(amounts)).toContain('Verladen Express');
    const withCo2 = structuredClone(amounts);
    withCo2.places.push({ id: 'p_co2', name: 'CO2', position: { x: 0, y: 0 } });
    withCo2.arcs.push({ id: 'a_co2', source: 't_scan', target: 'p_co2', weight: 1 });
    // Without the role the scanner would end a case: it feeds a place that nothing empties.
    expect(endActivities(withCo2)).toContain('Scannen');
    withCo2.places.find((p) => p.id === 'p_co2')!.role = 'quantity';
    expect(endActivities(withCo2).sort()).toEqual(endActivities(amounts).sort());
  });

  it('satisfies succession(Scannen, Sortieren) and init(Anlieferung) for 100 % of the finished parcels', async () => {
    const { traces } = await simulate();
    expect(traces.length).toBeGreaterThan(50);
    const specs = [
      declare('s', 'succession(Scannen, Sortieren)'),
      declare('i', 'init(Anlieferung)'),
    ];
    const closed = checkLog(traces, specs, {
      endActivities: endActivities(example('parcel-center')),
    });
    expect(closed.open).toBeGreaterThan(0); // parcels that are still in the center at 2 h
    expect(closed.properties[0]).toMatchObject({ satisfied: closed.cases - closed.open, ratio: 1 });
    expect(closed.properties[1]).toMatchObject({ ratio: 1 });
    // init holds for every parcel, finished or not.
    expect(checkLog(traces, [specs[1]!]).properties[0]).toMatchObject({
      total: traces.length,
      ratio: 1,
    });
  });

  it('counts a parcel that is still on its way as a violation of the response part', async () => {
    const { traces } = await simulate();
    const ends = new Set(endActivities(example('parcel-center')));
    const open = traces.filter((t) => !ends.has(t.activities.at(-1) ?? ''));
    expect(open.length).toBeGreaterThan(0);
    const [all] = checkLog(traces, [declare('s', 'succession(Scannen, Sortieren)')]).properties;
    // Only parcels that were scanned and not yet sorted violate it: precedence never fails.
    const waitingForSorting = open.filter(
      (t) => t.activities.includes('Scannen') && !t.activities.includes('Sortieren'),
    );
    expect(all?.violatingCount).toBe(waitingForSorting.length);
    expect(all?.violating.every((v) => v.activities.at(-1) === 'Scannen')).toBe(true);
  });

  it('every path of a parcel is a path of the model', async () => {
    const { traces } = await simulate();
    const result = checkLog(
      traces,
      [
        declare('a', 'exactly(Anlieferung, 1)'),
        declare('b', 'notCoExistence(Weiche A, Weiche B)'),
        declare('c', 'precedence(Sortieren, Weiche A)'),
        { id: 'd', kind: 'ltlf', formula: 'G(Scannen -> X Sortieren) | G(Scannen -> F Sortieren)' },
      ],
      { endActivities: endActivities(example('parcel-center')) },
    );
    for (const property of result.properties) expect(property.ratio).toBe(1);
  });

  it('reads the same CSV that the app writes', async () => {
    const net = example('parcel-center');
    const sim = createSimulation(net, { seed: 3 });
    const events = [...sim.initialEvents, ...(await sim.advance(600))];
    const rows = eventLogRows(events, net);
    expect(tracesFromRows(parseEventLogCsv(toEventLogCsv(events, net)))).toEqual(
      tracesFromRows(rows),
    );
  });
});
