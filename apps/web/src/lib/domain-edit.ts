import type { PetriNet } from '@pnm/core';
import {
  addDecor,
  addSlot,
  decorAt,
  distanceToSegment,
  entryOf,
  GRID,
  hideEntry,
  insertPoint,
  moveEntry,
  movePoint,
  moveSlot,
  newDecor,
  normalizeDomainView,
  ref,
  refOfElement,
  removeDecor,
  removePoint,
  removeSlot,
  resetEntry,
  setBox,
  setEntryKind,
  setLabel,
  setPass,
  setSensor,
  showEntry,
  type Decor,
  type DomainView,
  type EntryRef,
  type Point,
  type Rect,
} from '@pnm/domain';
import { en } from '../i18n/en';
import { useDomainEditStore } from '../store/domain-edit-store';
import { useEditorStore } from '../store/editor-store';
import { notify, useUiStore } from '../store/ui-store';
import { domainEditActive, registerDomainEditApi } from './domain-edit-api';
import { getDomainView } from './domain-view';

export { domainEditActive };

/** The grid for edits: 8 px when snapping is on in the editor, else whole pixels only. */
export function gridStep(): number {
  return useUiStore.getState().snapToGrid ? GRID : 0;
}

/** The entry that the selection stands for: a piece of decor, or the entry of the one selected element. */
export function selectedEntry(
  net: PetriNet,
  view: DomainView | null,
  selection: readonly string[],
  decor: number | null,
): EntryRef | null {
  if (!view) return null;
  if (decor !== null && (view.decor?.[decor] ?? null) !== null) return ref('decor', decor);
  const id = selection.length === 1 ? selection[0] : undefined;
  return id === undefined ? null : refOfElement(net, view, id);
}

/** The entry that is selected right now. */
export function currentSelectedEntry(): EntryRef | null {
  const state = useEditorStore.getState();
  return selectedEntry(
    state.net,
    getDomainView(),
    state.selection,
    useDomainEditStore.getState().decor,
  );
}

/** Selects an entry: a net element in both views, or a piece of decor in the domain view only. */
export function selectEntry(entry: EntryRef | null, elementId: string | null): void {
  const editor = useEditorStore.getState();
  const decor = useDomainEditStore.getState();
  if (entry?.section === 'decor') {
    editor.clearSelection();
    decor.selectDecor(Number(entry.key));
  } else if (elementId !== null) {
    decor.selectDecor(null);
    editor.select([elementId]);
  } else {
    decor.selectDecor(null);
    editor.clearSelection();
  }
}

/**
 * Runs an edit of the view as one undo step. The edit is a pure function of the view; the
 * result is checked against the schema before it goes into the document.
 */
export function editView(change: (view: DomainView, net: PetriNet) => DomainView): boolean {
  const state = useEditorStore.getState();
  if (state.mode === 'simulate') {
    notify('info', en.messages.editLocked);
    return false;
  }
  const view = getDomainView();
  if (!view) return false;
  const next = change(view, state.net);
  // A drag that ends where it began changes nothing and must not leave an undo step.
  if (next === view || JSON.stringify(next) === JSON.stringify(view)) return false;
  try {
    state.setDomainView(normalizeDomainView(next));
  } catch (error) {
    notify('error', error instanceof Error ? error.message : String(error));
    return false;
  }
  return true;
}

/** Puts a finished view (for example the result of a drag) into the document. One undo step. */
export function commitView(next: DomainView): boolean {
  return editView(() => next);
}

/** The options for edits of the view: the grid and the net (arcs follow what they touch). */
function options(net: PetriNet) {
  return { snap: gridStep(), net };
}

export function nudgeSelected(dx: number, dy: number): boolean {
  const entry = currentSelectedEntry();
  if (!entry) return false;
  return editView((view, net) => moveEntry(view, entry, [dx, dy], { snap: 0, net }));
}

/**
 * "Delete" in the mode "Edit layout": decor goes for good, anything else is hidden in the view
 * (the net keeps the element, undo brings the entry back).
 */
export function deleteSelectedEntry(): boolean {
  const entry = currentSelectedEntry();
  if (!entry) return false;
  if (entry.section === 'decor') {
    const done = editView((view) => removeDecor(view, Number(entry.key)));
    if (done) useDomainEditStore.getState().selectDecor(null);
    return done;
  }
  return hideSelected();
}

export function hideSelected(): boolean {
  const entry = currentSelectedEntry();
  if (!entry || entry.section === 'decor' || entry.section === 'arcs') return false;
  const done = editView((view, net) => hideEntry(view, net, entry, en.domain.hiddenByUser));
  if (done) {
    notify('info', en.domain.hiddenToast, {
      action: {
        label: en.domain.undo,
        run: () => {
          useEditorStore.getState().undo();
        },
      },
    });
  }
  return done;
}

export function showSelected(entry: EntryRef): boolean {
  return editView((view, net) => showEntry(view, net, entry));
}

export function resetToGeneric(entry: EntryRef): boolean {
  const { section, key } = entry;
  if (section === 'decor') return false;
  return editView((view, net) => resetEntry(net, view, { section, key }));
}

export function changeKind(entry: EntryRef, kind: string): boolean {
  return editView((view, net) => setEntryKind(view, net, entry, kind));
}

export function changeLabel(entry: EntryRef, label: string): boolean {
  return editView((view) => setLabel(view, entry, label));
}

export function changeSensor(entry: EntryRef, sensor: string): boolean {
  return editView((view) => setSensor(view, entry, sensor));
}

export function changePass(entry: EntryRef, pass: boolean | undefined): boolean {
  return editView((view) => setPass(view, entry, pass));
}

export function changeBox(entry: EntryRef, rect: Rect): boolean {
  return editView((view, net) => setBox(view, entry, rect, options(net)));
}

export function changePos(entry: EntryRef, pos: Point): boolean {
  return editView((view, net) => {
    const current = entryOf(view, entry);
    if (!current || !('pos' in current)) return view;
    return moveEntry(view, entry, [pos[0] - current.pos[0], pos[1] - current.pos[1]], {
      snap: 0,
      net,
    });
  });
}

/** Adds a piece of decor around `at` and selects it. */
export function addDecorAt(kind: Decor['kind'], at: Point): boolean {
  let index = -1;
  const done = editView((view) => {
    const added = addDecor(view, newDecor(kind, at, view.meta.canvas, gridStep()));
    index = added.index;
    return added.view;
  });
  if (done && index >= 0) selectEntry(ref('decor', index), null);
  return done;
}

/** The segment of a path nearest to a point, with the nearest point on it. */
export function nearestSegment(
  path: readonly Point[],
  p: Point,
): { index: number; at: Point; distance: number } | null {
  let best: { index: number; at: Point; distance: number } | null = null;
  for (let i = 0; i + 1 < path.length; i += 1) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const d = distanceToSegment(p, a, b);
    if (best === null || d < best.distance) {
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const lengthSquared = dx * dx + dy * dy;
      const t =
        lengthSquared === 0
          ? 0
          : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared));
      best = { index: i, at: [a[0] + t * dx, a[1] + t * dy], distance: d };
    }
  }
  return best;
}

/** The points of a path-like entry, if it has some. */
export function pathOf(view: DomainView, entry: EntryRef): Point[] | null {
  const found = entryOf(view, entry);
  if (!found) return null;
  if ('path' in found) return found.path;
  return null;
}

/** "Add point" from the context menu: on the segment nearest to the click. */
export function addPointAt(entry: EntryRef, at: Point): boolean {
  return editView((view) => {
    const path = pathOf(view, entry);
    const near = path ? nearestSegment(path, at) : null;
    return near ? insertPoint(view, entry, near.index, near.at) : view;
  });
}

/** "Remove point" from the context menu: the point nearest to the click (a path keeps two). */
export function removePointAt(entry: EntryRef, at: Point): boolean {
  return editView((view) => {
    const path = pathOf(view, entry);
    if (!path || path.length <= 2) return view;
    let best = 0;
    let bestDistance = Infinity;
    path.forEach((p, i) => {
      const d = Math.hypot(p[0] - at[0], p[1] - at[1]);
      if (d < bestDistance) {
        best = i;
        bestDistance = d;
      }
    });
    return removePoint(view, entry, best);
  });
}

export function addSlotAt(entry: EntryRef, at: Point): boolean {
  return editView((view) => addSlot(view, entry, at));
}

/** "Remove slot" from the context menu: the slot nearest to the click. */
export function removeSlotAt(entry: EntryRef, at: Point): boolean {
  return editView((view) => {
    const found = entryOf(view, entry);
    if (!found || !('slots' in found) || !found.slots || found.slots.length === 0) return view;
    let best = 0;
    let bestDistance = Infinity;
    found.slots.forEach((p, i) => {
      const d = Math.hypot(p[0] - at[0], p[1] - at[1]);
      if (d < bestDistance) {
        best = i;
        bestDistance = d;
      }
    });
    return removeSlot(view, entry, best);
  });
}

/** True if the user can edit an entry's label in place. */
export function hasLabel(view: DomainView, entry: EntryRef): boolean {
  const found = entryOf(view, entry);
  if (!found || !('kind' in found)) return false;
  switch (found.kind) {
    case 'hidden':
    case 'furniture':
    case 'wall':
      return false;
    default:
      return true;
  }
}

/** The text in the label field when it opens: the label, else the name of the element. */
export function labelText(net: PetriNet, view: DomainView, entry: EntryRef): string {
  const found = entryOf(view, entry);
  if (!found || !('kind' in found)) return '';
  if (found.kind === 'label') return found.text;
  if ('label' in found && found.label !== undefined) return found.label;
  if (entry.section === 'places') return net.places.find((p) => p.id === entry.key)?.name ?? '';
  if (entry.section === 'transitions') {
    return net.transitions.find((t) => t.id === entry.key)?.name ?? '';
  }
  return '';
}

export function startLabelEdit(entry: EntryRef): void {
  const view = getDomainView();
  if (view && hasLabel(view, entry)) useDomainEditStore.getState().startRename(entry);
}

/** Opens the JSON editor of the panel at the entry. */
export function editJson(entry: EntryRef): void {
  const ui = useUiStore.getState();
  if (ui.viewMode === 'net') ui.setViewMode('domain');
  else ui.setRightTab('domain');
  ui.revealJson(
    entry.section === 'decor' ? `decor[${entry.key}]` : `${entry.section}.${entry.key}`,
  );
}

/** The entry under a point of the sheet when the scene found no element (decor). */
export function decorEntryAt(view: DomainView, p: Point, slack: number): EntryRef | null {
  const index = decorAt(view, p, slack);
  return index === null ? null : ref('decor', index);
}

/** Moves one point of a path or wall of an entry to exact coordinates (the panel fields). */
export function setPointAt(entry: EntryRef, index: number, to: Point): boolean {
  return editView((view, net) => movePoint(view, entry, index, to, { snap: 0, net }));
}

/** Adds a point after the point `index` (in the middle of the next segment). */
export function insertPointAfter(entry: EntryRef, index: number): boolean {
  return editView((view) => insertPoint(view, entry, index));
}

export function removePointIndex(entry: EntryRef, index: number): boolean {
  return editView((view) => removePoint(view, entry, index));
}

export function setSlotAt(entry: EntryRef, index: number, to: Point): boolean {
  return editView((view) => moveSlot(view, entry, index, to, { snap: 0 }));
}

export function addSlotDefault(entry: EntryRef): boolean {
  return editView((view) => addSlot(view, entry));
}

export function removeSlotIndex(entry: EntryRef, index: number): boolean {
  return editView((view) => removeSlot(view, entry, index));
}

// The keyboard commands reach the editing of the view through this registration.
registerDomainEditApi({
  hasView: () => getDomainView() !== null,
  selectedEntry: currentSelectedEntry,
  deleteSelected: deleteSelectedEntry,
  nudgeSelected,
  startLabel: startLabelEdit,
});
