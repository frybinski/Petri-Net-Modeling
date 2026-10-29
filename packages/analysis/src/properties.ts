import type { Id, Marking, PetriNet } from '@pnm/core';
import { traceTo, type StateSpace, type Step } from './state-space';

/**
 * How often a transition can fire. The classes are nested: `live` (L4) implies `L3` implies `L1`.
 * In a finite state space "arbitrarily often" (L2) and "infinitely often along some run" (L3)
 * coincide, so only L3 is reported.
 *
 * - `dead`: never enabled.
 * - `L1`: enabled in at least one reachable marking.
 * - `L3`: lies on a cycle of the state space, so some run fires it again and again.
 * - `L4` (live): from every reachable marking it can still be enabled later.
 * - `unknown`: the exploration was cut off before the transition was seen.
 */
export type LivenessClass = 'dead' | 'L1' | 'L3' | 'L4' | 'unknown';

export interface TransitionBehaviour {
  transitionId: Id;
  name: string;
  liveness: LivenessClass;
}

export interface DeadlockWitness {
  stateId: number;
  marking: Marking;
  /** A shortest firing sequence from the initial marking into the deadlock. */
  trace: Step[];
}

export interface BehaviourProperties {
  /** The state space is complete, so the statements below are exact. */
  complete: boolean;
  states: number;
  edges: number;
  /** The largest number of tokens seen on each place (a lower bound of the real maximum if cut off). */
  bounds: Record<Id, number>;
  /** Bounded: true if complete; `null` if the exploration was cut off (see the coverability graph). */
  bounded: boolean | null;
  /** The largest number of tokens on any single place. */
  maxPlaceTokens: number;
  deadlockCount: number;
  /** The first deadlocks in the order of the search (shortest witnesses first), at most 20. */
  deadlocks: DeadlockWitness[];
  /** False as soon as a deadlock was seen; true if complete and none; `null` otherwise. */
  deadlockFree: boolean | null;
  transitions: TransitionBehaviour[];
  /** Every transition is live; `false` as soon as one is not (when complete), else `null`. */
  live: boolean | null;
  /** The initial marking can be reached again from every reachable marking. */
  reversible: boolean | null;
  /** Markings reachable from every reachable marking (as state ids); `null` if cut off. */
  homeStates: number[] | null;
  /** Strongly connected components, and how many of them have no way out. */
  components: number | null;
  terminalComponents: number | null;
}

const MAX_WITNESSES = 20;

/** Strongly connected components with an iterative Tarjan (state spaces are deep). */
export function stronglyConnectedComponents(
  nodeCount: number,
  edges: ReadonlyArray<{ from: number; to: number }>,
): { componentOf: number[]; count: number } {
  const outgoing: number[][] = Array.from({ length: nodeCount }, () => []);
  for (const edge of edges) outgoing[edge.from]!.push(edge.to);
  const indexOf = new Array<number>(nodeCount).fill(-1);
  const lowlink = new Array<number>(nodeCount).fill(0);
  const onStack = new Array<boolean>(nodeCount).fill(false);
  const componentOf = new Array<number>(nodeCount).fill(-1);
  const stack: number[] = [];
  let counter = 0;
  let count = 0;

  for (let root = 0; root < nodeCount; root += 1) {
    if (indexOf[root] !== -1) continue;
    const work: Array<{ node: number; next: number }> = [{ node: root, next: 0 }];
    indexOf[root] = lowlink[root] = counter;
    counter += 1;
    stack.push(root);
    onStack[root] = true;
    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const successors = outgoing[frame.node]!;
      if (frame.next < successors.length) {
        const w = successors[frame.next]!;
        frame.next += 1;
        if (indexOf[w] === -1) {
          indexOf[w] = lowlink[w] = counter;
          counter += 1;
          stack.push(w);
          onStack[w] = true;
          work.push({ node: w, next: 0 });
        } else if (onStack[w]) {
          lowlink[frame.node] = Math.min(lowlink[frame.node]!, indexOf[w]!);
        }
        continue;
      }
      if (lowlink[frame.node] === indexOf[frame.node]) {
        for (;;) {
          const w = stack.pop()!;
          onStack[w] = false;
          componentOf[w] = count;
          if (w === frame.node) break;
        }
        count += 1;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) lowlink[parent.node] = Math.min(lowlink[parent.node]!, lowlink[frame.node]!);
    }
  }
  return { componentOf, count };
}

/** Boundedness, deadlocks, liveness and reversibility as far as the state space tells. */
export function analyzeBehaviour(net: PetriNet, space: StateSpace): BehaviourProperties {
  const complete = !space.truncated;
  const bounds: Record<Id, number> = {};
  for (const place of net.places) bounds[place.id] = 0;
  for (const state of space.states) {
    for (const [placeId, tokens] of Object.entries(state.marking)) {
      if (placeId in bounds && tokens.length > (bounds[placeId] ?? 0))
        bounds[placeId] = tokens.length;
    }
  }
  const maxPlaceTokens = Math.max(0, ...Object.values(bounds));

  const deadlockStates = space.states.filter((s) => s.deadlock);
  const deadlocks: DeadlockWitness[] = deadlockStates.slice(0, MAX_WITNESSES).map((state) => ({
    stateId: state.id,
    marking: state.marking,
    trace: traceTo(space, state.id),
  }));
  const deadlockFree = deadlockStates.length > 0 ? false : complete ? true : null;

  const fired = new Set(space.edges.map((e) => e.transitionId));
  let liveness = new Map<Id, LivenessClass>();
  let homeStates: number[] | null = null;
  let reversible: boolean | null = null;
  let components: number | null = null;
  let terminalComponents: number | null = null;

  if (complete) {
    const { componentOf, count } = stronglyConnectedComponents(space.states.length, space.edges);
    const terminal = new Array<boolean>(count).fill(true);
    for (const edge of space.edges) {
      if (componentOf[edge.from] !== componentOf[edge.to])
        terminal[componentOf[edge.from]!] = false;
    }
    const terminalIds = terminal.flatMap((t, c) => (t ? [c] : []));
    components = count;
    terminalComponents = terminalIds.length;
    // Transitions on an edge inside a component, per component.
    const inside = Array.from({ length: count }, () => new Set<Id>());
    const cyclic = new Set<Id>();
    for (const edge of space.edges) {
      const c = componentOf[edge.from]!;
      if (c === componentOf[edge.to]) {
        inside[c]!.add(edge.transitionId);
        cyclic.add(edge.transitionId);
      }
    }
    for (const transition of net.transitions) {
      const id = transition.id;
      let cls: LivenessClass = 'dead';
      if (fired.has(id)) cls = 'L1';
      if (cyclic.has(id)) cls = 'L3';
      if (terminalIds.length > 0 && terminalIds.every((c) => inside[c]!.has(id))) cls = 'L4';
      liveness.set(id, cls);
    }
    // A home state is reachable from every state: only possible with exactly one terminal component.
    if (terminalIds.length === 1) {
      const home = terminalIds[0]!;
      homeStates = space.states.filter((s) => componentOf[s.id] === home).map((s) => s.id);
      reversible = componentOf[space.initial] === home;
    } else {
      homeStates = [];
      reversible = false;
    }
  } else {
    liveness = new Map(net.transitions.map((t) => [t.id, fired.has(t.id) ? 'L1' : 'unknown']));
  }

  const transitions: TransitionBehaviour[] = net.transitions.map((t) => ({
    transitionId: t.id,
    name: t.name,
    liveness: liveness.get(t.id) ?? 'unknown',
  }));
  const live = complete
    ? net.transitions.length > 0 && transitions.every((t) => t.liveness === 'L4')
    : null;

  return {
    complete,
    states: space.states.length,
    edges: space.edges.length,
    bounds,
    bounded: complete ? true : null,
    maxPlaceTokens,
    deadlockCount: deadlockStates.length,
    deadlocks,
    deadlockFree,
    transitions,
    live,
    reversible,
    homeStates,
    components,
    terminalComponents,
  };
}
