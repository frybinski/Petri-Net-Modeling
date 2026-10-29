import { describe, expect, it } from 'vitest';
import { moveNodes, parseNetText, serializeNet, setProperties, validate } from '../src';
import { makeNet } from './helpers';

const list = [
  { id: 'a', kind: 'declare', template: 'response', activities: ['x', 'y'] },
  { id: 'b', kind: 'ltlf', formula: 'G(x -> F y)' },
];

describe('properties', () => {
  const net = makeNet({ places: [['p', 1]], transitions: ['t'], arcs: [['p', 't']] });

  it('is optional and absent from files without it', () => {
    expect(serializeNet(net)).not.toContain('properties');
    expect(parseNetText(serializeNet(net)).properties).toBeUndefined();
  });

  it('is passed through unchecked and survives a round trip', () => {
    const text = serializeNet({ ...net, properties: list });
    const back = parseNetText(text);
    expect(back.properties).toEqual(list);
    expect(serializeNet(back)).toBe(text);
    expect(validate({ ...net, properties: 'anything' })).toEqual([]);
  });

  it('setProperties sets and removes the list without touching the rest', () => {
    const set = setProperties(net, list);
    expect(set.properties).toBe(list);
    expect(set.places).toBe(net.places);
    expect('properties' in setProperties(set, undefined)).toBe(false);
    expect(moveNodes(set, { p: { x: 5, y: 5 } }).properties).toBe(list);
  });
});
