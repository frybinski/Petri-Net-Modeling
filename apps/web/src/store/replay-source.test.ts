import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setSimulationClientFactory } from '../lib/sim-client';
import { fittingLog, overlappingLog, replayLogOf, shop } from '../test/replay-fixtures';
import { DEVIATION_RING_MS, registerLogFileRequest, useEditorStore } from './editor-store';
import { eventLog } from './sim-log';
import { useReplayStore } from './replay-store';
import { useUiStore } from './ui-store';

const store = () => useEditorStore.getState();

const settled = () =>
  vi.waitFor(() => {
    expect(store().computing).toBe(false);
  });

/** Plays a replay to its end, a step at a time. */
async function playToEnd(): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    await store().stepNext();
    await settled();
    if (store().simIdle) return;
  }
  throw new Error('the replay did not end');
}

beforeEach(() => {
  store().loadNet(shop(), null);
  useUiStore.setState({ toasts: [] });
});

afterEach(() => {
  store().stopSimulation();
  registerLogFileRequest(null);
  vi.useRealTimers();
  setSimulationClientFactory();
});

describe('the source of the simulation', () => {
  it('starts with the engine, and the switch asks for a file while no log is loaded', async () => {
    await store().startSimulation();
    expect(store()).toMatchObject({ simSource: 'engine', simSourceName: null });
    expect(store().simMetrics?.replay).toBeUndefined();
    const ask = vi.fn();
    registerLogFileRequest(ask);
    store().setSimSource('log');
    expect(ask).toHaveBeenCalledTimes(1);
    // Nothing changed meanwhile.
    expect(store().simSource).toBe('engine');
  });

  it('replays the loaded log: the clock, the marking and the figures follow the log', async () => {
    await store().startLogReplay(replayLogOf(fittingLog()));
    await settled();
    expect(store()).toMatchObject({
      mode: 'simulate',
      simSource: 'log',
      simSourceName: 'shop.csv',
      simTimed: true,
      simSpeed: 60,
      simTime: 0,
    });
    expect(store().simMetrics?.replay).toMatchObject({ processed: 0, total: 12, fitness: null });
    // The engine's controls have nothing to do: nothing is enabled, no rate, no resource to change.
    expect(store().enabled.size).toBe(0);
    expect(store().simRates).toEqual({});

    await store().stepNext();
    await settled();
    expect(store().simTime).toBe(0);
    expect(store().simMarking?.['wait']).toHaveLength(1);

    await playToEnd();
    expect(store().simTime).toBe(30 + 1 + 10 - 10 + 0);
    expect(store().simMarking?.['done']).toHaveLength(3);
    expect(store().simMarking?.['clerk']).toHaveLength(1);
    expect(store().simMetrics?.replay).toMatchObject({
      fitness: 1,
      missing: 0,
      remaining: 0,
      processed: 12,
      total: 12,
    });
    expect(store().simMetrics?.completedCases).toBe(3);
    // The trace has the events of the replay, and no deviation.
    expect(eventLog.all().filter((e) => e.type === 'deviation')).toEqual([]);
    expect(eventLog.all().some((e) => e.type === 'complete')).toBe(true);
  });

  it('goes back and starts over like the engine does', async () => {
    await store().startLogReplay(replayLogOf(fittingLog()));
    await settled();
    await store().stepNext();
    await settled();
    await store().stepNext();
    await settled();
    const time = store().simTime;
    expect(store().simCanBack).toBe(true);
    await store().stepBack();
    await settled();
    expect(store().simTime).toBeLessThan(time);
    await store().resetSimulation();
    await settled();
    expect(store().simTime).toBe(0);
    expect(store().simMetrics?.replay?.processed).toBe(0);
  });

  it('switches between the sources and keeps the log for the way back', async () => {
    await store().startSimulation();
    await settled();
    useReplayStore.getState().setLog(replayLogOf(fittingLog()));
    store().setSimSource('log');
    await vi.waitFor(() => {
      expect(store().simSource).toBe('log');
    });
    await settled();
    expect(store().simMetrics?.replay).toBeDefined();
    store().setSimSource('engine');
    await vi.waitFor(() => {
      expect(store().simSource).toBe('engine');
    });
    await settled();
    expect(store().simMetrics?.replay).toBeUndefined();
    store().setSimSource('log');
    await vi.waitFor(() => {
      expect(store().simSource).toBe('log');
    });
    // Another document does not keep a log that was mapped to the old net.
    store().loadNet(shop(), null);
    expect(useReplayStore.getState().log).toBeNull();
    expect(store().mode).toBe('edit');
    expect(store().simSource).toBe('engine');
  });

  it('does not play on after the log has ended, and says so', async () => {
    await store().startLogReplay(replayLogOf(fittingLog()));
    await settled();
    store().setSimSpeed('max');
    store().setPlaying(true);
    await vi.waitFor(() => {
      expect(store().simPlaying).toBe(false);
    });
    expect(store().simIdle).toBe(true);
    expect(useUiStore.getState().toasts.at(-1)?.message).toMatch(/replayed to its end/);
    expect(store().simMetrics?.replay?.processed).toBe(12);
  });
});

describe('deviations in the store', () => {
  it('counts the created token, lets the place flash for a second and logs the deviation', async () => {
    await store().startLogReplay(replayLogOf(overlappingLog()));
    await settled();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    // Step to the instant of the second start at the one clerk.
    for (let i = 0; i < 4; i += 1) {
      await store().stepNext();
      await vi.waitFor(() => {
        expect(store().computing).toBe(false);
      });
    }
    const stats = store().simMetrics?.replay;
    expect(stats?.missing).toBe(1);
    expect(stats?.missingByPlace).toEqual({ clerk: 1 });
    expect(stats?.fitness).toBeLessThan(1);
    expect(Object.keys(store().simDeviationRing)).toEqual(['clerk']);
    const deviation = eventLog.all().find((e) => e.type === 'deviation');
    expect(deviation).toMatchObject({ kind: 'missing', placeId: 'clerk', caseId: 'c2' });

    await vi.advanceTimersByTimeAsync(DEVIATION_RING_MS + 50);
    expect(store().simDeviationRing).toEqual({});
    // The count stays, for the hover card.
    expect(store().simMetrics?.replay?.missingByPlace).toEqual({ clerk: 1 });
  });

  it('a newer ring is not ended by the timeout of an older one', async () => {
    await store().startLogReplay(
      replayLogOf([
        ...overlappingLog(),
        { caseId: 'c3', activity: 'Arrive', time: 4, lifecycle: 'complete' },
        { caseId: 'c3', activity: 'Serve', time: 5, lifecycle: 'start' },
        { caseId: 'c3', activity: 'Serve', time: 15, lifecycle: 'complete' },
      ]),
    );
    await settled();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    for (let i = 0; i < 4; i += 1) {
      await store().stepNext();
      await vi.waitFor(() => {
        expect(store().computing).toBe(false);
      });
    }
    await vi.advanceTimersByTimeAsync(DEVIATION_RING_MS - 300);
    expect(Object.keys(store().simDeviationRing)).toEqual(['clerk']);
    await store().stepNext();
    await vi.waitFor(() => {
      expect(store().computing).toBe(false);
    });
    await store().stepNext();
    await vi.waitFor(() => {
      expect(store().computing).toBe(false);
    });
    expect(store().simMetrics?.replay?.missing).toBe(2);
    // The first timeout ends here; the ring of the second token is still there.
    await vi.advanceTimersByTimeAsync(400);
    expect(Object.keys(store().simDeviationRing)).toEqual(['clerk']);
    await vi.advanceTimersByTimeAsync(DEVIATION_RING_MS);
    expect(store().simDeviationRing).toEqual({});
  });
});

describe('the live source', () => {
  const pnm = () => (window as unknown as { pnm?: { live?: LiveApi } }).pnm;
  interface LiveApi {
    push(events: unknown[]): Promise<void>;
    close(): Promise<void>;
    help: string;
  }

  it('offers window.pnm.live while it is active and takes it away again', async () => {
    expect(pnm()?.live).toBeUndefined();
    await store().startSimulation();
    await settled();
    expect(pnm()?.live).toBeUndefined();
    await store().startLiveFeed();
    await settled();
    expect(store()).toMatchObject({ simSource: 'live', simTimed: true, simPlaying: true });
    expect(typeof pnm()?.live?.push).toBe('function');
    expect(pnm()?.live?.help).toContain('window.pnm.live.push');
    store().setSimSource('engine');
    await vi.waitFor(() => {
      expect(store().simSource).toBe('engine');
    });
    expect(pnm()?.live).toBeUndefined();
    await store().startLiveFeed();
    await settled();
    expect(pnm()?.live).toBeDefined();
    store().stopSimulation();
    expect(pnm()?.live).toBeUndefined();
  });

  it('shows tokens when events are pushed from the console, and ends the feed', async () => {
    await store().startLiveFeed();
    await settled();
    store().setSimSpeed('max');
    await pnm()!.live!.push([
      { case: 'c1', activity: 'Arrive', lifecycle: 'complete', time: 1 },
      { case: 'c1', activity: 'serve', lifecycle: 'start', time: 2 },
    ]);
    await vi.waitFor(() => {
      expect(store().simMarking?.['clerk'] ?? []).toHaveLength(0);
      expect(store().simRunning.map((f) => f.transitionId)).toEqual(['serve']);
    });
    expect(store().simMetrics?.replay?.fitness).toBe(1);
    await pnm()!.live!.push([{ caseId: 'c1', activity: 'Serve', time: 5 }]);
    await vi.waitFor(() => {
      expect(store().simMarking?.['done']).toHaveLength(1);
    });
    expect(store().simMarking?.['clerk']).toHaveLength(1);
    // An event without a time happens now.
    await pnm()!.live!.push([{ case: 'c2', activity: 'Arrive' }]);
    await vi.waitFor(() => {
      expect(store().simMarking?.['wait']).toHaveLength(1);
    });
    expect(store().simIdle).toBe(true);
    // A live feed that is waiting keeps playing.
    expect(store().simPlaying).toBe(true);

    await pnm()!.live!.close();
    expect(store().simFeedClosed).toBe(true);
    await expect(pnm()!.live!.push([{ case: 'c3', activity: 'Arrive' }])).rejects.toThrow(/closed/);
  });

  it('refuses events without a case or an activity, and pushes outside the live source', async () => {
    await store().startLiveFeed();
    await settled();
    await expect(pnm()!.live!.push([{ activity: 'Arrive' }])).rejects.toThrow(/needs a "case"/);
    store().stopSimulation();
    await expect(store().pushLiveEvents([])).rejects.toThrow(/not active/);
  });

  it('skips activities that match no transition and reports them as deviations', async () => {
    await store().startLiveFeed();
    await settled();
    await pnm()!.live!.push([{ case: 'c1', activity: 'Gossip', time: 1 }]);
    await vi.waitFor(() => {
      expect(store().simMetrics?.replay?.ignored).toBe(1);
    });
  });
});
