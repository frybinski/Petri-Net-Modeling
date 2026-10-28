import { createId } from './id';
import type { Annotation, Arc, Id, Marking, PetriNet, Place, Position, Transition } from './model';
import { uniqueName } from './net-ops';

/** A copied part of a net. Contains only arcs whose both ends are part of the fragment. */
export interface NetFragment {
  places: Place[];
  transitions: Transition[];
  arcs: Arc[];
  marking: Marking;
  annotations: Annotation[];
}

export function isEmptyFragment(fragment: NetFragment): boolean {
  return (
    fragment.places.length === 0 &&
    fragment.transitions.length === 0 &&
    fragment.annotations.length === 0
  );
}

/** Copies the selected nodes and annotations plus the arcs running between them. */
export function extractFragment(net: PetriNet, ids: Iterable<Id>): NetFragment {
  const selected = new Set(ids);
  const places = net.places.filter((p) => selected.has(p.id));
  const transitions = net.transitions.filter((t) => selected.has(t.id));
  const nodeIds = new Set([...places, ...transitions].map((n) => n.id));
  const arcs = net.arcs.filter((a) => nodeIds.has(a.source) && nodeIds.has(a.target));
  const marking: Marking = {};
  for (const p of places) {
    const tokens = net.marking[p.id];
    if (tokens && tokens.length > 0) marking[p.id] = structuredClone(tokens);
  }
  const annotations = (net.annotations ?? []).filter((a) => selected.has(a.id));
  return structuredClone({ places, transitions, arcs, marking, annotations });
}

export interface InsertResult {
  net: PetriNet;
  /** Ids of all inserted elements (nodes, arcs, annotations). */
  ids: Id[];
  /** Ids of the inserted nodes and annotations, which can be selected on the canvas. */
  nodeIds: Id[];
}

/**
 * Inserts a fragment with fresh ids, shifted by `offset`. Names are made unique
 * within the target net.
 */
export function insertFragment(
  net: PetriNet,
  fragment: NetFragment,
  offset: Position,
): InsertResult {
  const copy = structuredClone(fragment);
  const idMap = new Map<Id, Id>();
  const fresh = (old: Id): Id => {
    const id = createId();
    idMap.set(old, id);
    return id;
  };
  const shift = (p: Position): Position => ({ x: p.x + offset.x, y: p.y + offset.y });

  const placeNames = net.places.map((p) => p.name);
  const places = copy.places.map((p) => {
    const name = uniqueName(placeNames, p.name);
    placeNames.push(name);
    return { ...p, id: fresh(p.id), name, position: shift(p.position) };
  });
  const transitionNames = net.transitions.map((t) => t.name);
  const transitions = copy.transitions.map((t) => {
    const name = uniqueName(transitionNames, t.name);
    transitionNames.push(name);
    return { ...t, id: fresh(t.id), name, position: shift(t.position) };
  });
  const arcs = copy.arcs.map((a): Arc => {
    const next: Arc = {
      ...a,
      id: createId(),
      source: idMap.get(a.source) ?? a.source,
      target: idMap.get(a.target) ?? a.target,
    };
    if (a.points) next.points = a.points.map(shift);
    return next;
  });
  const annotations = copy.annotations.map((a) => ({
    ...a,
    id: fresh(a.id),
    position: shift(a.position),
  }));
  const marking: Marking = { ...net.marking };
  for (const [oldId, tokens] of Object.entries(copy.marking)) {
    const newId = idMap.get(oldId);
    if (newId) marking[newId] = tokens;
  }

  const result: PetriNet = {
    ...net,
    places: [...net.places, ...places],
    transitions: [...net.transitions, ...transitions],
    arcs: [...net.arcs, ...arcs],
    marking,
  };
  if (annotations.length > 0 || net.annotations) {
    result.annotations = [...(net.annotations ?? []), ...annotations];
  }
  return {
    net: result,
    ids: [...places, ...transitions, ...arcs, ...annotations].map((e) => e.id),
    nodeIds: [...places, ...transitions, ...annotations].map((e) => e.id),
  };
}
