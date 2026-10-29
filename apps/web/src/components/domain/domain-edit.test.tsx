import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../App';
import { hideSelected } from '../../lib/domain-edit';
import { getDomainView } from '../../lib/domain-view';
import { loadExample } from '../../test/domain-fixtures';
import { useDomainEditStore } from '../../store/domain-edit-store';
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
    domainEdit: false,
    jsonReveal: null,
  });
  useDomainEditStore.setState({ decor: null, renaming: null, menu: null, readout: null });
  store().loadNet(loadExample('parcel-center'), 'parcel-center.pn.json');
});

async function open() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByTestId('view-domain'));
  return user;
}

describe('the mode switch', () => {
  it('toggles between Inspect and Edit layout and shows the handles flag', async () => {
    const user = await open();
    const inspect = screen.getByTestId('domain-mode-inspect');
    const edit = screen.getByTestId('domain-mode-edit');
    expect(inspect).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('domain-canvas')).toHaveAttribute('data-editing', 'false');
    await user.click(edit);
    expect(edit).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('domain-canvas')).toHaveAttribute('data-editing', 'true');
    await user.click(inspect);
    expect(screen.getByTestId('domain-canvas')).toHaveAttribute('data-editing', 'false');
  });

  it('works with the key E and is gone while simulating', async () => {
    const user = await open();
    await user.keyboard('e');
    expect(screen.getByTestId('domain-canvas')).toHaveAttribute('data-editing', 'true');
    store().startSimulation();
    await waitFor(() => {
      expect(screen.queryByTestId('domain-mode')).toBeNull();
    });
    expect(screen.getByTestId('domain-canvas')).toHaveAttribute('data-editing', 'false');
    store().stopSimulation();
    await waitFor(() => {
      expect(screen.getByTestId('domain-mode')).toBeInTheDocument();
    });
  });
});

describe('the fields of the entry', () => {
  it('changes the box of the selected station and one undo brings it back', async () => {
    const user = await open();
    store().select(['t_sort']);
    const x = await screen.findByTestId('domain-field-box-0');
    expect(x).toHaveValue('520');
    await user.clear(x);
    await user.type(x, '600{Enter}');
    await waitFor(() => {
      expect(getDomainView()?.transitions['t_sort']).toMatchObject({ box: [600, 262, 100, 116] });
    });
    // The slot moved with the box.
    expect(getDomainView()?.transitions['t_sort']).toMatchObject({ slots: [[650, 332]] });
    expect(screen.getByTestId('origin-user')).toHaveTextContent('30 user');
    store().undo();
    await waitFor(() => {
      expect(getDomainView()?.transitions['t_sort']).toMatchObject({ box: [520, 262, 100, 116] });
    });
  });

  it('changes the kind, the label and the sensor', async () => {
    const user = await open();
    store().select(['t_scan']);
    await user.selectOptions(await screen.findByTestId('domain-field-kind'), 'machine');
    expect(getDomainView()?.transitions['t_scan']?.kind).toBe('machine');
    const label = screen.getByTestId('domain-field-label');
    await user.clear(label);
    await user.type(label, 'Scanner 2{Enter}');
    expect(getDomainView()?.transitions['t_scan']).toMatchObject({ label: 'Scanner 2' });
    const sensor = screen.getByTestId('domain-field-sensor');
    await user.type(sensor, 'camera{Enter}');
    expect(getDomainView()?.transitions['t_scan']).toMatchObject({ sensor: 'camera' });
  });

  it('only offers the kinds that the role allows', async () => {
    await open();
    store().select(['t_arr']);
    const select = await screen.findByTestId('domain-field-kind');
    const options = within(select)
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(['door', 'dock']);
  });

  it('edits the points of a path and the slots of a station', async () => {
    const user = await open();
    store().select(['p_in']);
    const y = await screen.findByTestId('domain-field-point-1-y');
    await user.clear(y);
    await user.type(y, '400{Enter}');
    expect(getDomainView()?.places['p_in']).toMatchObject({
      path: [
        [96, 320],
        [256, 400],
      ],
    });
    await user.click(screen.getByTestId('domain-field-point-0-add'));
    expect((getDomainView()?.places['p_in'] as { path: number[][] }).path).toHaveLength(3);
    await user.click(screen.getByTestId('domain-field-point-1-remove'));
    expect((getDomainView()?.places['p_in'] as { path: number[][] }).path).toHaveLength(2);

    store().select(['t_scan']);
    await user.click(await screen.findByTestId('domain-field-slot-add'));
    expect((getDomainView()?.transitions['t_scan'] as { slots: number[][] }).slots).toHaveLength(3);
    await user.click(screen.getByTestId('domain-field-slot-2-remove'));
    expect((getDomainView()?.transitions['t_scan'] as { slots: number[][] }).slots).toHaveLength(2);
  });

  it('shows a hidden entry with a button to show it again', async () => {
    const user = await open();
    store().select(['t_sort']);
    hideSelected();
    expect(await screen.findByText(/Hidden in the view: hidden by user/)).toBeInTheDocument();
    await user.click(screen.getByTestId('domain-entry-show'));
    expect(getDomainView()?.transitions['t_sort']?.kind).toBe('station');
    expect(getDomainView()?.provenance['transitions.t_sort']?.source).toBe('generic');
  });

  it('resets an entry to generic', async () => {
    const user = await open();
    store().select(['t_sort']);
    await user.click(await screen.findByTestId('domain-entry-reset'));
    expect(getDomainView()?.provenance['transitions.t_sort']?.source).toBe('generic');
  });

  it('edits decor and keeps the JSON of the entry available', async () => {
    await open();
    useDomainEditStore.getState().selectDecor(1);
    expect(await screen.findByTestId('domain-entry-ref')).toHaveTextContent('decor[1]');
    expect(screen.getByTestId('domain-entry')).toHaveTextContent('"kind": "label"');
    const text = screen.getByTestId('domain-field-label');
    expect(text).toHaveValue('Halle 2 · Sortierung');
  });

  it('is locked while simulating', async () => {
    const user = await open();
    store().select(['t_sort']);
    await screen.findByTestId('domain-field-box-0');
    useEditorStore.setState({ mode: 'simulate' });
    // While simulating, the panel is one click away on its tab.
    await user.click(await screen.findByRole('tab', { name: 'Domain view' }));
    await waitFor(() => {
      expect(screen.getByTestId('domain-field-box-0')).toBeDisabled();
    });
  });
});

describe('the out-of-date card', () => {
  it('lists what is missing and stale and offers three separate actions', async () => {
    const user = await open();
    expect(screen.queryByTestId('domain-stale-card')).toBeNull();
    // A new place (V3) and a removed one (V2) both make the view out of date.
    const id = store().addPlace({ x: 10, y: 10 }) as string;
    store().select(['p_B']);
    store().removeSelected();
    const card = await screen.findByTestId('domain-stale-card');
    expect(card).toHaveTextContent('The view is out of date');
    expect(screen.getByTestId('domain-stale-list')).toHaveTextContent('1 element without an entry');
    expect(screen.getByTestId('domain-stale-list')).toHaveTextContent(
      /\d+ entries of removed elements/,
    );
    expect(screen.getByTestId('stale-update-hash')).toBeDisabled();

    const before = getDomainView();
    await user.click(screen.getByTestId('stale-fill'));
    const filled = getDomainView();
    expect(filled?.places[id]?.kind).toBeDefined();
    expect(filled?.provenance[`places.${id}`]?.source).toBe('generic');
    // The stale entry was kept: only the missing one was added.
    expect(filled?.places['p_B']).toEqual(before?.places['p_B']);
    expect(screen.getByTestId('stale-fill')).toBeDisabled();

    await user.click(screen.getByTestId('stale-remove'));
    expect(getDomainView()?.places['p_B']).toBeUndefined();
    expect(screen.getByTestId('stale-update-hash')).toBeEnabled();
    await user.click(screen.getByTestId('stale-update-hash'));
    await waitFor(() => {
      expect(screen.queryByTestId('domain-stale-card')).toBeNull();
    });
    expect(screen.getByTestId('domain-status')).toHaveTextContent('0 problems');
  });

  it('undoes each action on its own', async () => {
    const user = await open();
    const id = store().addPlace({ x: 10, y: 10 }) as string;
    await user.click(await screen.findByTestId('stale-fill'));
    expect(getDomainView()?.places[id]).toBeDefined();
    store().undo();
    await waitFor(() => {
      expect(getDomainView()?.places[id]).toBeUndefined();
    });
    expect(screen.getByTestId('stale-fill')).toBeEnabled();
  });
});

describe('reset all to generic', () => {
  it('asks first and replaces every entry', async () => {
    const user = await open();
    await user.click(screen.getByTestId('domain-reset-all'));
    expect(useUiStore.getState().confirm?.title).toMatch(/Replace/);
    expect(getDomainView()?.provenance['transitions.t_sort']?.source).toBe('user');
    useUiStore.getState().confirm?.onConfirm();
    await waitFor(() => {
      expect(getDomainView()?.provenance['transitions.t_sort']?.source).toBe('generic');
    });
  });
});

describe('the context menu', () => {
  it('adds decor on the empty sheet', async () => {
    const user = await open();
    await user.click(screen.getByTestId('domain-mode-edit'));
    const count = getDomainView()?.decor?.length ?? 0;
    fireEvent.contextMenu(screen.getByTestId('domain-canvas'), { clientX: 5, clientY: 5 });
    const item = await screen.findByTestId('domain-menu-add-room');
    await user.click(item);
    await waitFor(() => {
      expect(getDomainView()?.decor).toHaveLength(count + 1);
    });
    expect(getDomainView()?.decor?.at(-1)?.kind).toBe('room');
  });

  it('has no menu in Inspect mode', async () => {
    await open();
    fireEvent.contextMenu(screen.getByTestId('domain-canvas'), { clientX: 5, clientY: 5 });
    expect(screen.queryByTestId('context-menu')).toBeNull();
  });
});

describe('the shortcut help', () => {
  it('lists the keys and mouse actions of the edit mode', async () => {
    const user = await open();
    await user.keyboard('?');
    const list = await screen.findByTestId('shortcuts-list');
    expect(list).toHaveTextContent('Edit the layout of the domain view');
    expect(list).toHaveTextContent('Move the selected entry in the domain view');
    expect(list).toHaveTextContent('Hide the selected entry in the domain view');
    const mouse = screen.getByTestId('mouse-help');
    expect(mouse).toHaveTextContent('Drag in "Edit layout"');
    expect(mouse).toHaveTextContent('Shift+drag a corner handle');
  });
});
