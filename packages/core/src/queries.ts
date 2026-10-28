import type { Arc, Id, Node, PetriNet, Place, Transition } from './model';

export function placeById(net: PetriNet, id: Id): Place | undefined {
  return net.places.find((p) => p.id === id);
}

export function transitionById(net: PetriNet, id: Id): Transition | undefined {
  return net.transitions.find((t) => t.id === id);
}

export function nodeById(net: PetriNet, id: Id): Node | undefined {
  return placeById(net, id) ?? transitionById(net, id);
}

export function arcById(net: PetriNet, id: Id): Arc | undefined {
  return net.arcs.find((a) => a.id === id);
}

export function isPlace(net: PetriNet, id: Id): boolean {
  return net.places.some((p) => p.id === id);
}

export function isTransition(net: PetriNet, id: Id): boolean {
  return net.transitions.some((t) => t.id === id);
}

/** All arcs that start or end at the node. */
export function arcsOf(net: PetriNet, nodeId: Id): Arc[] {
  return net.arcs.filter((a) => a.source === nodeId || a.target === nodeId);
}

/** Ids of the nodes with an arc into `nodeId` (the preset, without duplicates). */
export function preset(net: PetriNet, nodeId: Id): Id[] {
  return unique(net.arcs.filter((a) => a.target === nodeId).map((a) => a.source));
}

/** Ids of the nodes with an arc from `nodeId` (the postset, without duplicates). */
export function postset(net: PetriNet, nodeId: Id): Id[] {
  return unique(net.arcs.filter((a) => a.source === nodeId).map((a) => a.target));
}

function unique(ids: Id[]): Id[] {
  return [...new Set(ids)];
}
