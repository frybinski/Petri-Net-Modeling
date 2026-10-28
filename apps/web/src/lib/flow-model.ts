import {
  tokenLabel,
  type Diagnostic,
  type Id,
  type Marking,
  type PetriNet,
  type Position,
  type Token,
} from '@pnm/core';
import type { ArcFlowEdge, FlowNode } from '../components/canvas/types';
import {
  PARALLEL_ARC_BEND,
  PLACE_SHAPE,
  TRANSITION_SHAPE,
  arcGeometry,
  arrowHeadPoints,
  type Endpoint,
} from './geometry';

export const ANNOTATION_WIDTH = 180;

/** Up to this many tokens are written out below a place of a JSON net. */
export const MAX_LABELLED_TOKENS = 3;
/** Up to this many tokens are listed in the hover text. */
export const MAX_TOOLTIP_TOKENS = 10;

/** One token per line, for the hover text of a place. */
export function tokenTooltip(tokens: readonly Token[]): string {
  const lines = tokens.slice(0, MAX_TOOLTIP_TOKENS).map((t) => tokenLabel(t, 60));
  if (tokens.length > MAX_TOOLTIP_TOKENS) {
    lines.push(`… and ${tokens.length - MAX_TOOLTIP_TOKENS} more`);
  }
  return lines.join('\n');
}

export const INSCRIPTION_LABEL_LENGTH = 24;
export const GUARD_LABEL_LENGTH = 34;

export interface FlowContext {
  net: PetriNet;
  marking: Marking;
  selection: readonly Id[];
  /** Ids of enabled transitions (simulation only) and their number of bindings. */
  enabled: ReadonlyMap<Id, number>;
  /** Transition whose binding list is open. */
  picking: Id | null;
  /** Show guards, inscriptions and types. */
  showInscriptions: boolean;
  simulating: boolean;
  diagnostics: readonly Diagnostic[];
  dragPositions: Readonly<Record<Id, Position>> | null;
  renamingId: Id | null;
  arcSource: Id | null;
  /** Locked nodes cannot be dragged or connected. */
  editable: boolean;
  connectable: boolean;
  measured: ReadonlyMap<Id, { width: number; height: number }>;
}

/** Ids of elements that have at least one error diagnostic. */
export function errorIds(diagnostics: readonly Diagnostic[]): Set<Id> {
  const ids = new Set<Id>();
  for (const d of diagnostics) {
    if (d.severity === 'error' && d.elementId !== undefined) ids.add(d.elementId);
  }
  return ids;
}

/** Converts the model into React Flow nodes. Model positions are centers (annotations: top-left). */
export function buildFlowNodes(ctx: FlowContext): FlowNode[] {
  const selected = new Set(ctx.selection);
  const errors = errorIds(ctx.diagnostics);
  const positionOf = (id: Id, fallback: Position): Position => ctx.dragPositions?.[id] ?? fallback;
  const nodes: FlowNode[] = [];

  for (const note of ctx.net.annotations ?? []) {
    nodes.push({
      id: note.id,
      type: 'annotation',
      position: positionOf(note.id, note.position),
      origin: [0, 0],
      width: ANNOTATION_WIDTH,
      ...(ctx.measured.get(note.id) && { measured: ctx.measured.get(note.id) }),
      selected: selected.has(note.id),
      draggable: ctx.editable,
      selectable: true,
      connectable: false,
      ariaLabel: `Note: ${note.text || 'empty'}`,
      data: { text: note.text, renaming: ctx.renamingId === note.id },
    });
  }

  const json = ctx.net.profile === 'json-net';
  for (const place of ctx.net.places) {
    const tokenList = ctx.marking[place.id] ?? [];
    const tokens = tokenList.length;
    nodes.push({
      id: place.id,
      type: 'place',
      position: positionOf(place.id, place.position),
      ...(ctx.measured.get(place.id) && { measured: ctx.measured.get(place.id) }),
      selected: selected.has(place.id),
      draggable: ctx.editable,
      connectable: ctx.connectable,
      ariaLabel: `Place ${place.name}, ${tokens} ${tokens === 1 ? 'token' : 'tokens'}`,
      data: {
        name: place.name,
        tokens,
        json,
        tokenLabels:
          json && tokens <= MAX_LABELLED_TOKENS ? tokenList.map((t) => tokenLabel(t, 18)) : [],
        ...(json && tokens > 0 && { tooltip: tokenTooltip(tokenList) }),
        ...(json && ctx.showInscriptions && place.type !== undefined && { typeName: place.type }),
        ...(place.capacity !== undefined && { capacity: place.capacity }),
        hasError: errors.has(place.id),
        isArcSource: ctx.arcSource === place.id,
        renaming: ctx.renamingId === place.id,
      },
    });
  }

  for (const transition of ctx.net.transitions) {
    const enabled = ctx.enabled.has(transition.id);
    const guard = transition.guard?.trim();
    nodes.push({
      id: transition.id,
      type: 'transition',
      position: positionOf(transition.id, transition.position),
      ...(ctx.measured.get(transition.id) && { measured: ctx.measured.get(transition.id) }),
      selected: selected.has(transition.id),
      draggable: ctx.editable,
      connectable: ctx.connectable,
      ariaLabel: `Transition ${transition.name}${ctx.simulating ? (enabled ? ', enabled' : ', not enabled') : ''}`,
      data: {
        name: transition.name,
        ...(json && ctx.showInscriptions && guard ? { guard } : {}),
        bindings: ctx.enabled.get(transition.id) ?? 0,
        picking: ctx.picking === transition.id,
        enabled,
        simulating: ctx.simulating,
        hasError: errors.has(transition.id),
        isArcSource: ctx.arcSource === transition.id,
        renaming: ctx.renamingId === transition.id,
      },
    });
  }

  return nodes;
}

/** Converts arcs into React Flow edges with their geometry precomputed from the model. */
export function buildFlowEdges(ctx: FlowContext): ArcFlowEdge[] {
  const selected = new Set(ctx.selection);
  const errors = errorIds(ctx.diagnostics);
  const endpoints = new Map<Id, Endpoint>();
  for (const p of ctx.net.places) {
    endpoints.set(p.id, { center: ctx.dragPositions?.[p.id] ?? p.position, shape: PLACE_SHAPE });
  }
  for (const t of ctx.net.transitions) {
    endpoints.set(t.id, {
      center: ctx.dragPositions?.[t.id] ?? t.position,
      shape: TRANSITION_SHAPE,
    });
  }
  const directions = new Set(ctx.net.arcs.map((a) => `${a.source}>${a.target}`));
  const json = ctx.net.profile === 'json-net';

  const edges: ArcFlowEdge[] = [];
  for (const arc of ctx.net.arcs) {
    const source = endpoints.get(arc.source);
    const target = endpoints.get(arc.target);
    if (!source || !target) continue; // dangling arcs are reported by validation, not drawn
    const hasReverse = directions.has(`${arc.target}>${arc.source}`);
    const geometry = arcGeometry({
      source,
      target,
      points: arc.points,
      bend: hasReverse ? PARALLEL_ARC_BEND : 0,
    });
    edges.push({
      id: arc.id,
      type: 'arc',
      source: arc.source,
      target: arc.target,
      selected: selected.has(arc.id),
      selectable: true,
      focusable: true,
      ariaLabel: `Arc from ${nameOf(ctx.net, arc.source)} to ${nameOf(ctx.net, arc.target)}, ${
        json && (arc.inscription ?? '').trim() !== ''
          ? `inscription ${arc.inscription!.trim()}`
          : `weight ${arc.weight}`
      }`,
      data: {
        path: geometry.path,
        arrow: arrowHeadPoints(geometry.tip, geometry.angle),
        label: geometry.label,
        weight: arc.weight,
        ...(json && ctx.showInscriptions && (arc.inscription ?? '').trim() !== ''
          ? { inscription: arc.inscription!.trim() }
          : {}),
        hasError: errors.has(arc.id),
        arcId: arc.id,
      },
    });
  }
  return edges;
}

export function nameOf(net: PetriNet, id: Id): string {
  return (
    net.places.find((p) => p.id === id)?.name ??
    net.transitions.find((t) => t.id === id)?.name ??
    id
  );
}
