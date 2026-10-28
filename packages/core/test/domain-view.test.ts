import { describe, expect, it } from 'vitest';
import {
  moveNodes,
  parseNetText,
  serializeNet,
  setDomainView,
  setDomainViewGeneration,
  validate,
} from '../src';
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

describe('domainViewGeneration', () => {
  const net = makeNet({ places: [['p', 1]], transitions: ['t'], arcs: [['p', 't']] });
  const record = { model: 'm', prompt: { system: 's', user: 'u' }, rounds: [] };

  it('is passed through and written right after the domain view', () => {
    const full = {
      ...net,
      simulation: { seed: 3 },
      domainView: view,
      domainViewGeneration: record,
    };
    const text = serializeNet(full);
    const keys = Object.keys(JSON.parse(text) as object);
    expect(keys.slice(-3)).toEqual(['simulation', 'domainView', 'domainViewGeneration']);
    const back = parseNetText(text);
    expect(back.domainViewGeneration).toEqual(record);
    expect(serializeNet(back)).toBe(text);
    expect(validate(full)).toEqual([]);
  });

  it('is absent from files without it', () => {
    expect(serializeNet(net)).not.toContain('domainViewGeneration');
  });

  it('setDomainViewGeneration sets and removes the record without touching the rest', () => {
    const withView = setDomainView(net, view);
    const set = setDomainViewGeneration(withView, record);
    expect(set.domainViewGeneration).toBe(record);
    expect(set.domainView).toBe(view);
    expect(set.places).toBe(net.places);
    const removed = setDomainViewGeneration(set, undefined);
    expect('domainViewGeneration' in removed).toBe(false);
    expect(removed.domainView).toBe(view);
  });

  it('removing the view removes the record, replacing it keeps the record', () => {
    const full = setDomainViewGeneration(setDomainView(net, view), record);
    expect(setDomainView(full, { other: true }).domainViewGeneration).toBe(record);
    const removed = setDomainView(full, undefined);
    expect('domainView' in removed).toBe(false);
    expect('domainViewGeneration' in removed).toBe(false);
  });

  it('survives other edits', () => {
    const full = setDomainViewGeneration(setDomainView(net, view), record);
    expect(moveNodes(full, { p: { x: 5, y: 5 } }).domainViewGeneration).toBe(record);
  });
});
