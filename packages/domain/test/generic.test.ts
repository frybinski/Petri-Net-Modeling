import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEmptyNet, parseNetText, removeNode, type PetriNet } from '@pnm/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  fillArcs,
  fillMissing,
  genericDomainView,
  genericDomainViewWithLayout,
  netHash,
  validateDomainView,
  withNetHash,
} from '../src';
import { smallNet, smallView } from './helpers';

const AT = '2026-01-01T00:00:00.000Z';

const example = (name: string): PetriNet =>
  parseNetText(
    readFileSync(
      join(import.meta.dirname, '..', '..', '..', 'examples', `${name}.pn.json`),
      'utf8',
    ),
  );

interface NetSpec {
  places: number;
  transitions: number;
  arcs: Array<[number, number, boolean]>;
  marks: number[];
  positions: Array<[number, number] | null>;
  roles: Array<'case' | 'resource' | 'quantity' | null>;
  prefix: string;
}

const netSpec = fc.record({
  places: fc.integer({ min: 0, max: 30 }),
  transitions: fc.integer({ min: 0, max: 30 }),
  arcs: fc.array(fc.tuple(fc.nat(60), fc.nat(60), fc.boolean()), { maxLength: 120 }),
  marks: fc.array(fc.integer({ min: 0, max: 5 }), { maxLength: 30 }),
  positions: fc.array(
    fc.option(
      fc.tuple(fc.integer({ min: -3000, max: 3000 }), fc.integer({ min: -3000, max: 3000 })),
      {
        nil: null,
      },
    ),
    { maxLength: 60 },
  ),
  roles: fc.array(
    fc.constantFrom('case' as const, 'resource' as const, 'quantity' as const, null),
    { maxLength: 30 },
  ),
  prefix: fc.constantFrom('', 'P-', 'M-', 'C-'),
});

function buildNet(spec: NetSpec, withPositions: boolean): PetriNet {
  const net = createEmptyNet('Random net');
  const place = (i: number) => `p${i}`;
  const transition = (j: number) => `t${j}`;
  for (let i = 0; i < spec.places; i += 1) {
    const at = spec.positions[i];
    const role = spec.roles[i];
    net.places.push({
      id: place(i),
      name: `P${i}`,
      position: withPositions && at ? { x: at[0], y: at[1] } : (undefined as never),
      ...(role ? { role } : {}),
    });
    const marks = spec.marks[i] ?? 0;
    if (marks > 0) net.marking[place(i)] = Array.from({ length: marks }, () => 1);
  }
  for (let j = 0; j < spec.transitions; j += 1) {
    const at = spec.positions[spec.places + j];
    net.transitions.push({
      id: transition(j),
      name: `T${j}`,
      position: withPositions && at ? { x: at[0], y: at[1] } : (undefined as never),
    });
  }
  const seen = new Set<string>();
  spec.arcs.forEach(([a, b, toPlace], index) => {
    if (spec.places === 0 || spec.transitions === 0) return;
    const p = place(a % spec.places);
    const t = transition(b % spec.transitions);
    const [source, target] = toPlace ? [t, p] : [p, t];
    if (seen.has(`${source}>${target}`)) return;
    seen.add(`${source}>${target}`);
    net.arcs.push({ id: `a${index}`, source, target, weight: 1 });
  });
  if (spec.prefix) net.simulation = { caseIdPrefix: spec.prefix };
  return net;
}

describe('genericDomainView', () => {
  // Acceptance A4: the generic view of random nets passes V1 to V5.
  it('A4: is valid for 200 random nets, with and without positions', () => {
    fc.assert(
      fc.property(netSpec, fc.boolean(), (spec, withPositions) => {
        const net = buildNet(spec, withPositions);
        const view = genericDomainView(net, { at: AT });
        const result = validateDomainView(net, JSON.parse(JSON.stringify(view)));
        const errors = result.diagnostics.filter((d) => d.severity === 'error');
        expect(errors).toEqual([]);
        // The hash matches, and every element has an entry.
        expect(result.diagnostics.filter((d) => d.rule === 'V7')).toEqual([]);
        expect(Object.keys(view.places)).toHaveLength(net.places.length);
        expect(Object.keys(view.transitions)).toHaveLength(net.transitions.length);
      }),
      { numRuns: 250 },
    );
  });

  it('A4: maps every quantity place of random nets to a counter, never to a belt or slots', () => {
    fc.assert(
      fc.property(netSpec, fc.boolean(), (spec, withPositions) => {
        const net = buildNet(spec, withPositions);
        const view = genericDomainView(net, { at: AT });
        const result = validateDomainView(net, JSON.parse(JSON.stringify(view)));
        expect(result.diagnostics.filter((d) => d.rule === 'V9')).toEqual([]);
        for (const place of net.places) {
          if (place.role !== 'quantity') continue;
          expect(view.places[place.id]?.kind).toBe('pool');
        }
      }),
      { numRuns: 250 },
    );
  });

  it('draws a quantity place that is a source or a sink by its arcs as a counter too', () => {
    const net = createEmptyNet('Amounts');
    net.places.push(
      { id: 'steel', name: 'Steel (kg)', position: { x: 0, y: 0 }, role: 'quantity' },
      { id: 'co2', name: 'CO2e (kg)', position: { x: 200, y: 0 }, role: 'quantity' },
      { id: 'jobs', name: 'Jobs', position: { x: 100, y: 100 } },
    );
    net.transitions.push({ id: 'cut', name: 'Cut', position: { x: 100, y: 0 } });
    net.arcs.push(
      { id: 'a1', source: 'steel', target: 'cut', weight: 3 },
      { id: 'a2', source: 'cut', target: 'co2', weight: 1 },
      { id: 'a3', source: 'jobs', target: 'cut', weight: 1 },
    );
    net.marking['steel'] = [1, 1, 1];
    const view = genericDomainView(net, { at: AT });
    // `steel` is a source and `co2` a sink by the arcs; both are counters.
    expect(view.places['steel']?.kind).toBe('pool');
    expect(view.places['co2']?.kind).toBe('pool');
    expect(view.places['co2']).toMatchObject({ label: 'CO2e (kg)' });
    expect(validateDomainView(net, JSON.parse(JSON.stringify(view))).ok).toBe(true);
  });

  it('is deterministic', () => {
    fc.assert(
      fc.property(netSpec, (spec) => {
        const net = buildNet(spec, true);
        expect(genericDomainView(net, { at: AT })).toEqual(genericDomainView(net, { at: AT }));
      }),
      { numRuns: 50 },
    );
  });

  it('handles the empty net', () => {
    const net = createEmptyNet('Empty');
    const view = genericDomainView(net, { at: AT });
    expect(validateDomainView(net, view).diagnostics).toEqual([]);
    expect(view.meta.viewName).toBe('Generic view');
  });

  it('maps roles to kinds', () => {
    const net = smallNet();
    const view = genericDomainView(net, { at: AT });
    expect(view.transitions['t_in']?.kind).toBe('door');
    expect(view.transitions['work']?.kind).toBe('station');
    expect(view.places['q']?.kind).toBe('conveyor');
    expect(view.places['res']).toMatchObject({ kind: 'slots', of: 'work' });
    expect(view.places['done']?.kind).toBe('sink');
  });

  it('gives a resource with several units as many slots and keeps them in the box', () => {
    const net = smallNet();
    net.marking = { res: [1, 1, 1, 1, 1] };
    const view = genericDomainView(net, { at: AT });
    const work = view.transitions['work'];
    expect(work?.kind === 'station' && work.slots?.length).toBe(5);
    expect(validateDomainView(net, view).diagnostics).toEqual([]);
  });

  it('turns a second resource of the same transition into a pool', () => {
    const net = smallNet();
    net.places.push({ id: 'res2', name: 'Tool', position: { x: 360, y: 200 } });
    net.arcs.push(
      { id: 'a6', source: 'res2', target: 'work', weight: 1 },
      { id: 'a7', source: 'work', target: 'res2', weight: 1 },
    );
    net.marking['res2'] = [1];
    const view = genericDomainView(net, { at: AT });
    expect(view.places['res']?.kind).toBe('slots');
    expect(view.places['res2']?.kind).toBe('pool');
    expect(validateDomainView(net, view).diagnostics.filter((d) => d.severity === 'error')).toEqual(
      [],
    );
  });

  it('derives the entity from the case id prefix', () => {
    const parcels = { ...smallNet(), simulation: { caseIdPrefix: 'P-' } };
    const people = { ...smallNet(), simulation: { caseIdPrefix: 'M-' } };
    expect(genericDomainView(parcels, { at: AT }).meta.entity.sprite).toBe('parcel');
    expect(genericDomainView(people, { at: AT }).meta.entity.sprite).toBe('person');
    expect(genericDomainView(smallNet(), { at: AT }).meta.entity.sprite).toBe('dot');
  });

  it('marks every entry as generic', () => {
    const view = genericDomainView(smallNet(), { at: AT });
    const sources = new Set(Object.values(view.provenance).map((p) => p.source));
    expect([...sources]).toEqual(['generic']);
    expect(view.provenance['places.q']?.at).toBe(AT);
  });

  it('draws the complaint handling example without errors or warnings', () => {
    const net = example('complaint-handling');
    const view = genericDomainView(net, { at: AT });
    expect(validateDomainView(net, view).diagnostics).toEqual([]);
  });

  it('lays out nets whose nodes all sit at one spot', async () => {
    const net = smallNet();
    for (const node of [...net.places, ...net.transitions]) node.position = { x: 0, y: 0 };
    const view = await genericDomainViewWithLayout(net, { at: AT });
    const result = validateDomainView(net, view);
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const stations = Object.values(view.transitions);
    const first = stations[0];
    const second = stations[1];
    expect(JSON.stringify(first)).not.toBe(JSON.stringify(second));
  });
});

describe('fillMissing', () => {
  it('leaves a complete view as it is', () => {
    const net = smallNet();
    const view = smallView(net);
    expect(fillMissing(net, view, { at: AT })).toEqual(view);
  });

  it('adds entries for new elements and marks them generic', () => {
    const net = smallNet();
    const view = smallView(net);
    net.places.push({ id: 'extra', name: 'Extra', position: { x: 200, y: 200 } });
    net.arcs.push({ id: 'a9', source: 'work', target: 'extra', weight: 1 });
    const filled = fillMissing(net, view, { at: AT });
    expect(filled.places['extra']).toBeDefined();
    expect(filled.provenance['places.extra']).toEqual({ source: 'generic', at: AT });
    expect(filled.arcs?.['work>extra']).toBeDefined();
    // The hash is left to "update hash".
    const diagnostics = validateDomainView(net, filled).diagnostics;
    expect(diagnostics.map((d) => d.rule)).toEqual(['V7']);
    expect(validateDomainView(net, withNetHash(net, filled)).diagnostics).toEqual([]);
  });

  it('drops entries of elements that were removed', () => {
    const net = smallNet();
    const view = smallView(net);
    const smaller = removeNode(net, 'done');
    expect(validateDomainView(smaller, view).diagnostics.map((d) => d.rule)).toContain('V2');
    const filled = fillMissing(smaller, view, { at: AT });
    expect(filled.places['done']).toBeUndefined();
    expect(filled.arcs?.['work>done']).toBeUndefined();
    expect(validateDomainView(smaller, withNetHash(smaller, filled)).diagnostics).toEqual([]);
  });

  it('replaces entries that break a rule and keeps the others', () => {
    const net = smallNet();
    const view = smallView(net);
    view.places['res'] = {
      kind: 'conveyor',
      path: [
        [1, 1],
        [1, 1],
      ],
    };
    const filled = fillMissing(net, view, { at: AT });
    expect(filled.places['res']?.kind).toBe('slots');
    expect(filled.places['q']).toEqual(view.places['q']);
    expect(filled.provenance['places.res']?.source).toBe('generic');
    expect(
      validateDomainView(net, filled).diagnostics.filter((d) => d.severity === 'error'),
    ).toEqual([]);
  });

  it('A4 variant: completes views of random nets that lost their entries', () => {
    fc.assert(
      fc.property(netSpec, (spec) => {
        const net = buildNet(spec, true);
        const stale = genericDomainView(createEmptyNet('x'), { at: AT });
        const filled = fillMissing(net, stale, { at: AT });
        const errors = validateDomainView(net, withNetHash(net, filled)).diagnostics.filter(
          (d) => d.severity === 'error',
        );
        expect(errors).toEqual([]);
        expect(netHash(net)).toBe(withNetHash(net, filled).netHash);
      }),
      { numRuns: 60 },
    );
  });
});

describe('fillArcs', () => {
  it('leaves a view with all its arcs as it is', () => {
    const net = smallNet();
    const view = genericDomainView(net, { at: AT });
    expect(fillArcs(net, view, { at: AT })).toBe(view);
  });

  it('adds straight paths for missing arcs, marks them generic and keeps the rest', () => {
    const net = smallNet();
    const view = genericDomainView(net, { at: AT });
    const kept = view.arcs?.['work>done'];
    const { arcs: _arcs, ...without } = view;
    const filled = fillArcs(
      net,
      { ...without, arcs: { 'work>done': kept! } },
      { at: '2027-01-01T00:00:00.000Z' },
    );
    expect(filled.arcs?.['work>done']).toBe(kept);
    expect(Object.keys(filled.arcs ?? {}).sort()).toEqual(Object.keys(view.arcs ?? {}).sort());
    expect(filled.provenance['arcs.t_in>q']).toEqual({
      source: 'generic',
      at: '2027-01-01T00:00:00.000Z',
    });
    expect(filled.provenance['arcs.work>done']).toEqual(view.provenance['arcs.work>done']);
    expect(validateDomainView(net, filled).ok).toBe(true);
  });

  it('works on a view without an arcs field', () => {
    const net = smallNet();
    const { arcs: _arcs, ...without } = genericDomainView(net, { at: AT });
    const filled = fillArcs(net, without, { at: AT });
    expect(Object.keys(filled.arcs ?? {}).length).toBeGreaterThan(0);
  });
});
