import { canonicalJson } from '@pnm/core';
import type { StateSpace, Step } from '@pnm/analysis';

/** The states on the breadth-first path from the initial state to `stateId`, in order. */
export function pathTo(space: StateSpace, stateId: number): number[] {
  const path: number[] = [];
  let current = space.states[stateId];
  while (current !== undefined) {
    path.push(current.id);
    if (current.parentEdge < 0) break;
    current = space.states[space.edges[current.parentEdge]!.from];
  }
  return path.reverse();
}

/**
 * The states that a firing sequence visits, starting at the initial state, found by following the
 * edges with the same transition and binding. `null` if the sequence is not a path of the graph.
 */
export function pathOfSteps(space: StateSpace, steps: readonly Step[]): number[] | null {
  const outgoing = new Map<number, number[]>();
  space.edges.forEach((edge, index) => {
    const list = outgoing.get(edge.from);
    if (list) list.push(index);
    else outgoing.set(edge.from, [index]);
  });
  const path = [space.initial];
  let current = space.initial;
  for (const step of steps) {
    const wanted = canonicalJson(step.binding ?? {});
    const edge = (outgoing.get(current) ?? [])
      .map((index) => space.edges[index]!)
      .find(
        (e) => e.transitionId === step.transitionId && canonicalJson(e.binding ?? {}) === wanted,
      );
    if (!edge) return null;
    current = edge.to;
    path.push(current);
  }
  return path;
}
