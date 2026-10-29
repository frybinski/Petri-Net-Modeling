/** How much detail the canvas shows: the labels of nodes and arcs fade out when zoomed out. */
export type ZoomLevel = 'detail' | 'mid' | 'far';

/** Zoom at which the detail labels (types, guards, inscriptions, token chips) disappear. */
export const ZOOM_MID = 0.7;
/** Zoom at which the names disappear as well and only the shapes remain. */
export const ZOOM_FAR = 0.4;

export function zoomLevel(zoom: number): ZoomLevel {
  if (zoom >= ZOOM_MID) return 'detail';
  if (zoom >= ZOOM_FAR) return 'mid';
  return 'far';
}

/** Fitting the view never zooms in further than this: small nets fill a wide canvas. */
export const FIT_MAX_ZOOM = 2;
