import type { Id, PetriNet, Position } from '@pnm/core';
import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode } from 'elkjs/lib/elk-api.js';

export type LayoutDirection = 'RIGHT' | 'DOWN';

export interface LayoutOptions {
  /** Flow direction of the layered layout. Default `RIGHT`. */
  direction?: LayoutDirection;
  /** Minimum distance between neighbouring nodes in pixels. Default 60. */
  spacing?: number;
}

export const PLACE_DIAMETER = 40;

/** Size of a transition for the given layout direction (width x height). */
export function transitionSize(direction: LayoutDirection): { width: number; height: number } {
  return direction === 'RIGHT' ? { width: 40, height: 60 } : { width: 60, height: 40 };
}

let elk: InstanceType<typeof ELK> | undefined;

function getElk(): InstanceType<typeof ELK> {
  // The bundled build runs ELK on the calling thread, so it works in Vite and in Node alike.
  elk ??= new ELK();
  return elk;
}

/**
 * Computes positions for all places and transitions with ELK's layered algorithm.
 * The returned positions are node centers (the convention of the net model). The
 * net itself is not modified, and annotations are left alone.
 */
export async function layoutNet(
  net: PetriNet,
  options: LayoutOptions = {},
): Promise<Record<Id, Position>> {
  const direction = options.direction ?? 'RIGHT';
  const spacing = options.spacing ?? 60;
  const tSize = transitionSize(direction);

  const sizes = new Map<Id, { width: number; height: number }>();
  for (const p of net.places) sizes.set(p.id, { width: PLACE_DIAMETER, height: PLACE_DIAMETER });
  for (const t of net.transitions) sizes.set(t.id, tSize);
  if (sizes.size === 0) return {};

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.spacing.nodeNode': String(spacing),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(Math.round(spacing * 1.5)),
      'elk.layered.spacing.edgeNodeBetweenLayers': String(Math.round(spacing / 2)),
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.separateConnectedComponents': 'true',
      'elk.spacing.componentComponent': String(spacing * 2),
    },
    children: [...sizes].map(([id, size]) => ({ id, ...size })),
    edges: net.arcs
      .filter((a) => sizes.has(a.source) && sizes.has(a.target))
      .map((a) => ({ id: a.id, sources: [a.source], targets: [a.target] })),
  };

  const result = await getElk().layout(graph);

  const positions: Record<Id, Position> = {};
  for (const child of result.children ?? []) {
    const size = sizes.get(child.id);
    if (!size) continue;
    positions[child.id] = {
      x: Math.round((child.x ?? 0) + size.width / 2),
      y: Math.round((child.y ?? 0) + size.height / 2),
    };
  }
  return positions;
}

export interface GraphNode {
  id: string;
  width: number;
  height: number;
  /** Put the node in the first layer (the start of a state space). */
  first?: boolean;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
}

export interface GraphLayoutOptions {
  direction?: LayoutDirection;
  /** Distance between nodes in the same layer in pixels. Default 40. */
  spacing?: number;
  /** Distance between layers in pixels. Default 80. */
  layerSpacing?: number;
}

export interface GraphLayout {
  /** Top-left corner of every node. */
  positions: Record<string, Position>;
  /** The route of every edge as a list of points from the source to the target. */
  routes: Record<string, Position[]>;
}

/**
 * Lays out any directed graph with ELK's layered algorithm (used for state spaces): positions of
 * the nodes and routes of the edges. Self-loops are left out. Cycles are broken by ELK; a node
 * marked `first` is placed in the first layer, so that the graph reads from the start on.
 */
export async function layoutGraph(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  options: GraphLayoutOptions = {},
): Promise<GraphLayout> {
  if (nodes.length === 0) return { positions: {}, routes: {} };
  const direction = options.direction ?? 'RIGHT';
  const spacing = options.spacing ?? 40;
  const layerSpacing = options.layerSpacing ?? 80;
  const known = new Set(nodes.map((n) => n.id));
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.edgeRouting': 'POLYLINE',
      'elk.spacing.nodeNode': String(spacing),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(layerSpacing),
      'elk.layered.spacing.edgeNodeBetweenLayers': String(Math.round(spacing / 2)),
      'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    },
    children: nodes.map((n) => ({
      id: n.id,
      width: n.width,
      height: n.height,
      ...(n.first && { layoutOptions: { 'elk.layered.layering.layerConstraint': 'FIRST' } }),
    })),
    edges: edges
      .filter((e) => known.has(e.source) && known.has(e.target) && e.source !== e.target)
      .map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };
  const result = await getElk().layout(graph);
  const positions: Record<string, Position> = {};
  for (const child of result.children ?? []) {
    positions[child.id] = { x: Math.round(child.x ?? 0), y: Math.round(child.y ?? 0) };
  }
  const routes: Record<string, Position[]> = {};
  for (const edge of result.edges ?? []) {
    const section = edge.sections?.[0];
    if (!section) continue;
    routes[edge.id] = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(
      (p) => ({ x: Math.round(p.x), y: Math.round(p.y) }),
    );
  }
  return { positions, routes };
}
