import type { Id, Position } from '@pnm/core';

/** Operations on the canvas viewport that components outside the canvas need. */
export interface ViewApi {
  fitView(): void;
  /** Centers the viewport on the given elements. */
  focus(ids: Id[]): void;
  /** Pans the viewport just far enough that the given nodes are visible. */
  reveal(ids: Id[]): void;
  /** Sets the zoom to 100 %, keeping the center of the view. */
  resetZoom(): void;
  /** Model coordinates of the middle of the visible canvas. */
  center(): Position | null;
}

let current: ViewApi | null = null;

export function registerViewApi(api: ViewApi | null): void {
  current = api;
}

export function getViewApi(): ViewApi | null {
  return current;
}
