import type { Id, PetriNet } from '@pnm/core';

/**
 * A place/transition net compiled for fast firing on count vectors. It follows the firing rule of
 * `@pnm/core` exactly (sum of parallel arcs, a transition with an invalid weight never fires,
 * weak capacity rule on the net effect); a property test compares the two.
 */
export interface PtModel {
  placeIds: Id[];
  transitionIds: Id[];
  /** Per transition: `[place, tokens taken]`. */
  pre: Array<Array<[number, number]>>;
  /** Per transition: `[place, change]` for the places whose token count changes. */
  delta: Array<Array<[number, number]>>;
  /** Places with a capacity: `[place, capacity]`. */
  capacities: Array<[number, number]>;
  /** Per transition: the change of each capacity place, parallel to `capacities`. */
  capacityDelta: number[][];
  /** Transitions that can never fire (an adjacent arc has an invalid weight). */
  blocked: boolean[];
  initial: number[];
}

export function compilePt(net: PetriNet): PtModel {
  const placeIndex = new Map<Id, number>();
  net.places.forEach((p, i) => placeIndex.set(p.id, i));
  const transitionIndex = new Map<Id, number>();
  net.transitions.forEach((t, i) => transitionIndex.set(t.id, i));
  const T = net.transitions.length;
  const consume: Array<Map<number, number>> = Array.from({ length: T }, () => new Map());
  const produce: Array<Map<number, number>> = Array.from({ length: T }, () => new Map());
  const blocked = new Array<boolean>(T).fill(false);

  for (const arc of net.arcs) {
    const fromPlace = placeIndex.get(arc.source);
    const toTransition = transitionIndex.get(arc.target);
    const fromTransition = transitionIndex.get(arc.source);
    const toPlace = placeIndex.get(arc.target);
    const isPre = fromPlace !== undefined && toTransition !== undefined;
    const isPost = fromTransition !== undefined && toPlace !== undefined;
    if (!isPre && !isPost) continue;
    const t = isPre ? toTransition : fromTransition!;
    if (!Number.isInteger(arc.weight) || arc.weight < 1) {
      blocked[t] = true;
      continue;
    }
    const map = isPre ? consume[t]! : produce[t]!;
    const p = isPre ? fromPlace : toPlace!;
    map.set(p, (map.get(p) ?? 0) + arc.weight);
  }

  const delta: PtModel['delta'] = [];
  for (let t = 0; t < T; t += 1) {
    const change = new Map<number, number>();
    for (const [p, w] of consume[t]!) change.set(p, (change.get(p) ?? 0) - w);
    for (const [p, w] of produce[t]!) change.set(p, (change.get(p) ?? 0) + w);
    delta.push([...change].filter(([, d]) => d !== 0).sort((a, b) => a[0] - b[0]));
  }
  const capacities: Array<[number, number]> = [];
  net.places.forEach((p, i) => {
    if (p.capacity !== undefined) capacities.push([i, p.capacity]);
  });
  const capacityDelta = delta.map((changes) => {
    const byPlace = new Map(changes);
    return capacities.map(([p]) => byPlace.get(p) ?? 0);
  });

  return {
    placeIds: net.places.map((p) => p.id),
    transitionIds: net.transitions.map((t) => t.id),
    pre: consume.map((m) => [...m].sort((a, b) => a[0] - b[0])),
    delta,
    capacities,
    capacityDelta,
    blocked,
    initial: net.places.map((p) => net.marking[p.id]?.length ?? 0),
  };
}

export function ptEnabled(model: PtModel, counts: readonly number[], t: number): boolean {
  if (model.blocked[t]) return false;
  for (const [p, w] of model.pre[t]!) {
    if (counts[p]! < w) return false;
  }
  const changes = model.capacityDelta[t]!;
  for (let k = 0; k < model.capacities.length; k += 1) {
    const [p, capacity] = model.capacities[k]!;
    if (counts[p]! + changes[k]! > capacity) return false;
  }
  return true;
}

/** The count vector after firing `t`; the transition must be enabled. */
export function ptFire(model: PtModel, counts: readonly number[], t: number): number[] {
  const next = counts.slice();
  for (const [p, d] of model.delta[t]!) next[p] = next[p]! + d;
  return next;
}
