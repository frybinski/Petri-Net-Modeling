import { describe, expect, it } from 'vitest';
import { autoMapActivities } from '../src';
import { makeNet } from './helpers';

function named(names: Record<string, string>) {
  const net = makeNet({ transitions: Object.keys(names) });
  net.transitions.forEach((t) => {
    t.name = names[t.id]!;
  });
  return net;
}

describe('autoMapActivities', () => {
  const net = named({
    t_scan: 'Scannen',
    t_sort: 'Sortieren',
    t_loadA: 'Verladen Tor 1',
    t_loadB: 'Verladen Tor 2',
    t_check: 'Check Credit',
    t_x: 'Weg Arbeitsplatz',
  });

  it('matches the same name first', () => {
    const { mapping, unmatched } = autoMapActivities(net, ['Scannen', 'Sortieren']);
    expect(mapping).toEqual({ Scannen: 't_scan', Sortieren: 't_sort' });
    expect(unmatched).toEqual([]);
  });

  it('ignores case, spaces, underscores and hyphens', () => {
    const { mapping } = autoMapActivities(net, [
      'scannen',
      '  SORTIEREN ',
      'check_credit',
      'Check-Credit',
      'verladentor1',
      'WEG   ARBEITSPLATZ',
    ]);
    expect(mapping).toEqual({
      scannen: 't_scan',
      '  SORTIEREN ': 't_sort',
      check_credit: 't_check',
      'Check-Credit': 't_check',
      verladentor1: 't_loadA',
      'WEG   ARBEITSPLATZ': 't_x',
    });
  });

  it('matches the id of a transition', () => {
    const { mapping, unmatched } = autoMapActivities(net, ['t_scan', 'T_SORT', 'nothing']);
    expect(mapping).toEqual({ t_scan: 't_scan', T_SORT: 't_sort' });
    expect(unmatched).toEqual(['nothing']);
  });

  it('matches a name that begins like the other, if only one transition does', () => {
    const { mapping, unmatched } = autoMapActivities(net, [
      'Scannen (Paket)',
      'Sortier',
      'Verladen',
      'Weg',
      'Ab',
    ]);
    expect(mapping).toEqual({
      'Scannen (Paket)': 't_scan',
      Sortier: 't_sort',
      Weg: 't_x',
    });
    // "Verladen" begins two names; "Ab" is too short to say anything.
    expect(unmatched).toEqual(['Verladen', 'Ab']);
  });

  it('leaves ambiguous names to the person', () => {
    const twins = named({ a: 'Pack', b: 'Pack', c: 'Ship' });
    const { mapping, unmatched } = autoMapActivities(twins, ['Pack', 'Ship']);
    expect(mapping).toEqual({ Ship: 'c' });
    expect(unmatched).toEqual(['Pack']);
  });

  it('prefers the same name to a looser match', () => {
    const both = named({ a: 'Pack', b: 'pack' });
    expect(autoMapActivities(both, ['pack']).mapping).toEqual({ pack: 'b' });
    expect(autoMapActivities(both, ['PACK']).unmatched).toEqual(['PACK']);
  });

  it('copes with a net without transitions and an empty list', () => {
    expect(autoMapActivities(makeNet({}), ['A'])).toEqual({ mapping: {}, unmatched: ['A'] });
    expect(autoMapActivities(net, [])).toEqual({ mapping: {}, unmatched: [] });
  });
});
