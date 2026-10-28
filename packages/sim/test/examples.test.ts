import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNetText, placeRole, validate, type PetriNet } from '@pnm/core';
import { describe, expect, it } from 'vitest';
import { createSimulation, isTimedNet, type SimEvent } from '../src';

const load = (name: string): PetriNet =>
  parseNetText(
    readFileSync(
      join(import.meta.dirname, '..', '..', '..', 'examples', `${name}.pn.json`),
      'utf8',
    ),
  );

const HOUR = 3600;

/** Runs like the editor at maximum speed: bundles of 200 events until the time is up. */
async function runLikeMax(net: PetriNet, seconds: number, seed?: number) {
  const sim = createSimulation(net, seed === undefined ? {} : { seed });
  const events: SimEvent[] = [...sim.initialEvents];
  while (sim.state.time < seconds) {
    const bundle = await sim.advance(seconds - sim.state.time, { maxEvents: 200 });
    events.push(...bundle);
    if (bundle.some((e) => e.type === 'idle')) break;
  }
  return { sim, events };
}

describe('timed examples', () => {
  const names = ['parcel-center', 'smart-office', 'complaint-handling'];

  for (const name of names) {
    it(`${name} is valid, timed and has no warnings`, () => {
      const net = load(name);
      expect(validate(net)).toEqual([]);
      expect(isTimedNet(net)).toBe(true);
    });
  }

  it('the parcel center has the structure of the mockup', () => {
    const net = load('parcel-center');
    expect(net.places).toHaveLength(12);
    expect(net.transitions).toHaveLength(9);
    expect(net.marking['p_scanner']).toHaveLength(2);
    expect(net.marking['p_sorter']).toHaveLength(1);
    const weights = ['t_rA', 't_rB', 't_rE'].map(
      (id) => net.transitions.find((t) => t.id === id)?.priority,
    );
    expect(weights).toEqual([0.5, 0.35, 0.15]);
    expect(net.transitions.find((t) => t.id === 't_arr')?.rate).toBe(300);
    expect(placeRole(net, 'p_in')).toBe('case');
    expect(placeRole(net, 'p_scanner')).toBe('resource');
    expect(placeRole(net, 'p_done')).toBe('sink');
  });

  it('the smart office has the structure of the mockup', () => {
    const net = load('smart-office');
    expect(net.places).toHaveLength(12);
    expect(net.transitions).toHaveLength(8); // seven stations and the arrival
    expect(net.marking['o_desks']).toHaveLength(8);
    expect(net.marking['o_rooms']).toHaveLength(3);
    expect(net.transitions.find((t) => t.id === 'o_arr')?.rate).toBe(40);
  });

  it('the complaint handling splits and joins cases and decides between two transitions', async () => {
    const net = load('complaint-handling');
    expect(net.places).toHaveLength(8);
    const { sim, events } = await runLikeMax(net, 2 * HOUR);
    const reimbursed = events.filter((e) => e.type === 'complete' && e.transitionId === 't5');
    const rejected = events.filter((e) => e.type === 'complete' && e.transitionId === 't6');
    expect(reimbursed.length).toBeGreaterThan(20);
    expect(rejected.length).toBeGreaterThan(20);
    const done = sim.metrics();
    expect(done.completedCases).toBeGreaterThan(400);
    // Every finished case went through the join exactly once.
    const joins = events.filter((e) => e.type === 'complete' && e.transitionId === 't4');
    expect(joins.length).toBeGreaterThanOrEqual(done.completedCases);
  });

  it('runs the parcel center for two simulated hours at maximum speed in well under 10 seconds', async () => {
    const net = load('parcel-center');
    const started = performance.now();
    const { sim, events } = await runLikeMax(net, 2 * HOUR);
    const elapsed = performance.now() - started;
    expect(sim.state.time).toBe(2 * HOUR);
    expect(events.some((e) => e.type === 'warning')).toBe(false);
    expect(sim.metrics().completedCases).toBeGreaterThan(300);
    expect(elapsed).toBeLessThan(10_000);
  });

  it('runs the smart office for a working day', async () => {
    const net = load('smart-office');
    const { sim, events } = await runLikeMax(net, 8 * HOUR);
    expect(events.some((e) => e.type === 'warning')).toBe(false);
    expect(sim.metrics().completedCases).toBeGreaterThan(100);
    const desks = sim.metrics().resources.find((r) => r.placeId === 'o_desks');
    expect(desks?.utilization).toBeGreaterThan(0.3);
  });

  it('gives the same event stream for the same seed', async () => {
    const net = load('parcel-center');
    const a = await runLikeMax(net, HOUR, 7);
    const b = await runLikeMax(net, HOUR, 7);
    const c = await runLikeMax(net, HOUR, 8);
    expect(b.events).toEqual(a.events);
    expect(c.events).not.toEqual(a.events);
  });

  it('never puts more than one parcel through a station than it has workers for', async () => {
    const net = load('parcel-center');
    const sim = createSimulation(net, { seed: 2 });
    let maxScans = 0;
    let maxSorts = 0;
    while (sim.state.time < HOUR) {
      await sim.advance(60);
      const running = (id: string) => sim.state.running.filter((f) => f.transitionId === id).length;
      maxScans = Math.max(maxScans, running('t_scan'));
      maxSorts = Math.max(maxSorts, running('t_sort'));
    }
    expect(maxScans).toBe(2);
    expect(maxSorts).toBe(1);
  });
});
