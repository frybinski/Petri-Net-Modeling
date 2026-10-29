import { createEmptyNet, type PetriNet } from '@pnm/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeServer, type FakeServer } from '../test/fake-server';
import { selectIsDirty, useEditorStore } from '../store/editor-store';
import { useLlmStore } from '../store/llm-store';
import { useServerStore } from '../store/server-store';
import { useUiStore } from '../store/ui-store';
import {
  createProject,
  currentLink,
  detectServer,
  openProject,
  openSharePage,
  openVersion,
  reloadFromServer,
  saveCommand,
  saveToServer,
  startServerMode,
} from './server-actions';
import { SETTINGS_KEY } from './llm-settings';

const editor = () => useEditorStore.getState();
const server = () => useServerStore.getState();
const toast = () => useUiStore.getState().toasts[0];

let fake: FakeServer;

function netWith(name: string, places: number): PetriNet {
  const net = createEmptyNet(name);
  return {
    ...net,
    places: Array.from({ length: places }, (_, i) => ({
      id: `p${i}`,
      name: `p${i}`,
      position: { x: i * 100, y: 0 },
    })),
  };
}

beforeEach(async () => {
  localStorage.clear();
  window.history.pushState({}, '', '/');
  editor().newNet();
  server().setHealth(null);
  server().setLink(null);
  server().setConflict(null);
  server().closeDialog();
  useUiStore.setState({ toasts: [], confirm: null });
  fake = createFakeServer({ name: 'aifb-test', defaultModel: 'fake-model' });
  fake.install();
  await detectServer();
});

afterEach(() => {
  fake.restore();
});

describe('detecting the server', () => {
  it('turns the server mode on and keeps the name', () => {
    expect(server().status).toBe('present');
    expect(server().health?.name).toBe('aifb-test');
  });

  it('stays off where there is none', async () => {
    fake.restore();
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 404 }));
    await detectServer();
    expect(server().status).toBe('absent');
    expect(server().health).toBeNull();
  });

  it('makes the server the language model when nothing was chosen, without storing it', () => {
    expect(useLlmStore.getState().settings).toMatchObject({
      preset: 'server',
      baseUrl: '/llm/v1',
      model: 'fake-model',
    });
    expect(localStorage.getItem(SETTINGS_KEY)).toBeNull();
  });
});

describe('opening a project', () => {
  it('replaces the document, makes it the project and does not call it changed', async () => {
    const id = fake.add('Crossing', netWith('Crossing', 3));
    expect(await openProject(id)).toBe(true);
    expect(editor().net.name).toBe('Crossing');
    expect(editor().net.places).toHaveLength(3);
    expect(selectIsDirty(editor())).toBe(false);
    expect(currentLink()).toMatchObject({ kind: 'project', id, name: 'Crossing', version: 1 });
    expect(toast()?.message).toContain('Opened “Crossing” (version 1)');
  });

  it('says so when the project is gone and leaves the document alone', async () => {
    editor().loadNet(netWith('Mine', 1), null);
    expect(await openProject('00000000-0000-4000-8000-0000000000ff')).toBe(false);
    expect(editor().net.name).toBe('Mine');
    expect(toast()).toMatchObject({ kind: 'error' });
    expect(toast()?.details?.[0]).toContain('does not exist');
  });

  it('loses the link as soon as another document is loaded', async () => {
    const id = fake.add('Crossing');
    await openProject(id);
    expect(currentLink()).not.toBeNull();
    editor().newNet();
    expect(currentLink()).toBeNull();
  });
});

describe('saving', () => {
  it('asks for a name when the document is not a project yet, then makes it one', async () => {
    editor().loadNet(netWith('Fresh', 2), null, { unsaved: true });
    await saveToServer();
    expect(server().dialog).toBe('save');
    expect(server().saveAsCopy).toBe(false);
    expect(fake.calls.filter((c) => c.method === 'POST')).toHaveLength(0);

    expect(await createProject('Fresh project')).toBe(true);
    expect(fake.calls.at(-1)).toMatchObject({ method: 'POST', path: '/api/v1/projects' });
    expect(currentLink()).toMatchObject({ kind: 'project', name: 'Fresh project', version: 1 });
    expect(selectIsDirty(editor())).toBe(false);
    expect(toast()?.message).toContain('Saved “Fresh project” to the server as a new project');
  });

  it('saves the next version of a project with the version it was based on', async () => {
    const id = fake.add('Crossing', netWith('Crossing', 1));
    await openProject(id);
    editor().renameNet('Crossing renamed');
    expect(selectIsDirty(editor())).toBe(true);
    await saveToServer();
    expect(fake.calls.at(-1)).toMatchObject({ method: 'PUT', headers: { 'if-match': '"1"' } });
    expect(currentLink()).toMatchObject({ version: 2, name: 'Crossing renamed' });
    expect(selectIsDirty(editor())).toBe(false);
    expect(fake.projects.get(id)?.versions).toHaveLength(2);
    expect(toast()?.message).toContain('as version 2');
    // And once more.
    editor().renameNet('Crossing 3');
    await saveToServer();
    expect(fake.calls.at(-1)?.headers['if-match']).toBe('"2"');
    expect(currentLink()?.version).toBe(3);
  });

  it('keeps edits made while the save was under way marked as unsaved', async () => {
    const id = fake.add('Crossing');
    await openProject(id);
    editor().renameNet('First edit');
    const pending = saveToServer();
    editor().renameNet('Second edit');
    await pending;
    expect(selectIsDirty(editor())).toBe(true);
  });

  it('shows the conflict dialog when someone saved in between, and saves nothing', async () => {
    const id = fake.add('Crossing');
    await openProject(id);
    fake.saveElsewhere(id, netWith('Their change', 4));
    editor().renameNet('My change');
    await saveToServer();
    expect(server().conflict).toMatchObject({ yours: 1, current: 2 });
    expect(fake.projects.get(id)?.versions).toHaveLength(2);
    expect(selectIsDirty(editor())).toBe(true);
    expect(currentLink()?.version).toBe(1);
  });

  it('reloads from the server after a conflict', async () => {
    const id = fake.add('Crossing');
    await openProject(id);
    fake.saveElsewhere(id, netWith('Their change', 4));
    editor().renameNet('My change');
    await saveToServer();
    const link = server().conflict!.link;
    server().setConflict(null);
    expect(await reloadFromServer(link)).toBe(true);
    expect(editor().net.name).toBe('Their change');
    expect(currentLink()).toMatchObject({ version: 2 });
    expect(selectIsDirty(editor())).toBe(false);
  });

  it('opens the save dialog for a copy through a link that only reads', async () => {
    const id = fake.add('Shared', netWith('Shared', 2));
    const link = await (await import('./server-api')).serverApi.share(id, 'read');
    expect(await openSharePage(link.token)).toBe(true);
    expect(currentLink()).toMatchObject({ kind: 'shared', mode: 'read' });
    editor().renameNet('Changed here');
    await saveToServer();
    expect(server().dialog).toBe('save');
    expect(server().saveAsCopy).toBe(true);
    expect(fake.calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    // The copy is a project of its own.
    expect(await createProject('Copy')).toBe(true);
    expect(currentLink()).toMatchObject({ kind: 'project', name: 'Copy' });
    expect(fake.projects.get(id)?.versions).toHaveLength(1);
  });

  it('saves through a link that can write', async () => {
    const id = fake.add('Shared', netWith('Shared', 2));
    const link = await (await import('./server-api')).serverApi.share(id, 'write');
    await openSharePage(link.token);
    editor().renameNet('Edited through the link');
    await saveToServer();
    expect(fake.calls.at(-1)).toMatchObject({
      method: 'PUT',
      path: `/api/v1/shared/${link.token}`,
      headers: { 'if-match': '"1"' },
    });
    expect(fake.projects.get(id)?.versions).toHaveLength(2);
    expect(currentLink()).toMatchObject({ version: 2 });
  });

  it('reports a failed save and keeps the document unsaved', async () => {
    const id = fake.add('Crossing');
    await openProject(id);
    editor().renameNet('Edited');
    fake.projects.delete(id);
    await saveToServer();
    expect(toast()).toMatchObject({ kind: 'error' });
    expect(selectIsDirty(editor())).toBe(true);
    expect(server().conflict).toBeNull();
  });

  it('saves to a file when there is no server', async () => {
    server().setHealth(null);
    const click = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:x', configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: () => undefined, configurable: true });
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const element = realCreate(tag);
      if (tag === 'a') element.click = click;
      return element;
    });
    try {
      saveCommand();
      expect(click).toHaveBeenCalled();
      expect(server().dialog).toBeNull();
    } finally {
      vi.restoreAllMocks();
      Reflect.deleteProperty(URL, 'createObjectURL');
      Reflect.deleteProperty(URL, 'revokeObjectURL');
    }
  });
});

describe('versions', () => {
  it('opens an older version as a change and bases the next save on the newest', async () => {
    const id = fake.add('Crossing', netWith('Crossing', 1));
    fake.saveElsewhere(id, netWith('Crossing', 3));
    const versions = await (await import('./server-api')).serverApi.versions(id);
    const first = versions.find((v) => v.version === 1)!;
    expect(await openVersion(id, 'Crossing', first, 2)).toBe(true);
    expect(editor().net.places).toHaveLength(1);
    expect(selectIsDirty(editor())).toBe(true);
    expect(currentLink()).toMatchObject({ id, version: 2 });
    await saveToServer();
    expect(fake.calls.at(-1)?.headers['if-match']).toBe('"2"');
    expect(fake.projects.get(id)?.versions).toHaveLength(3);
    expect(fake.projects.get(id)?.versions[2]?.net.places).toHaveLength(1);
  });

  it('opens the newest version as unchanged', async () => {
    const id = fake.add('Crossing', netWith('Crossing', 2));
    const [v1] = await (await import('./server-api')).serverApi.versions(id);
    expect(await openVersion(id, 'Crossing', v1!, 1)).toBe(true);
    expect(selectIsDirty(editor())).toBe(false);
  });
});

describe('the page of a share link', () => {
  it('opens the project behind the link when the app starts', async () => {
    const id = fake.add('Shared', netWith('Shared', 2));
    const link = await (await import('./server-api')).serverApi.share(id, 'read');
    window.history.pushState({}, '', `/s/${link.token}`);
    server().setHealth(null);
    await startServerMode();
    expect(server().status).toBe('present');
    expect(editor().net.name).toBe('Shared');
    expect(currentLink()).toMatchObject({ kind: 'shared', mode: 'read', id });
  });

  it('says so when the link does not work', async () => {
    window.history.pushState({}, '', `/s/${'z'.repeat(43)}`);
    editor().loadNet(netWith('Mine', 1), null);
    await startServerMode();
    expect(editor().net.name).toBe('Mine');
    expect(currentLink()).toBeNull();
    expect(toast()).toMatchObject({ kind: 'error' });
    expect(toast()?.message).toContain('share link does not work');
  });
});

describe('without a server', () => {
  it('does nothing at the start but ask', async () => {
    fake.restore();
    const spy = vi.fn(async () => new Response('not found', { status: 404 }));
    vi.stubGlobal('fetch', spy);
    server().setHealth(null);
    await startServerMode();
    expect(server().status).toBe('absent');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
