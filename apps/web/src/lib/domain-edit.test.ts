import { ref, type DomainView, type Point } from '@pnm/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadExample } from '../test/domain-fixtures';
import { useDomainEditStore } from '../store/domain-edit-store';
import { useEditorStore } from '../store/editor-store';
import { useUiStore } from '../store/ui-store';
import { handleShortcut } from './commands';
import {
  addDecorAt,
  changeBox,
  changeKind,
  changeLabel,
  commitView,
  currentSelectedEntry,
  deleteSelectedEntry,
  domainEditActive,
  editView,
  hideSelected,
  nearestSegment,
  nudgeSelected,
  resetToGeneric,
  selectEntry,
  selectedEntry,
  showSelected,
} from './domain-edit';
import { previewDrag, type EditDrag } from './domain-drag';
import { getDomainView } from './domain-view';

const store = () => useEditorStore.getState();
const view = (): DomainView => {
  const found = getDomainView();
  if (!found) throw new Error('no view');
  return found;
};

beforeEach(() => {
  store().newNet();
  store().loadNet(loadExample('parcel-center'), 'parcel-center.pn.json');
  useUiStore.setState({
    toasts: [],
    confirm: null,
    viewMode: 'domain',
    domainEdit: true,
    snapToGrid: true,
  });
  useDomainEditStore.setState({ decor: null, renaming: null, menu: null, readout: null });
});

describe('edit mode', () => {
  it('is active only with a view, the domain view on screen and an editable net', () => {
    expect(domainEditActive()).toBe(true);
    useUiStore.setState({ domainEdit: false });
    expect(domainEditActive()).toBe(false);
    useUiStore.setState({ domainEdit: true, viewMode: 'net' });
    expect(domainEditActive()).toBe(false);
    useUiStore.setState({ viewMode: 'both' });
    expect(domainEditActive()).toBe(true);
    useEditorStore.setState({ mode: 'simulate' });
    expect(domainEditActive()).toBe(false);
  });

  it('maps the selection to the entry that edits apply to', () => {
    const net = store().net;
    const v = view();
    expect(selectedEntry(net, v, ['t_sort'], null)).toEqual(ref('transitions', 't_sort'));
    // The cells of a resource belong to the card of their transition.
    expect(selectedEntry(net, v, ['p_scanner'], null)).toEqual(ref('transitions', 't_scan'));
    expect(selectedEntry(net, v, [], 3)).toEqual(ref('decor', 3));
    expect(selectedEntry(net, v, [], 999)).toBeNull();
    expect(selectedEntry(net, v, ['t_sort', 'p_in'], null)).toBeNull();
    expect(selectedEntry(net, null, ['t_sort'], null)).toBeNull();
  });

  it('keeps the selection of decor and of net elements apart', () => {
    selectEntry(ref('decor', 2), null);
    expect(store().selection).toEqual([]);
    expect(useDomainEditStore.getState().decor).toBe(2);
    expect(currentSelectedEntry()).toEqual(ref('decor', 2));
    // A selection in the net replaces the decor.
    store().select(['t_sort']);
    expect(useDomainEditStore.getState().decor).toBeNull();
    selectEntry(ref('transitions', 't_scan'), 't_scan');
    expect(store().selection).toEqual(['t_scan']);
  });
});

describe('edits as undo steps', () => {
  it('records one undo step per edit and marks the entry as user-made', () => {
    store().select(['t_sort']);
    const before = store().past.length;
    expect(nudgeSelected(1, 0)).toBe(true);
    expect(store().past.length).toBe(before + 1);
    const entry = view().transitions['t_sort'];
    expect(entry).toMatchObject({ kind: 'machine', box: [521, 262, 100, 116] });
    expect(view().provenance['transitions.t_sort']?.source).toBe('user');
    store().undo();
    expect(view().transitions['t_sort']).toMatchObject({ box: [520, 262, 100, 116] });
  });

  it('commits a finished drag as one step', () => {
    const base = view();
    const moved = previewDragFor(base, ref('transitions', 't_sort'), [40, 24]);
    const before = store().past.length;
    expect(commitView(moved)).toBe(true);
    expect(store().past.length).toBe(before + 1);
    expect(view().transitions['t_sort']).toMatchObject({ box: [560, 288, 100, 116] });
    store().undo();
    expect(view()).toEqual(base);
  });

  it('does not record a step when nothing changed', () => {
    const before = store().past.length;
    expect(editView((v) => v)).toBe(false);
    expect(commitView(view())).toBe(false);
    expect(store().past.length).toBe(before);
  });

  it('refuses edits while the simulation runs', () => {
    store().select(['t_sort']);
    useEditorStore.setState({ mode: 'simulate' });
    expect(nudgeSelected(1, 0)).toBe(false);
    expect(useUiStore.getState().toasts[0]?.message).toMatch(/simulation/i);
  });

  it('sets labels, boxes and kinds through the same functions as the picture', () => {
    const t = ref('transitions', 't_sort');
    expect(changeLabel(t, 'Sorter 2')).toBe(true);
    expect(view().transitions['t_sort']).toMatchObject({ label: 'Sorter 2' });
    expect(changeBox(t, [100, 100, 120, 90])).toBe(true);
    expect(view().transitions['t_sort']).toMatchObject({ box: [100, 100, 120, 90] });
    expect(changeKind(t, 'gate')).toBe(true);
    expect(view().transitions['t_sort']?.kind).toBe('gate');
    expect(changeKind(t, 'door')).toBe(true);
    expect(view().transitions['t_sort']).toMatchObject({ kind: 'door', pos: [160, 145] });
    // A kind that the role does not allow is refused.
    expect(changeKind(ref('transitions', 't_arr'), 'station')).toBe(false);
    expect(view().transitions['t_arr']?.kind).toBe('dock');
  });
});

describe('hide instead of delete', () => {
  it('hides the entry with a reason and keeps the element in the net', () => {
    store().select(['t_sort']);
    const transitions = store().net.transitions.length;
    expect(deleteSelectedEntry()).toBe(true);
    expect(view().transitions['t_sort']).toEqual({ kind: 'hidden', reason: 'hidden by user' });
    expect(store().net.transitions).toHaveLength(transitions);
    expect(store().net.transitions.some((t) => t.id === 't_sort')).toBe(true);
    const toast = useUiStore.getState().toasts[0];
    expect(toast?.message).toMatch(/stays in the net/);
    toast?.action?.run();
    expect(view().transitions['t_sort']?.kind).toBe('machine');
  });

  it('shows a hidden entry again and resets entries to generic', () => {
    store().select(['t_sort']);
    hideSelected();
    expect(showSelected(ref('transitions', 't_sort'))).toBe(true);
    expect(view().transitions['t_sort']?.kind).toBe('station');
    expect(view().provenance['transitions.t_sort']?.source).toBe('generic');
    expect(resetToGeneric(ref('places', 'p_done'))).toBe(true);
    expect(view().provenance['places.p_done']?.source).toBe('generic');
  });

  it('removes decor for good', () => {
    const count = view().decor?.length ?? 0;
    selectEntry(ref('decor', 1), null);
    expect(deleteSelectedEntry()).toBe(true);
    expect(view().decor).toHaveLength(count - 1);
    expect(useDomainEditStore.getState().decor).toBeNull();
    store().undo();
    expect(view().decor).toHaveLength(count);
  });

  it('adds decor and selects it', () => {
    const count = view().decor?.length ?? 0;
    expect(addDecorAt('room', [400, 300])).toBe(true);
    expect(view().decor).toHaveLength(count + 1);
    expect(useDomainEditStore.getState().decor).toBe(count);
    expect(view().decor?.[count]?.kind).toBe('room');
  });
});

function previewDragFor(base: DomainView, target: EditDrag['target'], delta: Point): DomainView {
  const drag: EditDrag = { target, handle: null, start: [100, 100], base, moved: true };
  return previewDrag(
    drag,
    [100 + delta[0], 100 + delta[1]],
    { alt: false, shift: false },
    store().net,
    8,
  );
}

describe('previewDrag', () => {
  it('is a pure function of the drag: going back to the start gives the start view', () => {
    const base = view();
    const target = ref('transitions', 't_sort');
    const there = previewDragFor(base, target, [57, 33]);
    expect(there).not.toEqual(base);
    // Without the grid, a drag back to the start is the start.
    const drag: EditDrag = { target, handle: null, start: [100, 100], base, moved: true };
    const back = previewDrag(drag, [100, 100], { alt: true, shift: false }, store().net, 8);
    expect(back).toBe(base);
    expect(base.transitions['t_sort']).toMatchObject({ box: [520, 262, 100, 116] });
  });

  it('turns the grid off with Alt and keeps proportions with Shift', () => {
    const base = view();
    const target = ref('transitions', 't_sort');
    const drag: EditDrag = { target, handle: null, start: [0, 0], base, moved: true };
    const free = previewDrag(drag, [3, 5], { alt: true, shift: false }, store().net, 8);
    expect(free.transitions['t_sort']).toMatchObject({ box: [523, 267, 100, 116] });
    const snapped = previewDrag(drag, [3, 5], { alt: false, shift: false }, store().net, 8);
    expect(snapped.transitions['t_sort']).toMatchObject({ box: [520, 264, 100, 116] });
    const resize: EditDrag = {
      target,
      handle: {
        id: 'x',
        kind: 'resize-se',
        target,
        at: [620, 378],
        cursor: 'nwse-resize',
      },
      start: [0, 0],
      base,
      moved: true,
    };
    const kept = previewDrag(resize, [50, 0], { alt: true, shift: true }, store().net, 8);
    const box = (kept.transitions['t_sort'] as { box: number[] }).box;
    expect((box[2] ?? 0) / (box[3] ?? 1)).toBeCloseTo(100 / 116, 1);
  });

  it('adds a point when a segment handle is dragged', () => {
    const base = view();
    const target = ref('places', 'p_in');
    const drag: EditDrag = {
      target,
      handle: { id: 's', kind: 'segment', target, index: 0, at: [176, 320], cursor: 'copy' },
      start: [176, 320],
      base,
      moved: true,
    };
    const next = previewDrag(drag, [176, 400], { alt: false, shift: false }, store().net, 8);
    const path = (next.places['p_in'] as { path: number[][] }).path;
    expect(path).toHaveLength(3);
    expect(path[1]).toEqual([176, 400]);
    // Letting go at once still adds the point in the middle.
    const still = previewDrag(drag, [176, 320], { alt: false, shift: false }, store().net, 8);
    expect((still.places['p_in'] as { path: number[][] }).path[1]).toEqual([176, 320]);
  });
});

describe('nearestSegment', () => {
  it('finds the segment and the point on it', () => {
    const path: Point[] = [
      [0, 0],
      [100, 0],
      [100, 100],
    ];
    expect(nearestSegment(path, [60, 8])).toEqual({ index: 0, at: [60, 0], distance: 8 });
    expect(nearestSegment(path, [95, 70])?.index).toBe(1);
    expect(nearestSegment([[1, 1]], [0, 0])).toBeNull();
  });
});

describe('keyboard', () => {
  function press(key: string, init: KeyboardEventInit = {}): void {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('data-testid', 'domain-canvas');
    document.body.append(canvas);
    canvas.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    );
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    Object.defineProperty(event, 'target', { value: canvas });
    handleShortcut(event);
    canvas.remove();
  }

  it('moves the selected entry with the arrow keys, 8 px with Shift', () => {
    store().select(['t_sort']);
    press('ArrowRight');
    expect(view().transitions['t_sort']).toMatchObject({ box: [521, 262, 100, 116] });
    press('ArrowDown', { shiftKey: true });
    expect(view().transitions['t_sort']).toMatchObject({ box: [521, 270, 100, 116] });
    // The net node did not move.
    expect(store().net.transitions.find((t) => t.id === 't_sort')?.position).toEqual(
      loadExample('parcel-center').transitions.find((t) => t.id === 't_sort')?.position,
    );
  });

  it('hides the selection on Delete instead of deleting it', () => {
    store().select(['t_sort']);
    press('Delete');
    expect(view().transitions['t_sort']?.kind).toBe('hidden');
    expect(store().net.transitions.some((t) => t.id === 't_sort')).toBe(true);
  });

  it('toggles the mode with E', () => {
    useUiStore.setState({ domainEdit: false });
    press('e');
    expect(useUiStore.getState().domainEdit).toBe(true);
    press('e');
    expect(useUiStore.getState().domainEdit).toBe(false);
    useUiStore.setState({ viewMode: 'net' });
    press('e');
    expect(useUiStore.getState().domainEdit).toBe(false);
  });
});
