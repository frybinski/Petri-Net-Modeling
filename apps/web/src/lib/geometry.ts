import type { Position } from '@pnm/core';

export const PLACE_SIZE = 40;
export const TRANSITION_WIDTH = 40;
export const TRANSITION_HEIGHT = 60;
/** Distance between the two arcs of a pair of opposite arcs. */
export const PARALLEL_ARC_BEND = 26;
export const ARROW_LENGTH = 10;
export const ARROW_HALF_WIDTH = 4.5;

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
  /** SVG path of the visible line, shortened so that the arrow tip sits on the boundary. */
  path: string;
  /** Arrow tip. */
  tip: Position;
  /** Direction of the arc at the tip, in radians. */
  angle: number;
  /** Anchor for the weight label. */
  label: Position;
}

export interface ArcGeometryInput {
  source: Endpoint;
  target: Endpoint;
  /** Intermediate bend points; make the arc a polyline. */
  points?: readonly Position[];
  /** Sideways offset of the arc's midpoint. 0 draws a straight line. */
  bend?: number;
}

/** Computes the path, arrow tip and label anchor of an arc between two nodes. */
export function arcGeometry({
  source,
  target,
  points = [],
  bend = 0,
}: ArcGeometryInput): ArcGeometry {
  const gap = 1.5;
  if (points.length > 0) {
    const first = points[0] as Position;
    const last = points[points.length - 1] as Position;
    const start = boundaryPoint(source.center, source.shape, first, gap);
    const tip = boundaryPoint(target.center, target.shape, last, gap);
    const angle = Math.atan2(tip.y - last.y, tip.x - last.x);
    const lineEnd = backOff(tip, angle, ARROW_LENGTH - 1);
    const chain = [start, ...points, lineEnd];
    const path = chain.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p.x)} ${round(p.y)}`).join(' ');
    const a = chain[Math.floor((chain.length - 1) / 2)] as Position;
    const b = chain[Math.floor((chain.length - 1) / 2) + 1] as Position;
    return { path, tip, angle, label: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }

  const dx = target.center.x - source.center.x;
  const dy = target.center.y - source.center.y;
  const length = Math.hypot(dx, dy) || 1;

  if (bend === 0) {
    const start = boundaryPoint(source.center, source.shape, target.center, gap);
    const tip = boundaryPoint(target.center, target.shape, source.center, gap);
    const angle = Math.atan2(tip.y - start.y, tip.x - start.x);
    const lineEnd = backOff(tip, angle, ARROW_LENGTH - 1);
    return {
      path: `M${round(start.x)} ${round(start.y)} L${round(lineEnd.x)} ${round(lineEnd.y)}`,
      tip,
      angle,
      label: { x: (start.x + tip.x) / 2, y: (start.y + tip.y) / 2 },
    };
  }

  // Quadratic curve whose control point is shifted sideways from the midpoint.
  const control: Position = {
    x: (source.center.x + target.center.x) / 2 + (-dy / length) * bend * 2,
    y: (source.center.y + target.center.y) / 2 + (dx / length) * bend * 2,
  };
  const start = boundaryPoint(source.center, source.shape, control, gap);
  const tip = boundaryPoint(target.center, target.shape, control, gap);
  const angle = Math.atan2(tip.y - control.y, tip.x - control.x);
  const lineEnd = backOff(tip, angle, ARROW_LENGTH - 1);
  return {
    path: `M${round(start.x)} ${round(start.y)} Q${round(control.x)} ${round(control.y)} ${round(lineEnd.x)} ${round(lineEnd.y)}`,
    tip,
    angle,
    label: {
      x: 0.25 * start.x + 0.5 * control.x + 0.25 * tip.x,
      y: 0.25 * start.y + 0.5 * control.y + 0.25 * tip.y,
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
export const MAX_TOKEN_DOTS = 5;

/** Offsets of token dots from the place center for 1..5 tokens. */
export function tokenDotOffsets(count: number): Position[] {
  const d = 7;
  switch (count) {
    case 1:
      return [{ x: 0, y: 0 }];
    case 2:
      return [
        { x: -d + 1, y: 0 },
        { x: d - 1, y: 0 },
      ];
    case 3:
      return [
        { x: 0, y: -d + 1 },
        { x: -d, y: d - 2 },
        { x: d, y: d - 2 },
      ];
    case 4:
      return [
        { x: -d + 1, y: -d + 1 },
        { x: d - 1, y: -d + 1 },
        { x: -d + 1, y: d - 1 },
        { x: d - 1, y: d - 1 },
      ];
    case 5:
      return [...tokenDotOffsets(4), { x: 0, y: 0 }];
    default:
      return [];
  }
}

/** Snaps a value to a grid. */
export function snap(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}

export const GRID_SIZE = 20;
