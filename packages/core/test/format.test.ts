import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createEmptyNet,
  NetFormatError,
  parseNet,
  parseNetText,
  serializeNet,
  validate,
  type PetriNet,
} from '../src';
import { makeNet } from './helpers';

const examplesDir = join(import.meta.dirname, '..', '..', '..', 'examples');
const exampleFiles = readdirSync(examplesDir).filter((f) => f.endsWith('.pn.json'));

describe('format', () => {
  it('creates an empty net', () => {
    const net = createEmptyNet('Hello');
    expect(net).toMatchObject({ version: '1.0', profile: 'pt-net', name: 'Hello', places: [] });
    expect(createEmptyNet('x', 'json-net').profile).toBe('json-net');
    expect(validate(net)).toEqual([]);
  });

  it('round-trips through serialize and parse', () => {
    const net = makeNet({
      places: [
        ['p', 2, 5],
        ['q', 0],
      ],
      transitions: ['t'],
      arcs: [
        ['p', 't', 2],
        ['t', 'q'],
      ],
    });
    net.annotations = [{ id: 'n1', text: 'hello\nworld', position: { x: 5, y: 6 } }];
    net.arcs[0]!.points = [{ x: 1, y: 2 }];
    net.places[0]!.type = 'Order';
    net.transitions[0]!.guard = '$x > 1';
    net.arcs[1]!.inscription = '$x';
    net.types = { Order: { type: 'object' } };
    const again = parseNet(JSON.parse(serializeNet(net)));
    expect(again).toEqual(net);
  });

  it('serializes with stable key order, two-space indent and trailing newline', () => {
    const net = makeNet({ places: [['p', 1]], transitions: ['t'], arcs: [['p', 't']] });
    const text = serializeNet(net);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "version": "1.0"');
    const order = Object.keys(JSON.parse(text));
    expect(order).toEqual([
      'version',
      'profile',
      'name',
      'types',
      'places',
      'transitions',
      'arcs',
      'marking',
    ]);
    expect(serializeNet(parseNetText(text))).toBe(text);
  });

  it('drops empty marking entries and keeps unknown ones sorted at the end', () => {
    const net = makeNet({ places: [['p', 1]] });
    net.marking.zzz = [1];
    net.marking.aaa = [1];
    net.marking.p = [1];
    net.places.push({ id: 'e', name: 'e', position: { x: 0, y: 0 } });
    net.marking.e = [];
    expect(Object.keys(JSON.parse(serializeNet(net)).marking)).toEqual(['p', 'aaa', 'zzz']);
  });

  it('accepts structured tokens', () => {
    const net = makeNet({ places: [['p']] });
    net.marking.p = [{ id: 'A-1', amount: 12.5 }, 'text', 3, true, [1, null]];
    expect(parseNet(JSON.parse(serializeNet(net))).marking.p).toHaveLength(5);
  });

  it('rejects null tokens', () => {
    const json = JSON.parse(serializeNet(makeNet({ places: [['p']] })));
    json.marking = { p: [null] };
    expect(() => parseNet(json)).toThrow(NetFormatError);
  });

  it('reports readable errors with paths', () => {
    const json = JSON.parse(serializeNet(makeNet({ places: [['p']] })));
    json.places[0].position = { x: 'left', y: 0 };
    json.version = '2.0';
    try {
      parseNet(json);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(NetFormatError);
      const e = error as NetFormatError;
      expect(e.issues.some((i) => i.startsWith('places[0].position.x:'))).toBe(true);
      expect(e.issues.some((i) => i.startsWith('version:'))).toBe(true);
      expect(e.message).toContain('places[0].position.x');
    }
  });

  it('reports a single issue on one line', () => {
    expect(() => parseNet(42)).toThrow(/^Invalid net file: \(root\):/);
  });

  it('rejects text that is not JSON', () => {
    expect(() => parseNetText('{nope')).toThrow(/not valid JSON/);
    expect(() => parseNetText('')).toThrow(NetFormatError);
  });

  it('loads nets with range errors so they can be repaired, and validate reports them', () => {
    const json = JSON.parse(
      serializeNet(makeNet({ places: [['p']], transitions: ['t'], arcs: [['p', 't']] })),
    );
    json.arcs[0].weight = 0;
    const net = parseNet(json);
    expect(validate(net).map((d) => d.code)).toContain('ARC_WEIGHT_INVALID');
  });

  it('strips unknown keys', () => {
    const json = JSON.parse(serializeNet(createEmptyNet('x')));
    json.extra = 1;
    expect('extra' in parseNet(json)).toBe(false);
  });

  describe('examples', () => {
    it('contains the required example nets', () => {
      for (const required of [
        'producer-consumer',
        'traffic-light',
        'dining-philosophers-3',
        'mutual-exclusion',
      ]) {
        expect(exampleFiles).toContain(`${required}.pn.json`);
      }
    });

    for (const file of exampleFiles) {
      it(`${file} parses, is valid without errors or warnings, and is canonical`, () => {
        const text = readFileSync(join(examplesDir, file), 'utf8');
        const net: PetriNet = parseNetText(text);
        expect(net.profile).toBe('pt-net');
        expect(validate(net)).toEqual([]);
        expect(serializeNet(net)).toBe(text);
      });
    }
  });
});
