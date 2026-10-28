import { isSourceTransition, placeRoles, type Id, type PetriNet, type PlaceRole } from '@pnm/core';

export interface CompactPlace {
  id: Id;
  name: string;
  /** Tokens in the initial marking. */
  tokens: number;
  role: PlaceRole;
  /** Resource places only: the transitions that take from the place and give back to it. */
  loopsWith?: Id[];
}

export interface CompactTransition {
  id: Id;
  name: string;
  /** `source` if the transition has no input place (arrivals), else `step`. */
  role: 'source' | 'step';
  /** For example `uniform 15..25`; for orientation only, a view never contains times. */
  timing?: string;
}

export interface CompactNet {
  name: string;
  places: CompactPlace[];
  transitions: CompactTransition[];
  /** `[source, target]` pairs. */
  arcs: Array<[Id, Id]>;
  /** Editor positions scaled to 0..1 in both directions; absent if the nodes do not differ. */
  positions?: Record<Id, [number, number]>;
}

function timingText(net: PetriNet, id: Id): string | undefined {
  const timing = net.transitions.find((t) => t.id === id)?.timing;
  if (!timing) return undefined;
  switch (timing.kind) {
    case 'fixed':
      return `fixed ${timing.value}`;
    case 'uniform':
      return `uniform ${timing.min}..${timing.max}`;
    case 'exponential':
      return `exponential mean ${timing.mean}`;
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The net reduced to what the mapping needs: roles, initial tokens, arcs and rough positions. */
export function compactNet(net: PetriNet, options: { positions?: boolean } = {}): CompactNet {
  const roles = placeRoles(net);
  const arcKeys = new Set(net.arcs.map((a) => `${a.source}>${a.target}`));
  const places = net.places.map((place): CompactPlace => {
    const role = roles.get(place.id) ?? 'case';
    const base: CompactPlace = {
      id: place.id,
      name: place.name,
      tokens: net.marking[place.id]?.length ?? 0,
      role,
    };
    if (role !== 'resource') return base;
    const loops = net.transitions
      .filter((t) => arcKeys.has(`${place.id}>${t.id}`) && arcKeys.has(`${t.id}>${place.id}`))
      .map((t) => t.id);
    return loops.length > 0 ? { ...base, loopsWith: loops } : base;
  });
  const transitions = net.transitions.map((transition): CompactTransition => {
    const timing = timingText(net, transition.id);
    return {
      id: transition.id,
      name: transition.name,
      role: isSourceTransition(net, transition.id) ? 'source' : 'step',
      ...(timing !== undefined && { timing }),
    };
  });
  const compact: CompactNet = {
    name: net.name,
    places,
    transitions,
    arcs: net.arcs.map((a): [Id, Id] => [a.source, a.target]),
  };

  if (options.positions !== false) {
    const nodes = [...net.places, ...net.transitions];
    const xs = nodes.map((n) => n.position.x);
    const ys = nodes.map((n) => n.position.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const spanX = Math.max(...xs) - minX;
    const spanY = Math.max(...ys) - minY;
    if (nodes.length > 1 && (spanX > 0 || spanY > 0)) {
      const positions: Record<Id, [number, number]> = {};
      for (const node of nodes) {
        positions[node.id] = [
          spanX > 0 ? round2((node.position.x - minX) / spanX) : 0.5,
          spanY > 0 ? round2((node.position.y - minY) / spanY) : 0.5,
        ];
      }
      compact.positions = positions;
    }
  }
  return compact;
}
