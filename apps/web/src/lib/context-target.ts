import type { Id } from '@pnm/core';
import { useEditorStore } from '../store/editor-store';
import { useUiStore } from '../store/ui-store';

/**
 * Records a right click on a node or an arc. The element joins the selection, unless it already is
 * part of it; a click on a member of a larger selection opens the menu of the whole selection.
 */
export function targetElement(id: Id, kind: 'node' | 'edge'): void {
  const store = useEditorStore.getState();
  if (!store.selection.includes(id)) store.select([id]);
  const group = useEditorStore.getState().selection.length > 1;
  useUiStore.getState().setMenuTarget(group ? { kind: 'selection' } : { kind, id });
}
