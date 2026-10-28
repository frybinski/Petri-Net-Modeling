import { createEmptyNet, type PetriNet, type Token } from '../src';

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

interface JsonSpec {
  types?: Record<string, unknown>;
  places?: Array<{ id: string; type?: string; tokens?: Token[]; capacity?: number }>;
  transitions?: Array<{ id: string; guard?: string }>;
  arcs?: Array<{ from: string; to: string; inscription?: string; weight?: number }>;
}

/** Builds a small JSON net for tests. Ids double as names. */
export function makeJsonNet({
  types = {},
  places = [],
  transitions = [],
  arcs = [],
}: JsonSpec): PetriNet {
  const net = createEmptyNet('test', 'json-net');
  net.types = types;
  places.forEach((p, i) => {
    net.places.push({
      id: p.id,
      name: p.id,
      position: { x: i * 100, y: 0 },
      ...(p.type !== undefined && { type: p.type }),
      ...(p.capacity !== undefined && { capacity: p.capacity }),
    });
    if (p.tokens && p.tokens.length > 0) net.marking[p.id] = p.tokens;
  });
  transitions.forEach((t, i) => {
    net.transitions.push({
      id: t.id,
      name: t.id,
      position: { x: i * 100, y: 100 },
      ...(t.guard !== undefined && { guard: t.guard }),
    });
  });
  arcs.forEach((a, i) => {
    net.arcs.push({
      id: `arc${i}`,
      source: a.from,
      target: a.to,
      weight: a.weight ?? 1,
      ...(a.inscription !== undefined && { inscription: a.inscription }),
    });
  });
  return net;
}
