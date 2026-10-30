/**
 * The history of a counter (N2): the count at the events of the simulation, kept as a short list
 * of points. A counter with `display.history` draws it as a small curve under or in its box.
 */

/** The count of a counter after an event at simulated time `t`. */
export interface HistoryPoint {
  /** Simulated seconds. */
  t: number;
  /** The number of tokens. */
  v: number;
}

/** The curve shows at most the last eight simulated hours. */
export const HISTORY_WINDOW_SECONDS = 8 * 3600;

/** A counter keeps at most this many points; older ones are merged (see `compactHistory`). */
export const HISTORY_LIMIT = 500;

/**
 * Adds a point. A point at the time of the last one replaces it (several events at one instant
 * are one step), and a point that repeats the last value adds nothing.
 */
export function appendHistory(
  points: readonly HistoryPoint[],
  point: HistoryPoint,
): HistoryPoint[] {
  const last = points[points.length - 1];
  if (last === undefined) return [point];
  if (last.t === point.t) {
    const before = points[points.length - 2];
    // The step back to the value before the instant leaves no step at all.
    if (before !== undefined && before.v === point.v) return points.slice(0, -1);
    return [...points.slice(0, -1), point];
  }
  if (last.v === point.v) return points.slice();
  return [...points, point];
}

/**
 * The points of the last `window` seconds before `now`, plus the one point before them that
 * gives the value at the start of the window, moved to the start. Points are in time order.
 */
export function trimHistory(
  points: readonly HistoryPoint[],
  now: number,
  window = HISTORY_WINDOW_SECONDS,
): HistoryPoint[] {
  const start = now - window;
  // The last point at or before the start gives the value at the start.
  let first = -1;
  while (first + 1 < points.length && points[first + 1]!.t <= start) first += 1;
  if (first < 0) return points.slice();
  const anchor = points[first]!;
  return [{ t: start, v: anchor.v }, ...points.slice(first + 1)];
}

/**
 * Brings a series down to `limit` points without losing a jump: the newest half of the points
 * stay as they are, the older ones are merged in windows of equal numbers of points, and each
 * window keeps its lowest and its highest point (in time order). The highest and the lowest
 * count of the series are therefore always still in it.
 */
export function compactHistory(
  points: readonly HistoryPoint[],
  limit = HISTORY_LIMIT,
): HistoryPoint[] {
  if (points.length <= limit) return points.slice();
  const keep = Math.floor(limit / 2);
  const older = points.slice(0, points.length - keep);
  const recent = points.slice(points.length - keep);
  // Each window gives at most two points.
  const windows = Math.max(1, Math.floor((limit - keep) / 2));
  const size = Math.ceil(older.length / windows);
  const merged: HistoryPoint[] = [];
  for (let from = 0; from < older.length; from += size) {
    const part = older.slice(from, from + size);
    let low = part[0]!;
    let high = part[0]!;
    for (const point of part) {
      if (point.v < low.v) low = point;
      if (point.v > high.v) high = point;
    }
    const pair = low.t <= high.t ? [low, high] : [high, low];
    merged.push(...(low === high ? [low] : pair));
  }
  const result = [...merged, ...recent];
  // A very long series of windows could still be over the limit by rounding.
  return result.length <= limit ? result : compactHistory(result, limit);
}

/**
 * The points of a curve in a rectangle, as a step line: the count holds until the next point,
 * then jumps. The curve ends at `now`, the time axis covers the last `window` seconds or, while
 * the series is shorter, all of it. Values are drawn from 0 to `top` (at least the highest count).
 */
export function stepLine(
  points: readonly HistoryPoint[],
  now: number,
  rect: readonly [number, number, number, number],
  top: number,
  window = HISTORY_WINDOW_SECONDS,
): Array<[number, number]> {
  if (points.length === 0) return [];
  const [x, y, w, h] = rect;
  const shown = trimHistory(points, now, window);
  const t0 = shown[0]!.t;
  const span = Math.max(now - t0, 1);
  const high = Math.max(top, 1, ...shown.map((p) => p.v));
  const px = (t: number): number => x + (Math.min(Math.max(t - t0, 0), span) / span) * w;
  const py = (v: number): number => y + h - (Math.max(v, 0) / high) * h;
  const line: Array<[number, number]> = [];
  shown.forEach((p, i) => {
    if (i > 0) line.push([px(p.t), py(shown[i - 1]!.v)]);
    line.push([px(p.t), py(p.v)]);
  });
  const last = shown[shown.length - 1]!;
  line.push([px(Math.max(now, last.t)), py(last.v)]);
  return line;
}
