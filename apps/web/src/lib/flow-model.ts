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
import { truncate } from './inscriptions';
import { describeTiming } from './sim-format';
import type { Bottleneck, RunInfo } from './sim-view';
import {
  PLACE_SIZE,
  PLACE_SHAPE,
  TRANSITION_HEIGHT,
  TRANSITION_WIDTH,
  TRANSITION_SHAPE,
  arcGeometry,
  arrowHeadPoints,
  guardPillObstacle,
  obstaclesFor,
  type Endpoint,
} from '@pnm/layout/geometry';

export const ANNOTATION_WIDTH = 180;

/** Up to this many token chips are shown next to a selected place of a JSON net. */
export const MAX_TOKEN_CHIPS = 5;
/** Up to this many tokens are listed in the hover card. */
export const MAX_CARD_TOKENS = 10;

export const INSCRIPTION_LABEL_LENGTH = 24;
export const GUARD_LABEL_LENGTH = 28;

/** The text of a guard pill: the guard on one line, shortened, in brackets. */
export function guardPillText(guard: string): string {
  return `[ ${truncate(guard, GUARD_LABEL_LENGTH)} ]`;
}

export type ChipSide = 'right' | 'left' | 'below';

/** Reach of the chip card from the node: to the sides, and downwards. */
const CHIP_REACH_X = 220;
const CHIP_REACH_Y = 160;
/** Vertical band around the node that the chip card (and the guards next to it) occupies. */
const CHIP_BAND = 90;

/**
 * Side of a place on which its token chips appear: to the right, unless another node is within
 * about 220 px there (and roughly 90 px above or below); then to the left (not for the leftmost nodes of the net), then below. Without any free side it stays on the right.
 */
export function chipSide(net: PetriNet, id: Id, position: Position): ChipSide {
  const others = [...net.places, ...net.transitions].filter((n) => n.id !== id);
  const blocked = (inside: (dx: number, dy: number) => boolean): boolean =>
    others.some((n) => inside(n.position.x - position.x, n.position.y - position.y));
  if (!blocked((dx, dy) => dx > 0 && dx <= CHIP_REACH_X && Math.abs(dy) <= CHIP_BAND))
    return 'right';
  // The leftmost nodes of a net sit at the edge of the view, where a card to the left is cut off.
  const atLeftEdge = others.every((n) => n.position.x >= position.x - 100);
  if (
    !atLeftEdge &&
    !blocked((dx, dy) => dx < 0 && dx >= -CHIP_REACH_X && Math.abs(dy) <= CHIP_BAND)
  ) {
    return 'left';
  }
  if (!blocked((dx, dy) => dy > 0 && dy <= CHIP_REACH_Y && Math.abs(dx) <= 100)) return 'below';
  return 'right';
}

/** The token chips of a place: the first few labels and how many more there are. */
export function tokenChips(tokens: readonly Token[]): { chips: string[]; more: number } {
  return {
    chips: tokens.slice(0, MAX_TOKEN_CHIPS).map((t) => tokenLabel(t, 22)),
    more: Math.max(0, tokens.length - MAX_TOKEN_CHIPS),
  };
}

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
  /** Firings under way per transition (timed simulation). */
  running?: ReadonlyMap<Id, RunInfo>;
  /** Transitions with a breakpoint, and places with a breakpoint and its token count. */
  breakpointTransitions?: ReadonlySet<Id>;
  breakpointPlaces?: Readonly<Record<Id, number>>;
  /** Queues that are filling up. */
  bottlenecks?: ReadonlyMap<Id, Bottleneck>;
  /** Places that just got a token created by a replay. */
  deviationRing?: ReadonlySet<Id>;
  /** Tokens a replay has created, by place. */
  createdTokens?: Readonly<Record<Id, number>>;
}

/** Ids of elements that have at least one error diagnostic. */
export function errorIds(diagnostics: readonly Diagnostic[]): Set<Id> {
  const ids = new Set<Id>();
  for (const d of diagnostics) {
    if (d.severity === 'error' && d.elementId !== undefined) ids.add(d.elementId);
  }
  return ids;
}

/** First error message per element, for the warning marker on the canvas. */
export function errorTexts(diagnostics: readonly Diagnostic[]): Map<Id, string> {
  const texts = new Map<Id, string>();
  for (const d of diagnostics) {
    if (d.severity === 'error' && d.elementId !== undefined && !texts.has(d.elementId)) {
      texts.set(d.elementId, d.message);
    }
  }
  return texts;
}

/** Converts the model into React Flow nodes. Model positions are centers (annotations: top-left). */
export function buildFlowNodes(ctx: FlowContext): FlowNode[] {
  const selected = new Set(ctx.selection);
  const errors = errorIds(ctx.diagnostics);
  const errorText = errorTexts(ctx.diagnostics);
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
    const { chips, more } = json ? tokenChips(tokenList) : { chips: [], more: 0 };
    nodes.push({
      id: place.id,
      type: 'place',
      position: positionOf(place.id, place.position),
      // The size is known up front, so that a new node is visible (and can take the focus) at once.
      initialWidth: PLACE_SIZE,
      initialHeight: PLACE_SIZE,
      ...(ctx.measured.get(place.id) && { measured: ctx.measured.get(place.id) }),
      selected: selected.has(place.id),
      draggable: ctx.editable,
      connectable: ctx.connectable,
      ariaLabel: `Place ${place.name}, ${tokens} ${tokens === 1 ? 'token' : 'tokens'}`,
      data: {
        name: place.name,
        tokens,
        json,
        chips,
        chipsMore: more,
        chipSide: chipSide(ctx.net, place.id, positionOf(place.id, place.position)),
        ...(json && ctx.showInscriptions && place.type !== undefined && { typeName: place.type }),
        ...(place.capacity !== undefined && { capacity: place.capacity }),
        hasError: errors.has(place.id),
        ...(errors.has(place.id) && { errorText: errorText.get(place.id) }),
        isArcSource: ctx.arcSource === place.id,
        renaming: ctx.renamingId === place.id,
        ...(ctx.bottlenecks?.get(place.id) && { bottleneck: ctx.bottlenecks.get(place.id) }),
        ...(ctx.deviationRing?.has(place.id) && { deviation: true }),
        ...(ctx.breakpointPlaces?.[place.id] !== undefined && {
          breakpoint: ctx.breakpointPlaces[place.id],
        }),
      },
    });
  }

  for (const transition of ctx.net.transitions) {
    const enabled = ctx.enabled.has(transition.id);
    const guard = transition.guard?.trim();
    const run = ctx.running?.get(transition.id);
    nodes.push({
      id: transition.id,
      type: 'transition',
      position: positionOf(transition.id, transition.position),
      initialWidth: TRANSITION_WIDTH,
      initialHeight: TRANSITION_HEIGHT,
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
        ...(errors.has(transition.id) && { errorText: errorText.get(transition.id) }),
        isArcSource: ctx.arcSource === transition.id,
        renaming: ctx.renamingId === transition.id,
        ...(transition.timing && { timing: describeTiming(transition.timing) }),
        running: run?.count ?? 0,
        progress: run?.progress ?? 0,
        breakpoint: ctx.breakpointTransitions?.has(transition.id) ?? false,
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
  const json = ctx.net.profile === 'json-net';
  // The guard pills hang above their transitions: arcs keep clear of them like of nodes.
  const everyone: Array<readonly [string, Endpoint]> = [...endpoints.entries()];
  if (json && ctx.showInscriptions) {
    for (const t of ctx.net.transitions) {
      const guard = t.guard?.trim();
      if (!guard) continue;
      everyone.push([
        `guard:${t.id}`,
        guardPillObstacle(ctx.dragPositions?.[t.id] ?? t.position, guardPillText(guard).length),
      ]);
    }
  }
  const directions = new Set(ctx.net.arcs.map((a) => `${a.source}>${a.target}`));

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
      parallel: hasReverse,
      obstacles: obstaclesFor(everyone, [arc.source, arc.target], source.center, target.center),
    });
    edges.push({
      id: arc.id,
      type: 'arc',
      source: arc.source,
      target: arc.target,
      selected: selected.has(arc.id),
      selectable: true,
      focusable: true,
      interactionWidth: 20,
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
