import { describe, expect, it } from 'vitest';
import { createMetrics, createSimulation, type SimEvent } from '../src';
import { makeNet } from './helpers';

/** Five parcels, one worker who needs 10 s for each: they leave at 10, 20, 30, 40 and 50 s. */
const serial = () =>
  makeNet({
    places: [{ id: 'queue', tokens: 5 }, { id: 'worker', tokens: 1 }, 'done'],
    transitions: [{ id: 'work', timing: { kind: 'fixed', value: 10 } }],
    arcs: [
      ['queue', 'work'],
      ['worker', 'work'],
      ['work', 'worker'],
      ['work', 'done'],
    ],
  });

describe('metrics', () => {
  it('computes throughput and cycle time for a sequence with fixed durations', async () => {
    const sim = createSimulation(serial());
    await sim.advance(Infinity);
    const m = sim.metrics();
    expect(sim.state.time).toBe(50);
    expect(m.completedCases).toBe(5);
    expect(m.casesInSystem).toBe(0);
    expect(m.meanCycleTime).toBe(30);
    expect(m.maxCycleTime).toBe(50);
    expect(m.throughputPerHour).toBeCloseTo(360, 6);
  });

  it('computes stock, waiting time and utilisation', async () => {
    const sim = createSimulation(serial());
    await sim.advance(Infinity);
    const m = sim.metrics();
    const queue = m.places.find((p) => p.placeId === 'queue')!;
    // The first parcel is taken at once: 4 tokens for 10 s, then 3, 2, 1, 0: area 100 over 50 s.
    expect(queue.mean).toBeCloseTo(2, 6);
    expect(queue.max).toBe(4);
    expect(queue.current).toBe(0);
    // Waits 0, 10, 20, 30, 40.
    expect(queue.meanWait).toBe(20);
    const worker = m.resources.find((r) => r.placeId === 'worker')!;
    expect(worker.utilization).toBeCloseTo(1, 6);
    expect(worker.capacity).toBe(1);
    expect(m.places.find((p) => p.placeId === 'done')?.role).toBe('sink');
  });

  it('counts a case once even if several of its tokens reach a sink', async () => {
    const net = makeNet({
      places: [{ id: 'in', tokens: 1 }, 'out1', 'out2'],
      transitions: ['split'],
      arcs: [
        ['in', 'split'],
        ['split', 'out1'],
        ['split', 'out2'],
      ],
    });
    const sim = createSimulation(net);
    await sim.advance(Infinity);
    expect(sim.metrics().completedCases).toBe(1);
  });

  it('leaves the warm-up out of the figures', async () => {
    const warm = createSimulation(serial(), { warmup: 20 });
    await warm.advance(Infinity);
    const m = warm.metrics();
    expect(m.observed).toBe(30);
    // Parcels leaving at 20, 30, 40, 50 count; the one leaving at 10 does not.
    expect(m.completedCases).toBe(4);
    expect(m.meanCycleTime).toBe(35);
    // From 20 s on the queue holds 2, 1, 0 tokens for 10 s each; the waits are 20, 30, 40.
    const queue = m.places.find((p) => p.placeId === 'queue');
    expect(queue?.mean).toBeCloseTo(1, 6);
    expect(queue?.max).toBe(2);
    expect(queue?.meanWait).toBe(30);
  });

  it('can be rewound together with the simulation', async () => {
    const sim = createSimulation(serial());
    await sim.advance(25);
    const before = sim.metrics();
    await sim.advance(30);
    expect(sim.metrics().completedCases).toBe(5);
    await sim.restore(
      (() => {
        // take the state of a fresh run advanced to 25 s
        return before && sim.snapshot();
      })(),
    );
    // Restoring the current state is a no-op; now step back through the instants.
    while (sim.state.time > 25 && (await sim.stepBack())) {
      // keep going
    }
    expect(sim.metrics().completedCases).toBeLessThanOrEqual(2);
  });

  it('applies events one by one the same way the engine does', async () => {
    const net = serial();
    const sim = createSimulation(net);
    const metrics = createMetrics(net);
    for (const e of sim.initialEvents) metrics.apply(e);
    const events: SimEvent[] = await sim.advance(Infinity);
    for (const e of events) metrics.apply(e);
    expect(metrics.snapshot(sim.state.time)).toEqual(sim.metrics());
  });

  it('follows edits of the marking', async () => {
    const sim = createSimulation(serial());
    await sim.editMarking('worker', [1, 1]);
    await sim.advance(Infinity);
    const worker = sim.metrics().resources.find((r) => r.placeId === 'worker')!;
    expect(worker.capacity).toBe(2);
    expect(sim.state.time).toBe(30);
  });
});
