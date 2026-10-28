/** Position and zoom of the sheet inside its canvas element (CSS pixels). */
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
/** Space around the sheet when it is fitted into the view. */
export const FIT_PADDING = 28;
/** Fitting never zooms in further than this. */
export const MAX_FIT_ZOOM = 1.6;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Space that floating controls take at the edges of the view, in CSS pixels. */
export interface Insets {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

/**
 * The viewport that shows the whole sheet, centered, in a view of the given size. `insets` keep
 * the sheet clear of controls that float over the view.
 */
export function fitViewport(
  sheet: { width: number; height: number },
  view: { width: number; height: number },
  insets: Insets = {},
): Viewport {
  if (view.width <= 0 || view.height <= 0 || sheet.width <= 0 || sheet.height <= 0) {
    return { x: 0, y: 0, zoom: 1 };
  }
  const { top = 0, bottom = 0, left = 0, right = 0 } = insets;
  const width = Math.max(1, view.width - left - right);
  const height = Math.max(1, view.height - top - bottom);
  const zoom = Math.min(
    MAX_FIT_ZOOM,
    clampZoom(
      Math.min((width - 2 * FIT_PADDING) / sheet.width, (height - 2 * FIT_PADDING) / sheet.height),
    ),
  );
  return {
    x: left + (width - sheet.width * zoom) / 2,
    y: top + (height - sheet.height * zoom) / 2,
    zoom,
  };
}

/** Zooms by `factor` so that the sheet point under (`cx`, `cy`) stays where it is. */
export function zoomAround(viewport: Viewport, factor: number, cx: number, cy: number): Viewport {
  const zoom = clampZoom(viewport.zoom * factor);
  const ratio = zoom / viewport.zoom;
  return { x: cx - (cx - viewport.x) * ratio, y: cy - (cy - viewport.y) * ratio, zoom };
}

/** The sheet point under a point of the canvas element. */
export function toSheet(viewport: Viewport, px: number, py: number): [number, number] {
  return [(px - viewport.x) / viewport.zoom, (py - viewport.y) / viewport.zoom];
}
