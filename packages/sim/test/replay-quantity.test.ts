import type { PetriNet } from '@pnm/core';
import { describe, expect, it } from 'vitest';
import { createReplay } from '../src';
import { makeNet } from './helpers';
import { identityMapping, logOf, playOut, runEngine } from './replay-helpers';

/**
 * Four orders are cut in parallel (10 s): cutting takes `steel` 2, gives 3 `co2` and 1 `scrap`.
 * Deliveries and recycling belong to no case, so a log never mentions them.
 */
function cutting(steel: number): PetriNet {
  return makeNet({
    places: [
      { id: 'in', tokens: 4 },
      { id: 'steel', tokens: steel, role: 'quantity' },
      { id: 'out' },
      { id: 'co2', role: 'quantity' },
      { id: 'scrap', role: 'quantity' },
    ],
    transitions: [{ id: 'work', timing: { kind: 'fixed', value: 10 } }],
    arcs: [
      ['in', 'work'],
      ['steel', 'work', 2],
      ['work', 'out'],
      ['work', 'co2', 3],
      ['work', 'scrap'],
    ],
  });
}

describe('replay with quantity places', () => {
  it('replays the log of a run with fitness 1, without deviations, and with the same amounts', async () => {
    const net = cutting(8);
    const engine = await runEngine(net, 100);
    const log = logOf(engine.events, net);
    expect(log).toHaveLength(8);
    const replay = createReplay(net, log, { mapping: identityMapping(net) });
    const played = await playOut(replay, 100);
    expect(played.events.filter((e) => e.type === 'deviation' || e.type === 'warning')).toEqual([]);
    const stats = replay.metrics().replay!;
    expect(stats).toMatchObject({ fitness: 1, missing: 0, remaining: 0, ignored: 0 });
    // The tokens of the quantities are not counted: only the four orders in and the four out.
    expect(stats.consumed).toBe(4);
    expect(stats.produced).toBe(8);
    expect(replay.state.marking['co2']).toHaveLength(12);
    expect(replay.state.marking['scrap']).toHaveLength(4);
    expect(replay.state.marking['steel']).toBeUndefined();
    for (const meta of Object.values(replay.state.meta).flat()) {
      expect(typeof meta.enteredAt).toBe('number');
    }
    expect(replay.metrics().completedCases).toBe(4);
    expect(replay.metrics().casesInSystem).toBe(0);
    expect(replay.metrics().completedCases).toBe(engine.sim.metrics().completedCases);
  });

  it('makes up what the log takes from a quantity that the net lacks, without a deviation', async () => {
    const full = cutting(8);
    const engine = await runEngine(full, 100);
    const log = logOf(engine.events, full);
    // The net to replay on starts with only 3 steel: the log takes 8.
    const scarce = cutting(3);
    const replay = createReplay(scarce, log, { mapping: identityMapping(scarce) });
    const played = await playOut(replay, 100);
    expect(played.events.filter((e) => e.type === 'deviation')).toEqual([]);
    const metrics = replay.metrics();
    expect(metrics.replay).toMatchObject({ fitness: 1, missing: 0, remaining: 0 });
    expect(metrics.replay!.missingByPlace).toEqual({});
    // The stock never goes below 0, in the state or in the key figures.
    const steel = metrics.places.find((p) => p.placeId === 'steel')!;
    expect(steel.current).toBe(0);
    expect(steel.mean).toBeGreaterThanOrEqual(0);
    expect(replay.state.marking['steel'] ?? []).toEqual([]);
    for (const place of metrics.places) expect(place.current).toBeGreaterThanOrEqual(0);
  });

  it('computes the indicators of the net on a replay, with the amounts of the log', async () => {
    const net = cutting(8);
    net.simulation = {
      indicators: [
        {
          id: 'co2',
          label: 'CO2 per case',
          measure: { kind: 'inflow', of: 'co2' },
          per: 'case',
        },
        { id: 'steel', label: 'Steel', measure: { kind: 'outflow', of: 'steel' }, per: 'case' },
      ],
    };
    const engine = await runEngine(net, 100);
    const log = logOf(engine.events, net);
    const replay = createReplay(net, log, { mapping: identityMapping(net) });
    await playOut(replay, 100);
    expect(replay.metrics().indicators).toEqual(engine.sim.metrics().indicators);
    expect(replay.metrics().indicators!.map((i) => i.value)).toEqual([3, 2]);
  });
});
