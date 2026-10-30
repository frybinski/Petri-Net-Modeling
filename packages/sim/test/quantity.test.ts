import type { Indicator, PetriNet } from '@pnm/core';
import { describe, expect, it } from 'vitest';
import { createSimulation, type SimEvent } from '../src';
import { makeNet } from './helpers';

/**
 * Four orders are cut in parallel (10 s). Cutting takes 2 steel and gives 3 co2 and 1 scrap;
 * recycling (5 s) takes 2 scrap and gives 1 steel and 1 waste; a purchase (1 s) turns 5 bought
 * into 5 steel. `bought` is a source, `co2` and `waste` are sinks by structure: only the role
 * `quantity` makes them amounts. By hand:
 *   t = 0   four cases start, the purchase starts
 *   t = 1   steel 8 - 8 + 5
 *   t = 10  four cases end: out 4, co2 12, scrap 4; two recycles start
 *   t = 15  steel +2, waste +2 (steel 7)
 */
function bikes(indicators: Indicator[] = []): PetriNet {
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
  if (indicators.length > 0) net.simulation = { indicators };
  return net;
}

async function run(net: PetriNet, seconds: number, options = {}) {
  const sim = createSimulation(net, options);
  const events: SimEvent[] = [...sim.initialEvents];
  events.push(...(await sim.advance(seconds)));
  return { sim, events };
}

describe('tokens on quantity places carry no case', () => {
  it('has no case on a quantity token, in the state, in the events or in a firing', async () => {
    const { sim, events } = await run(bikes(), 100);
    for (const placeId of ['steel', 'co2', 'scrap', 'waste', 'bought']) {
      for (const meta of sim.state.meta[placeId] ?? []) expect(meta.caseId).toBeUndefined();
    }
    const quantities = new Set(['steel', 'co2', 'scrap', 'waste', 'bought']);
    for (const event of events) {
      if (event.type === 'start') {
        for (const ref of event.consumed) {
          if (quantities.has(ref.placeId)) expect(ref.caseId).toBeUndefined();
        }
      }
      if (event.type === 'complete') {
        for (const ref of event.produced) {
          if (quantities.has(ref.placeId)) expect(ref.caseId).toBeUndefined();
        }
      }
    }
    // The tokens of `out` do carry the case.
    expect(sim.state.meta['out']!.map((m) => m.caseId).sort()).toEqual([
      'C-0001',
      'C-0002',
      'C-0003',
      'C-0004',
    ]);
  });

  it('a firing that only works on quantities has no case, and no case is made for them', async () => {
    const { events } = await run(bikes(), 100);
    const recycles = events.filter((e) => e.type === 'start' && e.transitionId === 'recycle');
    const topups = events.filter((e) => e.type === 'start' && e.transitionId === 'topup');
    expect(recycles).toHaveLength(2);
    expect(topups).toHaveLength(1);
    for (const event of [...recycles, ...topups]) {
      expect(event.type === 'start' && event.caseIds).toEqual([]);
    }
    for (const event of events) {
      if (event.type === 'complete' && ['recycle', 'topup'].includes(event.transitionId)) {
        expect(event.caseIds).toEqual([]);
      }
    }
    // Only the four orders are cases: the tokens of `bought` and `steel` at the start are not.
    expect(events.filter((e) => e.type === 'spawn')).toHaveLength(4);
  });

  it('a case that finishes is counted when it reaches `out`, not when its co2 reaches a sink', async () => {
    // The first step already puts co2 on a place that is a sink by structure.
    const net = makeNet({
      places: [
        { id: 'in', tokens: 1 },
        { id: 'mid' },
        { id: 'out' },
        { id: 'co2', role: 'quantity' },
      ],
      transitions: [
        { id: 'a', timing: { kind: 'fixed', value: 10 } },
        { id: 'b', timing: { kind: 'fixed', value: 20 } },
      ],
      arcs: [
        ['in', 'a'],
        ['a', 'mid'],
        ['a', 'co2', 4],
        ['mid', 'b'],
        ['b', 'out'],
      ],
    });
    const sim = createSimulation(net);
    await sim.advance(15);
    // co2 has arrived, the case has not left.
    expect(sim.state.marking['co2']).toHaveLength(4);
    expect(sim.metrics().completedCases).toBe(0);
    expect(sim.metrics().casesInSystem).toBe(1);
    await sim.advance(100);
    const m = sim.metrics();
    expect(m.completedCases).toBe(1);
    expect(m.casesInSystem).toBe(0);
    expect(m.meanCycleTime).toBe(30);
    expect(m.maxCycleTime).toBe(30);

    // Without the role the same net would have ended the case at 10 s.
    const plain = JSON.parse(JSON.stringify(net)) as PetriNet;
    delete plain.places.find((p) => p.id === 'co2')!.role;
    const old = createSimulation(plain);
    await old.advance(100);
    expect(old.metrics().meanCycleTime).toBe(10);
  });

  it('a source transition that feeds only quantities brings in no case', async () => {
    const net = makeNet({
      places: [{ id: 'steel', role: 'quantity' }],
      transitions: [{ id: 'deliver', rate: 6, timing: { kind: 'fixed', value: 60 } }],
      arcs: [['deliver', 'steel', 40]],
    });
    const { sim, events } = await run(net, 3600);
    expect(events.filter((e) => e.type === 'spawn')).toEqual([]);
    const starts = events.filter((e) => e.type === 'start');
    expect(starts.length).toBeGreaterThan(2);
    for (const event of starts) expect(event.type === 'start' && event.caseIds).toEqual([]);
    expect(sim.state.marking['steel']!.length % 40).toBe(0);
    expect(sim.state.marking['steel']!.length).toBeGreaterThan(0);
    const m = sim.metrics();
    expect(m.casesInSystem).toBe(0);
    expect(m.completedCases).toBe(0);
    expect(m.meanCycleTime).toBeNull();
  });

  it('a source transition with a case place among its outputs still brings in a case', async () => {
    const net = makeNet({
      places: [{ id: 'steel', role: 'quantity' }, { id: 'queue' }, { id: 'done' }],
      transitions: [
        { id: 'arrive', rate: 60 },
        { id: 'serve', timing: { kind: 'fixed', value: 5 } },
      ],
      arcs: [
        ['arrive', 'queue'],
        ['arrive', 'steel'],
        ['queue', 'serve'],
        ['serve', 'done'],
      ],
    });
    const { events } = await run(net, 600);
    expect(events.filter((e) => e.type === 'spawn').length).toBeGreaterThan(3);
  });

  it('can be started by hand and by a random step without a case', async () => {
    const net = makeNet({
      places: [{ id: 'steel', role: 'quantity' }],
      transitions: [{ id: 'deliver' }],
      arcs: [['deliver', 'steel', 3]],
    });
    const sim = createSimulation(net);
    const first = await sim.fireManually('deliver');
    expect(first.filter((e) => e.type === 'spawn')).toEqual([]);
    const second = await sim.stepRandom();
    expect(second.filter((e) => e.type === 'spawn')).toEqual([]);
    expect(sim.state.marking['steel']).toHaveLength(6);
    expect(sim.metrics().casesInSystem).toBe(0);
  });
});

describe('key figures of quantity places', () => {
  it('lists the places with their stock but without a waiting time', async () => {
    const { sim } = await run(bikes(), 100);
    const places = sim.metrics().places;
    const steel = places.find((p) => p.placeId === 'steel')!;
    expect(steel.role).toBe('quantity');
    expect(steel.current).toBe(7);
    // 8 tokens for no time at 0 s (the cuts take them in the same instant), 5 from 1 s, 7 from 15 s.
    expect(steel.max).toBe(7);
    expect(steel.mean).toBeCloseTo((5 * 14 + 7 * 85) / 100, 6);
    expect(steel.meanWait).toBeNull();
    // No place is a resource, so there is no utilisation either.
    expect(sim.metrics().resources).toEqual([]);
    expect(places.find((p) => p.placeId === 'co2')?.current).toBe(12);
    expect(places.find((p) => p.placeId === 'co2')?.role).toBe('quantity');
    // Cases: four, all completed at 10 s.
    expect(sim.metrics().completedCases).toBe(4);
    expect(sim.metrics().meanCycleTime).toBe(10);
  });

  it('keeps a time-weighted mean for a quantity', async () => {
    const { sim } = await run(bikes(), 100);
    const co2 = sim.metrics().places.find((p) => p.placeId === 'co2')!;
    // 12 tokens from t = 10 to 100.
    expect(co2.mean).toBeCloseTo((12 * 90) / 100, 6);
  });
});

describe('determinism', () => {
  it('gives the same events and indicators for the same seed', async () => {
    const indicators: Indicator[] = [
      { id: 'co2', label: 'CO2', measure: { kind: 'inflow', of: 'co2' }, per: 'case' },
    ];
    const net = bikes(indicators);
    net.transitions.find((t) => t.id === 'work')!.timing = { kind: 'uniform', min: 8, max: 12 };
    const a = await run(net, 200, { seed: 5 });
    const b = await run(net, 200, { seed: 5 });
    const c = await run(net, 200, { seed: 6 });
    expect(b.events).toEqual(a.events);
    expect(b.sim.metrics()).toEqual(a.sim.metrics());
    expect(c.events).not.toEqual(a.events);
  });
});
