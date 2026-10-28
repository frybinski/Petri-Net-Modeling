import { createSimulation, type SimEvent } from '@pnm/sim';
import { layoutStateOf, type DomainView } from '@pnm/domain';
import { describe, expect, it } from 'vitest';
import { loadExample } from '../test/domain-fixtures';
import { DomainAnimator } from './domain-animator';

const parcel = loadExample('parcel-center');
const view = parcel.domainView as DomainView;

/** The animator fed bundle by bundle from a running simulation, like the store does. */
async function run(seconds: number, bundle: number, animator = new DomainAnimator()) {
  const sim = createSimulation(parcel);
  animator.setModel(parcel, view, layoutStateOf(sim.state));
  const events: SimEvent[] = [];
  let now = 1000;
  for (let t = 0; t < seconds; t += bundle) {
    const batch = await sim.advance(bundle);
    events.push(...batch);
    animator.ingest(batch, layoutStateOf(sim.state), now);
    now += 40;
  }
  return { animator, sim, events, now };
}

describe('DomainAnimator', () => {
  it('has nothing to draw without a view', () => {
    const animator = new DomainAnimator();
    animator.setModel(parcel, null, { time: 0, marking: parcel.marking, running: [] });
    expect(animator.staticScene).toBeNull();
    expect(animator.frame(0, {})).toBeNull();
    // Events that arrive meanwhile are ignored.
    animator.ingest([], { time: 0, marking: {}, running: [] }, 0);
    expect(animator.bundles).toBe(0);
  });

  it('processes the bundles in the order of their arrival', async () => {
    const { animator, events } = await run(900, 6);
    expect(animator.bundles).toBeGreaterThan(100);
    const ids = animator.anim.handled.map((h) => h.eventId);
    expect(ids.length).toBeGreaterThan(50);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
    expect(Math.max(...ids)).toBeLessThanOrEqual(events.length);
  });

  it('draws the sprites of the state and moves them between bundles', async () => {
    const { animator, now } = await run(300, 6);
    const frame = animator.frame(now, {});
    expect(frame).not.toBeNull();
    expect(frame!.sprites.length).toBeGreaterThan(0);
    // Right after a bundle tokens are on their way, later they rest.
    const later = animator.frame(now + 5000, {});
    expect(later!.sprites.every((s) => !s.moving)).toBe(true);
    expect(animator.isAnimating(now + 5000)).toBe(false);
  });

  it('jumps instead of moving when asked to', async () => {
    const instant = new DomainAnimator();
    instant.setInstant(true);
    const { now } = await run(300, 6, instant);
    expect(instant.anim.motions).toEqual([]);
    expect(instant.isAnimating(now)).toBe(false);
    expect(instant.anim.handled.some((h) => h.kind === 'motion')).toBe(true);
  });

  it('snaps to a state without motion and forgets what moved', async () => {
    const { animator, sim, now } = await run(300, 6);
    expect(animator.isAnimating(now - 40)).toBe(true);
    animator.snap(layoutStateOf(sim.state));
    expect(animator.anim.motions).toEqual([]);
    expect(animator.isAnimating(now)).toBe(false);
  });

  it('runs the simulation clock ahead of the last bundle while it plays, but not past the next event', async () => {
    const { animator } = await run(60, 6);
    const base = animator.layout!.time;
    const at = animator.receivedAt;
    const clock = { playing: true, speed: 10 as const, nextEvent: null };
    expect(animator.simTimeAt(at, clock)).toBe(base);
    expect(animator.simTimeAt(at + 100, clock)).toBeCloseTo(base + 1, 5);
    // Never more than a quarter of a second of wall-clock time ahead.
    expect(animator.simTimeAt(at + 5000, clock)).toBeCloseTo(base + 2.5, 5);
    // Never past the next event.
    expect(animator.simTimeAt(at + 100, { ...clock, nextEvent: base + 0.4 })).toBeCloseTo(
      base + 0.4,
      5,
    );
    // Not while paused, at the top speed or without a clock.
    expect(animator.simTimeAt(at + 100, { ...clock, playing: false })).toBe(base);
    expect(animator.simTimeAt(at + 100, { ...clock, speed: 'max' })).toBe(base);
    expect(animator.simTimeAt(at + 100, { ...clock, speed: null })).toBe(base);
  });
});
