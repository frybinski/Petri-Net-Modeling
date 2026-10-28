import { createId } from './id';
import type { Annotation, Arc, Id, PetriNet, Place, Position, Transition } from './model';
import { isPlace, isTransition, nodeById } from './queries';

/** Error raised by net operations when the requested change is not allowed. */
export class NetOpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetOpError';
  }
}

export interface AddPlaceInit {
  position: Position;
  id?: Id;
  name?: string;
  capacity?: number;
  type?: string;
}

export interface AddTransitionInit {
  position: Position;
  id?: Id;
  name?: string;
  guard?: string;
}

export interface AddArcInit {
  id?: Id;
  weight?: number;
  inscription?: string;
  points?: Position[];
}

export type PlacePatch = Partial<Omit<Place, 'id'>>;
export type TransitionPatch = Partial<Omit<Transition, 'id'>>;
export type NodePatch = PlacePatch & TransitionPatch;
export type ArcPatch = Partial<Omit<Arc, 'id' | 'source' | 'target'>>;

/**
 * Returns a name based on `base` that is not in `taken`. A trailing number is
 * incremented (`P1` -> `P2`), otherwise ` 2`, ` 3`, ... is appended.
 */
export function uniqueName(taken: Iterable<string>, base: string): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  const match = /^(.*?)(\d+)$/.exec(base);
  const stem = match ? (match[1] ?? '') : `${base} `;
  let n = match ? Number(match[2]) + 1 : 2;
  while (used.has(`${stem}${n}`)) n += 1;
  return `${stem}${n}`;
}

export function addPlace(net: PetriNet, init: AddPlaceInit): PetriNet {
  const id = init.id ?? createId();
  assertFreeId(net, id);
  assertCapacity(init.capacity);
  const place: Place = {
    id,
    name:
      init.name ??
      uniqueName(
        net.places.map((p) => p.name),
        'P1',
      ),
    position: { ...init.position },
  };
  if (init.capacity !== undefined) place.capacity = init.capacity;
  if (init.type !== undefined) place.type = init.type;
  return { ...net, places: [...net.places, place] };
}

export function addTransition(net: PetriNet, init: AddTransitionInit): PetriNet {
  const id = init.id ?? createId();
  assertFreeId(net, id);
  const transition: Transition = {
    id,
    name:
      init.name ??
      uniqueName(
        net.transitions.map((t) => t.name),
        'T1',
      ),
    position: { ...init.position },
  };
  if (init.guard !== undefined) transition.guard = init.guard;
  return { ...net, transitions: [...net.transitions, transition] };
}

/** Result of `canConnect`: either allowed, or a human-readable reason why not. */
export type ConnectCheck = { ok: true } | { ok: false; reason: string };

/** Checks whether an arc `source -> target` keeps the net bipartite. */
export function canConnect(net: PetriNet, source: Id, target: Id): ConnectCheck {
  const src = nodeById(net, source);
  const tgt = nodeById(net, target);
  if (!src || !tgt) return { ok: false, reason: 'Both ends of an arc must exist.' };
  if (isPlace(net, source) && isPlace(net, target)) {
    return { ok: false, reason: 'A place cannot be connected to a place.' };
  }
  if (isTransition(net, source) && isTransition(net, target)) {
    return { ok: false, reason: 'A transition cannot be connected to a transition.' };
  }
  return { ok: true };
}

/** Adds an arc. Throws `NetOpError` if the connection is not place <-> transition. */
export function addArc(net: PetriNet, source: Id, target: Id, init: AddArcInit = {}): PetriNet {
  const check = canConnect(net, source, target);
  if (!check.ok) throw new NetOpError(check.reason);
  const id = init.id ?? createId();
  assertFreeId(net, id);
  const weight = init.weight ?? 1;
  assertWeight(weight);
  const arc: Arc = { id, source, target, weight };
  if (init.inscription !== undefined) arc.inscription = init.inscription;
  if (init.points !== undefined) arc.points = init.points.map((p) => ({ ...p }));
  return { ...net, arcs: [...net.arcs, arc] };
}

/** Finds an existing arc with the same direction between the same two nodes. */
export function findArc(net: PetriNet, source: Id, target: Id): Arc | undefined {
  return net.arcs.find((a) => a.source === source && a.target === target);
}

/** Removes a place or transition together with its arcs and its initial tokens. */
export function removeNode(net: PetriNet, nodeId: Id): PetriNet {
  if (!nodeById(net, nodeId)) return net;
  const marking = { ...net.marking };
  delete marking[nodeId];
  return {
    ...net,
    places: net.places.filter((p) => p.id !== nodeId),
    transitions: net.transitions.filter((t) => t.id !== nodeId),
    arcs: net.arcs.filter((a) => a.source !== nodeId && a.target !== nodeId),
    marking,
  };
}

export function removeArc(net: PetriNet, arcId: Id): PetriNet {
  if (!net.arcs.some((a) => a.id === arcId)) return net;
  return { ...net, arcs: net.arcs.filter((a) => a.id !== arcId) };
}

/** Removes any mix of places, transitions, arcs and annotations by id. */
export function removeElements(net: PetriNet, ids: Iterable<Id>): PetriNet {
  const doomed = new Set(ids);
  const marking = { ...net.marking };
  for (const id of doomed) delete marking[id];
  const next: PetriNet = {
    ...net,
    places: net.places.filter((p) => !doomed.has(p.id)),
    transitions: net.transitions.filter((t) => !doomed.has(t.id)),
    arcs: net.arcs.filter(
      (a) => !doomed.has(a.id) && !doomed.has(a.source) && !doomed.has(a.target),
    ),
    marking,
  };
  if (net.annotations) next.annotations = net.annotations.filter((a) => !doomed.has(a.id));
  return next;
}

/**
 * Applies a patch to a place or transition. A key whose value is `undefined` is
 * removed from the element (for example `{ capacity: undefined }` makes a place unbounded).
 */
export function updateNode(net: PetriNet, nodeId: Id, patch: NodePatch): PetriNet {
  if ('capacity' in patch) assertCapacity(patch.capacity);
  if (isPlace(net, nodeId)) {
    const { guard: _guard, ...placePatch } = patch;
    return {
      ...net,
      places: net.places.map((p) => (p.id === nodeId ? applyPatch(p, placePatch) : p)),
    };
  }
  if (isTransition(net, nodeId)) {
    const { capacity: _capacity, type: _type, ...transitionPatch } = patch;
    return {
      ...net,
      transitions: net.transitions.map((t) =>
        t.id === nodeId ? applyPatch(t, transitionPatch) : t,
      ),
    };
  }
  throw new NetOpError(`Unknown node: ${nodeId}`);
}

export function updateArc(net: PetriNet, arcId: Id, patch: ArcPatch): PetriNet {
  if (!net.arcs.some((a) => a.id === arcId)) throw new NetOpError(`Unknown arc: ${arcId}`);
  if ('weight' in patch && patch.weight !== undefined) assertWeight(patch.weight);
  return { ...net, arcs: net.arcs.map((a) => (a.id === arcId ? applyPatch(a, patch) : a)) };
}

export function setWeight(net: PetriNet, arcId: Id, weight: number): PetriNet {
  assertWeight(weight);
  return updateArc(net, arcId, { weight });
}

/** Swaps source and target of an arc. */
export function reverseArc(net: PetriNet, arcId: Id): PetriNet {
  const arc = net.arcs.find((a) => a.id === arcId);
  if (!arc) throw new NetOpError(`Unknown arc: ${arcId}`);
  const reversed: Arc = { ...arc, source: arc.target, target: arc.source };
  if (arc.points) reversed.points = [...arc.points].reverse();
  return { ...net, arcs: net.arcs.map((a) => (a.id === arcId ? reversed : a)) };
}

/** Sets the number of initial tokens of a place. A count of 0 clears the place. */
export function setInitialTokens(net: PetriNet, placeId: Id, count: number): PetriNet {
  if (!isPlace(net, placeId)) throw new NetOpError(`Unknown place: ${placeId}`);
  if (!Number.isInteger(count) || count < 0) {
    throw new NetOpError('Token count must be an integer >= 0.');
  }
  const marking = { ...net.marking };
  if (count === 0) delete marking[placeId];
  else marking[placeId] = Array.from({ length: count }, () => 1);
  return { ...net, marking };
}

/** Moves nodes and annotations to new absolute positions. Unknown ids are ignored. */
export function moveNodes(net: PetriNet, positions: Readonly<Record<Id, Position>>): PetriNet {
  const move = <T extends { id: Id; position: Position }>(item: T): T => {
    const to = positions[item.id];
    return to ? { ...item, position: { x: to.x, y: to.y } } : item;
  };
  const next: PetriNet = {
    ...net,
    places: net.places.map(move),
    transitions: net.transitions.map(move),
  };
  if (net.annotations) next.annotations = net.annotations.map(move);
  return next;
}

export function renameNet(net: PetriNet, name: string): PetriNet {
  return { ...net, name };
}

export function addAnnotation(
  net: PetriNet,
  init: { position: Position; id?: Id; text?: string },
): PetriNet {
  const annotation: Annotation = {
    id: init.id ?? createId(),
    text: init.text ?? '',
    position: { ...init.position },
  };
  assertFreeId(net, annotation.id);
  return { ...net, annotations: [...(net.annotations ?? []), annotation] };
}

export function updateAnnotation(
  net: PetriNet,
  annotationId: Id,
  patch: Partial<Omit<Annotation, 'id'>>,
): PetriNet {
  if (!net.annotations?.some((a) => a.id === annotationId)) {
    throw new NetOpError(`Unknown annotation: ${annotationId}`);
  }
  return {
    ...net,
    annotations: net.annotations.map((a) => (a.id === annotationId ? applyPatch(a, patch) : a)),
  };
}

function applyPatch<T extends object>(target: T, patch: Partial<Record<keyof T, unknown>>): T {
  const next = { ...target } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next as T;
}

function allIds(net: PetriNet): Set<Id> {
  return new Set([
    ...net.places.map((p) => p.id),
    ...net.transitions.map((t) => t.id),
    ...net.arcs.map((a) => a.id),
    ...(net.annotations ?? []).map((a) => a.id),
  ]);
}

function assertFreeId(net: PetriNet, id: Id): void {
  if (allIds(net).has(id)) throw new NetOpError(`Id already in use: ${id}`);
}

function assertWeight(weight: number): void {
  if (!Number.isInteger(weight) || weight < 1)
    throw new NetOpError('Arc weight must be an integer >= 1.');
}

function assertCapacity(capacity: number | undefined): void {
  if (capacity !== undefined && (!Number.isInteger(capacity) || capacity < 1)) {
    throw new NetOpError('Capacity must be an integer >= 1.');
  }
}
