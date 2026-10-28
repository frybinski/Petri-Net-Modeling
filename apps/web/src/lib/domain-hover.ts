import { placeRoles, type Id, type Marking, type PetriNet, type PlaceRole } from '@pnm/core';
import { arcKey, type DomainView, type Provenance } from '@pnm/domain';

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
}

interface Input {
  net: PetriNet;
  view: DomainView;
  marking: Marking;
  /** Firings under way per transition id. */
  running?: ReadonlyMap<Id, number>;
  id: Id;
}

/** What the hover card of an element of the domain view shows. */
export function buildDomainCard({
  net,
  view,
  marking,
  running,
  id,
}: Input): DomainCardModel | null {
  const place = net.places.find((p) => p.id === id);
  if (place) {
    const entry = view.places[id];
    const origin = view.provenance[`places.${id}`];
    return {
      id,
      kind: 'place',
      name: place.name,
      shownAs: entry && entry.kind !== 'hidden' ? entry.kind : null,
      role: placeRoles(net).get(id) ?? 'case',
      tokens: marking[id]?.length ?? 0,
      ...(origin && { origin }),
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
