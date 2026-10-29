/** Operations on the viewport of the domain view that components outside it need. */
export interface DomainViewApi {
  fitView(): void;
  /** Sets the zoom to 100 %, keeping the center of the view. */
  resetZoom(): void;
  /** Pans the view so that the rectangle (sheet pixels) is fully visible, if it is not. */
  reveal(rect: [number, number, number, number]): void;
  /** Cancels the drag of the mode "Edit layout" that is going on. Returns true if there was one. */
  cancelDrag(): boolean;
}

let current: DomainViewApi | null = null;

export function registerDomainViewApi(api: DomainViewApi | null): void {
  current = api;
}

export function getDomainViewApi(): DomainViewApi | null {
  return current;
}
