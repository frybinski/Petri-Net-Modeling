import { createEmptyNet, type PetriNet } from '@pnm/core';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { DEFAULT_SETTINGS } from '../../lib/llm-settings';
import { detectServer, openProject, openSharePage } from '../../lib/server-actions';
import { serverApi } from '../../lib/server-api';
import { selectIsDirty, useEditorStore } from '../../store/editor-store';
import { useLlmStore } from '../../store/llm-store';
import { useServerStore } from '../../store/server-store';
import { useUiStore } from '../../store/ui-store';
import { createFakeServer, type FakeServer } from '../../test/fake-server';

const editor = () => useEditorStore.getState();
const server = () => useServerStore.getState();

let fake: FakeServer;

function netWith(name: string, places: number, transitions = 0): PetriNet {
  const net = createEmptyNet(name);
  return {
    ...net,
    places: Array.from({ length: places }, (_, i) => ({
      id: `p${i}`,
      name: `p${i}`,
      position: { x: i * 100, y: 0 },
    })),
    transitions: Array.from({ length: transitions }, (_, i) => ({
      id: `t${i}`,
      name: `t${i}`,
      position: { x: i * 100, y: 100 },
    })),
  };
}

async function setUp(options: { server?: boolean } = {}): Promise<void> {
  localStorage.clear();
  window.history.pushState({}, '', '/');
  editor().newNet();
  useServerStore.setState({
    status: 'unknown',
    health: null,
    link: null,
    dialog: null,
    conflict: null,
    saving: false,
  });
  useUiStore.setState({ toasts: [], confirm: null, shortcutsOpen: false, diagnosticsOpen: false });
  useLlmStore.setState({ settings: { ...DEFAULT_SETTINGS }, apiKey: '', settingsOpen: false });
  fake = createFakeServer({
    name: 'aifb-test',
    defaultModel: 'fake-model',
    models: ['fake-model', 'fake-model-large'],
  });
  if (options.server === false) {
    vi.stubGlobal('fetch', async () => new Response('not found', { status: 404 }));
  } else {
    fake.install();
  }
  await detectServer();
}

afterEach(() => {
  fake.restore();
});

async function openFileMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /^File/ }));
}

describe('the File menu and the status bar', () => {
  beforeEach(async () => {
    await setUp();
  });

  it('shows the server, its entries in the menu and where Ctrl+S goes', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByTestId('status-server')).toHaveTextContent('Server: aifb-test');
    await openFileMenu(user);
    expect(screen.getByTestId('menu-item-server-open')).toHaveTextContent('Open from server…');
    expect(screen.getByTestId('menu-item-server-save')).toHaveTextContent('Save to server…');
    expect(screen.getByTestId('menu-item-server-save')).toHaveTextContent('Ctrl+S');
    // A document that is not a project has no versions and no links.
    expect(screen.getByTestId('menu-item-server-versions')).toBeDisabled();
    expect(screen.getByTestId('menu-item-server-share')).toBeDisabled();
    // The file moves to Ctrl+Shift+S.
    expect(screen.getByTestId('menu-item-save')).toHaveTextContent('Save to file');
    expect(screen.getByTestId('menu-item-save')).toHaveTextContent('Ctrl+Shift+S');
  });

  it('shows none of it where there is no server', async () => {
    fake.restore();
    await setUp({ server: false });
    const user = userEvent.setup();
    render(<App />);
    await openFileMenu(user);
    expect(screen.queryByTestId('menu-item-server-open')).not.toBeInTheDocument();
    expect(screen.queryByTestId('status-server')).not.toBeInTheDocument();
    expect(screen.getByTestId('menu-item-save')).toHaveTextContent('Save');
    expect(screen.getByTestId('menu-item-save')).not.toHaveTextContent('to file');
  });

  it('enables versions and links once the document is a project', async () => {
    const id = fake.add('Crossing', netWith('Crossing', 2));
    await openProject(id);
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByTestId('status-server-project')).toHaveTextContent(
      'Crossing · version 1',
    );
    await openFileMenu(user);
    expect(screen.getByTestId('menu-item-server-save')).toHaveTextContent('Save to server');
    expect(screen.getByTestId('menu-item-server-versions')).toBeEnabled();
    expect(screen.getByTestId('menu-item-server-share')).toBeEnabled();
  });
});

describe('opening from the server', () => {
  beforeEach(async () => {
    await setUp();
  });

  it('lists the projects, filters them and opens one', async () => {
    fake.add('Parcel center', netWith('Parcel center', 4, 3));
    fake.add('Smart office', netWith('Smart office', 2, 1));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('status-server');
    await openFileMenu(user);
    await user.click(screen.getByTestId('menu-item-server-open'));
    const list = await screen.findByTestId('server-project-list');
    expect(
      within(list)
        .getAllByTestId('server-project-name')
        .map((n) => n.textContent),
    ).toEqual(['Smart office', 'Parcel center']);
    expect(list).toHaveTextContent('version 1');
    expect(list).toHaveTextContent('4 places, 3 transitions, 0 arcs');

    await user.type(screen.getByTestId('server-search'), 'parcel');
    expect(within(list).getAllByTestId('server-project')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Open Parcel center' }));
    await waitFor(() => {
      expect(editor().net.name).toBe('Parcel center');
    });
    expect(screen.queryByTestId('server-open-dialog')).not.toBeInTheDocument();
    expect(await screen.findByTestId('status-server-project')).toHaveTextContent(
      'Parcel center · version 1',
    );
  });

  it('asks before it replaces unsaved changes', async () => {
    fake.add('Other', netWith('Other', 1));
    editor().loadNet(netWith('Mine', 3), null, { unsaved: true });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('status-server');
    await openFileMenu(user);
    await user.click(screen.getByTestId('menu-item-server-open'));
    await user.click(await screen.findByRole('button', { name: 'Open Other' }));
    expect(await screen.findByTestId('confirm-accept')).toBeInTheDocument();
    expect(editor().net.name).toBe('Mine');
    await user.click(screen.getByTestId('confirm-accept'));
    await waitFor(() => {
      expect(editor().net.name).toBe('Other');
    });
  });

  it('says that there are no projects, and when the list cannot be loaded', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('status-server');
    await openFileMenu(user);
    await user.click(screen.getByTestId('menu-item-server-open'));
    expect(await screen.findByTestId('server-empty')).toHaveTextContent(
      'no projects on the server yet',
    );
    await user.click(screen.getByTestId('server-close'));

    fake.restore();
    vi.stubGlobal('fetch', async () => new Response('<html>Bad gateway</html>', { status: 502 }));
    await openFileMenu(user);
    await user.click(screen.getByTestId('menu-item-server-open'));
    expect(await screen.findByTestId('server-load-failed')).toHaveTextContent('HTTP 502');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('moves a project to the trash after a confirmation and restores it', async () => {
    fake.add('Old project', netWith('Old project', 1));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('status-server');
    await openFileMenu(user);
    await user.click(screen.getByTestId('menu-item-server-open'));
    await user.click(await screen.findByRole('button', { name: 'Move Old project to the trash' }));
    expect(await screen.findByTestId('confirm-accept')).toBeInTheDocument();
    await user.click(screen.getByTestId('confirm-accept'));
    await waitFor(() => {
      expect(screen.getByTestId('server-empty')).toBeInTheDocument();
    });
    expect(fake.calls.some((c) => c.method === 'DELETE')).toBe(true);

    await user.click(screen.getByTestId('server-trash-toggle'));
    const trashed = await screen.findByTestId('server-trashed');
    expect(trashed).toHaveTextContent('Old project');
    await user.click(screen.getByRole('button', { name: 'Restore Old project' }));
    await waitFor(() => {
      expect(screen.getByTestId('server-trash-empty')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('server-trash-toggle'));
    expect(await screen.findByTestId('server-project-list')).toHaveTextContent('Old project');
  });
});

describe('saving', () => {
  beforeEach(async () => {
    await setUp();
  });

  it('Ctrl+S on a document that is no project asks for a name and makes a project', async () => {
    editor().loadNet(netWith('Fresh net', 2), null, { unsaved: true });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('status-server');
    await user.keyboard('{Control>}s{/Control}');
    const input = await screen.findByTestId('server-project-name-input');
    expect(input).toHaveValue('Fresh net');
    await user.clear(input);
    await user.type(input, 'My first project');
    await user.click(screen.getByTestId('server-save-confirm'));
    await waitFor(() => {
      expect(fake.projects.size).toBe(1);
    });
    expect([...fake.projects.values()][0]?.name).toBe('My first project');
    expect(await screen.findByTestId('status-server-project')).toHaveTextContent(
      'My first project · version 1',
    );
    expect(selectIsDirty(editor())).toBe(false);
  });

  it('Ctrl+S on a project saves the next version without a dialog', async () => {
    const id = fake.add('Crossing', netWith('Crossing', 1));
    await openProject(id);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('status-server-project');
    editor().renameNet('Crossing v2');
    await user.keyboard('{Control>}s{/Control}');
    await waitFor(() => {
      expect(fake.projects.get(id)?.versions).toHaveLength(2);
    });
    expect(await screen.findByTestId('status-server-project')).toHaveTextContent(
      'Crossing v2 · version 2',
    );
    expect(screen.queryByTestId('server-save-dialog')).not.toBeInTheDocument();
  });

  it('Ctrl+Shift+S saves a file and leaves the server alone', async () => {
    const id = fake.add('Crossing', netWith('Crossing', 1));
    await openProject(id);
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
      const user = userEvent.setup();
      render(<App />);
      await screen.findByTestId('status-server-project');
      const before = fake.calls.length;
      await user.keyboard('{Control>}{Shift>}s{/Shift}{/Control}');
      expect(click).toHaveBeenCalled();
      expect(fake.calls.length).toBe(before);
    } finally {
      vi.restoreAllMocks();
      Reflect.deleteProperty(URL, 'createObjectURL');
      Reflect.deleteProperty(URL, 'revokeObjectURL');
    }
  });

  it('shows the conflict dialog and reloads from the server on request', async () => {
    const id = fake.add('Crossing', netWith('Crossing', 1));
    await openProject(id);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('status-server-project');
    fake.saveElsewhere(id, netWith('Their version', 5));
    editor().renameNet('My version');
    await user.keyboard('{Control>}s{/Control}');
    const dialog = await screen.findByTestId('server-conflict-dialog');
    expect(dialog).toHaveTextContent('Version 2 was saved while you were editing version 1');
    expect(fake.projects.get(id)?.versions).toHaveLength(2);
    await user.click(screen.getByTestId('conflict-reload'));
    await waitFor(() => {
      expect(editor().net.name).toBe('Their version');
    });
    expect(screen.queryByTestId('server-conflict-dialog')).not.toBeInTheDocument();
    expect(await screen.findByTestId('status-server-project')).toHaveTextContent('version 2');
  });

  it('offers to save the changes as a new project after a conflict', async () => {
    const id = fake.add('Crossing', netWith('Crossing', 1));
    await openProject(id);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('status-server-project');
    fake.saveElsewhere(id, netWith('Their version', 5));
    editor().renameNet('My version');
    await user.keyboard('{Control>}s{/Control}');
    await user.click(await screen.findByTestId('conflict-copy'));
    const input = await screen.findByTestId('server-project-name-input');
    expect(input).toHaveValue('Crossing (copy)');
    await user.click(screen.getByTestId('server-save-confirm'));
    await waitFor(() => {
      expect(fake.projects.size).toBe(2);
    });
    expect(editor().net.name).toBe('My version');
    expect(fake.projects.get(id)?.versions).toHaveLength(2);
  });

  it('cancels a conflict without touching anything', async () => {
    const id = fake.add('Crossing', netWith('Crossing', 1));
    await openProject(id);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('status-server-project');
    fake.saveElsewhere(id, netWith('Their version', 5));
    editor().renameNet('My version');
    await user.keyboard('{Control>}s{/Control}');
    await user.click(await screen.findByTestId('conflict-cancel'));
    expect(editor().net.name).toBe('My version');
    expect(selectIsDirty(editor())).toBe(true);
    expect(server().conflict).toBeNull();
  });
});

describe('versions', () => {
  beforeEach(async () => {
    await setUp();
  });

  it('lists the versions with the element counts compared with the editor and opens one', async () => {
    const id = fake.add('Crossing', netWith('Crossing', 2, 1));
    fake.saveElsewhere(id, netWith('Crossing', 4, 1));
    await openProject(id);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('status-server-project');
    await openFileMenu(user);
    await user.click(screen.getByTestId('menu-item-server-versions'));
    const rows = await screen.findAllByTestId('server-version');
    expect(rows).toHaveLength(2);
    // The editor holds version 2 (4 places, 1 transition); version 1 has two places fewer.
    expect(within(rows[0]!).getByRole('rowheader')).toHaveTextContent('v2');
    expect(within(rows[0]!).getByRole('rowheader')).toHaveTextContent('newest');
    expect(within(rows[0]!).getByTestId('server-version-counts')).toHaveTextContent(
      '4 P, 1 T, 0 A',
    );
    expect(within(rows[0]!).queryByTestId('version-delta')).not.toBeInTheDocument();
    expect(within(rows[1]!).getByTestId('server-version-counts')).toHaveTextContent(
      '2 P (−2), 1 T, 0 A',
    );

    await user.click(within(rows[1]!).getByRole('button', { name: 'Open version 1' }));
    await waitFor(() => {
      expect(editor().net.places).toHaveLength(2);
    });
    // The older version counts as a change on top of the newest version.
    expect(selectIsDirty(editor())).toBe(true);
    expect(await screen.findByTestId('status-server-project')).toHaveTextContent('version 2');
  });
});

describe('share links', () => {
  beforeEach(async () => {
    await setUp();
  });

  it('makes a read-only and an editing link, copies them and removes them', async () => {
    const id = fake.add('Crossing', netWith('Crossing', 1));
    await openProject(id);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('status-server-project');
    await openFileMenu(user);
    await user.click(screen.getByTestId('menu-item-server-share'));
    await user.click(await screen.findByTestId('share-read-create'));
    const readUrl = await screen.findByTestId('share-read-url');
    expect((readUrl as HTMLInputElement).value).toMatch(/^http:\/\/server\.test\/s\/read-token-/);
    expect(screen.getByTestId('share-write-create')).toBeInTheDocument();

    await user.click(screen.getByTestId('share-read-copy'));
    expect(await navigator.clipboard.readText()).toBe((readUrl as HTMLInputElement).value);
    expect(await screen.findByText('Link copied.')).toBeInTheDocument();

    await user.click(screen.getByTestId('share-write-create'));
    expect(((await screen.findByTestId('share-write-url')) as HTMLInputElement).value).toContain(
      '/s/write-token-',
    );
    expect(fake.projects.get(id)?.shares.write).toBeDefined();

    const before = (readUrl as HTMLInputElement).value;
    await user.click(screen.getByTestId('share-read-rotate'));
    await waitFor(() => {
      expect(screen.getByTestId('share-read-url')).not.toHaveValue(before);
    });

    await user.click(screen.getByTestId('share-read-remove'));
    expect(await screen.findByTestId('share-read-create')).toBeInTheDocument();
    expect(fake.projects.get(id)?.shares.read).toBeUndefined();
    expect(fake.projects.get(id)?.shares.write).toBeDefined();
  });
});

describe('a page opened with a share link', () => {
  beforeEach(async () => {
    await setUp();
  });

  it('shows what a read-only link allows and offers a copy', async () => {
    const id = fake.add('Shared net', netWith('Shared net', 2));
    const link = await serverApi.share(id, 'read');
    await openSharePage(link.token);
    const user = userEvent.setup();
    render(<App />);
    const banner = await screen.findByTestId('shared-banner');
    expect(banner).toHaveAttribute('data-mode', 'read');
    expect(banner).toHaveTextContent('“Shared net” through a read-only link');
    expect(await screen.findByTestId('status-server-project')).toHaveTextContent('read-only link');
    await openFileMenu(user);
    expect(screen.getByTestId('menu-item-server-save')).toHaveTextContent(
      'Save a copy to the server…',
    );
    expect(screen.getByTestId('menu-item-server-versions')).toBeDisabled();
    expect(screen.getByTestId('menu-item-server-share')).toBeDisabled();
    await user.keyboard('{Escape}');

    // Saving does not touch the shared project; the copy is a project of its own.
    await user.click(screen.getByTestId('shared-banner-copy'));
    expect(await screen.findByTestId('server-project-name-input')).toHaveValue('Shared net (copy)');
    await user.click(screen.getByTestId('server-save-confirm'));
    await waitFor(() => {
      expect(fake.projects.size).toBe(2);
    });
    expect(fake.projects.get(id)?.versions).toHaveLength(1);
    await waitFor(() => {
      expect(screen.queryByTestId('shared-banner')).not.toBeInTheDocument();
    });
  });

  it('lets a link that can edit save versions', async () => {
    const id = fake.add('Shared net', netWith('Shared net', 2));
    const link = await serverApi.share(id, 'write');
    await openSharePage(link.token);
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByTestId('shared-banner')).toHaveAttribute('data-mode', 'write');
    expect(screen.queryByTestId('shared-banner-copy')).not.toBeInTheDocument();
    editor().renameNet('Shared net 2');
    await user.keyboard('{Control>}s{/Control}');
    await waitFor(() => {
      expect(fake.projects.get(id)?.versions).toHaveLength(2);
    });
  });

  it('has no banner on an ordinary page', async () => {
    render(<App />);
    await screen.findByTestId('status-server');
    expect(screen.queryByTestId('shared-banner')).not.toBeInTheDocument();
  });
});

describe('the language model settings on a server', () => {
  beforeEach(async () => {
    await setUp();
  });

  it('offers the server as the preset, without a key field, with the models of the server', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('status-server');
    await user.click(screen.getByTestId('llm-settings-open'));
    expect(await screen.findByTestId('llm-settings')).toBeInTheDocument();
    const preset = screen.getByTestId('llm-preset');
    expect(within(preset).getByRole('option', { name: 'Server (Ollama)' })).toBeInTheDocument();
    expect(preset).toHaveValue('server');
    expect(screen.getByTestId('llm-base-url')).toHaveValue('/llm/v1');
    expect(screen.getByTestId('llm-base-url')).toHaveAttribute('readonly');
    expect(screen.queryByTestId('llm-api-key')).not.toBeInTheDocument();
    expect(screen.getByTestId('llm-server-hint')).toBeInTheDocument();
    expect(screen.getByTestId('llm-model')).toHaveValue('fake-model');
    // The models are listed without asking for them.
    expect(await screen.findByTestId('llm-models-note')).toHaveTextContent('2 models found');
  });

  it('brings the key field back for a server of your own', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('status-server');
    await user.click(screen.getByTestId('llm-settings-open'));
    await user.selectOptions(await screen.findByTestId('llm-preset'), 'ollama');
    expect(screen.getByTestId('llm-api-key')).toBeInTheDocument();
    expect(screen.getByTestId('llm-base-url')).not.toHaveAttribute('readonly');
    expect(screen.getByTestId('llm-base-url')).toHaveValue('http://localhost:11434/v1');
    await user.selectOptions(screen.getByTestId('llm-preset'), 'server');
    expect(screen.queryByTestId('llm-api-key')).not.toBeInTheDocument();
    expect(screen.getByTestId('llm-base-url')).toHaveValue('/llm/v1');
  });

  it('does not offer the server where there is none', async () => {
    fake.restore();
    await setUp({ server: false });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('llm-settings-open'));
    const preset = await screen.findByTestId('llm-preset');
    expect(
      within(preset).queryByRole('option', { name: 'Server (Ollama)' }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('llm-api-key')).toBeInTheDocument();
  });
});
