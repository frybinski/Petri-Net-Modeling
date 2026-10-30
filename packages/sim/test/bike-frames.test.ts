import { placeRoles, validate, type PetriNet } from '@pnm/core';
import { describe, expect, it } from 'vitest';
import {
  createReplay,
  createSimulation,
  isTimedNet,
  type MetricsSnapshot,
  type SimEvent,
} from '../src';
import { identityMapping, loadExample, logOf, playOut } from './replay-helpers';

const HOUR = 3600;
const QUANTITIES = ['p_tubes', 'p_space', 'p_scrap', 'p_waste', 'p_co2'];

async function run(net: PetriNet, seconds: number, seed?: number) {
  const sim = createSimulation(net, seed === undefined ? {} : { seed });
  const events: SimEvent[] = [...sim.initialEvents];
  // The least stock the tube store ever had, and the most cases that waited in front of a station.
  let leastTubes = Infinity;
  let mostWaiting = 0;
  const waiting = ['p_orders', 'p_cut', 'p_welded', 'p_coated', 'p_checked', 'p_rework', 'p_ready'];
  while (sim.state.time < seconds) {
    events.push(...(await sim.advance(60)));
    leastTubes = Math.min(leastTubes, sim.state.marking['p_tubes']?.length ?? 0);
    for (const id of waiting) {
      mostWaiting = Math.max(mostWaiting, sim.state.marking[id]?.length ?? 0);
    }
  }
  return { sim, events, metrics: sim.metrics(), leastTubes, mostWaiting };
}

const indicator = (metrics: MetricsSnapshot, id: string): number | null =>
  metrics.indicators?.find((i) => i.id === id)?.value ?? null;

describe('example: the bicycle frame production (N1)', () => {
  const net = loadExample('bike-frames');

  it('is a valid timed P/T net without warnings, with five quantity places', () => {
    expect(net.profile).toBe('pt-net');
    expect(net.name).toBe('Fahrradrahmen-Fertigung');
    expect(validate(net)).toEqual([]);
    expect(isTimedNet(net)).toBe(true);
    expect(net.places).toHaveLength(17);
    expect(net.transitions).toHaveLength(11);
    const roles = placeRoles(net);
    expect(net.places.filter((p) => roles.get(p.id) === 'quantity').map((p) => p.id)).toEqual(
      QUANTITIES,
    );
    // The CO2 place, the waste and the scrap have no way out; they are still not sinks of cases.
    expect(roles.get('p_co2')).toBe('quantity');
    expect(roles.get('p_waste')).toBe('quantity');
    expect(roles.get('p_shipped')).toBe('sink');
    expect(roles.get('p_saw')).toBe('resource');
    expect(net.marking['p_tubes']).toHaveLength(120);
    expect(net.marking['p_space']).toHaveLength(80);
    expect(net.simulation).toMatchObject({ seed: 1, warmup: HOUR, caseIdPrefix: 'R-' });
    expect(net.simulation?.indicators?.map((i) => i.id)).toEqual([
      'co2-per-frame',
      'material',
      'recycled-share',
      'waste',
    ]);
  });

  it('keeps the tube store and the free space at 200 kg together (a place invariant)', async () => {
    const sim = createSimulation(net, { seed: 1 });
    // Tokens that a running firing has taken are on their way: add what it will put back.
    const total = (): number => {
      let sum = 0;
      for (const placeId of ['p_tubes', 'p_space']) {
        sum += sim.state.marking[placeId]?.length ?? 0;
        for (const firing of sim.state.running) {
          sum += firing.binding.produces[placeId]?.length ?? 0;
        }
      }
      return sum;
    };
    const seen = new Set<number>([total()]);
    while (sim.state.time < 8 * HOUR) {
      await sim.advance(37);
      seen.add(total());
    }
    expect([...seen]).toEqual([200]);
  });

  it('runs 8 simulated hours without congestion', async () => {
    const { events, metrics, leastTubes, mostWaiting } = await run(net, 8 * HOUR, 1);
    expect(events.some((e) => e.type === 'warning')).toBe(false);
    expect(metrics.completedCases).toBeGreaterThan(30);
    // Nothing piles up in front of a station, every machine has room, the store never runs dry.
    expect(mostWaiting).toBeLessThanOrEqual(6);
    expect(metrics.casesInSystem).toBeLessThanOrEqual(8);
    for (const resource of metrics.resources) expect(resource.utilization).toBeLessThan(0.85);
    expect(leastTubes).toBeGreaterThanOrEqual(100);
    expect(metrics.meanCycleTime!).toBeLessThan(60 * 60);
    expect(metrics.throughputPerHour!).toBeGreaterThan(4);
  });

  it('shows the figures of the plan: 10 to 20 kg CO2e per frame, 15 to 40 % recycled, no stall', async () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { metrics } = await run(net, 8 * HOUR, seed);
      expect(indicator(metrics, 'co2-per-frame'), `seed ${seed}`).toBeGreaterThan(10);
      expect(indicator(metrics, 'co2-per-frame'), `seed ${seed}`).toBeLessThan(20);
      expect(indicator(metrics, 'recycled-share'), `seed ${seed}`).toBeGreaterThan(15);
      expect(indicator(metrics, 'recycled-share'), `seed ${seed}`).toBeLessThan(40);
      // Three kilograms of tube per frame, a little more for the reworked ones.
      expect(indicator(metrics, 'material'), `seed ${seed}`).toBeGreaterThan(2.5);
      expect(indicator(metrics, 'material'), `seed ${seed}`).toBeLessThan(4);
      expect(indicator(metrics, 'waste'), `seed ${seed}`).toBeGreaterThan(0.1);
      expect(indicator(metrics, 'waste'), `seed ${seed}`).toBeLessThan(0.4);
    }
  });

  it('has the indicator values of seed 1 that the documentation names', async () => {
    const { metrics } = await run(net, 8 * HOUR, 1);
    expect(metrics.indicators!.map((i) => [i.id, i.unit, i.digits])).toEqual([
      ['co2-per-frame', 'kg', 1],
      ['material', 'kg', 1],
      ['recycled-share', '%', 0],
      ['waste', 'kg', 2],
    ]);
    expect(indicator(metrics, 'co2-per-frame')).toBeCloseTo(13.36, 2);
    expect(indicator(metrics, 'material')).toBeCloseTo(3.13, 2);
    expect(indicator(metrics, 'recycled-share')).toBeCloseTo(28.57, 2);
    expect(indicator(metrics, 'waste')).toBeCloseTo(0.21, 2);
    expect(metrics.completedCases).toBe(39);
  });

  it('counts a frame as done when it is shipped, not when its first CO2 arrives', async () => {
    const { events, metrics } = await run(net, 8 * HOUR, 1);
    const warmup = net.simulation!.warmup!;
    const born = new Map<string, number>();
    for (const event of events) if (event.type === 'spawn') born.set(event.caseId, event.t);
    const shipped = events.filter(
      (e): e is Extract<SimEvent, { type: 'complete' }> =>
        e.type === 'complete' && e.transitionId === 't_ship' && e.t >= warmup,
    );
    const cycles = shipped.map((e) => e.t - born.get(e.caseIds[0]!)!);
    expect(metrics.completedCases).toBe(shipped.length);
    expect(metrics.meanCycleTime!).toBeCloseTo(
      cycles.reduce((a, b) => a + b, 0) / cycles.length,
      6,
    );
    // The first CO2 of a frame comes with its cut, minutes before it is shipped.
    const firstCut = events.find((e) => e.type === 'complete' && e.transitionId === 't_cut')!;
    const caseOfCut = firstCut.type === 'complete' ? firstCut.caseIds[0]! : '';
    const shipOfCase = events.find(
      (e) => e.type === 'complete' && e.transitionId === 't_ship' && e.caseIds[0] === caseOfCut,
    );
    expect(shipOfCase!.t - firstCut.t).toBeGreaterThan(15 * 60);
    // Only frames are cases: one per order, none for deliveries, recycling or the initial stock.
    const orders = events.filter((e) => e.type === 'start' && e.transitionId === 't_order');
    expect(events.filter((e) => e.type === 'spawn')).toHaveLength(orders.length);
    expect(metrics.casesInSystem).toBe(
      orders.length - shipped.length - cyclesBefore(events, warmup),
    );
  });

  it('deliveries and recycling are firings without a case, the rest belong to one frame', async () => {
    const { events } = await run(net, 8 * HOUR, 1);
    const caseless = new Set(['t_deliver', 't_recycle']);
    for (const event of events) {
      if (event.type !== 'start' && event.type !== 'complete') continue;
      if (caseless.has(event.transitionId)) expect(event.caseIds).toEqual([]);
      else expect(event.caseIds).toHaveLength(1);
    }
    expect(events.some((e) => e.type === 'start' && e.transitionId === 't_deliver')).toBe(true);
    expect(events.some((e) => e.type === 'start' && e.transitionId === 't_recycle')).toBe(true);
  });

  it('gives the same events and figures for the same seed', async () => {
    const a = await run(net, 4 * HOUR, 7);
    const b = await run(net, 4 * HOUR, 7);
    const c = await run(net, 4 * HOUR, 8);
    expect(b.events).toEqual(a.events);
    expect(b.metrics).toEqual(a.metrics);
    expect(c.events).not.toEqual(a.events);
  });

  it('replays the log of a run with fitness 1, without deviations and with the same amounts', async () => {
    const seconds = 8 * HOUR;
    const engine = await run(net, seconds, 1);
    const log = logOf(engine.events, net);
    // The log has no row of a delivery or of recycling.
    expect(
      log.some((row) => ['Primärstahl anliefern', 'Schrott aufbereiten'].includes(row.activity)),
    ).toBe(false);
    const replay = createReplay(net, log, { mapping: identityMapping(net) });
    const played = await playOut(replay, seconds);
    expect(played.events.filter((e) => e.type === 'deviation' || e.type === 'warning')).toEqual([]);
    const metrics = replay.metrics();
    expect(metrics.replay).toMatchObject({ fitness: 1, missing: 0, remaining: 0, ignored: 0 });
    expect(metrics.completedCases).toBe(engine.metrics.completedCases);
    expect(metrics.casesInSystem).toBe(engine.metrics.casesInSystem);
    expect(metrics.meanCycleTime).toBe(engine.metrics.meanCycleTime);
    // The tube that frames take is the same in both; deliveries and recycling are not in the log,
    // so the replay knows only the CO2 of the frames themselves.
    expect(indicator(metrics, 'material')).toBeCloseTo(indicator(engine.metrics, 'material')!, 9);
    expect(indicator(metrics, 'co2-per-frame')!).toBeLessThan(
      indicator(engine.metrics, 'co2-per-frame')!,
    );
    expect(indicator(metrics, 'co2-per-frame')!).toBeGreaterThan(7);
    // No stock is negative, and CO2 from the frames only is below that of the whole plant.
    for (const place of metrics.places) expect(place.current).toBeGreaterThanOrEqual(0);
    expect(replay.state.marking['p_co2']!.length).toBeLessThan(
      engine.sim.state.marking['p_co2']!.length,
    );
  });
});

/** Frames that were shipped before the warm-up ended: they were born and left already. */
function cyclesBefore(events: SimEvent[], warmup: number): number {
  return events.filter((e) => e.type === 'complete' && e.transitionId === 't_ship' && e.t < warmup)
    .length;
}
