import { createEmptyNet, type PetriNet } from '../src';

interface Spec {
  /** `[id, tokens, capacity?]` */
  places?: Array<[string, number?, number?]>;
  transitions?: string[];
  /** `[source, target, weight?]` */
  arcs?: Array<[string, string, number?]>;
}

/** Builds a small net for tests. Ids double as names. */
export function makeNet({ places = [], transitions = [], arcs = [] }: Spec): PetriNet {
  const net = createEmptyNet('test');
  places.forEach(([id, tokens = 0, capacity], i) => {
    net.places.push({
      id,
      name: id,
      position: { x: i * 100, y: 0 },
      ...(capacity && { capacity }),
    });
    if (tokens > 0) net.marking[id] = Array.from({ length: tokens }, () => 1);
  });
  transitions.forEach((id, i) => {
    net.transitions.push({ id, name: id, position: { x: i * 100, y: 100 } });
  });
  arcs.forEach(([source, target, weight = 1], i) => {
    net.arcs.push({ id: `arc${i}`, source, target, weight });
  });
  return net;
}
