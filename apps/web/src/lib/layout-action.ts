import type { LayoutDirection } from '@pnm/layout';
import { en } from '../i18n/en';
import { useEditorStore } from '../store/editor-store';
import { notify } from '../store/ui-store';
import { GRID_SIZE, snap } from './geometry';
import { getViewApi } from './view-api';

/** Runs the automatic layout as a single undo step. */
export async function runAutoLayout(direction: LayoutDirection): Promise<void> {
  const store = useEditorStore.getState();
  if (store.mode === 'simulate') {
    notify('info', en.messages.editLocked);
    return;
  }
  const { net } = store;
  if (net.places.length + net.transitions.length === 0) return;
  try {
    // Loaded on demand: the layout engine is large and only needed here.
    const { layoutNet } = await import('@pnm/layout');
    const raw = await layoutNet(net, { direction });
    const positions = Object.fromEntries(
      Object.entries(raw).map(([id, p]) => [
        id,
        { x: snap(p.x, GRID_SIZE / 2), y: snap(p.y, GRID_SIZE / 2) },
      ]),
    );
    // The document may have been replaced while the layout was computed.
    if (useEditorStore.getState().net !== net) return;
    useEditorStore.getState().applyLayout(positions);
    getViewApi()?.fitView();
  } catch (error) {
    notify('error', en.files.layoutFailed, {
      details: [error instanceof Error ? error.message : String(error)],
    });
  }
}
