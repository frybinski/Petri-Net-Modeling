import { en } from '../i18n/en';
import { useEditorStore } from '../store/editor-store';
import { useUiStore } from '../store/ui-store';

/** Deleting this many elements or more asks for confirmation first. */
export const DELETE_CONFIRM_FROM = 5;

/** Deletes the selection; large selections need a confirmation (undo is available either way). */
export function deleteSelection(): void {
  const state = useEditorStore.getState();
  const count = state.selection.length;
  if (count === 0) return;
  if (state.mode === 'edit' && count >= DELETE_CONFIRM_FROM) {
    useUiStore.getState().askConfirm({
      title: en.properties.deleteConfirmTitle(count),
      message: en.properties.deleteConfirmMessage,
      confirmLabel: en.properties.delete,
      danger: true,
      onConfirm: () => {
        useEditorStore.getState().removeSelected();
      },
    });
    return;
  }
  state.removeSelected();
}
