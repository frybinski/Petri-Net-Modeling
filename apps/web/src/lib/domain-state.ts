import type { LayoutState } from '@pnm/domain';
import { useEditorStore } from '../store/editor-store';

/** The layout state of the running simulation, or null while the editor is not simulating. */
export function currentSimState(): LayoutState | null {
  const s = useEditorStore.getState();
  if (s.mode !== 'simulate' || s.simMarking === null) return null;
  return { time: s.simTime, marking: s.simMarking, meta: s.simMeta, running: s.simRunning };
}
