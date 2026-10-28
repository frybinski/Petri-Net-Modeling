import { describe, expect, it } from 'vitest';
import {
  PLACE_SHAPE,
  TRANSITION_SHAPE,
  arcGeometry,
  arrowHeadPoints,
  boundaryPoint,
  shapeSize,
  snap,
  tokenDotOffsets,
} from './geometry';

describe('boundaryPoint', () => {
  it('finds the point on a circle', () => {
    const p = boundaryPoint({ x: 0, y: 0 }, PLACE_SHAPE, { x: 100, y: 0 });
    expect(p.x).toBeCloseTo(20);
    expect(p.y).toBeCloseTo(0);
    const q = boundaryPoint({ x: 0, y: 0 }, PLACE_SHAPE, { x: 0, y: -50 }, 5);
    expect(q.y).toBeCloseTo(-25);
  });

  it('finds the point on a rectangle for horizontal, vertical and diagonal directions', () => {
    expect(boundaryPoint({ x: 0, y: 0 }, TRANSITION_SHAPE, { x: 100, y: 0 })).toEqual({
      x: 20,
      y: 0,
    });
    expect(boundaryPoint({ x: 0, y: 0 }, TRANSITION_SHAPE, { x: 0, y: 100 })).toEqual({
      x: 0,
      y: 30,
    });
    const d = boundaryPoint({ x: 0, y: 0 }, TRANSITION_SHAPE, { x: 100, y: 100 });
    expect(d.x).toBeCloseTo(20);
    expect(d.y).toBeCloseTo(20);
  });

  it('returns the center for coinciding points', () => {
    expect(boundaryPoint({ x: 5, y: 5 }, PLACE_SHAPE, { x: 5, y: 5 })).toEqual({ x: 5, y: 5 });
  });
});

describe('arcGeometry', () => {
  const source = { center: { x: 0, y: 0 }, shape: PLACE_SHAPE };
  const target = { center: { x: 200, y: 0 }, shape: TRANSITION_SHAPE };

  it('draws a straight arc between the node boundaries', () => {
    const g = arcGeometry({ source, target });
    expect(g.path.startsWith('M21.5 0 L')).toBe(true);
    expect(g.tip.x).toBeCloseTo(178.5);
    expect(g.angle).toBeCloseTo(0);
    expect(g.label.y).toBeCloseTo(0);
  });

  it('bends arcs sideways when asked to', () => {
    const g = arcGeometry({ source, target, bend: 26 });
    expect(g.path).toContain('Q');
    expect(g.label.y).not.toBeCloseTo(0);
    const reverse = arcGeometry({ source: target, target: source, bend: 26 });
    expect(Math.sign(reverse.label.y)).toBe(-Math.sign(g.label.y));
  });

  it('routes through bend points', () => {
    const g = arcGeometry({ source, target, points: [{ x: 100, y: 80 }] });
    expect(g.path).toContain('L100 80');
    expect(g.tip.y).toBeGreaterThan(0);
  });

  it('builds an arrow head polygon with three points', () => {
    const points = arrowHeadPoints({ x: 10, y: 10 }, 0).split(' ');
    expect(points).toHaveLength(3);
    expect(points[0]).toBe('10,10');
  });
});

describe('helpers', () => {
  it('snaps values to the grid', () => {
    expect(snap(29, 20)).toBe(20);
    expect(snap(31, 20)).toBe(40);
    expect(snap(-9, 20)).toBe(-0);
  });

  it('lays out between one and five token dots', () => {
    for (let n = 1; n <= 5; n++) expect(tokenDotOffsets(n)).toHaveLength(n);
    expect(tokenDotOffsets(6)).toEqual([]);
    expect(tokenDotOffsets(0)).toEqual([]);
  });

  it('reports shape sizes', () => {
    expect(shapeSize(PLACE_SHAPE)).toEqual({ width: 40, height: 40 });
    expect(shapeSize(TRANSITION_SHAPE)).toEqual({ width: 40, height: 60 });
  });
});
