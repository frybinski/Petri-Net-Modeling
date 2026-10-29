import type { PetriNet } from '@pnm/core';
import { analyzeBehaviour, buildStateSpace, checkProperties, type Step } from '@pnm/analysis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listExamples } from '../lib/examples';
import { useEditorStore } from './editor-store';
import { useUiStore } from './ui-store';

const store = () => useEditorStore.getState();

function example(id: string): PetriNet {
  const found = listExamples().find((e) => e.id === id);
  if (!found) throw new Error(`no example ${id}`);
  return found.net;
}

const settled = () =>
  vi.waitFor(() => {
    expect(store().computing).toBe(false);
  });

async function deadlockTrace(net: PetriNet) {
  const space = await buildStateSpace(net);
  const witness = analyzeBehaviour(net, space).deadlocks[0]!;
  return { steps: witness.trace, marking: witness.marking };
}

beforeEach(() => {
  useUiStore.setState({ toasts: [] });
});

afterEach(() => {
  store().stopSimulation();
});

describe('replay of a recorded run', () => {
  it('plays the way into the deadlock of the dining philosophers and reaches the reported marking', async () => {
    const net = example('dining-philosophers-3');
    store().loadNet(net, null);
    const { steps, marking } = await deadlockTrace(net);
    await store().startReplay({ label: 'deadlock', steps, target: marking, immediate: true });
    await settled();
    const replay = store().replay;
    expect(replay).toMatchObject({ position: 3, status: 'done', reached: true });
    expect(store().mode).toBe('simulate');
    expect(store().simUntimed).toBe(true);
    // The three philosophers each hold their left fork.
    const held = net.places.filter((p) => p.name.endsWith('has left fork')).map((p) => p.id);
    for (const id of held) expect(store().simMarking?.[id]).toHaveLength(1);
    expect(store().simHistory.map((s) => s.transitionName)).toEqual([
      'P1 takes left fork',
      'P2 takes left fork',
      'P3 takes left fork',
    ]);
    // Nothing is enabled any more: the deadlock of the analysis is the deadlock of the simulation.
    expect(store().enabled.size).toBe(0);
  });

  it('goes step by step, back, to the start and ends when the user takes over', async () => {
    const net = example('dining-philosophers-3');
    store().loadNet(net, null);
    const { steps, marking } = await deadlockTrace(net);
    await store().startReplay({ label: 'deadlock', steps, target: marking });
    await settled();
    expect(store().replay).toMatchObject({ position: 0, status: 'ready' });

    await store().replayStep();
    expect(store().replay?.position).toBe(1);
    await store().replayStep();
    expect(store().replay?.position).toBe(2);
    await store().stepBack();
    expect(store().replay?.position).toBe(1);
    await store().replayStep();
    await store().replayStep();
    expect(store().replay).toMatchObject({ position: 3, status: 'done', reached: true });

    await store().restartReplay();
    await settled();
    expect(store().replay).toMatchObject({ position: 0, status: 'ready', reached: null });
    expect(store().simHistory).toEqual([]);

    // The user fires a transition by hand: the replay ends, the simulation stays.
    const first = steps[0]!.transitionId;
    store().fireTransition(first);
    await settled();
    expect(store().replay).toBeNull();
    expect(store().mode).toBe('simulate');
  });

  it('plays by itself, one step at a time', async () => {
    const net = example('dining-philosophers-3');
    store().loadNet(net, null);
    const { steps, marking } = await deadlockTrace(net);
    await store().startReplay({ label: 'deadlock', steps: steps.slice(0, 2), target: marking });
    await settled();
    store().setReplayPlaying(true);
    await vi.waitFor(
      () => {
        expect(store().replay?.status).toBe('done');
      },
      { timeout: 8000 },
    );
    // The recorded run ends before the target, so the replay reports that it did not arrive there.
    expect(store().replay).toMatchObject({ position: 2, reached: false });
    expect(store().replayPlaying).toBe(false);
  });

  it('replays a counterexample of a JSON net with its bindings', async () => {
    const net = example('order-processing');
    store().loadNet(net, null);
    const space = await buildStateSpace(net);
    const [result] = await checkProperties(net, space, [
      {
        id: 'p',
        kind: 'declare',
        template: 'precedence',
        activities: ['Reject', 'Create invoice'],
      },
    ]);
    const counter = result!.counterexample!;
    expect(counter.steps.some((s) => s.binding && 'o' in s.binding)).toBe(true);
    await store().startReplay({
      label: 'counterexample',
      steps: counter.steps,
      target: counter.marking,
      immediate: true,
    });
    await settled();
    expect(store().replay).toMatchObject({ position: 9, status: 'done', reached: true });
    expect(store().simMarking?.['invoices']).toHaveLength(5);
  });

  it('ignores durations and arrival rates', async () => {
    const net = example('parcel-center');
    store().loadNet(net, null);
    const delivery = net.transitions.find((t) => t.name === 'Anlieferung')!;
    const scan = net.transitions.find((t) => t.name === 'Scannen')!;
    const steps: Step[] = [{ transitionId: delivery.id }, { transitionId: scan.id }];
    await store().startReplay({ label: 'two steps', steps, immediate: true });
    await settled();
    expect(store().simTimed).toBe(false);
    expect(store().replay).toMatchObject({ position: 2, status: 'done', reached: null });
    const scanned = net.places.find((p) => p.name === 'Gescannt')!;
    expect(store().simMarking?.[scanned.id]).toHaveLength(1);
    // A normal start afterwards is timed again.
    store().stopSimulation();
    await store().startSimulation();
    await settled();
    expect(store().simTimed).toBe(true);
    expect(store().simUntimed).toBe(false);
  });

  it('stops with a message when a step is not possible', async () => {
    const net = example('dining-philosophers-3');
    store().loadNet(net, null);
    const right = net.transitions.find((t) => t.name === 'P1 takes right fork')!;
    await store().startReplay({ label: 'impossible', steps: [{ transitionId: right.id }] });
    await settled();
    await store().replayStep();
    expect(store().replay?.status).toBe('diverged');
    expect(useUiStore.getState().toasts[0]?.message).toContain('P1 takes right fork');
  });

  it('shows the net after the first steps of a run', async () => {
    const net = example('dining-philosophers-3');
    store().loadNet(net, null);
    const { steps } = await deadlockTrace(net);
    await store().startReplay({ label: 'prefix', steps: steps.slice(0, 1), immediate: true });
    await settled();
    expect(store().simHistory).toHaveLength(1);
    expect(store().replay).toMatchObject({ position: 1, status: 'done' });
  });
});
