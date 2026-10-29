import { createSimulation, type SimEvent } from '@pnm/sim';
import { layoutStateOf, moveEntry, ref, type DomainView } from '@pnm/domain';
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

describe('the preview of a drag', () => {
  const state = { time: 0, marking: parcel.marking, running: [] };
  const moveSorter = (dx: number, dy: number): DomainView =>
    moveEntry(view, ref('transitions', 't_sort'), [dx, dy], { snap: 0, net: parcel });

  it('takes the moved entry out of the static scene and draws it on its own layers', () => {
    const animator = new DomainAnimator();
    animator.setModel(parcel, view, state);
    const whole = animator.staticScene!;
    expect(animator.dragLayers).toBeNull();
    animator.previewView(parcel, moveSorter(40, 24), state);
    const rest = animator.staticScene!;
    const own = animator.dragLayers!;
    const count = (layers: Record<string, readonly unknown[]>) =>
      Object.values(layers).reduce((sum, list) => sum + list.length, 0);
    expect(count(own)).toBeGreaterThan(0);
    expect(count(rest.layers) + count(own)).toBe(count(whole.layers));
    // Hit tests keep working on the whole scene, and the view of the document is untouched.
    expect(rest.hits).toBe(whole.hits);
    expect(animator.view).toBe(view);
  });

  it('keeps the static scene while the pointer goes on, so that it is not rendered again', () => {
    const animator = new DomainAnimator();
    animator.setModel(parcel, view, state);
    animator.previewView(parcel, moveSorter(10, 0), state);
    const rest = animator.staticScene;
    const first = animator.dragLayers;
    animator.previewView(parcel, moveSorter(60, 30), state);
    animator.previewView(parcel, moveSorter(-20, 10), state);
    expect(animator.staticScene).toBe(rest);
    expect(animator.dragLayers).not.toBe(first);
  });

  it('lets another entry join the drag and then leaves the static scene once more', () => {
    const animator = new DomainAnimator();
    animator.setModel(parcel, view, state);
    animator.previewView(parcel, moveSorter(10, 0), state);
    const rest = animator.staticScene;
    const both = moveEntry(moveSorter(10, 0), ref('transitions', 't_scan'), [10, 0], {
      snap: 0,
      net: parcel,
    });
    animator.previewView(parcel, both, state);
    expect(animator.staticScene).not.toBe(rest);
  });

  it('moves the marks of the previewed entry with it', () => {
    const animator = new DomainAnimator();
    animator.setModel(parcel, view, state);
    const before = animator.frame(0, {})!;
    animator.previewView(parcel, moveSorter(200, 100), state);
    const during = animator.frame(0, {})!;
    expect(JSON.stringify(during.layers)).not.toBe(JSON.stringify(before.layers));
  });

  it('ends with the next model of the view', () => {
    const animator = new DomainAnimator();
    animator.setModel(parcel, view, state);
    animator.previewView(parcel, moveSorter(40, 24), state);
    animator.setModel(parcel, view, state);
    expect(animator.dragLayers).toBeNull();
  });
});
