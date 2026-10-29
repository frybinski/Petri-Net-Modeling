import { createEmptyNet, type PetriNet } from '@pnm/core';
import type { SimEvent } from '@pnm/sim';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setSimulationClientFactory } from '../lib/sim-client';
import { useEditorStore } from './editor-store';
import { LOG_LIMIT, eventLog, onSimEvents } from './sim-log';
import { useUiStore } from './ui-store';

const store = () => useEditorStore.getState();

const settled = () =>
  vi.waitFor(() => {
    expect(store().computing).toBe(false);
  });

/** arrive (240/h) -> wait -> serve (20 s, one clerk) -> done */
function shop(): PetriNet {
  const net = createEmptyNet('Shop');
  for (const id of ['wait', 'clerk', 'done']) {
    net.places.push({ id, name: id, position: { x: 0, y: 0 } });
  }
  net.marking['clerk'] = [1];
  net.transitions.push(
    { id: 'arrive', name: 'Arrive', position: { x: 0, y: 0 }, rate: 240 },
    {
      id: 'serve',
      name: 'Serve',
      position: { x: 0, y: 0 },
      timing: { kind: 'fixed', value: 20 },
    },
  );
  const arcs: Array<[string, string]> = [
    ['arrive', 'wait'],
    ['wait', 'serve'],
    ['clerk', 'serve'],
    ['serve', 'clerk'],
    ['serve', 'done'],
  ];
  arcs.forEach(([source, target], i) => net.arcs.push({ id: `a${i}`, source, target, weight: 1 }));
  net.simulation = { seed: 4, caseIdPrefix: 'S-' };
  return net;
}

/** Five parcels, one worker: a finite run. */
function finite(): PetriNet {
  const net = shop();
  net.transitions = net.transitions.filter((t) => t.id !== 'arrive');
  net.arcs = net.arcs.filter((a) => a.source !== 'arrive');
  net.places.push({ id: 'in', name: 'in', position: { x: 0, y: 0 } });
  net.marking['in'] = [1, 1, 1];
  net.arcs = net.arcs.map((a) => (a.source === 'wait' ? { ...a, source: 'in' } : a));
  net.places = net.places.filter((p) => p.id !== 'wait');
  return net;
}

beforeEach(() => {
  store().loadNet(shop(), null);
  useUiStore.setState({ toasts: [] });
});

afterEach(() => {
  store().stopSimulation();
  vi.useRealTimers();
  setSimulationClientFactory();
});

describe('a click right after the switch to the simulation', () => {
  it('is kept until the engine has answered and then fires the transition', async () => {
    void store().startSimulation();
    expect(store().computing).toBe(true);
    // The arrival transition is not known to be enabled yet: this click used to be lost.
    store().fireTransition('arrive');
    await vi.waitFor(() => {
      expect(store().simHistory.map((h) => h.transitionId)).toEqual(['arrive']);
    });
    await settled();
    expect(store().simMetrics?.casesInSystem).toBe(1);
  });

  it('keeps only the last of several clicks', async () => {
    void store().startSimulation();
    store().fireTransition('serve');
    store().fireTransition('arrive');
    await vi.waitFor(() => {
      expect(store().simHistory).toHaveLength(1);
    });
    await settled();
    expect(store().simHistory.map((h) => h.transitionId)).toEqual(['arrive']);
  });

  it('is dropped when the simulation is stopped before the answer', async () => {
    void store().startSimulation();
    store().fireTransition('arrive');
    store().stopSimulation();
    store().startSimulation();
    await settled();
    expect(store().simHistory).toHaveLength(0);
  });

  it('does not queue clicks later on, while a command is under way', async () => {
    store().startSimulation();
    await settled();
    void store().stepRandom();
    expect(store().computing).toBe(true);
    store().fireTransition('arrive');
    await settled();
    expect(store().simHistory.filter((h) => h.transitionName === 'Arrive').length).toBeLessThan(2);
  });
});

describe('timed simulation in the store', () => {
  it('starts timed nets at 10x with the clock at zero', async () => {
    store().startSimulation();
    await settled();
    expect(store()).toMatchObject({ simTimed: true, simSpeed: 10, simTime: 0, simPlaying: false });
    expect(store().simMetrics?.casesInSystem).toBe(0);
    // The arrival transition is enabled and can be clicked to inject a case.
    expect([...store().enabled.keys()]).toEqual(['arrive']);
  });

  it('advances the clock while playing, scaled by the speed, and stops on pause', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    store().startSimulation();
    await settled();
    store().setSimSpeed(10);
    store().setPlaying(true);
    expect(store().simPlaying).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    const first = store().simTime;
    // One wall-clock second at 10x is about ten simulated seconds.
    expect(first).toBeGreaterThan(6);
    expect(first).toBeLessThan(14);
    expect(store().simMetrics?.casesInSystem).toBeGreaterThanOrEqual(0);
    store().setPlaying(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(store().simTime).toBeCloseTo(first, 6);
  });

  it('never advances more than 100 ms times the speed per tick', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    store().startSimulation();
    await settled();
    store().setSimSpeed(5);
    store().setPlaying(true);
    // A long pause of the page (the timer fires once, late) must not make the clock jump.
    vi.setSystemTime(Date.now());
    await vi.advanceTimersByTimeAsync(40);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(store().simTime).toBeLessThanOrEqual(5 * 0.1 * (10_000 / 40 + 2));
    store().setPlaying(false);
  });

  it('follows the speed that is chosen while playing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    store().startSimulation();
    await settled();
    store().setSimSpeed(1);
    store().setPlaying(true);
    await vi.advanceTimersByTimeAsync(1000);
    const slow = store().simTime;
    store().setSimSpeed(60);
    await vi.advanceTimersByTimeAsync(1000);
    expect(store().simTime - slow).toBeGreaterThan(20 * Math.max(slow, 0.5));
    store().setPlaying(false);
  });

  it('runs bundles of events at maximum speed', async () => {
    store().startSimulation();
    await settled();
    store().setSimSpeed('max');
    store().setPlaying(true);
    await vi.waitFor(() => {
      expect(store().simTime).toBeGreaterThan(600);
    });
    store().setPlaying(false);
    expect(eventLog.length).toBeGreaterThan(50);
  });

  it('steps to the next event, steps back and resets', async () => {
    store().startSimulation();
    await settled();
    await store().stepNext();
    expect(store().simTime).toBeGreaterThan(0);
    expect(eventLog.length).toBeGreaterThan(0);
    expect(store().simCanBack).toBe(true);
    const time = store().simTime;
    await store().stepNext();
    expect(store().simTime).toBeGreaterThan(time);
    await store().stepBack();
    expect(store().simTime).toBe(time);
    // The event log and the history follow the state that was restored.
    const lastId = eventLog.all().at(-1)?.id ?? 0;
    expect(lastId).toBeLessThanOrEqual(store().simLogVersion + 1000);
    await store().stepBack();
    expect(store().simTime).toBe(0);
    expect(store().simCanBack).toBe(false);
    await store().stepNext();
    await store().resetSimulation();
    expect(store().simTime).toBe(0);
    expect(store().simHistory).toEqual([]);
    expect(eventLog.length).toBe(0);
  });

  it('removes the events and steps of a state that was stepped back from', async () => {
    store().startSimulation();
    await settled();
    await store().stepNext();
    await store().stepNext();
    await store().stepNext();
    const before = eventLog.length;
    const stepsBefore = store().simHistory.length;
    await store().stepBack();
    expect(eventLog.length).toBeLessThan(before);
    expect(store().simHistory.length).toBeLessThanOrEqual(stepsBefore);
    const kept = eventLog.all();
    for (let i = 1; i < kept.length; i += 1) expect(kept[i]!.id).toBeGreaterThan(kept[i - 1]!.id);
  });

  it('pauses at a breakpoint and selects the element', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    store().startSimulation();
    await settled();
    store().toggleTransitionBreakpoint('serve');
    expect(store().simBreakpoints.transitions).toEqual(['serve']);
    store().setSimSpeed(60);
    store().setPlaying(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(store().simPlaying).toBe(false);
    expect(store().selection).toEqual(['serve']);
    expect(useUiStore.getState().toasts.at(-1)?.message).toMatch(/Paused at Serve/);
    // The breakpoint is right after the first start of the transition.
    const starts = eventLog.all().filter((e) => e.type === 'start' && e.transitionId === 'serve');
    expect(starts).toHaveLength(1);
  });

  it('pauses when a place reaches the number of tokens', async () => {
    store().startSimulation();
    await settled();
    store().setPlaceBreakpoint('wait', 3);
    expect(store().simBreakpoints.places).toEqual({ wait: 3 });
    store().setSimSpeed('max');
    store().setPlaying(true);
    await vi.waitFor(() => {
      expect(store().simPlaying).toBe(false);
    });
    expect(store().simMarking?.['wait']).toHaveLength(3);
    store().setPlaceBreakpoint('wait', null);
    expect(store().simBreakpoints.places).toEqual({});
  });

  it('keeps breakpoints for elements that still exist when a new run starts', async () => {
    store().startSimulation();
    await settled();
    store().toggleTransitionBreakpoint('serve');
    store().stopSimulation();
    expect(store().simBreakpoints.transitions).toEqual(['serve']);
    store().startSimulation();
    await settled();
    expect(store().simBreakpoints.transitions).toEqual(['serve']);
    store().loadNet(shop(), null);
    expect(store().simBreakpoints.transitions).toEqual([]);
  });

  it('pauses with a message when nothing is left to do', async () => {
    store().loadNet(finite(), null);
    store().startSimulation();
    await settled();
    store().setSimSpeed('max');
    store().setPlaying(true);
    await vi.waitFor(() => {
      expect(store().simPlaying).toBe(false);
    });
    expect(store().simIdle).toBe(true);
    expect(store().simMarking?.['done']).toHaveLength(3);
    expect(useUiStore.getState().toasts.at(-1)?.message).toMatch(/Nothing left to simulate/);
  });

  it('lets the user fire a source transition and change arrival rate and resources', async () => {
    store().startSimulation();
    await settled();
    store().fireTransition('arrive');
    await settled();
    expect(store().simHistory.map((s) => s.transitionName)).toEqual(['Arrive']);
    expect(store().simMarking?.['wait']).toHaveLength(1);
    store().setArrivalRate('arrive', 0);
    await settled();
    expect(store().simRates['arrive']).toBeNull();
    store().adjustPlaceTokens('clerk', 1);
    await settled();
    expect(store().simMarking?.['clerk']).toHaveLength(2);
    store().adjustPlaceTokens('clerk', -1);
    store().adjustPlaceTokens('clerk', -1);
    await settled();
    expect(store().simMarking?.['clerk']).toBeUndefined();
  });

  it('publishes the events of every answer to the listeners', async () => {
    const seen: string[] = [];
    const off = onSimEvents((events) => {
      for (const e of events) seen.push(e.type);
    });
    store().startSimulation();
    await settled();
    store().fireTransition('arrive');
    await settled();
    off();
    expect(seen).toEqual(['spawn', 'start', 'complete']);
  });

  it('reports engine errors and drops answers of a stopped simulation', async () => {
    store().startSimulation();
    await settled();
    const error = vi.fn();
    setSimulationClientFactory(() => {
      throw new Error('no client');
    });
    store().stopSimulation();
    expect(store().mode).toBe('edit');
    expect(error).not.toHaveBeenCalled();
    // Stopping while a command is under way leaves no trace.
    setSimulationClientFactory();
    store().startSimulation();
    const pending = store().stepNext();
    store().stopSimulation();
    await pending;
    expect(store().simMarking).toBeNull();
    expect(store().computing).toBe(false);
  });

  it('keeps the document unchanged by the simulation', async () => {
    const before = store().net;
    store().startSimulation();
    await settled();
    await store().stepNext();
    store().stopSimulation();
    expect(store().net).toBe(before);
  });
});

describe('document changes stop the simulation', () => {
  it('loading another net ends the run', async () => {
    store().startSimulation();
    await settled();
    store().setPlaying(true);
    store().loadNet(createEmptyNet('other'), null);
    expect(store().mode).toBe('edit');
    expect(store().simPlaying).toBe(false);
    expect(eventLog.length).toBe(0);
  });
});

describe('the limit of the event log', () => {
  const event = (id: number): SimEvent => ({ id, type: 'idle', t: id }) as SimEvent;

  it('tells once that older events are dropped, and again after a reset', () => {
    eventLog.clear();
    const batch = Array.from({ length: LOG_LIMIT }, (_, i) => event(i));
    expect(eventLog.push(batch)).toBe(false);
    // One more event is over the limit: the oldest are dropped and the caller hears about it.
    expect(eventLog.push([event(LOG_LIMIT)])).toBe(true);
    expect(eventLog.dropped).toBeGreaterThan(0);
    expect(eventLog.length).toBeLessThanOrEqual(LOG_LIMIT);
    // From then on it keeps quiet, however often it drops.
    let again = false;
    for (let i = 0; i < 40_000; i += 1000) {
      again ||= eventLog.push(Array.from({ length: 1000 }, (_, k) => event(LOG_LIMIT + 1 + i + k)));
    }
    expect(again).toBe(false);
    eventLog.clear();
    expect(eventLog.push(batch)).toBe(false);
    expect(eventLog.push([event(LOG_LIMIT)])).toBe(true);
    eventLog.clear();
  });

  it('shows one toast when a simulation fills the log', async () => {
    store().startSimulation();
    await settled();
    // Fill the log from the outside, then let the engine add an event.
    eventLog.push(
      Array.from({ length: LOG_LIMIT }, (_, i) => ({ id: -i - 1, type: 'idle', t: 0 }) as SimEvent),
    );
    await store().stepRandom();
    await settled();
    const toasts = useUiStore.getState().toasts.filter((t) => /event log is full/.test(t.message));
    expect(toasts).toHaveLength(1);
  });
});
