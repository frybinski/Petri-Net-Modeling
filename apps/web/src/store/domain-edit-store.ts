import type { EntryRef, Point } from '@pnm/domain';
import { create } from 'zustand';
import { useEditorStore } from './editor-store';

/** What was right-clicked in the domain view in the mode "Edit layout". */
export interface DomainMenuTarget {
  /** The entry under the pointer, or `null` on the empty sheet. */
  entry: EntryRef | null;
  /** Where the pointer was, in sheet pixels. */
  at: Point;
}

interface DomainEditState {
  /** Index of the selected piece of decor. Decor is not part of the net, so it has its own selection. */
  decor: number | null;
  /** The entry whose label is being edited in place. */
  renaming: EntryRef | null;
  menu: DomainMenuTarget | null;
  /** Geometry readout of the drag that is going on, for the badge next to the pointer. */
  readout: { text: string; x: number; y: number } | null;
  selectDecor(index: number | null): void;
  startRename(entry: EntryRef | null): void;
  setMenu(target: DomainMenuTarget | null): void;
  setReadout(readout: DomainEditState['readout']): void;
}

export const useDomainEditStore = create<DomainEditState>()((set, get) => ({
  decor: null,
  renaming: null,
  menu: null,
  readout: null,
  selectDecor(index) {
    if (get().decor !== index) set({ decor: index });
  },
  startRename(entry) {
    set({ renaming: entry });
  },
  setMenu(target) {
    set({ menu: target });
  },
  setReadout(readout) {
    set({ readout });
  },
}));

// A selection in the net (or in the other view) replaces the selected piece of decor.
useEditorStore.subscribe((state, previous) => {
  if (state.selection !== previous.selection && state.selection.length > 0) {
    useDomainEditStore.getState().selectDecor(null);
  }
  if (state.docVersion !== previous.docVersion) {
    useDomainEditStore.setState({ decor: null, renaming: null, menu: null });
  }
});
