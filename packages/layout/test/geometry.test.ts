import { describe, expect, it } from 'vitest';
import {
  ARC_CLEARANCE,
  MAX_ARC_SAG,
  MAX_AVOID_LENGTH,
  MAX_AVOID_SAG,
  MIN_PARALLEL_SAG,
  PLACE_SHAPE,
  TRANSITION_SHAPE,
  arcGeometry,
  arcSag,
  arrowHeadPoints,
  boundaryPoint,
  distanceToNode,
  guardPillObstacle,
  obstaclesFor,
  shapeSize,
  snap,
  snapDragged,
  tokenDotOffsets,
} from '../src/geometry';

describe('boundaryPoint', () => {
  it('finds the point on a circle', () => {
    const p = boundaryPoint({ x: 0, y: 0 }, PLACE_SHAPE, { x: 100, y: 0 });
    expect(p.x).toBeCloseTo(22);
    expect(p.y).toBeCloseTo(0);
    const q = boundaryPoint({ x: 0, y: 0 }, PLACE_SHAPE, { x: 0, y: -50 }, 5);
    expect(q.y).toBeCloseTo(-27);
  });

  it('finds the point on a rectangle for horizontal, vertical and diagonal directions', () => {
    expect(boundaryPoint({ x: 0, y: 0 }, TRANSITION_SHAPE, { x: 100, y: 0 })).toEqual({
      x: 22,
      y: 0,
    });
    expect(boundaryPoint({ x: 0, y: 0 }, TRANSITION_SHAPE, { x: 0, y: 100 })).toEqual({
      x: 0,
      y: 32,
    });
    const d = boundaryPoint({ x: 0, y: 0 }, TRANSITION_SHAPE, { x: 100, y: 100 });
    expect(d.x).toBeCloseTo(22);
    expect(d.y).toBeCloseTo(22);
  });

  it('returns the center for coinciding points', () => {
    expect(boundaryPoint({ x: 5, y: 5 }, PLACE_SHAPE, { x: 5, y: 5 })).toEqual({ x: 5, y: 5 });
  });
});

describe('arcSag', () => {
  it('is zero for short arcs and capped for long ones', () => {
    expect(arcSag(60)).toBe(0);
    expect(arcSag(150)).toBeGreaterThan(0);
    expect(arcSag(150)).toBeLessThan(MAX_ARC_SAG);
    expect(arcSag(2000)).toBe(MAX_ARC_SAG);
  });

  it('keeps a minimum bulge for opposite arcs', () => {
    expect(arcSag(60, true)).toBe(MIN_PARALLEL_SAG);
    expect(arcSag(2000, true)).toBe(MAX_ARC_SAG);
  });
});

describe('arcGeometry', () => {
  const source = { center: { x: 0, y: 0 }, shape: PLACE_SHAPE };
  const target = { center: { x: 200, y: 0 }, shape: TRANSITION_SHAPE };
  const near = { center: { x: 80, y: 0 }, shape: TRANSITION_SHAPE };

  it('draws a straight arc between the node outlines when it is short', () => {
    const g = arcGeometry({ source, target: near });
    expect(g.path.startsWith('M22 0 L')).toBe(true);
    expect(g.tip.x).toBeCloseTo(58);
    expect(g.angle).toBeCloseTo(0);
    expect(g.label.y).toBeCloseTo(0);
  });

  it('bends longer arcs slightly and ends exactly on the node outline', () => {
    const g = arcGeometry({ source, target });
    expect(g.path).toContain('Q');
    // The tip sits on the left outline of the transition (x = 200 - 22) and the arrow head
    // is oriented along the curve, so its tip is a little below the chord.
    expect(g.tip.x).toBeGreaterThan(177);
    expect(g.tip.x).toBeLessThan(179);
    expect(Math.abs(g.angle)).toBeGreaterThan(0);
    // To the right of the direction of travel (down on screen when travelling right).
    expect(g.label.y).toBeGreaterThan(0);
    expect(g.label.y).toBeLessThanOrEqual(MAX_ARC_SAG);
  });

  it('pushes the arcs of an opposite pair to different sides', () => {
    const forward = arcGeometry({ source, target: near, parallel: true });
    const back = arcGeometry({ source: near, target: source, parallel: true });
    expect(forward.path).toContain('Q');
    expect(Math.abs(forward.label.y)).toBeGreaterThanOrEqual(MIN_PARALLEL_SAG);
    expect(Math.sign(back.label.y)).toBe(-Math.sign(forward.label.y));
    expect(Math.abs(forward.label.y - back.label.y)).toBeGreaterThan(2 * MIN_PARALLEL_SAG);
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

  it('lays out between one and six token dots', () => {
    for (let n = 1; n <= 6; n++) expect(tokenDotOffsets(n)).toHaveLength(n);
    expect(tokenDotOffsets(7)).toEqual([]);
    expect(tokenDotOffsets(0)).toEqual([]);
  });

  it('reports shape sizes', () => {
    expect(shapeSize(PLACE_SHAPE)).toEqual({ width: 44, height: 44 });
    expect(shapeSize(TRANSITION_SHAPE)).toEqual({ width: 44, height: 64 });
  });
});

describe('snapDragged', () => {
  it('snaps the centers by the offset of the first node', () => {
    const moved = snapDragged(
      [
        { id: 'a', position: { x: 93, y: 47 } },
        { id: 'b', position: { x: 133, y: 47 } },
      ],
      20,
    );
    expect(moved.map((m) => m.position)).toEqual([
      { x: 100, y: 40 },
      { x: 140, y: 40 },
    ]);
  });

  it('only rounds without a grid, and handles no nodes', () => {
    expect(snapDragged([{ position: { x: 1.4, y: 2.6 } }], null)[0]?.position).toEqual({
      x: 1,
      y: 3,
    });
    expect(snapDragged([], 20)).toEqual([]);
  });
});

describe('arcs around other nodes', () => {
  const place = (x: number, y: number) => ({ center: { x, y }, shape: PLACE_SHAPE });
  const transition = (x: number, y: number) => ({ center: { x, y }, shape: TRANSITION_SHAPE });

  it('measures the distance from the outline of circles and rectangles', () => {
    expect(distanceToNode({ x: 30, y: 0 }, place(0, 0))).toBeCloseTo(8);
    expect(distanceToNode({ x: 0, y: 0 }, place(0, 0))).toBeCloseTo(-22);
    expect(distanceToNode({ x: 30, y: 0 }, transition(0, 0))).toBeCloseTo(8);
    expect(distanceToNode({ x: 30, y: 40 }, transition(0, 0))).toBeCloseTo(Math.hypot(8, 8));
    expect(distanceToNode({ x: 0, y: 0 }, transition(0, 0))).toBeCloseTo(-22);
  });

  it('keeps the usual bulge when nothing is in the way', () => {
    const a = place(0, 0);
    const b = transition(300, 0);
    const free = arcGeometry({ source: a, target: b });
    const withFarNode = arcGeometry({ source: a, target: b, obstacles: [place(150, 400)] });
    expect(withFarNode.path).toBe(free.path);
  });

  it('bends around a node that sits on the straight line', () => {
    const a = place(0, 0);
    const b = transition(320, 0);
    const blocker = place(160, 0);
    const g = arcGeometry({ source: a, target: b, obstacles: [blocker] });
    expect(Math.abs(g.label.y)).toBeGreaterThan(22 + ARC_CLEARANCE - 4);
    expect(Math.abs(g.label.y)).toBeLessThanOrEqual(MAX_AVOID_SAG + 6);
  });

  it('takes the other side when the usual one is blocked', () => {
    const a = place(0, 0);
    const b = transition(300, 0);
    const usual = arcGeometry({ source: a, target: b });
    expect(usual.label.y).toBeGreaterThan(0); // down when travelling right
    // A node below the middle blocks that side, so the arc goes over the top.
    const blocker = place(150, usual.label.y + 4);
    const g = arcGeometry({ source: a, target: b, obstacles: [blocker] });
    expect(g.label.y).toBeLessThan(0);
  });

  it('does not move the two arcs of an opposite pair onto the same side', () => {
    const a = place(0, 0);
    const b = transition(300, 0);
    const blocker = place(150, 20);
    const forward = arcGeometry({ source: a, target: b, parallel: true, obstacles: [blocker] });
    const back = arcGeometry({ source: b, target: a, parallel: true, obstacles: [blocker] });
    expect(Math.sign(forward.label.y)).toBe(-Math.sign(back.label.y));
  });
});

describe('obstaclesFor', () => {
  const node = (x: number, y: number) => ({ center: { x, y }, shape: PLACE_SHAPE });
  const all: Array<readonly [string, ReturnType<typeof node>]> = [
    ['a', node(0, 0)],
    ['b', node(300, 0)],
    ['near', node(150, 40)],
    ['far', node(150, 600)],
  ];

  it('returns the nodes close to the arc and leaves out its two ends and distant nodes', () => {
    const found = obstaclesFor(all, ['a', 'b'], { x: 0, y: 0 }, { x: 300, y: 0 });
    expect(found).toHaveLength(1);
    expect(found[0]?.center).toEqual({ x: 150, y: 40 });
  });

  it('leaves very long arcs alone', () => {
    const a = { center: { x: 0, y: 0 }, shape: PLACE_SHAPE };
    const b = { center: { x: MAX_AVOID_LENGTH + 100, y: 0 }, shape: PLACE_SHAPE };
    const blocker = node(MAX_AVOID_LENGTH / 2 + 50, 0);
    const g = arcGeometry({ source: a, target: b, obstacles: [blocker] });
    const free = arcGeometry({ source: a, target: b });
    expect(g.path).toBe(free.path);
  });
});

describe('guardPillObstacle', () => {
  it('sits centered above the transition, with the width of its text', () => {
    const short = guardPillObstacle({ x: 100, y: 200 }, 11);
    expect(short.center.x).toBe(100);
    // The top of the transition is at y = 168; the pill ends 8 px above it and is 18 px high.
    expect(short.center.y).toBe(168 - 8 - 9);
    expect(short.shape).toMatchObject({ kind: 'rect', height: 18 });
    const long = guardPillObstacle({ x: 100, y: 200 }, 32);
    expect(long.shape.kind === 'rect' && short.shape.kind === 'rect').toBe(true);
    if (long.shape.kind === 'rect' && short.shape.kind === 'rect') {
      expect(long.shape.width).toBeGreaterThan(short.shape.width);
    }
  });

  it('bends an arc that would run through the pill', () => {
    // The token ring: the arc leaves the transition at the top, below its guard pill.
    const place = { center: { x: 0, y: 0 }, shape: PLACE_SHAPE };
    const transition = { center: { x: 70, y: 150 }, shape: TRANSITION_SHAPE };
    const pill = guardPillObstacle(transition.center, 11);
    const free = arcGeometry({ source: transition, target: place });
    const around = arcGeometry({ source: transition, target: place, obstacles: [pill] });
    expect(around.path).not.toBe(free.path);
    // The curve leaves the transition towards the side instead of through the pill.
    expect(around.start.y).toBeGreaterThan(pill.center.y + 9);
  });
});
