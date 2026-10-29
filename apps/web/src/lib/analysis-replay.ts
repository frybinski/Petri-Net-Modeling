import type { Marking } from '@pnm/core';
import type { Step } from '@pnm/analysis';
import { useEditorStore } from '../store/editor-store';

/** Starts the replay of a recorded run in the simulation and plays it step by step. */
export function playTrace(label: string, steps: Step[], target: Marking | null): void {
  void useEditorStore
    .getState()
    .startReplay({ label, steps, target })
    .then(() => {
      useEditorStore.getState().setReplayPlaying(true);
    });
}

/** Shows the net after the first `count` steps of a recorded run, at once. */
export function showAfter(
  label: string,
  steps: Step[],
  count: number,
  target: Marking | null,
): void {
  void useEditorStore.getState().startReplay({
    label,
    steps: steps.slice(0, count),
    target,
    immediate: true,
  });
}
