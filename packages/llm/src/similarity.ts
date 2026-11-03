import {
  distance,
  pathLength,
  pointAlong,
  rectCenter,
  sameAppearance,
  type DomainView,
  type Point,
} from '@pnm/domain';

/** How close a view is to a reference view of the same net. */
export interface ViewSimilarity {
  /** Places and transitions of the reference; the denominator of the kind agreement. */
  elements: number;
  /** Elements whose `kind` is the same, in percent of `elements` (100 for two empty views). */
  kindPercent: number;
  /** Elements that have a center in both views; the count behind `meanDistance`. */
  centered: number;
  /**
   * Mean distance of the centers of these elements, divided by the diagonal of the canvas of the
   * reference (0 is the same place, 1 the opposite corner). `null` if no element has a center in
   * both views.
   */
  meanDistance: number | null;
  /** Places where either view has an `appearance`; the denominator of `appearancePercent`. */
  appearances: number;
  /** Of these, the share with the same sprite and tint, in percent; `null` if there are none. */
  appearancePercent: number | null;
  /** Counters where either view has a `display`; the denominator of `displayPercent`. */
  displays: number;
  /** Of these, the share with the same style and icon, in percent; `null` if there are none. */
  displayPercent: number | null;
}

type Entry = { kind: string } & Record<string, unknown>;

/**
 * The center of an element, or `null` if it has none: the middle of the box, the point itself, the
 * point halfway along the length of a path. A `slots` place lives inside its transition and a
 * `hidden` element is not drawn, so neither has a center of its own.
 */
export function centerOf(entry: Entry | undefined): Point | null {
  if (!entry) return null;
  const { path, box, pos, at } = entry;
  if (Array.isArray(path) && path.length >= 2) {
    return pointAlong(path as Point[], pathLength(path as Point[]) / 2).point;
  }
  if (Array.isArray(box) && box.length === 4)
    return rectCenter(box as [number, number, number, number]);
  const point = pos ?? at;
  if (Array.isArray(point) && point.length === 2) return point as Point;
  return null;
}

function percent(part: number, whole: number): number {
  return whole === 0 ? 100 : (100 * part) / whole;
}

/**
 * Compares a view with a reference view of the same net (same ids), for the evaluation of a
 * generated view against the one in the repository. It looks at the places and transitions of the
 * reference only; an element the candidate lacks counts as a different kind and has no center.
 *
 * - Kind agreement: the share of elements with the same `kind`. A hidden element counts here and
 *   nowhere else.
 * - Distance: for elements with a center in both views (see `centerOf`), the mean Euclidean
 *   distance of the centers in canvas pixels, divided by the diagonal of the canvas of the
 *   reference. The candidate is not scaled; a candidate on a canvas of another size is simply
 *   further away.
 * - Appearance and display: among the places where at least one view has the field, the share of
 *   equal ones (sprite and tint; style and icon). Numbers such as `max` or `per` are not compared.
 *
 * Decor, arcs and labels are not compared.
 */
export function compareViews(candidate: DomainView, reference: DomainView): ViewSimilarity {
  const sections = ['places', 'transitions'] as const;
  let elements = 0;
  let sameKind = 0;
  let centered = 0;
  let distanceSum = 0;
  let appearances = 0;
  let sameLook = 0;
  let displays = 0;
  let sameDisplay = 0;
  const { width, height } = reference.meta.canvas;
  const diagonal = Math.hypot(width, height);

  for (const section of sections) {
    for (const [id, ref] of Object.entries(reference[section])) {
      const refEntry = ref as Entry;
      const own = (candidate[section] as Record<string, Entry | undefined>)[id];
      elements += 1;
      if (own?.kind === refEntry.kind) sameKind += 1;
      const a = centerOf(own);
      const b = centerOf(refEntry);
      if (a && b) {
        centered += 1;
        distanceSum += distance(a, b);
      }
    }
  }

  for (const id of Object.keys(reference.places)) {
    const ref = reference.places[id] as
      | {
          appearance?: Parameters<typeof sameAppearance>[0];
          display?: { style: string; icon?: string };
        }
      | undefined;
    const own = candidate.places[id] as typeof ref;
    if (ref?.appearance || own?.appearance) {
      appearances += 1;
      if (ref?.appearance && own?.appearance && sameAppearance(ref.appearance, own.appearance)) {
        sameLook += 1;
      }
    }
    if (ref?.display || own?.display) {
      displays += 1;
      if (
        ref?.display &&
        own?.display &&
        ref.display.style === own.display.style &&
        ref.display.icon === own.display.icon
      ) {
        sameDisplay += 1;
      }
    }
  }

  return {
    elements,
    kindPercent: percent(sameKind, elements),
    centered,
    meanDistance: centered === 0 || diagonal === 0 ? null : distanceSum / centered / diagonal,
    appearances,
    appearancePercent: appearances === 0 ? null : percent(sameLook, appearances),
    displays,
    displayPercent: displays === 0 ? null : percent(sameDisplay, displays),
  };
}
