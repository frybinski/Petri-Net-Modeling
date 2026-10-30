import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmptyNet, parseNetText, serializeNet, validate, type PetriNet } from '@pnm/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PNM_TOOL, PTNET_TYPE, PnmlError, fromPnml, parsePnml, toPnml } from '../src';
import { childElements, firstChild, parseXml, textContent, type XmlElement } from '../src/xml';

const here = fileURLToPath(new URL('.', import.meta.url));
const examplesDir = join(here, '..', '..', '..', 'examples');
const fixture = (name: string): string =>
  readFileSync(join(here, 'fixtures', 'pnml', name), 'utf8');

function walk(element: XmlElement, visit: (e: XmlElement) => void): void {
  visit(element);
  for (const child of childElements(element)) walk(child, visit);
}

describe('toPnml', () => {
  function small(): PetriNet {
    const net = createEmptyNet('Small <net> & "co"');
    net.places.push(
      { id: 'p 1', name: 'Wait & see', position: { x: 10, y: 20 } },
      { id: 'p2', name: 'Done', position: { x: 210, y: 20 } },
    );
    net.transitions.push({ id: 't:1', name: 'Go', position: { x: 110, y: 20 } });
    net.arcs.push(
      { id: 'a1', source: 'p 1', target: 't:1', weight: 1 },
      { id: 'a2', source: 't:1', target: 'p2', weight: 3, points: [{ x: 150, y: 60 }] },
    );
    net.marking['p 1'] = [1, 1];
    return net;
  }

  it('writes the standard structure', () => {
    const xml = toPnml(small());
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<pnml xmlns="')).toBe(true);
    const root = parseXml(xml);
    const net = firstChild(root, 'net')!;
    expect(net.attributes['type']).toBe(PTNET_TYPE);
    expect(textContent(firstChild(firstChild(net, 'name')!, 'text')!)).toBe('Small <net> & "co"');
    const page = firstChild(net, 'page')!;
    expect(childElements(page, 'place')).toHaveLength(2);
    expect(childElements(page, 'transition')).toHaveLength(1);
    const arcs = childElements(page, 'arc');
    expect(arcs).toHaveLength(2);
    // The weight 1 is implied, the weight 3 is an inscription.
    expect(firstChild(arcs[0]!, 'inscription')).toBeUndefined();
    expect(textContent(firstChild(firstChild(arcs[1]!, 'inscription')!, 'text')!)).toBe('3');
    const place = childElements(page, 'place')[0]!;
    expect(textContent(firstChild(firstChild(place, 'initialMarking')!, 'text')!)).toBe('2');
    expect(firstChild(firstChild(place, 'graphics')!, 'position')!.attributes).toEqual({
      x: '10',
      y: '20',
    });
  });

  it('is well-formed, deterministic and indented with two spaces', () => {
    const a = toPnml(small());
    expect(toPnml(small())).toBe(a);
    expect(a).toContain('\n    <page id="page1">\n      <place id="n_p_x20_1">');
    expect(() => parseXml(a)).not.toThrow();
    expect(toPnml(small(), { pretty: false })).not.toContain('\n  ');
  });

  it('writes valid, unique XML ids', () => {
    const net = small();
    net.places.push({ id: 'p 1', name: 'dup', position: { x: 0, y: 0 } });
    const ids: string[] = [];
    walk(parseXml(toPnml(net)), (e) => {
      const id = e.attributes['id'];
      if (id !== undefined) ids.push(id);
    });
    for (const id of ids) expect(id).toMatch(/^[A-Za-z_][A-Za-z0-9._-]*$/);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has no trace of the extension without toolspecific', () => {
    const net = small();
    net.profile = 'json-net';
    net.types = { T: { type: 'number' } };
    net.places[0]!.type = 'T';
    net.transitions[0]!.guard = 'x > 1';
    net.arcs[0]!.inscription = 'x';
    net.annotations = [{ id: 'n1', text: 'hello', position: { x: 0, y: 0 } }];
    const xml = toPnml(net, { toolspecific: false });
    expect(xml).not.toContain('toolspecific');
    expect(xml).not.toContain(`tool="${PNM_TOOL}"`);
    expect(xml).not.toContain('guard');
    expect(xml).not.toContain('CDATA');
  });

  it('keeps everything in the extension when it is on', () => {
    const net = small();
    net.profile = 'json-net';
    net.types = { T: { type: 'number' } };
    net.places[0]!.type = 'T';
    net.places[0]!.capacity = 4;
    net.transitions[0]!.guard = 'x > 1 && y < "]]>"';
    net.transitions[0]!.timing = { kind: 'uniform', min: 1, max: 2 };
    const xml = toPnml(net);
    expect(xml).toContain('tool="pnm"');
    expect(xml).toContain('<![CDATA[');
    // "]]>" in a guard must not end the CDATA section early.
    expect(() => parseXml(xml)).not.toThrow();
  });
});

describe('fromPnml', () => {
  it('rejects text that is not XML, not PNML or has no net', async () => {
    await expect(fromPnml(fixture('broken.pnml'))).rejects.toThrow(PnmlError);
    await expect(fromPnml(fixture('broken.pnml'))).rejects.toThrow(/not well-formed/);
    await expect(fromPnml(fixture('not-pnml.xml'))).rejects.toThrow(/not a PNML document/);
    await expect(fromPnml(fixture('no-net.pnml'))).rejects.toThrow(/no <net>/);
    await expect(fromPnml('')).rejects.toThrow(PnmlError);
  });

  it('gives a net without the extension the profile pt-net', () => {
    const { net } = parsePnml(toPnml(createEmptyNet('x', 'json-net'), { toolspecific: false }));
    expect(net.profile).toBe('pt-net');
  });

  it('warns about a damaged extension but still reads the structure', () => {
    const xml = toPnml(createEmptyNet('x')).replace(
      /<toolspecific[^]*?<\/toolspecific>/,
      '<toolspecific tool="pnm" version="1"><![CDATA[{ nope ]]></toolspecific>',
    );
    const { net, warnings } = parsePnml(xml);
    expect(net.name).toBe('x');
    expect(warnings.some((w) => w.includes('not valid JSON'))).toBe(true);
  });

  it('ignores the extensions of other tools', () => {
    const { net, warnings } = parsePnml(fixture('prom-like.pnml'));
    expect(net.profile).toBe('pt-net');
    expect(warnings.some((w) => w.includes('ProM'))).toBe(false);
  });

  it('limits huge initial markings', () => {
    const xml = `<pnml><net id="n"><page id="p"><place id="a"><initialMarking><text>99999999</text></initialMarking></place></page></net></pnml>`;
    const { net, warnings } = parsePnml(xml);
    expect(net.marking['a']).toHaveLength(10_000);
    expect(warnings.some((w) => w.includes('only 10000'))).toBe(true);
  });

  it('makes duplicate ids unique and says so', () => {
    const xml = `<pnml><net id="n"><page id="p">
      <place id="a"/><place id="a"/><transition id="a"/>
      <arc id="x" source="a" target="a"/></page></net></pnml>`;
    const { net, warnings } = parsePnml(xml);
    expect(net.places.map((p) => p.id)).toEqual(['a', 'a_2']);
    expect(net.transitions.map((t) => t.id)).toEqual(['a_3']);
    expect(warnings.filter((w) => w.includes('more than once'))).toHaveLength(2);
  });
});

interface Expected {
  file: string;
  name: string;
  places: number;
  transitions: number;
  arcs: number;
  tokens: number;
  layout: boolean;
  /** Substrings that must each appear in some warning. */
  warns: string[];
  /** Substrings that must appear in no warning. */
  quiet?: string[];
}

const FIXTURES: Expected[] = [
  {
    file: 'mockup-reklamation.pnml',
    name: 'Reklamation',
    places: 8,
    transitions: 7,
    arcs: 16,
    tokens: 1,
    layout: true,
    warns: ['laid out automatically'],
  },
  {
    file: 'prom-like.pnml',
    name: 'Order handling (discovered)',
    places: 3,
    transitions: 3,
    arcs: 6,
    tokens: 1,
    layout: false,
    warns: [],
    quiet: ['laid out', 'type'],
  },
  {
    file: 'pm4py.pnml',
    name: 'Discovered Petri net',
    places: 3,
    transitions: 3,
    arcs: 6,
    tokens: 1,
    layout: true,
    warns: ['laid out automatically', 'Final markings'],
  },
  {
    file: 'woped-like.pnml',
    name: 'noID',
    places: 3,
    transitions: 2,
    arcs: 4,
    tokens: 1,
    layout: false,
    warns: [],
    quiet: ['laid out', 'type'],
  },
  {
    file: 'two-pages.pnml',
    name: 'Two pages',
    places: 3,
    transitions: 2,
    arcs: 4,
    tokens: 2,
    layout: false,
    warns: ['2 pages'],
  },
  {
    file: 'special-arcs.pnml',
    name: 'Special arcs',
    places: 3,
    transitions: 1,
    arcs: 4,
    tokens: 2,
    layout: false,
    warns: [
      'inhibitor arc Lock',
      'reset arc Go',
      '"Default,2" of place "p1" was read as 2',
      'not a positive integer',
      '"ghost"',
    ],
  },
];

describe('PNML fixtures', () => {
  it.each(FIXTURES)('reads $file', async (expected) => {
    const result = await fromPnml(fixture(expected.file));
    const { net, warnings } = result;
    expect(net.name).toBe(expected.name);
    expect(net.places).toHaveLength(expected.places);
    expect(net.transitions).toHaveLength(expected.transitions);
    expect(net.arcs).toHaveLength(expected.arcs);
    expect(Object.values(net.marking).flat()).toHaveLength(expected.tokens);
    expect(result.laidOut).toBe(expected.layout);
    for (const part of expected.warns) {
      expect(
        warnings.some((w) => w.includes(part)),
        `a warning with "${part}" in\n${warnings.join('\n')}`,
      ).toBe(true);
    }
    for (const part of expected.quiet ?? []) {
      expect(warnings.some((w) => w.includes(part))).toBe(false);
    }
    // The result is a usable net: no errors from the check, all arcs between place and transition.
    expect(validate(net).filter((d) => d.severity === 'error')).toEqual([]);
    for (const node of [...net.places, ...net.transitions]) {
      expect(Number.isFinite(node.position.x) && Number.isFinite(node.position.y)).toBe(true);
    }
  });

  it('lays out a net without graphics so that nodes do not overlap', async () => {
    const { net } = await fromPnml(fixture('mockup-reklamation.pnml'));
    const spots = new Set(
      [...net.places, ...net.transitions].map((n) => `${n.position.x}:${n.position.y}`),
    );
    expect(spots.size).toBe(15);
    const first = net.places.find((p) => p.id === 'i')!;
    const last = net.places.find((p) => p.id === 'o')!;
    expect(last.position.x).toBeGreaterThan(first.position.x);
  });

  it('keeps the positions of the file', async () => {
    const { net } = await fromPnml(fixture('prom-like.pnml'));
    expect(net.places.find((p) => p.id === 'start')?.position).toEqual({ x: 40.5, y: 120 });
    expect(net.arcs.find((a) => a.id === 'a1')?.points).toEqual([{ x: 90, y: 120 }]);
    expect(net.arcs.find((a) => a.id === 'a2')?.weight).toBe(2);
  });

  it('lays out again on request and drops the old bend points', async () => {
    const { net, laidOut } = await fromPnml(fixture('prom-like.pnml'), { layout: 'auto' });
    expect(laidOut).toBe(true);
    expect(net.arcs.every((a) => a.points === undefined)).toBe(true);
  });

  it('turns reference places into arcs to the referenced place', async () => {
    const woped = (await fromPnml(fixture('woped-like.pnml'))).net;
    expect(woped.arcs.find((a) => a.id === 'e2')?.target).toBe('buffer');
    expect(woped.arcs.find((a) => a.id === 'e3')?.weight).toBe(3);
    const pages = (await fromPnml(fixture('two-pages.pnml'))).net;
    expect(pages.arcs.find((a) => a.id === 'a2')?.target).toBe('p2');
  });

  it('puts the pages next to each other', async () => {
    const { net } = await fromPnml(fixture('two-pages.pnml'));
    const x = (id: string): number => net.places.find((p) => p.id === id)!.position.x;
    expect(x('p1')).toBe(0);
    // The nodes of the first page reach x = 100; the gap is 120.
    expect(x('p2')).toBe(220);
    expect(x('p3')).toBe(420);
  });

  it('reads special arcs as normal arcs with a note', async () => {
    const { net } = await fromPnml(fixture('special-arcs.pnml'));
    expect(net.arcs.map((a) => a.id)).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(net.arcs.find((a) => a.id === 'a3')?.weight).toBe(1);
    expect(net.annotations?.map((a) => a.text)).toEqual([
      'inhibitor arc Lock → Go (imported as a normal arc)',
      'reset arc Go → Lock (imported as a normal arc)',
    ]);
    expect(net.marking['p1']).toEqual([1, 1]);
  });

  it('names a silent transition and a node without name', async () => {
    const { net } = await fromPnml(fixture('pm4py.pnml'));
    expect(net.transitions.find((t) => t.id === 'skip_1')?.name).toBe('τ');
    expect(net.places.find((p) => p.id === 'source')?.name).toBe('source');
    expect(net.transitions.find((t) => t.id === 'a1f3-b')?.name).toBe('Create Fine');
  });
});

describe('roundtrip through PNML', () => {
  const files = readdirSync(examplesDir).filter((f) => f.endsWith('.pn.json'));

  it('finds the examples', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it.each(files)('keeps %s unchanged', async (file) => {
    const original = parseNetText(readFileSync(join(examplesDir, file), 'utf8'));
    const xml = toPnml(original);
    const { net, warnings, laidOut } = await fromPnml(xml);
    expect(laidOut).toBe(false);
    expect(serializeNet(net)).toBe(serializeNet(original));
    // Only the findings of the check that the original has as well.
    expect(warnings.filter((w) => !/^(Check|Error): /.test(w))).toEqual([]);
    // And writing again gives the same text.
    expect(toPnml(net)).toBe(xml);
  });

  it('keeps the quantity role and the indicators', async () => {
    const original = parseNetText(
      readFileSync(join(examplesDir, 'producer-consumer.pn.json'), 'utf8'),
    );
    // An arc from a transition to a place, for `via`.
    const output = original.arcs.find((a) => original.transitions.some((t) => t.id === a.source))!;
    const first = original.places.find((p) => p.id === output.target)!;
    first.role = 'quantity';
    original.simulation = {
      seed: 4,
      indicators: [
        {
          id: 'share',
          label: 'Share',
          unit: '%',
          measure: { kind: 'inflow', of: first.id, via: output.source },
          per: { kind: 'tokens', of: first.id },
          factor: 100,
          digits: 2,
        },
        {
          id: 'rate',
          label: 'Rate',
          measure: { kind: 'firings', of: original.transitions[0]!.id },
          per: 'hour',
        },
      ],
    };
    const xml = toPnml(original);
    const { net, warnings } = await fromPnml(xml);
    expect(net.places.find((p) => p.id === first.id)!.role).toBe('quantity');
    expect(net.simulation).toEqual(original.simulation);
    expect(serializeNet(net)).toBe(serializeNet(original));
    expect(warnings.filter((w) => /indicator/i.test(w))).toEqual([]);
  });

  it('leaves out indicators that are not valid and says so', async () => {
    const original = parseNetText(
      readFileSync(join(examplesDir, 'producer-consumer.pn.json'), 'utf8'),
    );
    original.simulation = { seed: 2 };
    const xml = toPnml(original).replace(
      '"seed":2',
      '"seed":2,"indicators":[{"id":"x","label":"x","measure":{"kind":"average","of":"p"}}]',
    );
    const { net, warnings } = await fromPnml(xml);
    expect(net.simulation).toEqual({ seed: 2 });
    expect(warnings.some((w) => /indicators in the file are not valid/.test(w))).toBe(true);
  });

  it('keeps the list of properties', async () => {
    const original = parseNetText(
      readFileSync(join(examplesDir, 'producer-consumer.pn.json'), 'utf8'),
    );
    const properties = [{ id: 'p1', kind: 'ltlf', formula: 'G(produce -> F deliver)' }];
    const { net } = await fromPnml(toPnml({ ...original, properties }));
    expect(net.properties).toEqual(properties);
  });

  it('keeps the standard part when the extension is left out', async () => {
    const original = parseNetText(
      readFileSync(join(examplesDir, 'producer-consumer.pn.json'), 'utf8'),
    );
    const { net } = await fromPnml(toPnml(original, { toolspecific: false }));
    expect(net.places).toHaveLength(original.places.length);
    expect(net.transitions).toHaveLength(original.transitions.length);
    expect(net.arcs.map((a) => a.weight)).toEqual(original.arcs.map((a) => a.weight));
    expect(net.places.map((p) => p.name)).toEqual(original.places.map((p) => p.name));
    expect(net.places.map((p) => net.marking[p.id]?.length ?? 0)).toEqual(
      original.places.map((p) => original.marking[p.id]?.length ?? 0),
    );
    expect(net.places.map((p) => p.position)).toEqual(original.places.map((p) => p.position));
    expect(net.profile).toBe('pt-net');
  });

  const word = fc.stringMatching(/^[A-Za-z0-9 _.:&<>"'äöüß-]{0,12}$/);
  const ident = fc.stringMatching(/^[A-Za-z0-9 _.:/-]{1,8}$/);
  const coordinate = fc.oneof(
    fc.integer({ min: -2000, max: 2000 }),
    fc.integer({ min: -20000, max: 20000 }).map((n) => n / 8),
  );
  const point = fc.record({ x: coordinate, y: coordinate });

  const netArb: fc.Arbitrary<PetriNet> = fc
    .record({
      name: word,
      placeCount: fc.integer({ min: 0, max: 6 }),
      transitionCount: fc.integer({ min: 0, max: 5 }),
      ids: fc.uniqueArray(ident, { minLength: 11, maxLength: 11 }),
      names: fc.array(word, { minLength: 11, maxLength: 11 }),
      points: fc.array(point, { minLength: 11, maxLength: 11 }),
      counts: fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 6, maxLength: 6 }),
      arcSeeds: fc.array(
        fc.record({
          p: fc.nat(5),
          t: fc.nat(4),
          out: fc.boolean(),
          weight: fc.integer({ min: 1, max: 9 }),
          bends: fc.array(point, { maxLength: 2 }),
        }),
        { maxLength: 8 },
      ),
    })
    .map((s) => {
      const net = createEmptyNet(s.name);
      const places = s.ids.slice(0, s.placeCount);
      const transitions = s.ids.slice(6, 6 + s.transitionCount);
      places.forEach((id, i) => {
        net.places.push({ id, name: s.names[i]!, position: s.points[i]! });
        if (s.counts[i]! > 0) net.marking[id] = Array.from({ length: s.counts[i]! }, () => 1);
      });
      transitions.forEach((id, i) => {
        net.transitions.push({ id, name: s.names[6 + i]!, position: s.points[6 + i]! });
      });
      const seen = new Set<string>();
      s.arcSeeds.forEach((seed, i) => {
        const place = places[seed.p % Math.max(1, places.length)];
        const transition = transitions[seed.t % Math.max(1, transitions.length)];
        if (place === undefined || transition === undefined) return;
        const source = seed.out ? transition : place;
        const target = seed.out ? place : transition;
        const key = `${source}>${target}`;
        if (seen.has(key)) return;
        seen.add(key);
        net.arcs.push({
          id: `arc-${i}`,
          source,
          target,
          weight: seed.weight,
          ...(seed.bends.length > 0 && { points: seed.bends }),
        });
      });
      return net;
    });

  it('keeps random place/transition nets unchanged (property)', async () => {
    await fc.assert(
      fc.asyncProperty(netArb, async (original) => {
        // Names and ids may end in blanks or look odd; ids are unique by construction.
        const { net } = await fromPnml(toPnml(original), { layout: 'keep' });
        expect(serializeNet(net)).toBe(serializeNet(original));
      }),
      { numRuns: 200 },
    );
  });

  it('keeps the standard part of random nets without the extension (property)', async () => {
    await fc.assert(
      fc.asyncProperty(netArb, async (original) => {
        fc.pre(original.places.length + original.transitions.length > 0);
        const { net, laidOut } = await fromPnml(toPnml(original, { toolspecific: false }), {
          layout: 'keep',
        });
        expect(laidOut).toBe(false);
        expect(net.places.map((p) => [p.name.trim(), p.position])).toEqual(
          original.places.map((p) => [p.name.trim(), p.position]),
        );
        expect(net.arcs.map((a) => a.weight)).toEqual(original.arcs.map((a) => a.weight));
        expect(net.arcs.map((a) => a.points)).toEqual(original.arcs.map((a) => a.points));
        expect(net.places.map((p) => net.marking[p.id]?.length ?? 0)).toEqual(
          original.places.map((p) => original.marking[p.id]?.length ?? 0),
        );
      }),
      { numRuns: 100 },
    );
  });

  it('keeps awkward text in names and extension values', async () => {
    const original = createEmptyNet('  padded \r\n name \u0001 ]]> ', 'json-net');
    original.types = { Odd: { description: 'a ]]> b <c> & "d"' } };
    original.places.push({
      id: 'p',
      name: ' x \u0007y￾',
      position: { x: 1, y: 2 },
      type: 'Odd',
    });
    original.transitions.push({
      id: 't',
      name: '',
      position: { x: 3, y: 4 },
      guard: 'a < b && c > "]]>"',
    });
    original.arcs.push({ id: 'a', source: 'p', target: 't', weight: 1, inscription: '$x & $y' });
    original.marking['p'] = [{ s: '</toolspecific>' }, 'x'];
    const { net } = await fromPnml(toPnml(original));
    expect(serializeNet(net)).toBe(serializeNet(original));
  });
});
