import type { Position } from '@pnm/core';

export const PLACE_SIZE = 44;
export const TRANSITION_WIDTH = 44;
export const TRANSITION_HEIGHT = 64;
/** Stroke width of node outlines. */
export const NODE_STROKE = 1.75;
/** Largest sideways bulge of an arc (distance of the curve from the straight line). */
export const MAX_ARC_SAG = 24;
/** Smallest bulge of the two arcs between the same pair of nodes, so that they never overlap. */
export const MIN_PARALLEL_SAG = 12;
export const ARROW_LENGTH = 8;
export const ARROW_HALF_WIDTH = 3.6;

export type Shape =
  { kind: 'circle'; radius: number } | { kind: 'rect'; width: number; height: number };

export const PLACE_SHAPE: Shape = { kind: 'circle', radius: PLACE_SIZE / 2 };
export const TRANSITION_SHAPE: Shape = {
  kind: 'rect',
  width: TRANSITION_WIDTH,
  height: TRANSITION_HEIGHT,
};

export function shapeSize(shape: Shape): { width: number; height: number } {
  return shape.kind === 'circle'
    ? { width: shape.radius * 2, height: shape.radius * 2 }
    : { width: shape.width, height: shape.height };
}

export interface Endpoint {
  center: Position;
  shape: Shape;
}

/**
 * Point where the ray from the center of `shape` towards `toward` leaves the shape,
 * pushed outward by `gap` pixels.
 */
export function boundaryPoint(center: Position, shape: Shape, toward: Position, gap = 0): Position {
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { x: center.x, y: center.y };
  const ux = dx / length;
  const uy = dy / length;
  let reach: number;
  if (shape.kind === 'circle') {
    reach = shape.radius;
  } else {
    const hw = shape.width / 2;
    const hh = shape.height / 2;
    const tx = ux === 0 ? Infinity : hw / Math.abs(ux);
    const ty = uy === 0 ? Infinity : hh / Math.abs(uy);
    reach = Math.min(tx, ty);
  }
  return { x: center.x + ux * (reach + gap), y: center.y + uy * (reach + gap) };
}

export interface ArcGeometry {
  /** SVG path of the visible line, shortened so that the arrow head covers its end. */
  path: string;
  /** Arrow tip, exactly on the outline of the target node. */
  tip: Position;
  /** Direction of the arc at the tip, in radians. */
  angle: number;
  /** Middle of the curve: anchor of the label pill. */
  label: Position;
  /** Where the line leaves the source node. */
  start: Position;
}

export interface ArcGeometryInput {
  source: Endpoint;
  target: Endpoint;
  /** Intermediate bend points; make the arc a polyline. */
  points?: readonly Position[];
  /** There is also an arc in the opposite direction: both are pushed apart. */
  parallel?: boolean;
}

/**
 * Sideways bulge of an arc of the given length: none for short arcs, growing with the length up
 * to `MAX_ARC_SAG`. Arcs of a pair of opposite arcs always bulge a little, each to its own right
 * hand side, so that they separate on their own.
 */
export function arcSag(length: number, parallel = false): number {
  const sag = Math.min(MAX_ARC_SAG, Math.max(0, (length - 90) * 0.09));
  return parallel ? Math.max(sag, MIN_PARALLEL_SAG) : sag;
}

/** Computes the path, arrow tip and label anchor of an arc between two nodes. */
export function arcGeometry({
  source,
  target,
  points = [],
  parallel = false,
}: ArcGeometryInput): ArcGeometry {
  if (points.length > 0) {
    const first = points[0] as Position;
    const last = points[points.length - 1] as Position;
    const start = boundaryPoint(source.center, source.shape, first);
    const tip = boundaryPoint(target.center, target.shape, last);
    const angle = Math.atan2(tip.y - last.y, tip.x - last.x);
    const lineEnd = backOff(tip, angle, ARROW_LENGTH - 1);
    const chain = [start, ...points, lineEnd];
    const path = chain.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p.x)} ${round(p.y)}`).join(' ');
    const a = chain[Math.floor((chain.length - 1) / 2)] as Position;
    const b = chain[Math.floor((chain.length - 1) / 2) + 1] as Position;
    return { path, start, tip, angle, label: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }

  const dx = target.center.x - source.center.x;
  const dy = target.center.y - source.center.y;
  const length = Math.hypot(dx, dy) || 1;
  const sag = arcSag(length, parallel);

  if (sag < 0.5) {
    const start = boundaryPoint(source.center, source.shape, target.center);
    const tip = boundaryPoint(target.center, target.shape, source.center);
    const angle = Math.atan2(tip.y - start.y, tip.x - start.x);
    const lineEnd = backOff(tip, angle, ARROW_LENGTH - 1);
    return {
      path: `M${round(start.x)} ${round(start.y)} L${round(lineEnd.x)} ${round(lineEnd.y)}`,
      start,
      tip,
      angle,
      label: { x: (start.x + tip.x) / 2, y: (start.y + tip.y) / 2 },
    };
  }

  // Quadratic curve: the control point sits on the right hand side of the direction of travel.
  // A quadratic curve reaches half the control offset at its middle, hence the factor 2.
  const control: Position = {
    x: (source.center.x + target.center.x) / 2 + (-dy / length) * sag * 2,
    y: (source.center.y + target.center.y) / 2 + (dx / length) * sag * 2,
  };
  const start = boundaryPoint(source.center, source.shape, control);
  const tip = boundaryPoint(target.center, target.shape, control);
  const angle = Math.atan2(tip.y - control.y, tip.x - control.x);
  const lineEnd = backOff(tip, angle, ARROW_LENGTH - 1);
  return {
    path: `M${round(start.x)} ${round(start.y)} Q${round(control.x)} ${round(control.y)} ${round(lineEnd.x)} ${round(lineEnd.y)}`,
    start,
    tip,
    angle,
    label: {
      x: 0.25 * start.x + 0.5 * control.x + 0.25 * lineEnd.x,
      y: 0.25 * start.y + 0.5 * control.y + 0.25 * lineEnd.y,
    },
  };
}

/** Polygon points (SVG `points` attribute) of an arrow head with its tip at `tip`. */
export function arrowHeadPoints(tip: Position, angle: number): string {
  const back = backOff(tip, angle, ARROW_LENGTH);
  const nx = -Math.sin(angle) * ARROW_HALF_WIDTH;
  const ny = Math.cos(angle) * ARROW_HALF_WIDTH;
  return [
    `${round(tip.x)},${round(tip.y)}`,
    `${round(back.x + nx)},${round(back.y + ny)}`,
    `${round(back.x - nx)},${round(back.y - ny)}`,
  ].join(' ');
}

function backOff(point: Position, angle: number, distance: number): Position {
  return { x: point.x - Math.cos(angle) * distance, y: point.y - Math.sin(angle) * distance };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Largest number of tokens drawn as dots; more tokens are shown as a number. */
export const MAX_TOKEN_DOTS = 6;
/** Radius of a token dot (6 px diameter). */
export const TOKEN_DOT_RADIUS = 3;

/**
 * Offsets of token dots from the place center for 1..6 tokens: one in the middle, two side by
 * side, a triangle, a square, and a ring of five or six.
 */
export function tokenDotOffsets(count: number): Position[] {
  const polygon = (n: number, radius: number, start: number): Position[] =>
    Array.from({ length: n }, (_, i) => {
      const angle = start + (i * 2 * Math.PI) / n;
      return { x: round(Math.cos(angle) * radius), y: round(Math.sin(angle) * radius) };
    });
  switch (count) {
    case 1:
      return [{ x: 0, y: 0 }];
    case 2:
      return [
        { x: -6, y: 0 },
        { x: 6, y: 0 },
      ];
    case 3:
      return polygon(3, 7.5, -Math.PI / 2);
    case 4:
      return [
        { x: -5.5, y: -5.5 },
        { x: 5.5, y: -5.5 },
        { x: -5.5, y: 5.5 },
        { x: 5.5, y: 5.5 },
      ];
    case 5:
    case 6:
      return polygon(count, 10, -Math.PI / 2);
    default:
      return [];
  }
}

/** Snaps a value to a grid. */
export function snap(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}

export const GRID_SIZE = 20;

/**
 * Snaps nodes that are dragged together to the grid. React Flow would snap the top-left corner,
 * which puts the center of a node with an odd half size between grid points, so the snapping is
 * done here on the centers. All nodes move by the same offset, like the first node, so that
 * their distances stay as they are.
 */
export function snapDragged<T extends { position: Position }>(
  moves: readonly T[],
  grid: number | null,
): T[] {
  const first = moves[0];
  if (!first) return [];
  const dx = grid === null ? 0 : snap(first.position.x, grid) - first.position.x;
  const dy = grid === null ? 0 : snap(first.position.y, grid) - first.position.y;
  return moves.map((move) => ({
    ...move,
    position: { x: Math.round(move.position.x + dx), y: Math.round(move.position.y + dy) },
  }));
}
