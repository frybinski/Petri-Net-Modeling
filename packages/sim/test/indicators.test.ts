import type { Indicator, PetriNet } from '@pnm/core';
import { describe, expect, it } from 'vitest';
import { createSimulation, formatIndicatorValue, indicatorValue } from '../src';
import { makeNet } from './helpers';

/** The net of quantity.test.ts, worked out by hand there: four cases, co2 12, steel 8 out, 7 in. */
function bikes(indicators: Indicator[], warmup?: number): PetriNet {
  const net = makeNet({
    places: [
      { id: 'in', tokens: 4 },
      { id: 'steel', tokens: 8, role: 'quantity' },
      { id: 'out' },
      { id: 'co2', role: 'quantity' },
      { id: 'scrap', role: 'quantity' },
      { id: 'waste', role: 'quantity' },
      { id: 'bought', tokens: 5, role: 'quantity' },
    ],
    transitions: [
      { id: 'work', timing: { kind: 'fixed', value: 10 } },
      { id: 'recycle', timing: { kind: 'fixed', value: 5 } },
      { id: 'topup', timing: { kind: 'fixed', value: 1 } },
    ],
    arcs: [
      ['in', 'work'],
      ['steel', 'work', 2],
      ['work', 'out'],
      ['work', 'co2', 3],
      ['work', 'scrap'],
      ['scrap', 'recycle', 2],
      ['recycle', 'steel'],
      ['recycle', 'waste'],
      ['bought', 'topup', 5],
      ['topup', 'steel', 5],
    ],
  });
  net.simulation = { indicators, ...(warmup !== undefined && { warmup }) };
  return net;
}

async function valuesAt(net: PetriNet, seconds: number) {
  const sim = createSimulation(net);
  await sim.advance(seconds);
  const m = sim.metrics();
  return {
    sim,
    m,
    byId: Object.fromEntries((m.indicators ?? []).map((i) => [i.id, i])),
  };
}

const co2PerCase: Indicator = {
  id: 'co2-per-case',
  label: 'CO2 per case',
  unit: 'kg',
  measure: { kind: 'inflow', of: 'co2' },
  per: 'case',
};

describe('indicators against a hand calculation', () => {
  it('inflow and outflow per completed case', async () => {
    const { byId } = await valuesAt(
      bikes([
        co2PerCase,
        {
          id: 'steel-per-case',
          label: 'Steel',
          measure: { kind: 'outflow', of: 'steel' },
          per: 'case',
        },
      ]),
      100,
    );
    expect(byId['co2-per-case']).toEqual({
      id: 'co2-per-case',
      label: 'CO2 per case',
      unit: 'kg',
      value: 3,
      digits: 1,
    });
    expect(byId['steel-per-case']!.value).toBe(2);
    expect(byId['steel-per-case']!.unit).toBe('');
  });

  it('via counts only the flow over the arcs of one transition, and a share relates two flows', async () => {
    const { byId } = await valuesAt(
      bikes([
        {
          id: 'scrap-out',
          label: 'Scrap',
          measure: { kind: 'outflow', of: 'scrap', via: 'recycle' },
        },
        { id: 'all-steel', label: 'All steel in', measure: { kind: 'inflow', of: 'steel' } },
        {
          id: 'via-recycle',
          label: 'Recycled',
          measure: { kind: 'inflow', of: 'steel', via: 'recycle' },
        },
        {
          id: 'via-topup',
          label: 'Bought',
          measure: { kind: 'inflow', of: 'steel', via: 'topup' },
        },
        {
          id: 'share',
          label: 'Share',
          unit: '%',
          measure: { kind: 'inflow', of: 'steel', via: 'recycle' },
          per: { kind: 'inflow', of: 'steel' },
          factor: 100,
          digits: 2,
        },
      ]),
      100,
    );
    expect(byId['scrap-out']!.value).toBe(4);
    expect(byId['all-steel']!.value).toBe(7);
    expect(byId['via-recycle']!.value).toBe(2);
    expect(byId['via-topup']!.value).toBe(5);
    expect(byId['share']!.value).toBeCloseTo((100 * 2) / 7, 9);
    expect(byId['share']!.digits).toBe(2);
    expect(formatIndicatorValue(byId['share']!)).toBe('28.57');
  });

  it('firings per hour, the stock now, and a factor', async () => {
    const { byId, m } = await valuesAt(
      bikes([
        {
          id: 'per-hour',
          label: 'Cuts per hour',
          measure: { kind: 'firings', of: 'work' },
          per: 'hour',
        },
        { id: 'stock', label: 'Steel in stock', measure: { kind: 'tokens', of: 'steel' } },
        {
          id: 'grams',
          label: 'CO2 in g',
          measure: { kind: 'tokens', of: 'co2' },
          factor: 1000,
          digits: 0,
        },
      ]),
      100,
    );
    expect(m.observed).toBe(100);
    expect(byId['per-hour']!.value).toBeCloseTo(4 / (100 / 3600), 9);
    expect(byId['stock']!.value).toBe(7);
    expect(byId['grams']!.value).toBe(12_000);
    expect(formatIndicatorValue(byId['grams']!)).toBe('12000');
  });

  it('is null while the reference is 0, and a dash when shown', async () => {
    // At 5 s no case has completed.
    const early = await valuesAt(bikes([co2PerCase]), 5);
    expect(early.m.completedCases).toBe(0);
    expect(early.byId['co2-per-case']!.value).toBeNull();
    expect(formatIndicatorValue(early.byId['co2-per-case']!)).toBe('–');
    // A second measure that is 0: `bought` is used up by the purchase.
    const { byId } = await valuesAt(
      bikes([
        {
          id: 'x',
          label: 'x',
          measure: { kind: 'inflow', of: 'co2' },
          per: { kind: 'tokens', of: 'bought' },
        },
        {
          id: 'y',
          label: 'y',
          measure: { kind: 'inflow', of: 'co2' },
          per: { kind: 'firings', of: 'nope' },
        },
      ]),
      100,
    );
    expect(byId['x']!.value).toBeNull();
    // A reference that does not exist counts as 0 as well (validation reports it beforehand).
    expect(byId['y']!.value).toBeNull();
  });

  it('is null before any time has been observed', async () => {
    const sim = createSimulation(
      bikes([{ id: 'h', label: 'h', measure: { kind: 'firings', of: 'work' }, per: 'hour' }]),
    );
    expect(sim.metrics().indicators![0]!.value).toBeNull();
  });

  it('counts only what happens after the warm-up', async () => {
    // The cuts start at 0 s and the purchase at 0 s, before the warm-up of 5 s; the cuts end at 10 s.
    const { byId } = await valuesAt(
      bikes(
        [
          { id: 'cuts', label: 'Cuts', measure: { kind: 'firings', of: 'work' } },
          { id: 'steel-out', label: 'Steel taken', measure: { kind: 'outflow', of: 'steel' } },
          {
            id: 'steel-bought',
            label: 'Bought',
            measure: { kind: 'inflow', of: 'steel', via: 'topup' },
          },
          { id: 'co2', label: 'co2', measure: { kind: 'inflow', of: 'co2' }, per: 'case' },
          {
            id: 'per-hour',
            label: 'Recycles/h',
            measure: { kind: 'firings', of: 'recycle' },
            per: 'hour',
          },
        ],
        5,
      ),
      100,
    );
    expect(byId['cuts']!.value).toBe(0);
    expect(byId['steel-out']!.value).toBe(0);
    expect(byId['steel-bought']!.value).toBe(0);
    expect(byId['co2']!.value).toBe(3);
    // Two recycles in the 95 observed seconds.
    expect(byId['per-hour']!.value).toBeCloseTo(2 / (95 / 3600), 9);
  });

  it('has no indicators in the key figures of a net that defines none', async () => {
    const net = bikes([]);
    delete net.simulation;
    const sim = createSimulation(net);
    await sim.advance(100);
    expect(sim.metrics()).not.toHaveProperty('indicators');
    expect(sim.snapshot().metrics).not.toHaveProperty('flows');
  });

  it('indicatorValue works on plain numbers', () => {
    const value = indicatorValue(
      { id: 'a', label: 'A', measure: { kind: 'tokens', of: 'p' }, per: 'hour', factor: 2 },
      { count: { p: 6 }, completedCases: 0, observedSeconds: 7200, counters: {} },
    );
    expect(value.value).toBe(6);
  });
});

describe('indicators and the history of a run', () => {
  it('step back and restore bring the counters back', async () => {
    const net = bikes([
      co2PerCase,
      { id: 'cuts', label: 'Cuts', measure: { kind: 'firings', of: 'work' } },
    ]);
    const sim = createSimulation(net);
    await sim.advance(9);
    const before = sim.metrics();
    const snapshot = sim.snapshot();
    await sim.advance(20);
    expect(sim.metrics().indicators![0]!.value).toBe(3);
    await sim.restore(snapshot);
    expect(sim.metrics()).toEqual(before);
    await sim.advance(20);
    expect(sim.metrics().indicators![0]!.value).toBe(3);
    // Stepping back over the last instants gives the figures of that moment.
    const again = createSimulation(net);
    await again.advance(100);
    const full = again.metrics();
    while (again.canStepBack()) await again.stepBack();
    expect(again.metrics().indicators![1]!.value).toBe(0);
    await again.advance(100);
    expect(again.metrics().indicators).toEqual(full.indicators);
  });

  it('a reset starts the counters again', async () => {
    const sim = createSimulation(bikes([co2PerCase]));
    await sim.advance(100);
    await sim.reset();
    await sim.advance(100);
    expect(sim.metrics().indicators![0]!.value).toBe(3);
  });

  it('are the same on every run with the same seed (stochastic durations)', async () => {
    const net = bikes([co2PerCase]);
    net.transitions.find((t) => t.id === 'work')!.timing = { kind: 'exponential', mean: 10 };
    const one = await valuesAt(net, 300);
    const two = await valuesAt(net, 300);
    expect(two.m.indicators).toEqual(one.m.indicators);
  });
});
