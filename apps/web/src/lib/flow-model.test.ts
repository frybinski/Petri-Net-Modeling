import {
  addAnnotation,
  addArc,
  addPlace,
  addTransition,
  createEmptyNet,
  setInitialTokens,
  validate,
  type PetriNet,
} from '@pnm/core';
import { describe, expect, it } from 'vitest';
import { buildFlowEdges, buildFlowNodes, chipSide, errorIds, type FlowContext } from './flow-model';

function net(): PetriNet {
  let n = createEmptyNet('x');
  n = addPlace(n, { id: 'p', name: 'Buffer', position: { x: 0, y: 0 }, capacity: 2 });
  n = addTransition(n, { id: 't', name: 'go', position: { x: 100, y: 0 } });
  n = addArc(n, 'p', 't', { id: 'a1', weight: 2 });
  n = addArc(n, 't', 'p', { id: 'a2' });
  n = addAnnotation(n, { id: 'n', position: { x: 5, y: 200 }, text: 'hi' });
  return setInitialTokens(n, 'p', 1);
}

function context(overrides: Partial<FlowContext> = {}): FlowContext {
  const n = net();
  return {
    net: n,
    marking: n.marking,
    selection: [],
    enabled: new Map(),
    picking: null,
    showInscriptions: true,
    simulating: false,
    diagnostics: validate(n),
    dragPositions: null,
    renamingId: null,
    arcSource: null,
    editable: true,
    connectable: true,
    measured: new Map(),
    ...overrides,
  };
}

describe('buildFlowNodes', () => {
  it('creates a node for every element with its data', () => {
    const nodes = buildFlowNodes(context());
    expect(nodes.map((n) => [n.id, n.type])).toEqual([
      ['n', 'annotation'],
      ['p', 'place'],
      ['t', 'transition'],
    ]);
    const place = nodes.find((n) => n.id === 'p');
    expect(place?.data).toMatchObject({ name: 'Buffer', tokens: 1, capacity: 2, hasError: false });
    expect(place?.ariaLabel).toBe('Place Buffer, 1 token');
    expect(nodes.find((n) => n.id === 'n')?.origin).toEqual([0, 0]);
  });

  it('marks selection, drag positions, measured sizes and states', () => {
    const nodes = buildFlowNodes(
      context({
        selection: ['t'],
        dragPositions: { p: { x: 7, y: 8 } },
        measured: new Map([['p', { width: 40, height: 40 }]]),
        renamingId: 'p',
        arcSource: 't',
        enabled: new Map([['t', 1]]),
        simulating: true,
        editable: false,
        connectable: false,
      }),
    );
    const place = nodes.find((n) => n.id === 'p');
    const transition = nodes.find((n) => n.id === 't');
    expect(place?.position).toEqual({ x: 7, y: 8 });
    expect(place?.measured).toEqual({ width: 40, height: 40 });
    expect(place?.data).toMatchObject({ renaming: true });
    expect(place?.draggable).toBe(false);
    expect(transition?.selected).toBe(true);
    expect(transition?.data).toMatchObject({ enabled: true, isArcSource: true, simulating: true });
    expect(transition?.ariaLabel).toMatch(/enabled/);
  });

  it('flags elements with errors', () => {
    const n = net();
    n.arcs.push({ id: 'bad', source: 'p', target: 'ghost', weight: 1 });
    const diagnostics = validate(n);
    expect(errorIds(diagnostics).has('bad')).toBe(true);
    const nodes = buildFlowNodes(context({ net: n, diagnostics }));
    expect(nodes.every((node) => node.type === 'annotation' || node.data.hasError === false)).toBe(
      true,
    );
  });
});

describe('buildFlowEdges', () => {
  it('computes geometry, bends opposite arcs, labels weights and widens the hit area', () => {
    const edges = buildFlowEdges(context({ selection: ['a1'] }));
    expect(edges).toHaveLength(2);
    const a1 = edges.find((e) => e.id === 'a1');
    expect(a1?.selected).toBe(true);
    expect(a1?.data?.weight).toBe(2);
    expect(a1?.interactionWidth).toBe(20);
    expect(a1?.data?.path).toContain('Q'); // opposite arcs exist
    expect(a1?.ariaLabel).toBe('Arc from Buffer to go, weight 2');
  });

  it('follows drag positions and skips dangling arcs', () => {
    const n = net();
    n.arcs.push({ id: 'dangling', source: 'p', target: 'nowhere', weight: 1 });
    const edges = buildFlowEdges(context({ net: n, dragPositions: { t: { x: 300, y: 0 } } }));
    expect(edges.map((e) => e.id)).toEqual(['a1', 'a2']);
    // A short arc without an opposite arc stays straight.
    const straight = buildFlowEdges(
      context({ net: { ...n, arcs: [n.arcs[0]!] }, dragPositions: { t: { x: 70, y: 0 } } }),
    );
    expect(straight[0]?.data?.path).not.toContain('Q');
  });
});

describe('buildFlowEdges around guard pills', () => {
  // The geometry of the token ring: the arc from the transition up to the place leaves the
  // transition at its top, where the straight line runs through the pill of the guard.
  function guarded(guard: string | undefined): PetriNet {
    let n = createEmptyNet('x', 'json-net');
    n = addPlace(n, { id: 'p', name: 'P', position: { x: 0, y: 0 } });
    n = addTransition(n, {
      id: 't',
      name: 'T',
      position: { x: 70, y: 150 },
      ...(guard !== undefined && { guard }),
    });
    return addArc(n, 't', 'p', { id: 'a' });
  }
  const pathOf = (n: PetriNet, showInscriptions = true): string | undefined =>
    buildFlowEdges(context({ net: n, marking: n.marking, diagnostics: [], showInscriptions }))[0]
      ?.data?.path;
  /** How far the control point of the curve lies from the straight line between its ends. */
  const bulge = (path: string | undefined): number => {
    const m = /M(-?[\d.]+) (-?[\d.]+) Q(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)/.exec(
      path ?? '',
    );
    if (!m) return 0; // a straight line
    const [x1, y1, cx, cy, x2, y2] = m.slice(1).map(Number) as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    return Math.abs((x2 - x1) * (y1 - cy) - (x1 - cx) * (y2 - y1)) / Math.hypot(x2 - x1, y2 - y1);
  };

  it('bends an arc that would pass behind the guard pill of its own transition', () => {
    const usual = bulge(pathOf(guarded(undefined)));
    expect(bulge(pathOf(guarded('$n < 10')))).toBeGreaterThan(usual + 10);
  });

  it('keeps the straight line when the guards are hidden', () => {
    expect(pathOf(guarded('$n < 10'), false)).toBe(pathOf(guarded(undefined)));
  });

  it('also avoids the pill of another transition on the way', () => {
    let n = createEmptyNet('x', 'json-net');
    n = addTransition(n, { id: 'u', name: 'U', position: { x: 0, y: 0 } });
    n = addPlace(n, { id: 'q', name: 'Q', position: { x: 0, y: 320 } });
    // The transition itself is well clear of the line from Q to U, but its wide pill is not.
    n = addTransition(n, {
      id: 't',
      name: 'T',
      position: { x: 70, y: 190 },
      guard: '$n < 10 and $m > 3',
    });
    n = addArc(n, 'q', 'u', { id: 'a' });
    expect(bulge(pathOf(n))).toBeGreaterThan(bulge(pathOf(n, false)) + 10);
  });
});

describe('chipSide', () => {
  const at = (x: number, y: number) => ({ x, y });
  function row(...nodes: Array<[string, number, number]>): PetriNet {
    let n = createEmptyNet('x');
    for (const [id, x, y] of nodes) n = addPlace(n, { id, position: at(x, y) });
    return n;
  }

  it('prefers the right side', () => {
    expect(chipSide(row(['a', 0, 0], ['far', 400, 0]), 'a', at(0, 0))).toBe('right');
  });

  it('moves to the left, then below, when a node is within 220 px', () => {
    expect(chipSide(row(['a', 0, 0], ['r', 150, 10], ['w', -500, 0]), 'a', at(0, 0))).toBe('left');
    // The leftmost node of a net would show its card outside the view.
    expect(chipSide(row(['a', 0, 0], ['r', 150, 10]), 'a', at(0, 0))).toBe('below');
    expect(chipSide(row(['a', 0, 0], ['r', 150, 10], ['l', -150, 0]), 'a', at(0, 0))).toBe('below');
  });

  it('keeps the right side when nothing is free', () => {
    const net = row(['a', 0, 0], ['r', 150, 0], ['l', -150, 0], ['b', 0, 100]);
    expect(chipSide(net, 'a', at(0, 0))).toBe('right');
  });

  it('is part of the node data', () => {
    const nodes = buildFlowNodes(context());
    const place = nodes.find((n) => n.id === 'p');
    expect(place?.type === 'place' && place.data.chipSide).toBe('below'); // transition 100 px to the right, nothing further left
  });
});

describe('buildFlowNodes for the timed simulation', () => {
  it('adds the duration, the running firings, breakpoints and queue rings', () => {
    const base = context();
    const n = base.net;
    n.transitions[0]!.timing = { kind: 'uniform', min: 5, max: 9 };
    const nodes = buildFlowNodes({
      ...base,
      simulating: true,
      running: new Map([['t', { count: 2, progress: 0.4 }]]),
      breakpointTransitions: new Set(['t']),
      breakpointPlaces: { p: 3 },
      bottlenecks: new Map([['p', 'crit' as const]]),
    });
    const transition = nodes.find((x) => x.id === 't');
    expect(transition?.data).toMatchObject({
      timing: '5–9 s',
      running: 2,
      progress: 0.4,
      breakpoint: true,
    });
    expect(nodes.find((x) => x.id === 'p')?.data).toMatchObject({
      bottleneck: 'crit',
      breakpoint: 3,
    });
  });

  it('has no firing, breakpoint or ring without simulation', () => {
    const nodes = buildFlowNodes(context());
    expect(nodes.find((x) => x.id === 't')?.data).toMatchObject({
      running: 0,
      progress: 0,
      breakpoint: false,
    });
    expect(nodes.find((x) => x.id === 't')?.data).not.toHaveProperty('timing');
    expect(nodes.find((x) => x.id === 'p')?.data).not.toHaveProperty('bottleneck');
    expect(nodes.find((x) => x.id === 'p')?.data).not.toHaveProperty('breakpoint');
  });
});
