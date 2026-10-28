import 'fake-indexeddb/auto';
import { createEmptyNet, serializeNet } from '@pnm/core';
import { set } from 'idb-keyval';
import { beforeEach, describe, expect, it } from 'vitest';
import { selectIsDirty, useEditorStore } from '../store/editor-store';
import { useUiStore } from '../store/ui-store';
import { clearAutosave, restoreAutosave, writeAutosave } from './autosave';

beforeEach(async () => {
  await clearAutosave();
  useEditorStore.getState().newNet();
  useUiStore.setState({ toasts: [] });
});

describe('autosave', () => {
  it('has nothing to restore at first', async () => {
    expect(await restoreAutosave()).toBe(false);
  });

  it('writes the document and restores it as unsaved work', async () => {
    useEditorStore.getState().renameNet('Work in progress');
    useEditorStore.getState().addPlace({ x: 0, y: 0 });
    await writeAutosave();
    useEditorStore.getState().newNet();
    expect(useEditorStore.getState().net.places).toHaveLength(0);

    expect(await restoreAutosave()).toBe(true);
    const state = useEditorStore.getState();
    expect(state.net.name).toBe('Work in progress');
    expect(state.net.places).toHaveLength(1);
    expect(selectIsDirty(state)).toBe(true);
    expect(useUiStore.getState().toasts.at(-1)?.message).toMatch(/Restored/);
  });

  it('the restore notice offers to start fresh', async () => {
    useEditorStore.getState().addPlace({ x: 0, y: 0 });
    await writeAutosave();
    await restoreAutosave();
    useUiStore.getState().toasts.at(-1)?.action?.run();
    expect(useEditorStore.getState().net.places).toHaveLength(0);
  });

  it('does not restore empty nets or damaged records', async () => {
    await writeAutosave();
    expect(await restoreAutosave()).toBe(false);
    await set('pnm:autosave', { text: '{ broken', fileName: null, dirty: true, savedAt: 1 });
    expect(await restoreAutosave()).toBe(false);
    await set('pnm:autosave', {
      text: serializeNet(createEmptyNet('x')),
      fileName: null,
      dirty: false,
      savedAt: 1,
    });
    expect(await restoreAutosave()).toBe(false);
  });
});
