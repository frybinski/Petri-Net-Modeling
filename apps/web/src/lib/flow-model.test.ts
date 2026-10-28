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
import { buildFlowEdges, buildFlowNodes, errorIds, type FlowContext } from './flow-model';

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
  it('computes geometry, bends opposite arcs and labels weights', () => {
    const edges = buildFlowEdges(context({ selection: ['a1'] }));
    expect(edges).toHaveLength(2);
    const a1 = edges.find((e) => e.id === 'a1');
    expect(a1?.selected).toBe(true);
    expect(a1?.data?.weight).toBe(2);
    expect(a1?.data?.path).toContain('Q'); // opposite arcs exist
    expect(a1?.ariaLabel).toBe('Arc from Buffer to go, weight 2');
  });

  it('follows drag positions and skips dangling arcs', () => {
    const n = net();
    n.arcs.push({ id: 'dangling', source: 'p', target: 'nowhere', weight: 1 });
    const edges = buildFlowEdges(context({ net: n, dragPositions: { t: { x: 300, y: 0 } } }));
    expect(edges.map((e) => e.id)).toEqual(['a1', 'a2']);
    const straight = buildFlowEdges(context({ net: { ...n, arcs: [n.arcs[0]!] } }));
    expect(straight[0]?.data?.path).not.toContain('Q');
  });
});
