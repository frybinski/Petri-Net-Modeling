import type { PetriNet } from '@pnm/core';
import {
  decorAt,
  entryBounds,
  handlesFor,
  hiddenPlaceholders,
  hitHandle,
  placeholderAt,
  ref,
  refOfElement,
  removePoint,
  sameRef,
  staticLayoutState,
  type DomainView,
  type EntryRef,
  type Placeholder,
  type Point,
} from '@pnm/domain';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type MutableRefObject,
  type RefObject,
} from 'react';
import { currentSimState } from '../../lib/domain-state';
import {
  commitView,
  editView,
  gridStep,
  selectEntry,
  selectedEntry,
  startLabelEdit,
} from '../../lib/domain-edit';
import { describeGeometry, previewDrag, type EditDrag } from '../../lib/domain-drag';
import { EMPTY_OVERLAY, type EditOverlay } from '../../lib/domain-edit-paint';
import type { DomainAnimator } from '../../lib/domain-animator';
import { toSheet, type Viewport } from '../../lib/viewport';
import { useDomainEditStore } from '../../store/domain-edit-store';
import { useEditorStore } from '../../store/editor-store';

/** A press that moves less than this many pixels is a click, not a drag. */
const CLICK_SLOP = 4;
/** How far a handle reaches on the screen, in CSS pixels. */
const HANDLE_REACH = 9;
const HANDLE_REACH_TOUCH = 16;

interface Args {
  animator: DomainAnimator;
  viewportRef: RefObject<Viewport>;
  net: PetriNet;
  /** The view of the document. */
  view: DomainView | null;
  editing: boolean;
  selection: readonly string[];
  decor: number | null;
  /** Where the overlay for the painter is kept (the painter reads it every frame). */
  overlayRef: MutableRefObject<EditOverlay>;
  schedulePaint: () => void;
  hitAt: (px: number, py: number) => { elementId: string; kind: string } | null;
}

interface ActiveDrag {
  drag: EditDrag;
  startScreen: Point;
  preview: DomainView | null;
}

type PointerLike = Pick<
  ReactPointerEvent<HTMLElement>,
  'altKey' | 'shiftKey' | 'pointerType' | 'buttons'
>;

/**
 * The mode "Edit layout" of the domain canvas: selection, handles, drags with a live preview and
 * the commit of a finished drag as one undo step. The canvas calls the handlers first and only
 * handles the event itself (panning, cases) when they return false.
 */
export function useDomainEditing(args: Args) {
  const {
    animator,
    viewportRef,
    net,
    view,
    editing,
    selection,
    decor,
    overlayRef,
    schedulePaint,
    hitAt,
  } = args;
  const active = useRef<ActiveDrag | null>(null);
  const hoverHandle = useRef<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);

  const entry = useMemo(
    () => selectedEntry(net, view, selection, decor),
    [net, view, selection, decor],
  );
  const placeholders = useMemo(
    () => (editing && view ? hiddenPlaceholders(net, view) : []),
    [editing, net, view],
  );

  // Latest values for handlers that outlive a render (a drag).
  const latest = useRef({ net, entry, editing, placeholders, selection });
  useEffect(() => {
    latest.current = { net, entry, editing, placeholders, selection };
  });

  /** Rebuilds what is drawn on top of the picture from a view (the preview during a drag). */
  const refresh = useCallback(
    (shown: DomainView | null, activeHandle: string | null = null): void => {
      const { entry: selected, editing: on, placeholders: holes, selection: ids } = latest.current;
      if (!on || !shown) {
        overlayRef.current = EMPTY_OVERLAY;
        schedulePaint();
        return;
      }
      const handles = selected ? handlesFor(shown, selected) : [];
      let frame = selected ? entryBounds(shown, selected) : null;
      const marked = holes.map((h): Placeholder & { selected: boolean } => ({
        ...h,
        selected: ids.includes(h.elementId),
      }));
      if (!frame && selected) {
        // A hidden entry has no geometry: its placeholder is the frame.
        frame = marked.find((h) => sameRef(h.entry, selected))?.rect ?? null;
      }
      overlayRef.current = {
        frame,
        handles,
        hover: hoverHandle.current,
        active: activeHandle,
        placeholders: marked,
      };
      schedulePaint();
    },
    [overlayRef, schedulePaint],
  );

  useEffect(() => {
    hoverHandle.current = null;
    refresh(editing ? view : null);
  }, [editing, view, entry, placeholders, selection, refresh]);

  const reach = (event: PointerLike): number =>
    (event.pointerType === 'touch' ? HANDLE_REACH_TOUCH : HANDLE_REACH) / viewportRef.current.zoom;

  const sheetPoint = (px: number, py: number): Point => toSheet(viewportRef.current, px, py);

  /** Shows the view of the document again after a preview that was not kept. */
  const restore = useCallback((): void => {
    animator.setModel(
      latest.current.net,
      view,
      currentSimState() ?? staticLayoutState(latest.current.net),
    );
  }, [animator, view]);

  /** The entry under a point and the net element it stands for, in the order of what is on top. */
  const entryAtPoint = (
    px: number,
    py: number,
    p: Point,
    shown: DomainView,
  ): { entry: EntryRef; elementId: string | null } | null => {
    const hit = hitAt(px, py);
    if (hit) {
      const found = refOfElement(latest.current.net, shown, hit.elementId);
      return found ? { entry: found, elementId: hit.elementId } : null;
    }
    const hole = placeholderAt(latest.current.placeholders, p, 2 / viewportRef.current.zoom);
    if (hole) return { entry: hole.entry, elementId: hole.elementId };
    const index = decorAt(shown, p, 3 / viewportRef.current.zoom);
    return index === null ? null : { entry: ref('decor', index), elementId: null };
  };

  const pointerDown = (event: ReactPointerEvent<HTMLElement>, px: number, py: number): boolean => {
    const shown = animator.view;
    if (!latest.current.editing || !shown || event.button !== 0) return false;
    const p = sheetPoint(px, py);
    const selected = latest.current.entry;
    const begin = (target: EntryRef, handle: EditDrag['handle']): void => {
      active.current = {
        drag: { target, handle, start: p, base: shown, moved: false },
        startScreen: [px, py],
        preview: null,
      };
      refresh(shown, handle?.id ?? null);
    };

    // 1. A handle of the selected entry (not its surface).
    if (selected) {
      const handles = handlesFor(shown, selected);
      const handle = hitHandle(handles, p, reach(event));
      if (handle && handle.kind !== 'move') {
        begin(selected, handle);
        return true;
      }
    }
    // 2. An element or a piece of decor: select it and drag it by its surface.
    const found = entryAtPoint(px, py, p, shown);
    if (found) {
      if (event.shiftKey && found.elementId !== null) {
        const ids = latest.current.selection;
        useEditorStore
          .getState()
          .select(
            ids.includes(found.elementId)
              ? ids.filter((id) => id !== found.elementId)
              : [...ids, found.elementId],
          );
        return true;
      }
      if (!sameRef(found.entry, selected)) selectEntry(found.entry, found.elementId);
      // Hidden entries have no geometry to drag.
      if (entryBounds(shown, found.entry)) begin(found.entry, null);
      return true;
    }
    // 3. The surface of the selected entry.
    if (selected) {
      const handle = hitHandle(handlesFor(shown, selected), p, 0);
      if (handle) {
        begin(selected, handle);
        return true;
      }
    }
    return false;
  };

  const pointerMove = (event: ReactPointerEvent<HTMLElement>, px: number, py: number): boolean => {
    if (!latest.current.editing) return false;
    const current = active.current;
    if (current && event.buttons !== 0) {
      const slop = Math.hypot(px - current.startScreen[0], py - current.startScreen[1]);
      if (!current.drag.moved && slop <= CLICK_SLOP) return true;
      current.drag.moved = true;
      const next = previewDrag(
        current.drag,
        sheetPoint(px, py),
        { alt: event.altKey, shift: event.shiftKey },
        latest.current.net,
        gridStep(),
      );
      current.preview = next;
      setCursor(current.drag.handle?.cursor ?? 'move');
      animator.setModel(
        latest.current.net,
        next,
        currentSimState() ?? staticLayoutState(latest.current.net),
      );
      refresh(next, current.drag.handle?.id ?? null);
      useDomainEditStore.getState().setReadout({
        text: describeGeometry(next, current.drag.target),
        x: px,
        y: py,
      });
      return true;
    }
    // Hovering: show the cursor of the handle under the pointer.
    const shown = animator.view;
    if (!shown) return false;
    const p = sheetPoint(px, py);
    const selected = latest.current.entry;
    const handle = selected ? hitHandle(handlesFor(shown, selected), p, reach(event)) : null;
    const id = handle && handle.kind !== 'move' ? handle.id : null;
    if (id !== hoverHandle.current) {
      hoverHandle.current = id;
      overlayRef.current = { ...overlayRef.current, hover: id };
      schedulePaint();
    }
    if (id !== null && handle) setCursor(handle.cursor);
    else if (entryAtPoint(px, py, p, shown)) setCursor('move');
    else setCursor(null);
    return false;
  };

  const pointerUp = (event: ReactPointerEvent<HTMLElement>, cancelled = false): boolean => {
    const current = active.current;
    if (!current) return false;
    active.current = null;
    useDomainEditStore.getState().setReadout(null);
    const { drag } = current;
    let final = current.preview;
    // Grabbing the middle of a segment and letting go at once still adds the point.
    if (!cancelled && !drag.moved && drag.handle?.kind === 'segment') {
      final = previewDrag(
        drag,
        drag.start,
        { alt: event.altKey, shift: event.shiftKey },
        latest.current.net,
        gridStep(),
      );
    }
    if (!cancelled && final && final !== drag.base) {
      if (!commitView(final)) restore();
    } else if (current.preview) {
      restore();
    }
    refresh(view);
    return true;
  };

  /** Ends the drag without a change (Escape, a lost pointer). */
  const cancel = useCallback((): boolean => {
    const current = active.current;
    if (!current) return false;
    active.current = null;
    useDomainEditStore.getState().setReadout(null);
    if (current.preview) restore();
    refresh(view);
    return true;
  }, [refresh, restore, view]);

  const doubleClick = (px: number, py: number): boolean => {
    const shown = animator.view;
    const selected = latest.current.entry;
    if (!latest.current.editing || !shown) return false;
    const p = sheetPoint(px, py);
    if (selected) {
      const handle = hitHandle(
        handlesFor(shown, selected),
        p,
        HANDLE_REACH / viewportRef.current.zoom,
      );
      if (handle?.kind === 'point' && handle.part !== 'wall') {
        editView((v) => removePoint(v, selected, handle.index ?? 0));
        return true;
      }
    }
    const found = entryAtPoint(px, py, p, shown);
    if (!found) return false;
    startLabelEdit(found.entry);
    return true;
  };

  /** Records what was right-clicked, for the context menu that Radix opens next. */
  const contextMenu = (px: number, py: number): void => {
    const shown = animator.view;
    if (!latest.current.editing || !shown) return;
    const p = sheetPoint(px, py);
    const selected = latest.current.entry;
    const onHandle = selected
      ? hitHandle(handlesFor(shown, selected), p, HANDLE_REACH / viewportRef.current.zoom)
      : null;
    let target: EntryRef | null = null;
    if (onHandle && selected) target = selected;
    else {
      // A right click selects what is under it, like in the net editor.
      const found = entryAtPoint(px, py, p, shown);
      if (found) {
        if (!sameRef(found.entry, selected)) selectEntry(found.entry, found.elementId);
        target = found.entry;
      }
    }
    useDomainEditStore.getState().setMenu({ entry: target, at: p });
  };

  return {
    cursor,
    entry,
    pointerDown,
    pointerMove,
    pointerUp,
    cancel,
    doubleClick,
    contextMenu,
  };
}
