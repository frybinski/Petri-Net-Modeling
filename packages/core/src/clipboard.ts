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
  /**
   * The type definitions (name -> schema) that the copied places refer to, so that the fragment
   * can be pasted into another net. Fragments from before this field have none.
   */
  types?: Record<string, unknown>;
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
  const types: Record<string, unknown> = {};
  for (const p of places) {
    if (p.type !== undefined && Object.hasOwn(net.types, p.type)) types[p.type] = net.types[p.type];
  }
  return structuredClone({ places, transitions, arcs, marking, annotations, types });
}

/** Structural equality of two JSON values (object key order does not matter). */
function sameSchema(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => sameSchema(item, b[i]))
    );
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && sameSchema(left[key], right[key]))
  );
}

/** What pasting did to the types of the target net. */
export interface TypeChanges {
  /** Types that the target net did not have and that were added under their own name. */
  added: string[];
  /** Types whose name is taken by a different schema in the target net, and the name they got. */
  renamed: Array<{ from: string; to: string }>;
}

/**
 * Makes the types of a fragment available in `net`. A type that the net already has with the same
 * schema is used as it is; a missing one is added; a type of the same name with another schema is
 * added under a free name (`Name_2`, `Name_3`, ... as type names allow only letters, digits and `_`),
 * and reused when an earlier paste already created it.
 */
function resolveTypes(
  net: PetriNet,
  fragmentTypes: Record<string, unknown>,
): { types: Record<string, unknown>; names: Map<string, string>; changes: TypeChanges } {
  const types = { ...net.types };
  const names = new Map<string, string>();
  const changes: TypeChanges = { added: [], renamed: [] };
  for (const [name, schema] of Object.entries(fragmentTypes)) {
    if (!Object.hasOwn(types, name)) {
      types[name] = schema;
      changes.added.push(name);
      continue;
    }
    if (sameSchema(types[name], schema)) continue;
    let n = 2;
    while (Object.hasOwn(types, `${name}_${n}`) && !sameSchema(types[`${name}_${n}`], schema))
      n += 1;
    const free = `${name}_${n}`;
    if (!Object.hasOwn(types, free)) types[free] = schema;
    names.set(name, free);
    changes.renamed.push({ from: name, to: free });
  }
  return { types, names, changes };
}

export interface InsertResult {
  net: PetriNet;
  /** Ids of all inserted elements (nodes, arcs, annotations). */
  ids: Id[];
  /** Ids of the inserted nodes and annotations, which can be selected on the canvas. */
  nodeIds: Id[];
  /** Types that were added to the net for the pasted places. */
  typeChanges: TypeChanges;
}

/**
 * Inserts a fragment with fresh ids, shifted by `offset`. Names are made unique
 * within the target net, and the types that the places refer to are brought along (see
 * `resolveTypes`).
 */
export function insertFragment(
  net: PetriNet,
  fragment: NetFragment,
  offset: Position,
): InsertResult {
  const copy = structuredClone(fragment);
  const resolved = resolveTypes(net, copy.types ?? {});
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
    const placed: Place = { ...p, id: fresh(p.id), name, position: shift(p.position) };
    if (p.type !== undefined) placed.type = resolved.names.get(p.type) ?? p.type;
    return placed;
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
  if (resolved.changes.added.length > 0 || resolved.changes.renamed.length > 0) {
    result.types = resolved.types;
  }
  if (annotations.length > 0 || net.annotations) {
    result.annotations = [...(net.annotations ?? []), ...annotations];
  }
  return {
    net: result,
    ids: [...places, ...transitions, ...arcs, ...annotations].map((e) => e.id),
    nodeIds: [...places, ...transitions, ...annotations].map((e) => e.id),
    typeChanges: resolved.changes,
  };
}
