import type { PetriNet } from '@pnm/core';

const cache = new WeakMap<PetriNet, string>();

/**
 * Identifies what the analyses depend on: profile, types, places, transitions, arcs and the initial
 * marking. Positions, notes, simulation settings, the domain view and the list of properties do
 * not enter, so moving elements or editing a property keeps the results of the structure and the
 * state space up to date.
 */
export function analysisKey(net: PetriNet): string {
  const known = cache.get(net);
  if (known !== undefined) return known;
  const key = JSON.stringify([
    net.profile,
    net.types,
    net.places.map((p) => [p.id, p.name, p.type, p.capacity]),
    net.transitions.map((t) => [t.id, t.name, t.guard]),
    net.arcs.map((a) => [a.source, a.target, a.weight, a.inscription]),
    net.marking,
  ]);
  cache.set(net, key);
  return key;
}
