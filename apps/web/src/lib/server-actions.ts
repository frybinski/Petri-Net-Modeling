import type { PetriNet } from '@pnm/core';
import { useEffect, useState } from 'react';
import { en } from '../i18n/en';
import { useEditorStore } from '../store/editor-store';
import { useLlmStore } from '../store/llm-store';
import { serverHasProjects, useServerStore, type ServerLink } from '../store/server-store';
import { notify } from '../store/ui-store';
import { guardUnsaved, saveNet } from './files';
import {
  ServerError,
  fetchHealth,
  serverApi,
  shareTokenOf,
  type ProjectInfo,
  type VersionInfo,
} from './server-api';

/** A link together with the document it was made for. */
export type CurrentLink = ServerLink & { docVersion: number };

const server = () => useServerStore.getState();
const editor = () => useEditorStore.getState();

/**
 * The project that the document in the editor belongs to, or `null`. A link is made for one
 * document; once a file, an example or a new net replaces it, the link no longer applies.
 */
export function currentLink(): CurrentLink | null {
  const link = server().link;
  return link !== null && link.docVersion === editor().docVersion ? link : null;
}

/** The same for a component: it renders again when the document or the link changes. */
export function useCurrentLink(): CurrentLink | null {
  const link = useServerStore((s) => s.link);
  const docVersion = useEditorStore((s) => s.docVersion);
  return link !== null && link.docVersion === docVersion ? link : null;
}

/** True once the server has answered and offers the store of projects. */
export function serverReady(): boolean {
  return serverHasProjects(server());
}

/** Reads a failure of the server for a message. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Asks the address the app was loaded from whether a server is there, and sets the language model
 * up for it. Nothing else happens when there is none.
 */
export async function detectServer(): Promise<void> {
  const health = await fetchHealth();
  server().setHealth(health);
  useLlmStore.getState().adoptServer(health);
}

/**
 * Called once when the app starts: detects the server and, on a page that was opened with a share
 * link, opens the project behind it.
 */
export async function startServerMode(): Promise<void> {
  await detectServer();
  if (server().status !== 'present') return;
  const token = shareTokenOf(window.location.pathname);
  if (token !== null) await openSharePage(token);
}

/** Makes the link of the document: the editor holds the net that the server sent. */
function linkDocument(link: ServerLink): void {
  server().setLink({ ...link, docVersion: editor().docVersion });
}

/** Marks the net that was sent as saved; edits made while the request ran stay unsaved. */
function markSavedAs(net: PetriNet): void {
  useEditorStore.setState({ savedNet: net });
}

/** Opens a project of the server in the editor; unsaved changes are asked about first. */
export function openProjectGuarded(info: Pick<ProjectInfo, 'id'>): void {
  guardUnsaved(() => {
    void openProject(info.id);
  });
}

export async function openProject(id: string): Promise<boolean> {
  try {
    const { project, net } = await serverApi.get(id);
    editor().loadNet(net, null);
    linkDocument({ kind: 'project', id: project.id, name: project.name, version: project.version });
    notify('success', en.server.opened(project.name, project.version));
    return true;
  } catch (error) {
    notify('error', en.server.openFailed, { details: [reasonOf(error)] });
    return false;
  }
}

/**
 * Opens an older version of a project. It counts as changed, because the newest version is
 * another one; saving makes a new version on top of the newest.
 */
export async function openVersion(
  id: string,
  name: string,
  version: VersionInfo,
  newest: number,
): Promise<boolean> {
  try {
    const loaded = await serverApi.getVersion(id, version.version);
    const older = version.version !== newest;
    editor().loadNet(loaded.net, null, older ? { unsaved: true } : {});
    linkDocument({ kind: 'project', id, name, version: newest });
    notify('success', en.server.openedVersion(name, version.version));
    return true;
  } catch (error) {
    notify('error', en.server.openFailed, { details: [reasonOf(error)] });
    return false;
  }
}

/** Opens the project behind a share link, as the page `/s/<token>` does. */
export async function openSharePage(token: string): Promise<boolean> {
  try {
    const shared = await serverApi.shared(token);
    editor().loadNet(shared.net, null);
    linkDocument({
      kind: 'shared',
      token,
      mode: shared.mode,
      id: shared.project.id,
      name: shared.project.name,
      version: shared.project.version,
    });
    return true;
  } catch (error) {
    notify('error', en.server.shareOpenFailed, { details: [reasonOf(error)] });
    return false;
  }
}

/** Makes a new project of the document in the editor (the answer of the save dialog). */
export async function createProject(name: string): Promise<boolean> {
  const net = editor().net;
  server().setSaving(true);
  try {
    const project = await serverApi.create(net, name);
    markSavedAs(net);
    linkDocument({ kind: 'project', id: project.id, name: project.name, version: project.version });
    notify('success', en.server.created(project.name));
    return true;
  } catch (error) {
    notify('error', en.server.saveFailed, { details: [reasonOf(error)] });
    return false;
  } finally {
    server().setSaving(false);
  }
}

/**
 * Saves the document to the server. A document that belongs to a project becomes its next version;
 * any other document first gets a name and becomes a new project (the save dialog). Through a
 * link that only reads, the only way to save is a copy.
 */
export async function saveToServer(): Promise<void> {
  if (!serverReady()) {
    saveNet();
    return;
  }
  const link = currentLink();
  if (link === null) {
    server().openDialog('save');
    return;
  }
  if (link.kind === 'shared' && link.mode === 'read') {
    server().openDialog('save', { asCopy: true });
    return;
  }
  if (server().saving) return;
  const net = editor().net;
  server().setSaving(true);
  try {
    if (link.kind === 'project') {
      const project = await serverApi.save(link.id, net, link.version);
      server().patchLink({ version: project.version, name: project.name });
      notify('success', en.server.saved(project.name, project.version));
    } else {
      const project = await serverApi.saveShared(link.token, net, link.version);
      server().patchLink({ version: project.version, name: project.name });
      notify('success', en.server.saved(project.name, project.version));
    }
    markSavedAs(net);
  } catch (error) {
    if (error instanceof ServerError && error.isConflict) {
      server().setConflict({ link, yours: link.version, current: error.currentVersion });
    } else {
      notify('error', en.server.saveFailed, { details: [reasonOf(error)] });
    }
  } finally {
    server().setSaving(false);
  }
}

/** Ctrl+S: the server when the app has one, else the file. */
export function saveCommand(): void {
  if (serverReady()) void saveToServer();
  else saveNet();
}

/** After a conflict: throw away the changes and take what is on the server. */
export async function reloadFromServer(link: ServerLink): Promise<boolean> {
  try {
    if (link.kind === 'project') {
      const { project, net } = await serverApi.get(link.id);
      editor().loadNet(net, null);
      linkDocument({
        kind: 'project',
        id: project.id,
        name: project.name,
        version: project.version,
      });
      notify('success', en.server.opened(project.name, project.version));
    } else {
      const shared = await serverApi.shared(link.token);
      editor().loadNet(shared.net, null);
      linkDocument({ ...link, name: shared.project.name, version: shared.project.version });
      notify('success', en.server.opened(shared.project.name, shared.project.version));
    }
    return true;
  } catch (error) {
    notify('error', en.server.openFailed, { details: [reasonOf(error)] });
    return false;
  }
}

/** The project list for a dialog, with its state of loading. */
export type Loadable<T> =
  { state: 'loading' } | { state: 'ready'; value: T } | { state: 'failed'; message: string };

/** Runs `load` when the component appears and again when `reload` is called. */
export function useLoaded<T>(load: () => Promise<T>): [Loadable<T>, () => void] {
  const [result, setResult] = useState<Loadable<T>>({ state: 'loading' });
  const [counter, setCounter] = useState(0);
  useEffect(() => {
    let current = true;
    // The first run starts from the initial state; a reload shows the old list while it loads.
    load().then(
      (value) => {
        if (current) setResult({ state: 'ready', value });
      },
      (error: unknown) => {
        if (current) setResult({ state: 'failed', message: reasonOf(error) });
      },
    );
    return () => {
      current = false;
    };
    // `load` is made anew on every render; the counter says when to ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counter]);
  return [result, () => setCounter((c) => c + 1)];
}
