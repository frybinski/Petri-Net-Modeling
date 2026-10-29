import { parseInputInscription } from '@pnm/expr';
import type { Id, PetriNet } from '@pnm/core';

/**
 * The place/transition skeleton of a net as dense matrices: what the structural analyses (incidence
 * matrix, invariants, siphons) work on.
 *
 * - Arcs between two places or two transitions are ignored, like in the firing rule of the core.
 * - Several arcs between the same place and transition add up.
 * - In JSON nets an input arc with an inscription counts as many tokens as the inscription has
 *   variables (`$l, $r` takes two); every other arc counts its weight. Guards and output
 *   inscriptions are not looked at, so for a JSON net the skeleton is an approximation of the
 *   token flow (`approximate`).
 * - An arc with an invalid weight (not an integer >= 1) is left out and reported in `warnings`.
 */
export interface Skeleton {
  placeIds: Id[];
  placeNames: string[];
  transitionIds: Id[];
  transitionNames: string[];
  /** `pre[p][t]`: tokens that transition `t` takes from place `p`. */
  pre: number[][];
  /** `post[p][t]`: tokens that transition `t` puts on place `p`. */
  post: number[][];
  /** Tokens per place in the initial marking. */
  initial: number[];
  /** Capacity per place, `undefined` if unbounded. */
  capacity: Array<number | undefined>;
  /** True for JSON nets: the weights are those of the skeleton, not of the real token flow. */
  approximate: boolean;
  warnings: string[];
}

function isWeight(weight: number): boolean {
  return Number.isInteger(weight) && weight >= 1;
}

export function buildSkeleton(net: PetriNet): Skeleton {
  const placeIndex = new Map<Id, number>();
  net.places.forEach((p, i) => placeIndex.set(p.id, i));
  const transitionIndex = new Map<Id, number>();
  net.transitions.forEach((t, i) => transitionIndex.set(t.id, i));
  const rows = net.places.length;
  const cols = net.transitions.length;
  const pre = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  const post = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  const warnings: string[] = [];
  const json = net.profile === 'json-net';

  for (const arc of net.arcs) {
    const fromPlace = placeIndex.get(arc.source);
    const toTransition = transitionIndex.get(arc.target);
    const fromTransition = transitionIndex.get(arc.source);
    const toPlace = placeIndex.get(arc.target);
    const isPre = fromPlace !== undefined && toTransition !== undefined;
    const isPost = fromTransition !== undefined && toPlace !== undefined;
    if (!isPre && !isPost) continue;
    let weight = arc.weight;
    if (isPre && json && arc.inscription !== undefined && arc.inscription.trim() !== '') {
      const parsed = parseInputInscription(arc.inscription);
      if (parsed.ok && parsed.variables.length > 0) weight = parsed.variables.length;
    }
    if (!isWeight(weight)) {
      warnings.push(`Arc ${arc.id} has the invalid weight ${String(arc.weight)} and is ignored.`);
      continue;
    }
    if (isPre) pre[fromPlace]![toTransition]! += weight;
    else post[toPlace!]![fromTransition!]! += weight;
  }

  return {
    placeIds: net.places.map((p) => p.id),
    placeNames: net.places.map((p) => p.name),
    transitionIds: net.transitions.map((t) => t.id),
    transitionNames: net.transitions.map((t) => t.name),
    pre,
    post,
    initial: net.places.map((p) => net.marking[p.id]?.length ?? 0),
    capacity: net.places.map((p) => p.capacity),
    approximate: json,
    warnings,
  };
}

/** The incidence matrix `C = Post - Pre` (places x transitions). */
export function incidenceOf(skeleton: Pick<Skeleton, 'pre' | 'post'>): number[][] {
  return skeleton.pre.map((row, p) => row.map((value, t) => skeleton.post[p]![t]! - value));
}
