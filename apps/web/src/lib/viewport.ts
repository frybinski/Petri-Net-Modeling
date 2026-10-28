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

/** A rectangle in the coordinates of the view (CSS pixels from its top left corner). */
export interface ViewRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Fits the sheet into the view and keeps it clear of floating controls. It looks for the largest
 * zoom at which the sheet has a place, as close to the center as possible, that no control covers:
 * a bar at the top that lies beside the sheet (because the sheet is narrow in a wide view) costs
 * nothing, one that lies over it pushes the sheet down, and a corner control can be dodged by
 * moving the sheet a little to the side.
 */
export function fitAround(
  sheet: { width: number; height: number },
  view: { width: number; height: number },
  overlays: readonly ViewRect[],
  gap = 10,
): Viewport {
  const plain = fitViewport(sheet, view);
  if (view.width <= 0 || view.height <= 0 || sheet.width <= 0 || sheet.height <= 0) return plain;
  const free = (x: number, y: number, zoom: number): boolean => {
    const right = x + sheet.width * zoom + gap;
    const lower = y + sheet.height * zoom + gap;
    return overlays.every(
      (o) => o.left >= right || o.right <= x - gap || o.top >= lower || o.bottom <= y - gap,
    );
  };
  const steps = [0.5, 0, 1, 0.25, 0.75, 0.1, 0.9];
  for (let zoom = plain.zoom; zoom >= MIN_ZOOM; zoom *= 0.97) {
    const width = sheet.width * zoom;
    const height = sheet.height * zoom;
    const xMin = FIT_PADDING;
    const xMax = view.width - FIT_PADDING - width;
    const yMin = FIT_PADDING;
    const yMax = view.height - FIT_PADDING - height;
    if (xMax < xMin - 1e-6 || yMax < yMin - 1e-6) continue;
    for (const ty of steps) {
      for (const tx of steps) {
        const x = xMin + (xMax - xMin) * tx;
        const y = yMin + (yMax - yMin) * ty;
        if (free(x, y, zoom)) return { x, y, zoom };
      }
    }
  }
  return plain;
}
