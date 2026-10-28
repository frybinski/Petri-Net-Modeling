import { countsToMarking, markingToCounts, type Counts } from '../marking';
import type { Id, Marking, PetriNet } from '../model';
import { Multiset } from '../multiset';

interface Flow {
  /** Tokens consumed per place (sum of weights of arcs place -> transition). */
  consume: Multiset<Id>;
  /** Tokens produced per place (sum of weights of arcs transition -> place). */
  produce: Multiset<Id>;
}

/**
 * Collects pre- and post-flow of a transition. Arcs that are not place/transition
 * pairs are ignored. Returns `null` if an adjacent arc has an invalid weight (not an
 * integer >= 1); such a transition can never fire.
 */
function flowOf(net: PetriNet, transitionId: Id): Flow | null {
  const placeIds = new Set(net.places.map((p) => p.id));
  let consume = Multiset.empty<Id>();
  let produce = Multiset.empty<Id>();
  for (const arc of net.arcs) {
    const isPre = arc.target === transitionId && placeIds.has(arc.source);
    const isPost = arc.source === transitionId && placeIds.has(arc.target);
    if (!isPre && !isPost) continue;
    if (!Number.isInteger(arc.weight) || arc.weight < 1) return null;
    if (isPre) consume = consume.add(arc.source, arc.weight);
    else produce = produce.add(arc.target, arc.weight);
  }
  return { consume, produce };
}

function isEnabledOn(net: PetriNet, counts: Counts, transitionId: Id): boolean {
  if (!net.transitions.some((t) => t.id === transitionId)) return false;
  const flow = flowOf(net, transitionId);
  if (flow === null) return false;
  const { consume, produce } = flow;
  const current = Multiset.fromRecord(counts);
  if (!current.includes(consume)) return false;
  // Weak capacity rule: the marking reached by firing must respect all capacities.
  // Consumption happens before production, so loops are handled by the net effect.
  const next = current.difference(consume).union(produce);
  for (const place of net.places) {
    if (place.capacity !== undefined && next.count(place.id) > place.capacity) return false;
  }
  return true;
}

/** True if the transition exists and is enabled under `marking`. */
export function isEnabled(net: PetriNet, marking: Marking, transitionId: Id): boolean {
  return isEnabledOn(net, markingToCounts(marking), transitionId);
}

/** Ids of all enabled transitions, in the order of `net.transitions`. */
export function enabledTransitions(net: PetriNet, marking: Marking): Id[] {
  const counts = markingToCounts(marking);
  return net.transitions.filter((t) => isEnabledOn(net, counts, t.id)).map((t) => t.id);
}

/**
 * Fires a transition and returns the successor marking. The input marking is
 * not modified. Throws if the transition does not exist or is not enabled.
 */
export function fire(net: PetriNet, marking: Marking, transitionId: Id): Marking {
  if (!net.transitions.some((t) => t.id === transitionId)) {
    throw new Error(`Unknown transition: ${transitionId}`);
  }
  const counts = markingToCounts(marking);
  if (!isEnabledOn(net, counts, transitionId)) {
    throw new Error(`Transition ${transitionId} is not enabled`);
  }
  const { consume, produce } = flowOf(net, transitionId) as Flow; // non-null: enabled above
  const next = Multiset.fromRecord(counts).difference(consume).union(produce);
  return countsToMarking(next.toRecord());
}
