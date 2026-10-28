import { placeRoles, type Id, type Marking, type PetriNet, type PlaceRole } from '@pnm/core';
import {
  arcKey,
  queueLevel,
  type DomainView,
  type Provenance,
  type QueueLevel,
  type StationInfo,
  type StationStatus,
  type Thresholds,
  type TokenLayout,
} from '@pnm/domain';
import type { MetricsSnapshot } from '@pnm/sim';

export interface DomainCardModel {
  id: Id;
  kind: 'place' | 'transition' | 'arc';
  name: string;
  /** How the view draws the element (`conveyor`, `station`, ...); null if it is not drawn. */
  shownAs: string | null;
  role?: PlaceRole;
  tokens?: number;
  /** Firings of the transition that are under way. */
  running?: number;
  origin?: Provenance;
  sensor?: string;
  /** Simulation: how a station is doing. */
  status?: StationStatus;
  slots?: { busy: number; capacity: number };
  /** Simulation: cases waiting on the place, or in front of the station. */
  waiting?: number;
  /** Case ids of the first waiting cases of a belt, head first, and how many more there are. */
  waitingCases?: { ids: string[]; more: number };
  /** Seconds a token waited on average before it was taken. */
  meanWait?: number | null;
  /** Share of the capacity of a resource that was in use, 0 to 1. */
  utilization?: number | null;
  /** Simulation: free tokens of a resource place. */
  free?: number;
  level?: Exclude<QueueLevel, 'ok'>;
}

/** What the running simulation knows about the elements. Absent while editing. */
export interface LiveCardInput {
  layout: TokenLayout;
  stations: ReadonlyMap<Id, StationInfo>;
  metrics: MetricsSnapshot | null;
  thresholds: Thresholds;
}

const SHOWN_CASES = 4;

interface Input {
  net: PetriNet;
  view: DomainView;
  marking: Marking;
  /** Firings under way per transition id. */
  running?: ReadonlyMap<Id, number>;
  live?: LiveCardInput;
  id: Id;
}

/** What the hover card of an element of the domain view shows. */
export function buildDomainCard({
  net,
  view,
  marking,
  running,
  live,
  id,
}: Input): DomainCardModel | null {
  const place = net.places.find((p) => p.id === id);
  if (place) {
    const entry = view.places[id];
    const origin = view.provenance[`places.${id}`];
    const role = placeRoles(net).get(id) ?? 'case';
    return {
      id,
      kind: 'place',
      name: place.name,
      shownAs: entry && entry.kind !== 'hidden' ? entry.kind : null,
      role,
      tokens: marking[id]?.length ?? 0,
      ...(origin && { origin }),
      ...(live && placeLive(live, id, role, entry?.kind)),
    };
  }
  const transition = net.transitions.find((t) => t.id === id);
  if (transition) {
    const entry = view.transitions[id];
    const origin = view.provenance[`transitions.${id}`];
    const sensor = entry && entry.kind !== 'hidden' ? entry.sensor : undefined;
    const count = running?.get(id);
    return {
      id,
      kind: 'transition',
      name: transition.name,
      shownAs: entry && entry.kind !== 'hidden' ? entry.kind : null,
      ...(count !== undefined && count > 0 && { running: count }),
      ...(origin && { origin }),
      ...(sensor !== undefined && { sensor }),
      ...(live && transitionLive(live, view, id)),
    };
  }
  const arc = net.arcs.find((a) => a.id === id);
  if (arc) {
    const nameOf = (nodeId: Id): string =>
      net.places.find((p) => p.id === nodeId)?.name ??
      net.transitions.find((t) => t.id === nodeId)?.name ??
      nodeId;
    const key = arcKey(arc.source, arc.target);
    const origin = view.provenance[`arcs.${key}`];
    return {
      id,
      kind: 'arc',
      name: `${nameOf(arc.source)} → ${nameOf(arc.target)}`,
      shownAs: view.arcs?.[key] ? 'connector' : null,
      ...(origin && { origin }),
    };
  }
  return null;
}

/** The origin of an entry as text, for example `user · 2026-10-28`. */
export function formatOrigin(origin: Provenance): string {
  const source = origin.source === 'llm' ? 'LLM' : origin.source;
  const date = origin.at.slice(0, 10);
  return origin.model ? `${source} (${origin.model}) · ${date}` : `${source} · ${date}`;
}

function placeLive(
  live: LiveCardInput,
  id: Id,
  role: PlaceRole,
  kind: string | undefined,
): Partial<DomainCardModel> {
  const stats = live.metrics?.places.find((p) => p.placeId === id);
  const result: Partial<DomainCardModel> = {};
  if (role === 'resource') {
    const resource = live.metrics?.resources.find((r) => r.placeId === id);
    if (resource) {
      result.free = resource.free;
      result.utilization = resource.utilization;
    }
    return result;
  }
  if (role !== 'case') return result;
  const count = live.layout.counts.get(id) ?? 0;
  result.waiting = count;
  if (stats) result.meanWait = stats.meanWait;
  const level = queueLevel(count, live.thresholds);
  if (level !== 'ok') result.level = level;
  if (kind === 'queue' || kind === 'conveyor' || kind === 'buffer') {
    const waiting = [...live.layout.tokens.values()]
      .filter((t) => t.elementId === id && t.caseId !== undefined)
      .sort((a, b) => (b.along ?? 0) - (a.along ?? 0));
    const ids = waiting.slice(0, SHOWN_CASES).map((t) => t.caseId!);
    if (ids.length > 0) result.waitingCases = { ids, more: Math.max(0, count - ids.length) };
  }
  return result;
}

function transitionLive(live: LiveCardInput, view: DomainView, id: Id): Partial<DomainCardModel> {
  const info = live.stations.get(id);
  if (!info) return {};
  const result: Partial<DomainCardModel> = {
    status: info.status,
    waiting: info.waiting,
  };
  if (info.capacity > 0) result.slots = { busy: info.busy, capacity: info.capacity };
  // The use of the resource whose slots this station draws.
  for (const [placeId, entry] of Object.entries(view.places)) {
    if (entry.kind === 'slots' && entry.of === id) {
      const resource = live.metrics?.resources.find((r) => r.placeId === placeId);
      if (resource) {
        result.utilization = resource.utilization;
        break;
      }
    }
  }
  return result;
}
