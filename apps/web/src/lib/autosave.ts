import { createEmptyNet, parseNet, serializeNet, type PetriNet } from '@pnm/core';
import { del, get, set } from 'idb-keyval';
import { en } from '../i18n/en';
import { selectIsDirty, useEditorStore } from '../store/editor-store';
import { notify } from '../store/ui-store';

const KEY = 'pnm:autosave';
export const AUTOSAVE_DELAY_MS = 500;

interface AutosaveRecord {
  /** The net as the text of a `.pn.json` file. */
  text: string;
  fileName: string | null;
  dirty: boolean;
  savedAt: number;
}

function hasContent(net: PetriNet): boolean {
  return net.places.length + net.transitions.length + (net.annotations?.length ?? 0) > 0;
}

export async function writeAutosave(): Promise<void> {
  const state = useEditorStore.getState();
  const record: AutosaveRecord = {
    text: serializeNet(state.net),
    fileName: state.fileName,
    dirty: selectIsDirty(state),
    savedAt: Date.now(),
  };
  try {
    await set(KEY, record);
  } catch {
    // IndexedDB can be unavailable (private mode); autosave is best effort.
  }
}

export async function clearAutosave(): Promise<void> {
  try {
    await del(KEY);
  } catch {
    // best effort
  }
}

/** Restores the last autosaved net, if there is one with content. Returns true if it did. */
export async function restoreAutosave(): Promise<boolean> {
  let record: AutosaveRecord | undefined;
  try {
    record = await get<AutosaveRecord>(KEY);
  } catch {
    return false;
  }
  if (!record) return false;
  try {
    const net = parseNet(JSON.parse(record.text));
    if (!hasContent(net)) return false;
    const store = useEditorStore.getState();
    store.loadNet(net, record.fileName);
    // The autosaved state may differ from the file on disk: keep it marked as unsaved.
    if (record.dirty || record.fileName === null) {
      useEditorStore.setState({ savedNet: createEmptyNet(net.name) });
    }
    notify('info', en.files.restored, {
      action: { label: en.files.discardRestored, run: () => useEditorStore.getState().newNet() },
    });
    return true;
  } catch {
    return false;
  }
}

/** Saves the document to IndexedDB shortly after each change. Returns a stop function. */
export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = useEditorStore.subscribe((state, previous) => {
    if (
      state.net === previous.net &&
      state.fileName === previous.fileName &&
      state.savedNet === previous.savedNet
    ) {
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => {
      void writeAutosave();
    }, AUTOSAVE_DELAY_MS);
  });
  return () => {
    clearTimeout(timer);
    unsubscribe();
  };
}
