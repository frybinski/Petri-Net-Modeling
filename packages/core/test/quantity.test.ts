import { describe, expect, it } from 'vitest';
import {
  NetFormatError,
  computedPlaceRole,
  hasErrors,
  isCaselessRole,
  parseNet,
  parseNetText,
  placeRole,
  placeRoles,
  serializeNet,
  setRole,
  validate,
  type PetriNet,
} from '../src';
import { makeNet } from './helpers';

const quantity = (net: PetriNet, ...ids: string[]): PetriNet => {
  for (const id of ids) net.places.find((p) => p.id === id)!.role = 'quantity';
  return net;
};

/** order -> cut (takes 3 steel, gives 1 co2) -> done; a delivery refills the steel. */
const bikes = (): PetriNet =>
  makeNet({
    places: [['orders'], ['steel', 30], ['co2'], ['done'], ['dock']],
    transitions: ['cut', 'deliver'],
    arcs: [
      ['orders', 'cut'],
      ['steel', 'cut', 3],
      ['cut', 'co2'],
      ['cut', 'done'],
      ['dock', 'deliver'],
      ['deliver', 'steel', 10],
    ],
  });

describe('the quantity role', () => {
  it('is only ever set, never computed', () => {
    const net = bikes();
    for (const id of net.places.map((p) => p.id)) {
      expect(computedPlaceRole(net, id)).not.toBe('quantity');
      expect(placeRole(net, id)).not.toBe('quantity');
    }
    quantity(net, 'steel');
    expect(placeRole(net, 'steel')).toBe('quantity');
    expect(computedPlaceRole(net, 'steel')).toBe('case');
  });

  it('overrides the structural roles source and sink', () => {
    const net = quantity(bikes(), 'co2', 'dock');
    // `co2` is a sink and `dock` a source by structure; the role wins.
    expect(placeRole(net, 'co2')).toBe('quantity');
    expect(placeRole(net, 'dock')).toBe('quantity');
    expect(computedPlaceRole(net, 'co2')).toBe('sink');
    expect(computedPlaceRole(net, 'dock')).toBe('source');
    // The others keep their roles.
    expect(placeRole(net, 'done')).toBe('sink');
    expect(placeRole(net, 'orders')).toBe('source');
    expect(placeRole(net, 'steel')).toBe('case');
  });

  it('overrides a computed resource', () => {
    const net = makeNet({
      places: [['in'], ['tool', 1], ['out']],
      transitions: ['work'],
      arcs: [
        ['in', 'work'],
        ['tool', 'work'],
        ['work', 'tool'],
        ['work', 'out'],
      ],
    });
    expect(placeRole(net, 'tool')).toBe('resource');
    quantity(net, 'tool');
    expect(placeRole(net, 'tool')).toBe('quantity');
    expect(placeRoles(net).get('tool')).toBe('quantity');
  });

  it('isCaselessRole is true for resources and quantities only', () => {
    expect(isCaselessRole('resource')).toBe(true);
    expect(isCaselessRole('quantity')).toBe(true);
    for (const role of ['case', 'source', 'sink', undefined] as const) {
      expect(isCaselessRole(role)).toBe(false);
    }
  });

  it('is accepted by the schema and survives a round trip with the other fields', () => {
    const net = quantity(bikes(), 'steel', 'co2');
    const text = serializeNet(net);
    expect(
      JSON.parse(text).places.filter((p: { role?: string }) => p.role === 'quantity'),
    ).toHaveLength(2);
    expect(parseNetText(text)).toEqual(net);
    expect(serializeNet(parseNetText(text))).toBe(text);
  });

  it('is allowed in both profiles and does not add an error', () => {
    const pt = quantity(bikes(), 'steel', 'co2', 'dock');
    expect(validate(pt)).toEqual([]);
    const json: PetriNet = { ...structuredClone(pt), profile: 'json-net' };
    expect(hasErrors(validate(json))).toBe(false);
  });

  it('an unknown role is rejected by the file format with a message that names the field and the options', () => {
    const json = JSON.parse(serializeNet(bikes()));
    json.places[0].role = 'amount';
    expect(() => parseNet(json)).toThrow(NetFormatError);
    expect(() => parseNet(json)).toThrow(/places\[0\]\.role: .*"case"\|"resource"\|"quantity"/);
  });

  it('setRole sets and clears it', () => {
    let net = setRole(bikes(), 'steel', 'quantity');
    expect(placeRole(net, 'steel')).toBe('quantity');
    net = setRole(net, 'steel', undefined);
    expect(placeRole(net, 'steel')).toBe('case');
    expect(net.places.find((p) => p.id === 'steel')).not.toHaveProperty('role');
  });

  it('QUANTITY_LOOKS_LIKE_RESOURCE hints when a marked quantity forms a loop, naming both roles', () => {
    const net = makeNet({
      places: [['in'], ['store', 5], ['out']],
      transitions: ['work'],
      arcs: [
        ['in', 'work'],
        ['store', 'work'],
        ['work', 'store'],
        ['work', 'out'],
      ],
    });
    expect(validate(quantity(net, 'store')).map((d) => d.code)).toEqual([
      'QUANTITY_LOOKS_LIKE_RESOURCE',
    ]);
    const hint = validate(net)[0]!;
    expect(hint.severity).toBe('warning');
    expect(hint.elementId).toBe('store');
    expect(hint.message).toMatch(/Quantity/);
    expect(hint.message).toMatch(/Resource/);
  });

  it('QUANTITY_LOOKS_LIKE_RESOURCE stays quiet without a loop or without initial tokens', () => {
    expect(validate(quantity(bikes(), 'steel', 'co2'))).toEqual([]);
    const empty = makeNet({
      places: [['in'], ['store'], ['out']],
      transitions: ['work'],
      arcs: [
        ['in', 'work'],
        ['store', 'work'],
        ['work', 'store'],
        ['work', 'out'],
      ],
    });
    expect(validate(quantity(empty, 'store'))).toEqual([]);
  });
});
