import { describe, expect, it } from 'vitest';
import {
  NetOpError,
  indicatorProblems,
  parseNet,
  parseNetText,
  serializeNet,
  setIndicators,
  setSimulationSettings,
  validate,
  type Indicator,
  type PetriNet,
} from '../src';
import { makeNet } from './helpers';

const net = (): PetriNet =>
  makeNet({
    places: [['orders'], ['steel', 30], ['co2'], ['done']],
    transitions: ['cut'],
    arcs: [
      ['orders', 'cut'],
      ['steel', 'cut', 3],
      ['cut', 'co2'],
      ['cut', 'done'],
    ],
  });

const co2: Indicator = {
  id: 'co2-per-frame',
  label: 'CO2e per frame',
  unit: 'kg',
  measure: { kind: 'inflow', of: 'co2' },
  per: 'case',
  factor: 1,
  digits: 1,
};

const withIndicators = (...indicators: Indicator[]): PetriNet => ({
  ...net(),
  simulation: { indicators },
});

const messages = (n: PetriNet): string[] =>
  validate(n)
    .filter((d) => d.code === 'INDICATOR_INVALID')
    .map((d) => d.message);

describe('indicators in the file format', () => {
  it('round-trips in a stable key order, with every kind of measure and reference', () => {
    const all: Indicator[] = [
      co2,
      { id: 'a', label: 'A', measure: { kind: 'tokens', of: 'steel' } },
      { id: 'b', label: 'B', measure: { kind: 'outflow', of: 'steel', via: 'cut' }, per: 'hour' },
      {
        id: 'c',
        label: 'C',
        measure: { kind: 'firings', of: 'cut' },
        per: { kind: 'tokens', of: 'steel' },
      },
      {
        id: 'd',
        label: 'D',
        measure: { kind: 'inflow', of: 'co2', via: 'cut' },
        per: { kind: 'inflow', of: 'co2' },
        factor: 100,
      },
    ];
    const n = withIndicators(...all);
    n.simulation = { seed: 3, caseIdPrefix: 'R-', indicators: all };
    const text = serializeNet(n);
    expect(parseNetText(text)).toEqual(n);
    expect(serializeNet(parseNetText(text))).toBe(text);
    const first = JSON.parse(text).simulation.indicators[0];
    expect(Object.keys(first)).toEqual([
      'id',
      'label',
      'unit',
      'measure',
      'per',
      'factor',
      'digits',
    ]);
    expect(validate(n)).toEqual([]);
  });

  it('rejects an unknown kind of measure and a bad reference when reading', () => {
    const json = JSON.parse(serializeNet(withIndicators(co2)));
    json.simulation.indicators[0].measure = { kind: 'average', of: 'co2' };
    expect(() => parseNet(json)).toThrow(/simulation\.indicators\[0\]\.measure/);
    const other = JSON.parse(serializeNet(withIndicators(co2)));
    other.simulation.indicators[0].per = 'month';
    expect(() => parseNet(other)).toThrow(/simulation\.indicators\[0\]\.per/);
  });

  it('a net without indicators is unchanged', () => {
    const n = { ...net(), simulation: { seed: 2 } };
    expect(JSON.parse(serializeNet(n)).simulation).toEqual({ seed: 2 });
  });
});

describe('validation of indicators', () => {
  it('accepts a correct indicator', () => {
    expect(validate(withIndicators(co2))).toEqual([]);
  });

  it('reports an unknown place, with the path', () => {
    const bad = withIndicators({ ...co2, measure: { kind: 'inflow', of: 'p_nope' } });
    const found = validate(bad).filter((d) => d.code === 'INDICATOR_INVALID');
    expect(found).toHaveLength(1);
    expect(found[0]!.severity).toBe('error');
    expect(found[0]!.path).toBe('simulation.indicators[0].measure.of');
    expect(found[0]!.message).toContain('simulation.indicators[0].measure.of');
    expect(found[0]!.message).toContain('p_nope');
  });

  it('reports an unknown transition, and a place or transition of the wrong kind', () => {
    expect(
      messages(withIndicators({ ...co2, measure: { kind: 'firings', of: 'zzz' } })),
    ).toHaveLength(1);
    expect(
      messages(withIndicators({ ...co2, measure: { kind: 'firings', of: 'co2' } }))[0],
    ).toMatch(/is a place/);
    expect(messages(withIndicators({ ...co2, measure: { kind: 'tokens', of: 'cut' } }))[0]).toMatch(
      /is a transition/,
    );
  });

  it('checks the reference measure as well', () => {
    const bad = withIndicators({ ...co2, per: { kind: 'tokens', of: 'p_nope' } });
    expect(validate(bad).find((d) => d.code === 'INDICATOR_INVALID')?.path).toBe(
      'simulation.indicators[0].per.of',
    );
  });

  it('reports a duplicate id on the second indicator', () => {
    const found = validate(withIndicators(co2, { ...co2, label: 'again' })).filter(
      (d) => d.code === 'INDICATOR_INVALID',
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.path).toBe('simulation.indicators[1].id');
  });

  it('via needs an arc between the transition and the place, in the right direction', () => {
    const inflow = (via: string) =>
      withIndicators({ ...co2, measure: { kind: 'inflow', of: 'co2', via } });
    const outflow = (via: string) =>
      withIndicators({ ...co2, measure: { kind: 'outflow', of: 'steel', via } });
    expect(messages(inflow('cut'))).toEqual([]);
    expect(messages(outflow('cut'))).toEqual([]);
    // The arcs run the other way round.
    expect(
      messages(withIndicators({ ...co2, measure: { kind: 'outflow', of: 'co2', via: 'cut' } }))[0],
    ).toMatch(/no arc from "co2" to "cut"/);
    expect(
      messages(withIndicators({ ...co2, measure: { kind: 'inflow', of: 'steel', via: 'cut' } }))[0],
    ).toMatch(/no arc from "cut" to "steel"/);
    expect(messages(inflow('p_nope'))[0]).toMatch(/no transition/);
    expect(messages(inflow('co2'))[0]).toMatch(/is a place/);
  });

  it('factor must be finite and digits an integer from 0 to 6', () => {
    const factor = indicatorProblems(net(), { ...co2, factor: Number.POSITIVE_INFINITY });
    expect(factor.map((p) => p.path)).toEqual(['factor']);
    expect(factor[0]!.message).toMatch(/finite/);
    expect(indicatorProblems(net(), { ...co2, factor: Number.NaN }).map((p) => p.path)).toEqual([
      'factor',
    ]);
    for (const digits of [-1, 7, 1.5]) {
      expect(indicatorProblems(net(), { ...co2, digits }).map((p) => p.path)).toEqual(['digits']);
    }
    for (const digits of [0, 6]) expect(indicatorProblems(net(), { ...co2, digits })).toEqual([]);
  });

  it('a factor that is not a number is rejected by the schema, with the path', () => {
    const json = JSON.parse(serializeNet(withIndicators(co2)));
    json.simulation.indicators[0].factor = 'x';
    expect(() => parseNet(json)).toThrow(/simulation\.indicators\[0\]\.factor/);
  });

  it('reports all problems of all indicators, not only the first', () => {
    const bad = withIndicators(
      {
        ...co2,
        measure: { kind: 'inflow', of: 'nope' },
        per: { kind: 'tokens', of: 'nada' },
        digits: 9,
      },
      { ...co2, id: 'second', measure: { kind: 'firings', of: 'nope' } },
    );
    expect(messages(bad)).toHaveLength(4);
  });

  it('deleting an element that an indicator names makes the validation report the indicator', () => {
    const n = withIndicators(co2);
    expect(validate(n)).toEqual([]);
    const without: PetriNet = {
      ...n,
      places: n.places.filter((p) => p.id !== 'co2'),
      arcs: n.arcs.filter((a) => a.target !== 'co2'),
    };
    // The indicator is still there and now reported; it was not removed silently.
    expect(without.simulation?.indicators).toHaveLength(1);
    expect(messages(without)).toHaveLength(1);
  });
});

describe('net operations for indicators', () => {
  it('setIndicators sets, replaces and removes (an empty list removes the key)', () => {
    let n = setIndicators(net(), [co2]);
    expect(n.simulation?.indicators).toEqual([co2]);
    n = setIndicators(n, [co2, { id: 'x', label: 'X', measure: { kind: 'tokens', of: 'steel' } }]);
    expect(n.simulation?.indicators).toHaveLength(2);
    n = setIndicators(n, []);
    expect(n).not.toHaveProperty('simulation');
  });

  it('setIndicators keeps the other settings and does not check the ids', () => {
    const n = setSimulationSettings(net(), { seed: 4 });
    const withBad = setIndicators(n, [{ ...co2, measure: { kind: 'inflow', of: 'gone' } }]);
    expect(withBad.simulation?.seed).toBe(4);
    expect(withBad.simulation?.indicators).toHaveLength(1);
    expect(() => setIndicators(n, [co2])).not.toThrow(NetOpError);
  });
});
