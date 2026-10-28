import type { Id, PetriNet } from './model';

/**
 * The part a place plays in a process model.
 *
 * - `source`: no transition puts tokens on it (cases enter here).
 * - `sink`: no transition takes tokens from it (cases leave here).
 * - `resource`: holds initial tokens and is both input and output of one transition
 *   (a worker, machine or room that is taken and given back).
 * - `case`: everything else (queues, work in progress).
 */
export type PlaceRole = 'source' | 'sink' | 'resource' | 'case';

interface Adjacency {
  /** Transitions with an arc into the place. */
  into: Set<Id>;
  /** Transitions with an arc out of the place. */
  out: Set<Id>;
}

function adjacency(net: PetriNet): Map<Id, Adjacency> {
  const transitionIds = new Set(net.transitions.map((t) => t.id));
  const result = new Map<Id, Adjacency>();
  for (const place of net.places) result.set(place.id, { into: new Set(), out: new Set() });
  for (const arc of net.arcs) {
    if (transitionIds.has(arc.source)) result.get(arc.target)?.into.add(arc.source);
    if (transitionIds.has(arc.target)) result.get(arc.source)?.out.add(arc.target);
  }
  return result;
}

function rolesOf(net: PetriNet, honourOverride: boolean): Map<Id, PlaceRole> {
  const adjacent = adjacency(net);
  const roles = new Map<Id, PlaceRole>();
  for (const place of net.places) {
    const { into, out } = adjacent.get(place.id)!;
    if (into.size === 0) roles.set(place.id, 'source');
    else if (out.size === 0) roles.set(place.id, 'sink');
    else {
      const marked = (net.marking[place.id]?.length ?? 0) > 0;
      const computed: PlaceRole = marked && [...into].some((t) => out.has(t)) ? 'resource' : 'case';
      roles.set(place.id, (honourOverride ? place.role : undefined) ?? computed);
    }
  }
  return roles;
}

/** The roles of all places. Compute once and look up, rather than calling `placeRole` per place. */
export function placeRoles(net: PetriNet): Map<Id, PlaceRole> {
  return rolesOf(net, true);
}

/**
 * The role of a place. `source` and `sink` follow from the structure alone; between `resource`
 * and `case` the `role` field of the place overrides the computed role.
 */
export function placeRole(net: PetriNet, placeId: Id): PlaceRole {
  return placeRoles(net).get(placeId) ?? 'case';
}

/** The role derived from the structure and the initial marking only, ignoring `role`. */
export function computedPlaceRole(net: PetriNet, placeId: Id): PlaceRole {
  return rolesOf(net, false).get(placeId) ?? 'case';
}

/** True if the place is input and output of one and the same transition. */
export function hasLoop(net: PetriNet, placeId: Id): boolean {
  const adjacent = adjacency(net).get(placeId);
  return adjacent !== undefined && [...adjacent.into].some((t) => adjacent.out.has(t));
}

/** True if the transition has no input place: it creates tokens out of nothing (arrivals). */
export function isSourceTransition(net: PetriNet, transitionId: Id): boolean {
  const placeIds = new Set(net.places.map((p) => p.id));
  return !net.arcs.some((a) => a.target === transitionId && placeIds.has(a.source));
}
