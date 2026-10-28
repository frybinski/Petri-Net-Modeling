import { describe, expect, it } from 'vitest';
import { moveNodes, parseNetText, serializeNet, setDomainView, validate } from '../src';
import { makeNet } from './helpers';

const view = {
  schemaVersion: 1,
  netHash: 'fnv1a64:0123456789abcdef',
  places: { p: { kind: 'pool', pos: [10, 20] } },
};

describe('domainView', () => {
  const net = makeNet({ places: [['p', 1]], transitions: ['t'], arcs: [['p', 't']] });

  it('is optional and absent from files without it', () => {
    expect(serializeNet(net)).not.toContain('domainView');
    expect(parseNetText(serializeNet(net)).domainView).toBeUndefined();
  });

  it('is passed through unchecked and written last-but-one, after the simulation settings', () => {
    const withView = { ...net, simulation: { seed: 3 }, domainView: view };
    const text = serializeNet(withView);
    const keys = Object.keys(JSON.parse(text) as object);
    expect(keys.slice(-2)).toEqual(['simulation', 'domainView']);
    const back = parseNetText(text);
    expect(back.domainView).toEqual(view);
    expect(serializeNet(back)).toBe(text);
  });

  it('does not change how the net is validated', () => {
    expect(validate({ ...net, domainView: 'anything' })).toEqual([]);
  });

  it('setDomainView sets, replaces and removes the view without touching the rest', () => {
    const set = setDomainView(net, view);
    expect(set.domainView).toBe(view);
    expect(set.places).toBe(net.places);
    const replaced = setDomainView(set, { other: true });
    expect(replaced.domainView).toEqual({ other: true });
    const removed = setDomainView(replaced, undefined);
    expect('domainView' in removed).toBe(false);
    expect(net.domainView).toBeUndefined();
  });

  it('survives other edits', () => {
    const edited = moveNodes(setDomainView(net, view), { p: { x: 5, y: 5 } });
    expect(edited.domainView).toBe(view);
  });
});
