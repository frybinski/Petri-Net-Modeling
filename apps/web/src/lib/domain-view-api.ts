/** Operations on the viewport of the domain view that components outside it need. */
export interface DomainViewApi {
  fitView(): void;
  /** Sets the zoom to 100 %, keeping the center of the view. */
  resetZoom(): void;
}

let current: DomainViewApi | null = null;

export function registerDomainViewApi(api: DomainViewApi | null): void {
  current = api;
}

export function getDomainViewApi(): DomainViewApi | null {
  return current;
}
