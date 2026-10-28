import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../App';
import { loadExample } from '../../test/domain-fixtures';
import { useEditorStore } from '../../store/editor-store';
import { SPLIT_DEFAULT, useUiStore } from '../../store/ui-store';

const store = () => useEditorStore.getState();

beforeEach(() => {
  store().newNet();
  useUiStore.setState({
    toasts: [],
    confirm: null,
    shortcutsOpen: false,
    diagnosticsOpen: false,
    viewMode: 'net',
    rightTab: 'main',
    splitRatio: SPLIT_DEFAULT,
    hover: { id: null, source: null },
  });
});

function open(name: string): void {
  store().loadNet(loadExample(name), `${name}.pn.json`);
}

describe('view switch', () => {
  it('shows the three views and switches between them', async () => {
    const user = userEvent.setup();
    render(<App />);
    const group = screen.getByRole('group', { name: 'View' });
    expect(within(group).getByRole('button', { name: 'Net' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByTestId('domain-pane')).toBeNull();

    await user.click(screen.getByTestId('view-domain'));
    expect(useUiStore.getState().viewMode).toBe('domain');
    expect(screen.getByTestId('domain-pane')).toBeInTheDocument();
    expect(screen.getByTestId('net-pane')).toHaveAttribute('inert');
    // The tool palette belongs to the net editor.
    expect(screen.queryByRole('toolbar', { name: 'Tools' })).toBeNull();

    await user.click(screen.getByTestId('view-both'));
    expect(screen.getByTestId('net-pane')).not.toHaveAttribute('inert');
    expect(screen.getByTestId('domain-pane')).toBeInTheDocument();
    expect(screen.getByRole('separator')).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Tools' })).toBeInTheDocument();

    await user.click(screen.getByTestId('view-net'));
    expect(screen.queryByTestId('domain-pane')).toBeNull();
    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('switches with the keys 1, 2 and 3', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.keyboard('2');
    expect(useUiStore.getState().viewMode).toBe('domain');
    await user.keyboard('3');
    expect(useUiStore.getState().viewMode).toBe('both');
    await user.keyboard('1');
    expect(useUiStore.getState().viewMode).toBe('net');
  });

  it('moves the divider of the split view with the keyboard', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('view-both'));
    const separator = screen.getByRole('separator');
    expect(separator).toHaveAttribute('aria-valuenow', '50');
    separator.focus();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(separator).toHaveAttribute('aria-valuenow', '54');
    await user.keyboard('{Home}');
    expect(separator).toHaveAttribute('aria-valuenow', '25');
    await user.keyboard('{ArrowUp}');
    expect(separator).toHaveAttribute('aria-valuenow', '25');
  });

  it('shows the zoom of both views in the status bar of the split view', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.queryByTestId('domain-zoom-level')).toBeNull();
    await user.click(screen.getByTestId('view-both'));
    expect(screen.getByTestId('zoom-level')).toBeInTheDocument();
    expect(screen.getByTestId('domain-zoom-level')).toBeInTheDocument();
    await user.click(screen.getByTestId('view-domain'));
    expect(screen.queryByTestId('zoom-level')).toBeNull();
    expect(screen.getByTestId('domain-zoom-level')).toBeInTheDocument();
  });
});

describe('domain canvas', () => {
  it('invites to generate a view when the net has none', async () => {
    const user = userEvent.setup();
    open('complaint-handling');
    render(<App />);
    await user.click(screen.getByTestId('view-domain'));
    expect(screen.getByTestId('domain-empty')).toHaveTextContent('No domain view yet');
    await user.click(screen.getByTestId('domain-generate'));
    await waitFor(() => {
      expect(store().net.domainView).toBeDefined();
    });
    expect(screen.queryByTestId('domain-empty')).toBeNull();
  });

  it('draws the marking: initial in edit mode, the current one while simulating', async () => {
    const user = userEvent.setup();
    open('parcel-center');
    render(<App />);
    await user.click(screen.getByTestId('view-domain'));
    const canvas = screen.getByTestId('domain-canvas');
    expect(canvas).toHaveAttribute('role', 'img');
    expect(canvas).toHaveAttribute('aria-label', expect.stringContaining('12 places'));
    await waitFor(() => {
      expect(canvas).toHaveAttribute('data-sprites', '0');
    });
    const net = store().net;
    useEditorStore.setState({
      mode: 'simulate',
      simMarking: { ...net.marking, p_in: [1, 1, 1], p_A: [1, 1] },
    });
    await waitFor(() => {
      expect(canvas).toHaveAttribute('data-sprites', '5');
    });
    useEditorStore.setState({
      simRunning: [
        { firingId: 1, transitionId: 't_scan', start: 0, end: 20, slot: 0, caseIds: [] },
      ],
    });
    await waitFor(() => {
      expect(canvas).toHaveAttribute('data-sprites', '6');
    });
  });

  it('explains a view that does not follow the schema', async () => {
    const user = userEvent.setup();
    open('parcel-center');
    store().setDomainView({ schemaVersion: 1 });
    render(<App />);
    await user.click(screen.getByTestId('view-domain'));
    expect(screen.getByTestId('domain-invalid')).toHaveTextContent('cannot be drawn');
  });
});
