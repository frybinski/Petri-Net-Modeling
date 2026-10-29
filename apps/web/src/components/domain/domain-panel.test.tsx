import { render, screen, waitFor } from '@testing-library/react';
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

describe('right panel tabs', () => {
  it('adds the domain panel next to the properties and back', async () => {
    const user = userEvent.setup();
    render(<App />);
    // The net view offers the properties and the analysis; the domain tab comes with the view.
    expect(screen.getByRole('tablist', { name: 'Panels' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Analyze' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Domain view' })).toBeNull();
    expect(screen.getByTestId('properties-panel')).toBeInTheDocument();

    await user.click(screen.getByTestId('view-domain'));

    await screen.findByTestId('domain-view');
    expect(screen.getByRole('tab', { name: 'Domain view' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // The panel is loaded on demand.
    expect(await screen.findByTestId('domain-panel')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Properties' }));
    expect(screen.getByTestId('properties-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('domain-panel')).toBeNull();

    await user.click(screen.getByTestId('view-net'));
    expect(screen.queryByRole('tab', { name: 'Domain view' })).toBeNull();
  });

  it('offers the simulation controls while simulating', async () => {
    const user = userEvent.setup();
    open('complaint-handling');
    render(<App />);
    await user.click(screen.getByTestId('view-both'));
    await screen.findByTestId('domain-view');
    store().startSimulation();
    await waitFor(() => {
      expect(screen.getByTestId('simulation-panel')).toBeInTheDocument();
    });
    expect(screen.getByRole('tab', { name: 'Simulation' })).toBeInTheDocument();
    store().stopSimulation();
  });
});

describe('generated view in the panel', () => {
  it('shows a generic view as generic and free of problems', async () => {
    const user = userEvent.setup();
    open('complaint-handling');
    render(<App />);
    await user.click(screen.getByTestId('view-domain'));
    await screen.findByTestId('domain-view');
    await user.click(await screen.findByTestId('domain-generate'));
    await waitFor(() => {
      expect(store().net.domainView).toBeDefined();
    });
    expect(screen.getByTestId('domain-status')).toHaveTextContent('0 problems');
    expect(screen.getByTestId('origin-generic')).toHaveTextContent(/^\d+ generic$/);
    expect(screen.getByTestId('origin-user')).toHaveTextContent('0 user');
  });

  it('reports a view that does not follow the schema', async () => {
    const user = userEvent.setup();
    open('parcel-center');
    store().setDomainView({ schemaVersion: 1 });
    render(<App />);
    await user.click(screen.getByTestId('view-domain'));
    await screen.findByTestId('domain-view');
    expect(await screen.findByTestId('domain-status')).toHaveTextContent('error');
  });
});

describe('domain panel', () => {
  async function renderPanel() {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('view-domain'));
    await screen.findByTestId('domain-view');
    // The panel is loaded on demand.
    await screen.findByTestId('domain-panel');
    return user;
  }

  it('reports a clean view of the parcel center', async () => {
    open('parcel-center');
    await renderPanel();
    expect(screen.getByTestId('domain-status')).toHaveTextContent('0 problems');
    expect(screen.getByTestId('origin-user')).toHaveTextContent('30 user');
    expect(screen.getByTestId('domain-hash-status')).toHaveAttribute('data-stale', 'false');
    expect(screen.queryAllByTestId('domain-diagnostic')).toHaveLength(0);
    expect(screen.getByTestId('domain-update-hash')).toBeDisabled();
    expect(screen.getByTestId('domain-fill')).toBeEnabled();
    expect(screen.getByLabelText('Theme')).toHaveValue('Paketzentrum');
  });

  it('shows what is wrong after a place was deleted and lets the actions clean it up', async () => {
    open('parcel-center');
    const user = await renderPanel();
    store().select(['p_B']);
    store().removeSelected();
    await waitFor(() => {
      expect(screen.getAllByTestId('domain-diagnostic').length).toBeGreaterThan(0);
    });
    const rules = screen.getAllByTestId('domain-diagnostic').map((row) => row.dataset['rule']);
    expect(rules).toEqual(expect.arrayContaining(['V2', 'V7']));
    expect(screen.getByTestId('domain-status')).toHaveTextContent(/error/);
    expect(screen.getByTestId('domain-hash-status')).toHaveAttribute('data-stale', 'true');
    expect(screen.getByTestId('domain-update-hash')).toBeDisabled();

    await user.click(screen.getByTestId('domain-fill'));
    expect(screen.getAllByTestId('domain-diagnostic').map((row) => row.dataset['rule'])).toEqual([
      'V7',
    ]);
    expect(screen.getByTestId('domain-update-hash')).toBeEnabled();

    await user.click(screen.getByTestId('domain-update-hash'));
    expect(screen.getByTestId('domain-status')).toHaveTextContent('0 problems');
  });

  it('selects the element of a diagnostic', async () => {
    open('parcel-center');
    const user = await renderPanel();
    const id = store().addPlace({ x: 10, y: 10 }) as string;
    store().select([]);
    const row = await screen.findByRole('button', { name: /no entry/ });
    await user.click(row);
    expect(store().selection).toEqual([id]);
  });

  it('shows the entry of the selected element with its origin', async () => {
    open('smart-office');
    await renderPanel();
    expect(screen.getByTestId('domain-entry-section')).toHaveTextContent('Select a place');
    store().select(['o_work']);
    const entry = await screen.findByTestId('domain-entry');
    expect(entry).toHaveTextContent('"kind": "area"');
    expect(screen.getByTestId('domain-entry-origin')).toHaveTextContent('user');
    store().select(['a-unknown']);
  });

  it('removes the view', async () => {
    open('smart-office');
    const user = await renderPanel();
    await user.click(screen.getByTestId('domain-remove'));
    expect(store().net.domainView).toBeUndefined();
    expect(screen.getByTestId('domain-empty')).toBeInTheDocument();
  });

  it('changes the sprite and the names of the view', async () => {
    open('smart-office');
    const user = await renderPanel();
    await user.selectOptions(screen.getByTestId('domain-sprite'), 'document');
    const view = store().net.domainView as { meta: { entity: { sprite: string } } };
    expect(view.meta.entity.sprite).toBe('document');
    const theme = screen.getByLabelText('Theme');
    await user.clear(theme);
    await user.type(theme, 'Office{Enter}');
    expect((store().net.domainView as { meta: { theme: string } }).meta.theme).toBe('Office');
  });

  it('keeps Apply disabled until the text has changed', async () => {
    open('smart-office');
    await renderPanel();
    expect(await screen.findByTestId('domain-apply')).toBeDisabled();
    expect(screen.getByTestId('domain-revert')).toBeDisabled();
    expect(screen.getByTestId('domain-draft-status')).toHaveTextContent('');
  });

  it('locks the actions while the simulation runs', async () => {
    open('smart-office');
    const user = await renderPanel();
    useEditorStore.setState({ mode: 'simulate' });
    // Starting the simulation brings up its controls; the domain tab is one click away.
    await user.click(await screen.findByRole('tab', { name: 'Domain view' }));
    expect(screen.getByTestId('domain-remove')).toBeDisabled();
    expect(screen.getByTestId('domain-generate-action')).toBeDisabled();
    expect(screen.getByTestId('domain-fill')).toBeDisabled();
  });
});
