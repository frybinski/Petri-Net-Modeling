import type { PetriNet } from '@pnm/core';
import {
  entryBounds,
  insertPoint,
  moveEntry,
  movePoint,
  moveRoom,
  moveSlot,
  resizeEntry,
  type DomainView,
  type EntryRef,
  type Handle,
  type Point,
} from '@pnm/domain';

/** A drag in the mode "Edit layout": what is grabbed, where, and the view it started from. */
export interface EditDrag {
  target: EntryRef;
  /** The grabbed handle; `null` for a drag of the whole entry by its surface. */
  handle: Handle | null;
  /** Where the pointer went down, in sheet pixels. */
  start: Point;
  /** The view when the drag began. Every preview is computed from it. */
  base: DomainView;
  moved: boolean;
}

export interface DragModifiers {
  /** Alt switches the grid off. */
  alt: boolean;
  /** Shift keeps the proportions of a box that is resized by a corner. */
  shift: boolean;
}

/**
 * The view as it looks with the pointer at `pointer`. Pure: the same drag and pointer always give
 * the same view, so a drag that goes back to its start gives the start view again.
 */
export function previewDrag(
  drag: EditDrag,
  pointer: Point,
  modifiers: DragModifiers,
  net: PetriNet,
  grid: number,
): DomainView {
  const { base, target, handle } = drag;
  const delta: Point = [pointer[0] - drag.start[0], pointer[1] - drag.start[1]];
  const snap = modifiers.alt ? 0 : grid;
  const options = { snap, net, keepAspect: modifiers.shift };
  if (handle === null || handle.kind === 'pos' || (handle.kind === 'move' && !handle.part)) {
    return moveEntry(base, target, delta, options);
  }
  switch (handle.kind) {
    case 'move':
      return handle.part === 'room' && handle.index !== undefined
        ? moveRoom(base, target, handle.index, delta, options)
        : base;
    case 'point':
      return movePoint(
        base,
        target,
        handle.index ?? 0,
        [handle.at[0] + delta[0], handle.at[1] + delta[1]],
        options,
      );
    case 'slot':
      return moveSlot(
        base,
        target,
        handle.index ?? 0,
        [handle.at[0] + delta[0], handle.at[1] + delta[1]],
        options,
      );
    case 'segment': {
      // Grabbing the middle of a segment adds a point there and drags it.
      const index = handle.index ?? 0;
      const inserted = insertPoint(base, target, index, handle.at, options);
      return movePoint(
        inserted,
        target,
        index + 1,
        [handle.at[0] + delta[0], handle.at[1] + delta[1]],
        options,
      );
    }
    default:
      return resizeEntry(base, target, handle.kind, delta, {
        ...options,
        ...(handle.part === 'room' && handle.index !== undefined && { room: handle.index }),
      });
  }
}

/** A short text for the badge next to the pointer: where the entry is and how large. */
export function describeGeometry(view: DomainView, target: EntryRef): string {
  const bounds = entryBounds(view, target);
  if (!bounds) return '';
  const [x, y, w, h] = bounds.map((n) => Math.round(n)) as [number, number, number, number];
  return w > 0 && h > 0 ? `${x}, ${y}  ·  ${w} × ${h}` : `${x}, ${y}`;
}
