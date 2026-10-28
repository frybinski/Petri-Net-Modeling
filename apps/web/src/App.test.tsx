import { createEmptyNet, serializeNet } from '@pnm/core';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { useEditorStore } from './store/editor-store';
import { useUiStore } from './store/ui-store';

beforeEach(() => {
  useEditorStore.getState().newNet();
  useUiStore.setState({ toasts: [], confirm: null, shortcutsOpen: false, diagnosticsOpen: false });
});

describe('App', () => {
  it('renders the editor chrome and the empty-state hint', () => {
    render(<App />);
    expect(screen.getByRole('toolbar', { name: 'Tools' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^File/ })).toBeInTheDocument();
    expect(screen.getByTestId('empty-hint')).toBeInTheDocument();
    expect(screen.getByText('No problems')).toBeInTheDocument();
  });

  it('shows an error message when a file with invalid JSON is opened', async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByTestId('open-file-input');
    await user.upload(
      input,
      new File(['{ not json'], 'broken.pn.json', { type: 'application/json' }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not open broken.pn.json');
    expect(alert).toHaveTextContent(/not valid JSON/);
    expect(useEditorStore.getState().net.places).toHaveLength(0);
  });

  it('opens a valid file and shows its name', async () => {
    const user = userEvent.setup();
    render(<App />);
    const net = createEmptyNet('Opened net');
    await user.upload(
      screen.getByTestId('open-file-input'),
      new File([serializeNet(net)], 'opened.pn.json', { type: 'application/json' }),
    );
    expect(await screen.findByTestId('net-name')).toHaveValue('Opened net');
  });

  it('opens an example from the File menu', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /^File/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Traffic light' }));
    expect(useEditorStore.getState().net.name).toBe('Traffic light');
    expect(screen.getByTestId('net-counts')).toHaveTextContent('8 places, 6 transitions, 16 arcs');
  });

  it('switches tools through the palette and reflects them with aria-pressed', async () => {
    const user = userEvent.setup();
    render(<App />);
    const place = screen.getByRole('button', { name: /^Place/ });
    expect(place).toHaveAttribute('aria-pressed', 'false');
    await user.click(place);
    expect(place).toHaveAttribute('aria-pressed', 'true');
    expect(useEditorStore.getState().tool).toBe('place');
  });

  it('edits the properties of the selected place', async () => {
    const user = userEvent.setup();
    render(<App />);
    const id = useEditorStore.getState().addPlace({ x: 0, y: 0 }) as string;
    const panel = await screen.findByTestId('properties-panel');
    const name = within(panel).getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Buffer{Enter}');
    expect(useEditorStore.getState().net.places.find((p) => p.id === id)?.name).toBe('Buffer');
    await user.click(within(panel).getByRole('button', { name: 'Increase initial tokens' }));
    expect(useEditorStore.getState().net.marking[id]).toHaveLength(1);
    await user.type(within(panel).getByLabelText('Capacity'), '3{Enter}');
    expect(useEditorStore.getState().net.places[0]?.capacity).toBe(3);
  });

  it('shows diagnostics and jumps to the element', async () => {
    const user = userEvent.setup();
    render(<App />);
    useEditorStore.getState().addPlace({ x: 0, y: 0 });
    useEditorStore.getState().select([]);
    await user.click(await screen.findByTestId('status-diagnostics'));
    const items = await screen.findAllByTestId('diagnostic-item');
    expect(items[0]).toHaveAttribute('data-code', 'ISOLATED_NODE');
    await user.click(items[0] as HTMLElement);
    expect(useEditorStore.getState().selection).toHaveLength(1);
  });

  it('switches to simulation mode with its panel', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('mode-simulate'));
    expect(await screen.findByTestId('simulation-panel')).toBeInTheDocument();
    // The engine answers asynchronously; an empty net has nothing enabled.
    await waitFor(() => {
      expect(screen.getByTestId('enabled-summary')).toHaveTextContent(/Deadlock/);
    });
    await user.click(screen.getByTestId('mode-edit'));
    expect(screen.getByTestId('properties-panel')).toBeInTheDocument();
  });

  it('toggles the theme', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('theme-toggle'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    await user.click(screen.getByTestId('theme-toggle'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('opens the keyboard shortcut overview with ?', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.keyboard('?');
    expect(useUiStore.getState().shortcutsOpen).toBe(true);
    expect(await screen.findByTestId('shortcuts-list')).toHaveTextContent('Undo');
  });
});
