import { createId } from './id';
import type {
  Annotation,
  Arc,
  Id,
  PetriNet,
  Place,
  Position,
  Profile,
  SimulationSettings,
  Timing,
  Token,
  Transition,
} from './model';
import { isPlace, isTransition, nodeById } from './queries';
import { isToken } from './token';
import { validateTypeName } from './types';
import { timingProblem } from './validate';

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
    const {
      guard: _guard,
      timing: _timing,
      priority: _priority,
      rate: _rate,
      ...placePatch
    } = patch;
    return {
      ...net,
      places: net.places.map((p) => (p.id === nodeId ? applyPatch(p, placePatch) : p)),
    };
  }
  if (isTransition(net, nodeId)) {
    const { capacity: _capacity, type: _type, role: _role, ...transitionPatch } = patch;
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

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type DistributeAxis = 'horizontal' | 'vertical';

function positioned(net: PetriNet, ids: ReadonlySet<Id>): Array<{ id: Id; position: Position }> {
  return [...net.places, ...net.transitions, ...(net.annotations ?? [])].filter((e) =>
    ids.has(e.id),
  );
}

/**
 * Aligns the selected nodes and annotations by their reference points: `left`, `center`
 * and `right` set a common x (minimum, mean, maximum), `top`, `middle` and `bottom` a
 * common y. Needs at least two elements, otherwise the net is returned unchanged.
 */
export function alignNodes(net: PetriNet, ids: Iterable<Id>, mode: AlignMode): PetriNet {
  const items = positioned(net, new Set(ids));
  if (items.length < 2) return net;
  const xs = items.map((i) => i.position.x);
  const ys = items.map((i) => i.position.y);
  const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;
  const moves: Record<Id, Position> = {};
  for (const { id, position } of items) {
    switch (mode) {
      case 'left':
        moves[id] = { x: Math.min(...xs), y: position.y };
        break;
      case 'center':
        moves[id] = { x: Math.round(mean(xs)), y: position.y };
        break;
      case 'right':
        moves[id] = { x: Math.max(...xs), y: position.y };
        break;
      case 'top':
        moves[id] = { x: position.x, y: Math.min(...ys) };
        break;
      case 'middle':
        moves[id] = { x: position.x, y: Math.round(mean(ys)) };
        break;
      case 'bottom':
        moves[id] = { x: position.x, y: Math.max(...ys) };
        break;
    }
  }
  return moveNodes(net, moves);
}

/**
 * Spaces the selected elements evenly along an axis between the two outermost ones.
 * Needs at least three elements, otherwise the net is returned unchanged.
 */
export function distributeNodes(net: PetriNet, ids: Iterable<Id>, axis: DistributeAxis): PetriNet {
  const items = positioned(net, new Set(ids));
  if (items.length < 3) return net;
  const key = axis === 'horizontal' ? 'x' : 'y';
  const sorted = [...items].sort((a, b) => a.position[key] - b.position[key]);
  const first = sorted[0]!.position[key];
  const last = sorted[sorted.length - 1]!.position[key];
  const step = (last - first) / (sorted.length - 1);
  const moves: Record<Id, Position> = {};
  sorted.forEach((item, index) => {
    const value = Math.round(first + step * index);
    moves[item.id] =
      axis === 'horizontal' ? { x: value, y: item.position.y } : { x: item.position.x, y: value };
  });
  return moveNodes(net, moves);
}

// --- Higher nets: types, guards, inscriptions and tokens ---------------------------------

function typeNameCheck(name: string): void {
  if (!validateTypeName(name)) {
    throw new NetOpError(
      `Invalid type name "${name}": use a letter followed by letters, digits or _.`,
    );
  }
}

function assertTypeExists(net: PetriNet, name: string): void {
  if (!Object.hasOwn(net.types, name)) throw new NetOpError(`Unknown type: ${name}`);
}

/** Adds a type. Throws if the name is invalid or already taken. */
export function addType(net: PetriNet, name: string, schema: unknown): PetriNet {
  typeNameCheck(name);
  if (Object.hasOwn(net.types, name)) throw new NetOpError(`The type "${name}" already exists.`);
  return { ...net, types: { ...net.types, [name]: schema } };
}

/** Renames a type and updates the places that use it. */
export function renameType(net: PetriNet, from: string, to: string): PetriNet {
  assertTypeExists(net, from);
  if (from === to) return net;
  typeNameCheck(to);
  if (Object.hasOwn(net.types, to)) throw new NetOpError(`The type "${to}" already exists.`);
  const types: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(net.types)) types[name === from ? to : name] = schema;
  return {
    ...net,
    types,
    places: net.places.map((p) => (p.type === from ? { ...p, type: to } : p)),
  };
}

/** Replaces the schema of a type. */
export function updateType(net: PetriNet, name: string, schema: unknown): PetriNet {
  assertTypeExists(net, name);
  return { ...net, types: { ...net.types, [name]: schema } };
}

/** Removes a type; places that used it become untyped. */
export function removeType(net: PetriNet, name: string): PetriNet {
  if (!Object.hasOwn(net.types, name)) return net;
  const types = { ...net.types };
  delete types[name];
  return {
    ...net,
    types,
    places: net.places.map((p) => {
      if (p.type !== name) return p;
      const { type: _removed, ...rest } = p;
      return rest;
    }),
  };
}

/** Assigns a type to a place, or removes it with `undefined`. */
export function setPlaceType(net: PetriNet, placeId: Id, type: string | undefined): PetriNet {
  if (!isPlace(net, placeId)) throw new NetOpError(`Unknown place: ${placeId}`);
  if (type !== undefined) assertTypeExists(net, type);
  return updateNode(net, placeId, { type });
}

/** Sets the guard of a transition. Blank text removes it. */
export function setGuard(net: PetriNet, transitionId: Id, guard: string | undefined): PetriNet {
  if (!isTransition(net, transitionId)) throw new NetOpError(`Unknown transition: ${transitionId}`);
  return updateNode(net, transitionId, {
    guard: guard === undefined || guard.trim() === '' ? undefined : guard,
  });
}

/** Sets the inscription of an arc. Blank text removes it. */
export function setInscription(
  net: PetriNet,
  arcId: Id,
  inscription: string | undefined,
): PetriNet {
  return updateArc(net, arcId, {
    inscription: inscription === undefined || inscription.trim() === '' ? undefined : inscription,
  });
}

function assertToken(token: unknown): asserts token is Token {
  if (!isToken(token)) throw new NetOpError('A token must be a JSON value other than null.');
}

function withTokens(net: PetriNet, placeId: Id, tokens: Token[]): PetriNet {
  const marking = { ...net.marking };
  if (tokens.length === 0) delete marking[placeId];
  else marking[placeId] = tokens;
  return { ...net, marking };
}

function assertPlace(net: PetriNet, placeId: Id): void {
  if (!isPlace(net, placeId)) throw new NetOpError(`Unknown place: ${placeId}`);
}

/** Replaces the initial tokens of a place. */
export function setTokens(net: PetriNet, placeId: Id, tokens: readonly Token[]): PetriNet {
  assertPlace(net, placeId);
  tokens.forEach(assertToken);
  return withTokens(net, placeId, structuredClone([...tokens]));
}

/** Appends an initial token to a place. */
export function addToken(net: PetriNet, placeId: Id, token: Token): PetriNet {
  assertPlace(net, placeId);
  assertToken(token);
  return withTokens(net, placeId, [...(net.marking[placeId] ?? []), structuredClone(token)]);
}

/** Replaces the initial token at `index`. */
export function updateToken(net: PetriNet, placeId: Id, index: number, token: Token): PetriNet {
  assertPlace(net, placeId);
  assertToken(token);
  const tokens = [...(net.marking[placeId] ?? [])];
  if (!Number.isInteger(index) || index < 0 || index >= tokens.length) {
    throw new NetOpError(`No token at index ${index}.`);
  }
  tokens[index] = structuredClone(token);
  return withTokens(net, placeId, tokens);
}

/** Removes the initial token at `index`. */
export function removeToken(net: PetriNet, placeId: Id, index: number): PetriNet {
  assertPlace(net, placeId);
  const tokens = [...(net.marking[placeId] ?? [])];
  if (!Number.isInteger(index) || index < 0 || index >= tokens.length) {
    throw new NetOpError(`No token at index ${index}.`);
  }
  tokens.splice(index, 1);
  return withTokens(net, placeId, tokens);
}

/** Switches the net class. Types, inscriptions and guards are kept; a P/T net ignores them. */
export function setProfile(net: PetriNet, profile: Profile): PetriNet {
  return net.profile === profile ? net : { ...net, profile };
}

// --- Timed simulation: durations, priorities, rates, roles, settings --------------------------

function assertTransition(net: PetriNet, transitionId: Id): void {
  if (!isTransition(net, transitionId)) throw new NetOpError(`Unknown transition: ${transitionId}`);
}

/** Sets the duration of a transition, or removes it with `undefined` (duration 0). */
export function setTiming(net: PetriNet, transitionId: Id, timing: Timing | undefined): PetriNet {
  assertTransition(net, transitionId);
  if (timing !== undefined) {
    const problem = timingProblem(timing);
    if (problem) throw new NetOpError(`Invalid timing: ${problem}`);
  }
  return updateNode(net, transitionId, { timing: timing && { ...timing } });
}

/** Sets the conflict weight of a transition (> 0), or removes it with `undefined` (weight 1). */
export function setPriority(
  net: PetriNet,
  transitionId: Id,
  priority: number | undefined,
): PetriNet {
  assertTransition(net, transitionId);
  if (priority !== undefined && !(Number.isFinite(priority) && priority > 0)) {
    throw new NetOpError('Priority must be a number greater than 0.');
  }
  return updateNode(net, transitionId, { priority });
}

/** Sets the arrival rate (per hour, >= 0) of a transition, or removes it with `undefined`. */
export function setRate(net: PetriNet, transitionId: Id, rate: number | undefined): PetriNet {
  assertTransition(net, transitionId);
  if (rate !== undefined && !(Number.isFinite(rate) && rate >= 0)) {
    throw new NetOpError('Arrival rate must be a number of at least 0 per hour.');
  }
  return updateNode(net, transitionId, { rate });
}

/** Overrides the computed role of a place, or restores the computed one with `undefined`. */
export function setRole(
  net: PetriNet,
  placeId: Id,
  role: 'case' | 'resource' | undefined,
): PetriNet {
  assertPlace(net, placeId);
  return updateNode(net, placeId, { role });
}

/**
 * Changes the simulation settings. A key whose value is `undefined` is removed; when no
 * setting is left, the `simulation` object is removed as well.
 */
export function setSimulationSettings(net: PetriNet, patch: Partial<SimulationSettings>): PetriNet {
  if (patch.seed !== undefined && !Number.isInteger(patch.seed)) {
    throw new NetOpError('The seed must be an integer.');
  }
  if (patch.warmup !== undefined && !(Number.isFinite(patch.warmup) && patch.warmup >= 0)) {
    throw new NetOpError('The warm-up time must be 0 or more seconds.');
  }
  if (patch.startTime !== undefined && Number.isNaN(Date.parse(patch.startTime))) {
    throw new NetOpError(
      'The start time must be an ISO timestamp, for example 2026-01-05T08:00:00Z.',
    );
  }
  const next: Record<string, unknown> = { ...net.simulation };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  const { simulation: _old, ...rest } = net;
  return Object.keys(next).length === 0
    ? rest
    : { ...rest, simulation: next as SimulationSettings };
}

// --- Domain view -----------------------------------------------------------------------------

/**
 * Sets the domain view of the net, or removes it with `undefined`. The core does not look at the
 * content (`@pnm/domain` checks it), so a view that is out of date after other edits stays as it
 * is and is reported by the validation of the view.
 */
export function setDomainView(net: PetriNet, view: unknown): PetriNet {
  const { domainView: _old, ...rest } = net;
  return view === undefined ? rest : { ...rest, domainView: view };
}
