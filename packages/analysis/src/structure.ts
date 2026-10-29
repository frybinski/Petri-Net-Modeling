import type { Id, PetriNet } from '@pnm/core';
import { buildSkeleton, incidenceOf, type Skeleton } from './skeleton';

/** One structural property with a short explanation, as the editor lists it. */
export interface StructureCheck {
  key: string;
  label: string;
  holds: boolean;
  explanation: string;
  /** Elements that explain the answer (violators, or the members of a list). */
  elements: Id[];
}

export interface StructureResult {
  places: number;
  transitions: number;
  arcs: number;
  /** JSON net: computed on the skeleton, see `Skeleton`. */
  approximate: boolean;
  warnings: string[];
  /** The incidence matrix `C = Post - Pre`, rows are places, columns transitions. */
  incidence: { places: Id[]; transitions: Id[]; matrix: number[][] };
  sourcePlaces: Id[];
  sinkPlaces: Id[];
  sourceTransitions: Id[];
  sinkTransitions: Id[];
  isolated: Id[];
  /** Number of weakly connected components (0 for an empty net). */
  components: number;
  connected: boolean;
  stronglyConnected: boolean;
  /** Every arc has weight 1. */
  ordinary: boolean;
  /** No transition has a place as input and as output. */
  pure: boolean;
  /** Every transition has exactly one input and one output place. */
  stateMachine: boolean;
  /** Every place has exactly one input and one output transition. */
  markedGraph: boolean;
  freeChoice: boolean;
  extendedFreeChoice: boolean;
  /** Places with more than one output transition. */
  conflicts: Array<{ placeId: Id; transitionIds: Id[] }>;
  /** Places that are input and output of the same transition. */
  loops: Array<{ placeId: Id; transitionId: Id }>;
  /** Minimal siphons and traps (sets of place ids). */
  siphons: Id[][];
  traps: Id[][];
  /** The enumeration of siphons or traps stopped at its limit. */
  setsTruncated: boolean;
  /**
   * Commoner's condition: every minimal siphon contains an initially marked trap. `null` if the
   * enumeration was cut off. For free-choice nets the condition is equivalent to liveness.
   */
  commoner: { holds: boolean; violating: Id[][] } | null;
  checks: StructureCheck[];
}

export interface StructureOptions {
  /** Maximum number of siphons (and of traps) reported. Default 200. */
  maxSets?: number;
  /** Maximum number of search steps per enumeration. Default 200000. */
  maxSteps?: number;
}

export const DEFAULT_MAX_SETS = 200;
const DEFAULT_MAX_STEPS = 200_000;

/** Adjacency on the skeleton: input/output places per transition, input/output transitions per place. */
interface Adjacency {
  inPlaces: number[][];
  outPlaces: number[][];
  inTransitions: number[][];
  outTransitions: number[][];
}

function adjacencyOf(s: Skeleton): Adjacency {
  const P = s.placeIds.length;
  const T = s.transitionIds.length;
  const inPlaces: number[][] = Array.from({ length: T }, () => []);
  const outPlaces: number[][] = Array.from({ length: T }, () => []);
  const inTransitions: number[][] = Array.from({ length: P }, () => []);
  const outTransitions: number[][] = Array.from({ length: P }, () => []);
  for (let p = 0; p < P; p += 1) {
    for (let t = 0; t < T; t += 1) {
      if (s.pre[p]![t]! > 0) {
        inPlaces[t]!.push(p);
        outTransitions[p]!.push(t);
      }
      if (s.post[p]![t]! > 0) {
        outPlaces[t]!.push(p);
        inTransitions[p]!.push(t);
      }
    }
  }
  return { inPlaces, outPlaces, inTransitions, outTransitions };
}

/**
 * Minimal siphons of a net given as "consumers" and "producers" per transition. A set S of places
 * is a siphon if every transition that puts a token on S also takes one from S. The search
 * starts with one place and, for every violating transition, branches over the places that could
 * repair it; every minimal siphon is found because the repair can follow its members.
 * Traps are the same problem with the arcs reversed.
 */
function minimalSets(
  placeCount: number,
  consumers: number[][],
  producers: number[][],
  maxSets: number,
  maxSteps: number,
): { sets: number[][]; truncated: boolean } {
  const found = new Map<string, number[]>();
  const seen = new Set<string>();
  let steps = 0;
  let truncated = false;

  // For each place the transitions that produce on it.
  const producing: number[][] = Array.from({ length: placeCount }, () => []);
  producers.forEach((places, t) => {
    for (const p of places) producing[p]!.push(t);
  });

  const visit = (set: number[]): void => {
    if (truncated) return;
    const key = set.join(',');
    if (seen.has(key)) return;
    seen.add(key);
    steps += 1;
    if (steps > maxSteps) {
      truncated = true;
      return;
    }
    const members = new Set(set);
    for (const p of set) {
      for (const t of producing[p]!) {
        const taken = consumers[t]!;
        if (taken.some((q) => members.has(q))) continue;
        // The transition puts tokens on the set but takes none from it: repair with an input place.
        for (const q of taken) visit([...set, q].sort((a, b) => a - b));
        return;
      }
    }
    found.set(key, set);
  };

  for (let p = 0; p < placeCount && !truncated; p += 1) visit([p]);

  // Keep only minimal sets (no other found set is a proper subset).
  const all = [...found.values()].sort((a, b) => a.length - b.length || compareLists(a, b));
  const minimal: number[][] = [];
  for (const candidate of all) {
    const members = new Set(candidate);
    if (!minimal.some((m) => m.length < candidate.length && m.every((p) => members.has(p)))) {
      minimal.push(candidate);
    }
  }
  if (minimal.length > maxSets) truncated = true;
  return { sets: minimal.slice(0, maxSets), truncated };
}

function compareLists(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

/** The largest trap inside `set`: places whose output transitions cannot lose all tokens are kept. */
function maxTrapIn(set: number[], adjacency: Adjacency): number[] {
  const inside = new Set(set);
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of [...inside]) {
      // A transition that takes from p must put a token back into the set.
      const leaks = adjacency.outTransitions[p]!.some(
        (t) => !adjacency.outPlaces[t]!.some((q) => inside.has(q)),
      );
      if (leaks) {
        inside.delete(p);
        changed = true;
      }
    }
  }
  return [...inside].sort((a, b) => a - b);
}

/** Weakly connected components and strong connectivity of the bipartite graph. */
function connectivity(s: Skeleton, adjacency: Adjacency): { components: number; strong: boolean } {
  const P = s.placeIds.length;
  const T = s.transitionIds.length;
  const n = P + T; // places first, then transitions
  if (n === 0) return { components: 0, strong: true };
  const forward: number[][] = Array.from({ length: n }, () => []);
  const backward: number[][] = Array.from({ length: n }, () => []);
  for (let t = 0; t < T; t += 1) {
    for (const p of adjacency.inPlaces[t]!) {
      forward[p]!.push(P + t);
      backward[P + t]!.push(p);
    }
    for (const p of adjacency.outPlaces[t]!) {
      forward[P + t]!.push(p);
      backward[p]!.push(P + t);
    }
  }
  const reach = (start: number, edges: number[][]): number => {
    const seen = new Array<boolean>(n).fill(false);
    const stack = [start];
    seen[start] = true;
    let count = 0;
    while (stack.length > 0) {
      const v = stack.pop()!;
      count += 1;
      for (const w of edges[v]!) {
        if (!seen[w]) {
          seen[w] = true;
          stack.push(w);
        }
      }
    }
    return count;
  };
  const strong = reach(0, forward) === n && reach(0, backward) === n;
  // Weak components with union-find over the undirected edges.
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root]!;
    let cursor = x;
    while (parent[cursor] !== root) {
      const next = parent[cursor]!;
      parent[cursor] = root;
      cursor = next;
    }
    return root;
  };
  for (let v = 0; v < n; v += 1) {
    for (const w of forward[v]!) parent[find(v)] = find(w);
  }
  const roots = new Set<number>();
  for (let v = 0; v < n; v += 1) roots.add(find(v));
  return { components: roots.size, strong };
}

/** Structure of the (skeleton of the) net; no state space is built. */
export function analyzeStructure(net: PetriNet, options: StructureOptions = {}): StructureResult {
  const maxSets = options.maxSets ?? DEFAULT_MAX_SETS;
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const s = buildSkeleton(net);
  const adjacency = adjacencyOf(s);
  const P = s.placeIds.length;
  const T = s.transitionIds.length;
  const placeId = (p: number): Id => s.placeIds[p]!;
  const transitionId = (t: number): Id => s.transitionIds[t]!;

  const isolatedPlaces = s.placeIds.filter(
    (_, p) => adjacency.inTransitions[p]!.length === 0 && adjacency.outTransitions[p]!.length === 0,
  );
  const isolatedTransitions = s.transitionIds.filter(
    (_, t) => adjacency.inPlaces[t]!.length === 0 && adjacency.outPlaces[t]!.length === 0,
  );
  const isolatedSet = new Set([...isolatedPlaces, ...isolatedTransitions]);

  const sourcePlaces = s.placeIds.filter(
    (id, p) => !isolatedSet.has(id) && adjacency.inTransitions[p]!.length === 0,
  );
  const sinkPlaces = s.placeIds.filter(
    (id, p) => !isolatedSet.has(id) && adjacency.outTransitions[p]!.length === 0,
  );
  const sourceTransitions = s.transitionIds.filter(
    (id, t) => !isolatedSet.has(id) && adjacency.inPlaces[t]!.length === 0,
  );
  const sinkTransitions = s.transitionIds.filter(
    (id, t) => !isolatedSet.has(id) && adjacency.outPlaces[t]!.length === 0,
  );

  const ordinary =
    s.pre.every((row) => row.every((w) => w <= 1)) &&
    s.post.every((row) => row.every((w) => w <= 1));
  const loops: StructureResult['loops'] = [];
  for (let t = 0; t < T; t += 1) {
    for (const p of adjacency.inPlaces[t]!) {
      if (s.post[p]![t]! > 0) loops.push({ placeId: placeId(p), transitionId: transitionId(t) });
    }
  }
  const conflicts: StructureResult['conflicts'] = [];
  for (let p = 0; p < P; p += 1) {
    const out = adjacency.outTransitions[p]!;
    if (out.length > 1)
      conflicts.push({ placeId: placeId(p), transitionIds: out.map(transitionId) });
  }

  const stateMachineViolators = s.transitionIds.filter(
    (_, t) => adjacency.inPlaces[t]!.length !== 1 || adjacency.outPlaces[t]!.length !== 1,
  );
  const stateMachine = ordinary && stateMachineViolators.length === 0;
  const markedGraphViolators = s.placeIds.filter(
    (_, p) => adjacency.inTransitions[p]!.length !== 1 || adjacency.outTransitions[p]!.length !== 1,
  );
  const markedGraph = ordinary && markedGraphViolators.length === 0;

  // Free choice: p in the preset of t implies p* = {t} or *t = {p}.
  const freeChoiceViolators = new Set<Id>();
  for (let t = 0; t < T; t += 1) {
    const inputs = adjacency.inPlaces[t]!;
    if (inputs.length <= 1) continue;
    for (const p of inputs) {
      if (adjacency.outTransitions[p]!.length > 1) freeChoiceViolators.add(transitionId(t));
    }
  }
  const freeChoice = ordinary && freeChoiceViolators.size === 0;
  // Extended free choice: transitions that share an input place have the same inputs.
  const extendedViolators = new Set<Id>();
  for (let p = 0; p < P; p += 1) {
    const out = adjacency.outTransitions[p]!;
    for (let i = 0; i < out.length; i += 1) {
      for (let j = i + 1; j < out.length; j += 1) {
        const a = adjacency.inPlaces[out[i]!]!;
        const b = adjacency.inPlaces[out[j]!]!;
        if (a.length !== b.length || a.some((q, k) => q !== b[k])) {
          extendedViolators.add(transitionId(out[i]!));
          extendedViolators.add(transitionId(out[j]!));
        }
      }
    }
  }
  const extendedFreeChoice = ordinary && extendedViolators.size === 0;

  const { components, strong } = connectivity(s, adjacency);
  const connected = components <= 1;

  // Siphons: producers are the output places of a transition, consumers its input places.
  const siphonSearch = minimalSets(P, adjacency.inPlaces, adjacency.outPlaces, maxSets, maxSteps);
  const trapSearch = minimalSets(P, adjacency.outPlaces, adjacency.inPlaces, maxSets, maxSteps);
  const setsTruncated = siphonSearch.truncated || trapSearch.truncated;
  // Isolated places are trivially siphons and traps; they say nothing about the net.
  const dropIsolated = (sets: number[][]): number[][] =>
    sets.filter((set) => !(set.length === 1 && isolatedSet.has(placeId(set[0]!))));
  const siphons = dropIsolated(siphonSearch.sets);
  const traps = dropIsolated(trapSearch.sets);

  let commoner: StructureResult['commoner'] = null;
  if (!siphonSearch.truncated) {
    const violating = siphons.filter((set) => {
      const trap = maxTrapIn(set, adjacency);
      return !trap.some((p) => s.initial[p]! > 0);
    });
    commoner = {
      holds: violating.length === 0,
      violating: violating.map((set) => set.map(placeId)),
    };
  }

  const names = new Map<Id, string>();
  s.placeIds.forEach((id, p) => names.set(id, s.placeNames[p]!));
  s.transitionIds.forEach((id, t) => names.set(id, s.transitionNames[t]!));
  const list = (ids: Id[], max = 4): string => {
    const shown = ids.slice(0, max).map((id) => `"${names.get(id) ?? id}"`);
    return ids.length > max ? `${shown.join(', ')} and ${ids.length - max} more` : shown.join(', ');
  };

  const checks: StructureCheck[] = [
    {
      key: 'connected',
      label: 'Connected',
      holds: connected,
      explanation: connected
        ? 'All elements belong to one connected component.'
        : `The net falls apart into ${components} components.`,
      elements: [],
    },
    {
      key: 'stronglyConnected',
      label: 'Strongly connected',
      holds: strong,
      explanation: strong
        ? 'Every element can reach every other one. A live and bounded net always has this property.'
        : net.places.some((p) => p.capacity !== undefined)
          ? 'Some element cannot reach another one. Without the capacities this would exclude a live, bounded net; a capacity bounds a place without any arc, so here it does not.'
          : 'Some element cannot reach another one. A net that is not strongly connected cannot be both live and bounded.',
      elements: [],
    },
    {
      key: 'ordinary',
      label: 'Ordinary',
      holds: ordinary,
      explanation: ordinary ? 'All arc weights are 1.' : 'Some arcs have a weight greater than 1.',
      elements: [],
    },
    {
      key: 'pure',
      label: 'Pure',
      holds: loops.length === 0,
      explanation:
        loops.length === 0
          ? 'No transition takes from and gives to the same place.'
          : `${list([...new Set(loops.map((l) => l.transitionId))])} take from and give to the same place (a loop, for example a resource that is released).`,
      elements: [...new Set(loops.map((l) => l.transitionId))],
    },
    {
      key: 'stateMachine',
      label: 'State machine',
      holds: stateMachine,
      explanation: stateMachine
        ? 'Every transition has exactly one input and one output place: tokens only move.'
        : ordinary
          ? `${list(stateMachineViolators)} do not have exactly one input and one output place.`
          : 'Not ordinary, so not a state machine.',
      elements: ordinary ? stateMachineViolators : [],
    },
    {
      key: 'markedGraph',
      label: 'Marked graph',
      holds: markedGraph,
      explanation: markedGraph
        ? 'Every place has exactly one input and one output transition: no choice, only concurrency.'
        : ordinary
          ? `${list(markedGraphViolators)} do not have exactly one input and one output transition.`
          : 'Not ordinary, so not a marked graph.',
      elements: ordinary ? markedGraphViolators : [],
    },
    {
      key: 'freeChoice',
      label: 'Free choice',
      holds: freeChoice,
      explanation: freeChoice
        ? 'Whenever transitions compete for a place, none of them needs another place as well.'
        : ordinary
          ? `${list([...freeChoiceViolators])} compete for a place and also need another one.`
          : 'Not ordinary, so not free choice.',
      elements: [...freeChoiceViolators],
    },
    {
      key: 'extendedFreeChoice',
      label: 'Extended free choice',
      holds: extendedFreeChoice,
      explanation: extendedFreeChoice
        ? 'Transitions that share an input place have exactly the same input places.'
        : ordinary
          ? `${list([...extendedViolators])} share an input place but differ in the others.`
          : 'Not ordinary, so not extended free choice.',
      elements: [...extendedViolators],
    },
  ];

  return {
    places: P,
    transitions: T,
    arcs: net.arcs.length,
    approximate: s.approximate,
    warnings: s.warnings,
    incidence: { places: s.placeIds, transitions: s.transitionIds, matrix: incidenceOf(s) },
    sourcePlaces,
    sinkPlaces,
    sourceTransitions,
    sinkTransitions,
    isolated: [...isolatedPlaces, ...isolatedTransitions],
    components,
    connected,
    stronglyConnected: strong,
    ordinary,
    pure: loops.length === 0,
    stateMachine,
    markedGraph,
    freeChoice,
    extendedFreeChoice,
    conflicts,
    loops,
    siphons: siphons.map((set) => set.map(placeId)),
    traps: traps.map((set) => set.map(placeId)),
    setsTruncated,
    commoner,
    checks,
  };
}
