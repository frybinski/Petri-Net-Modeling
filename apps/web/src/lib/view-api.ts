import type { Id } from '@pnm/core';

/** Operations on the canvas viewport that components outside the canvas need. */
export interface ViewApi {
  fitView(): void;
  /** Centers the viewport on the given elements. */
  focus(ids: Id[]): void;
}

let current: ViewApi | null = null;

export function registerViewApi(api: ViewApi | null): void {
  current = api;
}

export function getViewApi(): ViewApi | null {
  return current;
}
