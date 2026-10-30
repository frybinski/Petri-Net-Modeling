import { createEmptyNet, type PetriNet, type Timing, type Token } from '@pnm/core';

export interface TransitionSpec {
  id: string;
  timing?: Timing;
  priority?: number;
  rate?: number;
  guard?: string;
}

export interface PlaceSpec {
  id: string;
  tokens?: number;
  capacity?: number;
  role?: 'case' | 'resource' | 'quantity';
}

export interface NetSpec {
  places?: Array<string | PlaceSpec>;
  transitions?: Array<string | TransitionSpec>;
  /** `[source, target, weight?]` */
  arcs?: Array<[string, string, number?]>;
  simulation?: PetriNet['simulation'];
}

/** Builds a P/T net for tests. Ids double as names. */
export function makeNet(spec: NetSpec): PetriNet {
  const net = createEmptyNet('test');
  (spec.places ?? []).forEach((entry, i) => {
    const p = typeof entry === 'string' ? { id: entry } : entry;
    const place: PetriNet['places'][number] = {
      id: p.id,
      name: p.id,
      position: { x: i * 100, y: 0 },
    };
    if ('capacity' in p && p.capacity !== undefined) place.capacity = p.capacity;
    if ('role' in p && p.role !== undefined) place.role = p.role;
    net.places.push(place);
    const tokens = 'tokens' in p ? (p.tokens ?? 0) : 0;
    if (tokens > 0) net.marking[p.id] = Array.from({ length: tokens }, () => 1);
  });
  (spec.transitions ?? []).forEach((entry, i) => {
    const t = typeof entry === 'string' ? { id: entry } : entry;
    net.transitions.push({
      id: t.id,
      name: t.id,
      position: { x: i * 100, y: 100 },
      ...(t.timing && { timing: t.timing }),
      ...(t.priority !== undefined && { priority: t.priority }),
      ...(t.rate !== undefined && { rate: t.rate }),
      ...(t.guard !== undefined && { guard: t.guard }),
    });
  });
  (spec.arcs ?? []).forEach(([source, target, weight = 1], i) => {
    net.arcs.push({ id: `a${i}`, source, target, weight });
  });
  if (spec.simulation) net.simulation = spec.simulation;
  return net;
}

export interface JsonSpec {
  types?: Record<string, unknown>;
  places?: Array<{ id: string; type?: string; tokens?: Token[] }>;
  transitions?: TransitionSpec[];
  arcs?: Array<{ from: string; to: string; inscription?: string; weight?: number }>;
}

/** Builds a JSON net for tests. */
export function makeJsonNet(spec: JsonSpec): PetriNet {
  const net = createEmptyNet('test', 'json-net');
  net.types = spec.types ?? {};
  (spec.places ?? []).forEach((p, i) => {
    net.places.push({
      id: p.id,
      name: p.id,
      position: { x: i * 100, y: 0 },
      ...(p.type !== undefined && { type: p.type }),
    });
    if (p.tokens && p.tokens.length > 0) net.marking[p.id] = p.tokens;
  });
  (spec.transitions ?? []).forEach((t, i) => {
    net.transitions.push({
      id: t.id,
      name: t.id,
      position: { x: i * 100, y: 100 },
      ...(t.timing && { timing: t.timing }),
      ...(t.priority !== undefined && { priority: t.priority }),
      ...(t.rate !== undefined && { rate: t.rate }),
      ...(t.guard !== undefined && { guard: t.guard }),
    });
  });
  (spec.arcs ?? []).forEach((a, i) => {
    net.arcs.push({
      id: `a${i}`,
      source: a.from,
      target: a.to,
      weight: a.weight ?? 1,
      ...(a.inscription !== undefined && { inscription: a.inscription }),
    });
  });
  return net;
}
