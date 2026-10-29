import type { Id, PetriNet } from '@pnm/core';
import { AnalysisCancelled } from './state-space';
import { compilePt, ptEnabled } from './pt-engine';

/** A marking of the coverability graph: a token count or `'ω'` ("arbitrarily many"). */
export type OmegaCount = number | 'ω';

export interface CoverabilityNode {
  id: number;
  marking: Record<Id, OmegaCount>;
  parent: number;
}

export interface CoverabilityEdge {
  from: number;
  to: number;
  transitionId: Id;
}

export interface CoverabilityResult {
  /** False for JSON nets: tokens carry data, so the method (counts only) does not apply. */
  applicable: boolean;
  reason?: string;
  nodes: CoverabilityNode[];
  edges: CoverabilityEdge[];
  /** Bounded: true or false; `null` if the node limit stopped the construction. */
  bounded: boolean | null;
  /** Places that can hold arbitrarily many tokens. */
  unboundedPlaces: Id[];
  /** The largest finite token count per place, `'ω'` for unbounded places. */
  bounds: Record<Id, OmegaCount>;
  truncated: boolean;
}

export interface CoverabilityOptions {
  /** Maximum number of nodes. Default 5000. */
  maxNodes?: number;
  signal?: AbortSignal;
}

export const DEFAULT_MAX_COVERABILITY_NODES = 5000;

/**
 * The coverability graph of Karp and Miller for place/transition nets. A path that leads from a
 * marking `a` to a larger marking `m >= a` can be repeated, so the places that grew get the value
 * ω. A net is bounded exactly if no ω occurs. Capacity places never get ω (the capacity stops the
 * growth) and only count as "grown" if they are equal in `a` and `m`, which keeps the repetition
 * argument valid under the weak capacity rule.
 */
export function buildCoverabilityGraph(
  net: PetriNet,
  options: CoverabilityOptions = {},
): CoverabilityResult {
  if (net.profile !== 'pt-net') {
    return {
      applicable: false,
      reason: 'The coverability graph is defined for place/transition nets only.',
      nodes: [],
      edges: [],
      bounded: null,
      unboundedPlaces: [],
      bounds: {},
      truncated: false,
    };
  }
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_COVERABILITY_NODES;
  const model = compilePt(net);
  const P = model.placeIds.length;
  const isCapacity = new Array<boolean>(P).fill(false);
  for (const [p] of model.capacities) isCapacity[p] = true;

  const markings: number[][] = [model.initial.slice()];
  const parents: number[] = [-1];
  const index = new Map<string, number>([[model.initial.join(','), 0]]);
  const edges: CoverabilityEdge[] = [];
  let truncated = false;

  for (let head = 0; head < markings.length && !truncated; head += 1) {
    if (options.signal?.aborted) throw new AnalysisCancelled();
    const marking = markings[head]!;
    for (let t = 0; t < model.transitionIds.length && !truncated; t += 1) {
      if (!ptEnabled(model, marking, t)) continue;
      const next = marking.slice();
      for (const [p, d] of model.delta[t]!) next[p] = next[p]! + d; // ω + d = ω
      // Accelerate along the path from the root: a smaller marking on the path that is covered.
      let changed = true;
      while (changed) {
        changed = false;
        for (let a = head; a !== -1; a = parents[a]!) {
          const ancestor = markings[a]!;
          let covered = true;
          let grown = false;
          for (let p = 0; p < P && covered; p += 1) {
            if (next[p]! < ancestor[p]!) covered = false;
            else if (next[p]! > ancestor[p]!) {
              if (isCapacity[p]) covered = false;
              else grown = true;
            }
          }
          if (!covered || !grown) continue;
          for (let p = 0; p < P; p += 1) {
            if (next[p]! > ancestor[p]! && next[p] !== Number.POSITIVE_INFINITY) {
              next[p] = Number.POSITIVE_INFINITY;
              changed = true;
            }
          }
        }
      }
      const key = next.join(',');
      let target = index.get(key);
      if (target === undefined) {
        if (markings.length >= maxNodes) {
          truncated = true;
          break;
        }
        target = markings.length;
        markings.push(next);
        parents.push(head);
        index.set(key, target);
      }
      edges.push({ from: head, to: target, transitionId: model.transitionIds[t]! });
    }
  }

  const unbounded = new Set<number>();
  const maxima = new Array<number>(P).fill(0);
  for (const marking of markings) {
    marking.forEach((count, p) => {
      if (count === Number.POSITIVE_INFINITY) unbounded.add(p);
      else if (count > maxima[p]!) maxima[p] = count;
    });
  }
  const label = (count: number): OmegaCount => (count === Number.POSITIVE_INFINITY ? 'ω' : count);
  const bounds: Record<Id, OmegaCount> = {};
  model.placeIds.forEach((id, p) => {
    bounds[id] = unbounded.has(p) ? 'ω' : maxima[p]!;
  });
  return {
    applicable: true,
    nodes: markings.map((marking, id) => ({
      id,
      parent: parents[id]!,
      marking: Object.fromEntries(
        model.placeIds.map((placeId, p) => [placeId, label(marking[p]!)]),
      ),
    })),
    edges,
    // An ω found so far proves unboundedness even if the construction was cut off.
    bounded: unbounded.size > 0 ? false : truncated ? null : true,
    unboundedPlaces: model.placeIds.filter((_, p) => unbounded.has(p)),
    bounds,
    truncated,
  };
}
