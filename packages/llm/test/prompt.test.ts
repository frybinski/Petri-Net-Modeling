import { describe, expect, it } from 'vitest';
import type { DomainDiagnostic } from '@pnm/domain';
import {
  EXAMPLE_DECOR_LIMIT,
  answerSchema,
  buildPrompt,
  buildRepairPrompt,
  compactNet,
  defaultExamples,
  repairSystemText,
  shortenExample,
  systemText,
} from '../src';
import { loadExample } from './helpers';

describe('compactNet', () => {
  const { net } = loadExample('parcel-center');
  const compact = compactNet(net);

  it('names the roles of places and transitions', () => {
    const role = (id: string) => compact.places.find((p) => p.id === id)?.role;
    expect(role('p_in')).toBe('case');
    expect(role('p_done')).toBe('sink');
    expect(role('p_scanner')).toBe('resource');
    expect(role('p_scanned')).toBe('case');
    expect(compact.places.filter((p) => p.role === 'sink').length).toBeGreaterThan(0);
    expect(compact.transitions.find((t) => t.id === 't_arr')?.role).toBe('source');
    expect(compact.transitions.find((t) => t.id === 't_scan')?.role).toBe('step');
  });

  it('names the role quantity, also for a place that is a sink by its arcs', () => {
    const amounts = structuredClone(net);
    amounts.places.find((p) => p.id === 'p_done')!.role = 'quantity';
    amounts.places.find((p) => p.id === 'p_in')!.role = 'quantity';
    const found = compactNet(amounts);
    expect(found.places.find((p) => p.id === 'p_done')?.role).toBe('quantity');
    expect(found.places.find((p) => p.id === 'p_in')?.role).toBe('quantity');
    expect(found.places.find((p) => p.id === 'p_scanner')?.role).toBe('resource');
  });

  it('gives the initial tokens, the transition a resource belongs to, and the timing', () => {
    const scanner = compact.places.find((p) => p.id === 'p_scanner');
    expect(scanner?.tokens).toBe(net.marking['p_scanner']?.length);
    expect(scanner?.loopsWith).toEqual(['t_scan']);
    expect(compact.places.find((p) => p.id === 'p_in')?.loopsWith).toBeUndefined();
    expect(compact.transitions.find((t) => t.id === 't_scan')?.timing).toBe('uniform 15..25');
  });

  it('keeps the arcs and scales the positions to 0..1', () => {
    expect(compact.arcs).toHaveLength(net.arcs.length);
    expect(compact.arcs[0]).toEqual([net.arcs[0]?.source, net.arcs[0]?.target]);
    const values = Object.values(compact.positions ?? {}).flat();
    expect(values.length).toBe(2 * (net.places.length + net.transitions.length));
    expect(Math.min(...values)).toBe(0);
    expect(Math.max(...values)).toBe(1);
  });

  it('leaves positions out on request or when the nodes sit on top of each other', () => {
    expect(compactNet(net, { positions: false }).positions).toBeUndefined();
    const stacked = {
      ...net,
      places: net.places.map((p) => ({ ...p, position: { x: 0, y: 0 } })),
      transitions: net.transitions.map((t) => ({ ...t, position: { x: 0, y: 0 } })),
    };
    expect(compactNet(stacked).positions).toBeUndefined();
  });
});

describe('answerSchema', () => {
  it('is the schema of a view without netHash and provenance', () => {
    const schema = answerSchema();
    const properties = schema['properties'] as Record<string, unknown>;
    expect(Object.keys(properties)).toEqual([
      'schemaVersion',
      'meta',
      'places',
      'transitions',
      'arcs',
      'decor',
    ]);
    expect(schema['required']).toEqual(['schemaVersion', 'meta', 'places', 'transitions']);
  });
});

describe('examples', () => {
  it('are the parcel center and the smart office, shortened', () => {
    const examples = defaultExamples();
    expect(examples.map((e) => e.net.name)).toEqual(['Paketzentrum', 'Smart Office']);
    for (const example of examples) {
      const short = shortenExample(example.view) as Record<string, unknown>;
      expect(short['provenance']).toBeUndefined();
      expect(short['netHash']).toBeUndefined();
      expect(short['arcs']).toBeUndefined();
      expect((short['decor'] as unknown[]).length).toBeLessThanOrEqual(EXAMPLE_DECOR_LIMIT);
      expect(Object.keys(short['places'] as object)).toHaveLength(example.net.places.length);
    }
    // The full views have more scenery than the prompt shows.
    expect(examples[0]?.view.decor?.length).toBeGreaterThan(EXAMPLE_DECOR_LIMIT);
  });
});

describe('buildPrompt', () => {
  const { net } = loadExample('parcel-center');
  const prompt = buildPrompt({
    net,
    description: 'Parcel center, hall 2, three loading gates',
    canvas: { width: 1200, height: 640 },
    examples: defaultExamples(),
    schema: answerSchema(),
  });

  it('puts the description, the canvas, the net, the schema and the examples into the user text', () => {
    expect(prompt.user).toContain('Parcel center, hall 2, three loading gates');
    expect(prompt.user).toContain('1200 px wide and 640 px high');
    expect(prompt.user).toContain('"id":"p_scanner"');
    expect(prompt.user).toContain('"loopsWith"');
    expect(prompt.user).toContain('### Example 1: Paketzentrum');
    expect(prompt.user).toContain('### Example 2: Smart Office');
    expect(prompt.user).toContain('"$schema"');
  });

  it('does not ask for netHash or provenance, and the examples do not contain them', () => {
    expect(prompt.user).not.toContain('fnv1a64');
    expect(prompt.user).not.toContain('"provenance"');
    expect(prompt.user).not.toContain('"netHash"');
    expect(prompt.system).toContain('Do not write "netHash" or "provenance"');
  });

  it('stays at a size that fits small context windows', () => {
    expect(prompt.system.length + prompt.user.length).toBeLessThan(40_000);
  });

  it('falls back to the net name without a description', () => {
    const plain = buildPrompt({
      net,
      description: '  ',
      canvas: { width: 800, height: 600 },
      examples: [],
      schema: {},
    });
    expect(plain.user).toContain('A process called "Paketzentrum".');
  });

  it('explains the role quantity in one line of the rules, and leaves the examples as they were', () => {
    const lines = prompt.system.split('\n').filter((line) => line.includes('quantity'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^ {3}- role "quantity" /);
    expect(lines[0]).toMatch(/unit/);
    expect(lines[0]).toMatch(/"pool"/);
    // The worked examples are the two of 1.2.0; neither knows quantities.
    expect(prompt.user).not.toContain('"role":"quantity"');
  });

  it('has a system text that matches the snapshot', () => {
    expect(systemText()).toMatchSnapshot();
    expect(prompt.system).toBe(systemText());
  });
});

describe('buildRepairPrompt', () => {
  const { net, view } = loadExample('parcel-center');
  const diagnostics: DomainDiagnostic[] = [
    {
      rule: 'V4',
      severity: 'error',
      path: 'places.p_scanned.kind',
      message: 'Place "Gescannt" is a case place; its kind must be x, not "slots"',
      elementId: 'p_scanned',
    },
    { rule: 'V5', severity: 'error', path: 'decor[1].rect', message: 'Invalid rectangle' },
    { rule: 'V3', severity: 'error', path: 'places.p_in', message: 'Place "Eingang" has no entry' },
  ];
  const previous = {
    meta: view.meta,
    places: { ...view.places, p_scanned: { kind: 'slots', of: 't_scan' } } as Record<
      string,
      unknown
    >,
    transitions: view.transitions as Record<string, unknown>,
    decor: view.decor as unknown[],
  };
  const prompt = buildRepairPrompt({
    previous,
    diagnostics,
    net: compactNet(net),
    canvas: { width: 1200, height: 640 },
  });

  it('lists the findings with rule, path and text', () => {
    expect(prompt.user).toContain('- V4 error at places.p_scanned.kind: Place "Gescannt"');
    expect(prompt.user).toContain('- V5 error at decor[1].rect: Invalid rectangle');
    expect(prompt.user).toContain('- V3 error at places.p_in');
  });

  it('describes the rule V9 for the model', () => {
    const v9 = buildRepairPrompt({
      previous,
      diagnostics: [
        {
          rule: 'V9',
          severity: 'error',
          path: 'places.p_in.kind',
          message: 'Place "Eingang" counts an amount',
          elementId: 'p_in',
        },
      ],
      net: compactNet(net),
      canvas: { width: 1200, height: 640 },
    });
    expect(v9.user).toContain('- V9 error at places.p_in.kind: Place "Eingang" counts an amount');
    expect(v9.user).toContain('quantity place');
  });

  it('shows only the entries the findings are about', () => {
    const shown = prompt.user.slice(prompt.user.indexOf('## Your entries'));
    expect(shown).toContain('"p_scanned": {"kind":"slots","of":"t_scan"}');
    expect(shown).not.toContain('"p_scanner":');
    expect(shown).toContain('"decor[1]"');
  });

  it('asks for a partial object and uses the repair system text', () => {
    expect(prompt.user).toContain('contains only the corrected entries');
    expect(prompt.system).toBe(repairSystemText());
    expect(prompt.system.startsWith(systemText())).toBe(true);
  });

  it('cuts the list of findings', () => {
    const many: DomainDiagnostic[] = Array.from({ length: 60 }, (_, i) => ({
      rule: 'V5',
      severity: 'error',
      path: `decor[${i}].rect`,
      message: 'Invalid rectangle',
    }));
    const cut = buildRepairPrompt({
      previous,
      diagnostics: many,
      net: compactNet(net),
      canvas: { width: 1200, height: 640 },
    });
    expect(cut.user).toContain('... and 20 more');
  });

  it('says so when nothing of the old answer is usable', () => {
    const empty = buildRepairPrompt({
      previous: {},
      diagnostics: [{ rule: 'V1', severity: 'error', path: '(root)', message: 'Not an object' }],
      net: compactNet(net),
      canvas: { width: 100, height: 100 },
    });
    expect(empty.user).toContain('(none:');
  });
});
