import type { Point, Rect } from './schema';

/** Distance between the tokens of a queue, in canvas pixels. */
export const TOKEN_SPACING = 16;

/** A queue holds at least this many tokens along its path (rule V6). */
export const MIN_QUEUE_TOKENS = 10;

/** The shortest path that holds `MIN_QUEUE_TOKENS` tokens. */
export const MIN_QUEUE_LENGTH = MIN_QUEUE_TOKENS * TOKEN_SPACING;

export function distance(a: Point, b: Point): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

export function pathLength(path: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) total += distance(path[i - 1]!, path[i]!);
  return total;
}

export function rectCenter(rect: Rect): Point {
  return [rect[0] + rect[2] / 2, rect[1] + rect[3] / 2];
}

export function pointInRect(point: Point, rect: Rect, tolerance = 0): boolean {
  return (
    point[0] >= rect[0] - tolerance &&
    point[0] <= rect[0] + rect[2] + tolerance &&
    point[1] >= rect[1] - tolerance &&
    point[1] <= rect[1] + rect[3] + tolerance
  );
}

export function lerp(a: Point, b: Point, t: number): Point {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** The point at `along` pixels from the start of the path, with the direction of the segment. */
export function pointAlong(
  path: readonly Point[],
  along: number,
): { point: Point; direction: Point } {
  const first = path[0] ?? [0, 0];
  if (path.length < 2) return { point: first, direction: [1, 0] };
  let remaining = Math.max(0, along);
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const length = distance(a, b);
    if (length === 0) continue;
    if (remaining <= length || i === path.length - 1) {
      const t = remaining / length;
      return {
        point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        direction: [(b[0] - a[0]) / length, (b[1] - a[1]) / length],
      };
    }
    remaining -= length;
  }
  return { point: path[path.length - 1] ?? first, direction: [1, 0] };
}

/** Distance of a point to a segment. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared));
  return distance(p, [a[0] + t * dx, a[1] + t * dy]);
}

export function distanceToPath(p: Point, path: readonly Point[]): number {
  if (path.length === 0) return Infinity;
  if (path.length === 1) return distance(p, path[0]!);
  let best = Infinity;
  for (let i = 1; i < path.length; i += 1) {
    best = Math.min(best, distanceToSegment(p, path[i - 1]!, path[i]!));
  }
  return best;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
