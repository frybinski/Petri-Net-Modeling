import type { Marking, PetriNet } from '@pnm/core';
import type { Dfa } from './dfa';
import { stronglyConnectedComponents } from './properties';
import { activityLabels, compileProperty, type CompiledProperty, type PropertySpec } from './spec';
import { AnalysisCancelled, markingKey, type StateSpace, type Step } from './state-space';
import type { LtlfDfaOptions } from './ltlf';

/**
 * What ends a run for the purpose of a check. Traces are the firing sequences from the initial
 * marking to an end state: `deadlock` (default) the states without enabled transition, `markings`
 * the states with one of the given markings, `all` every state (the property must then hold for
 * every prefix of a run).
 */
export type FinalStates = 'deadlock' | 'all' | { markings: Marking[] };

export interface CheckOptions {
  final?: FinalStates;
  /** Maximum number of nodes of the product of state space and automaton. Default 5000000. */
  maxProductNodes?: number;
  ltlf?: LtlfDfaOptions;
  signal?: AbortSignal;
}

export const DEFAULT_MAX_PRODUCT_NODES = 5_000_000;

export interface Counterexample {
  /** The firing sequence from the initial marking. */
  steps: Step[];
  /** The activities of the steps. */
  activities: string[];
  /** The state at the end of the sequence. */
  stateId: number;
  marking: Marking;
}

/**
 * - `holds`: every trace from the initial marking to an end state satisfies the property.
 * - `violated`: a trace does not; `counterexample` is a shortest one.
 * - `unknown`: the state space is incomplete and no violation was found in the explored part, or
 *   the property cannot be evaluated (`error`).
 */
export type Verdict = 'holds' | 'violated' | 'unknown';

export interface CheckResult {
  id: string;
  verdict: Verdict;
  /** One or two sentences that say why. */
  explanation: string;
  counterexample?: Counterexample;
  /** The property holds only because no run reaches an end state. */
  vacuous: boolean;
  /** There are infinite runs that never reach an end state; the property says nothing about them. */
  infiniteRuns: boolean;
  warnings: string[];
  /** Problem with the property itself (syntax, unknown activity, formula too large). */
  error?: string;
}

function describeFinal(final: FinalStates): string {
  if (final === 'deadlock') return 'a deadlock';
  if (final === 'all') return 'any marking';
  return 'one of the given markings';
}

/** Cycles among the states that are not final: runs that go on forever without ending. */
function hasInfiniteRun(space: StateSpace, final: readonly boolean[]): boolean {
  const kept = space.edges.filter((e) => !final[e.from] && !final[e.to]);
  if (kept.some((e) => e.from === e.to)) return true;
  const { componentOf, count } = stronglyConnectedComponents(space.states.length, kept);
  const size = new Array<number>(count).fill(0);
  for (const s of space.states) {
    if (final[s.id]) continue;
    const c = componentOf[s.id]!;
    size[c] = (size[c] ?? 0) + 1;
  }
  return size.some((n) => n > 1);
}

/**
 * Checks one compiled property on a state space. The product of the state space with the automaton
 * is searched breadth first for an end state in which the automaton does not accept, which gives a
 * shortest counterexample. Properties that cannot be evaluated give `unknown` with an `error`.
 */
export function checkCompiled(
  net: PetriNet,
  space: StateSpace,
  compiled: CompiledProperty,
  options: CheckOptions = {},
): CheckResult {
  const spec = compiled.spec;
  const final = options.final ?? 'deadlock';
  const base = { id: spec.id, vacuous: false, infiniteRuns: false, warnings: [] as string[] };
  if (compiled.error !== null || compiled.dfa === null) {
    return {
      ...base,
      verdict: 'unknown',
      explanation: compiled.tooLarge
        ? `${compiled.error ?? 'Formula too large.'} It cannot be checked on the state space; it can still be checked on a log.`
        : (compiled.error ?? 'The property cannot be checked.'),
      error: compiled.error ?? 'The property cannot be checked.',
    };
  }
  const dfa: Dfa = compiled.dfa;
  const { labelOf } = activityLabels(net);
  const symbolOfEdge = space.edges.map((e) =>
    dfa.symbol(labelOf.get(e.transitionId) ?? e.transitionId),
  );

  // Which states end a run.
  let isFinal: boolean[];
  if (final === 'deadlock') isFinal = space.states.map((s) => s.deadlock);
  else if (final === 'all') isFinal = space.states.map(() => true);
  else {
    const keys = new Set(final.markings.map((m) => markingKey(net, m)));
    isFinal = space.states.map((s) => keys.has(s.key));
  }

  // Adjacency in compressed form.
  const first = new Int32Array(space.states.length + 1);
  for (const edge of space.edges) first[edge.from + 1]! += 1;
  for (let i = 0; i < space.states.length; i += 1) first[i + 1]! += first[i]!;
  const fill = first.slice(0, space.states.length);
  const order = new Int32Array(space.edges.length);
  space.edges.forEach((edge, index) => {
    order[fill[edge.from]!++] = index;
  });

  const Q = dfa.states;
  const maxNodes = options.maxProductNodes ?? DEFAULT_MAX_PRODUCT_NODES;
  const parentNode = new Map<number, number>();
  const parentEdge = new Map<number, number>();
  const start = space.initial * Q + dfa.initial;
  parentNode.set(start, -1);
  parentEdge.set(start, -1);
  const queue: number[] = [start];
  let violation = -1;
  let sawFinal = false;
  for (let head = 0; head < queue.length; head += 1) {
    if (options.signal?.aborted) throw new AnalysisCancelled();
    const node = queue[head]!;
    const s = Math.floor(node / Q);
    const q = node % Q;
    if (isFinal[s]) {
      sawFinal = true;
      if (!dfa.accepting[q]) {
        violation = node;
        break;
      }
    }
    for (let k = first[s]!; k < first[s + 1]!; k += 1) {
      const edgeIndex = order[k]!;
      const target = space.edges[edgeIndex]!.to;
      const nextNode = target * Q + dfa.table[q]![symbolOfEdge[edgeIndex]!]!;
      if (parentNode.has(nextNode)) continue;
      if (parentNode.size >= maxNodes) {
        return {
          ...base,
          verdict: 'unknown',
          explanation:
            'The search through the state space and the property was cut off at its size limit.',
          warnings: ['product limit reached'],
        };
      }
      parentNode.set(nextNode, node);
      parentEdge.set(nextNode, edgeIndex);
      queue.push(nextNode);
    }
  }

  const infiniteRuns = hasInfiniteRun(space, isFinal);
  const warnings: string[] = [];
  if (infiniteRuns) {
    warnings.push(
      `The net contains infinite runs without a final state (${describeFinal(final)}); the property says nothing about them.`,
    );
  }
  if (violation >= 0) {
    const edgeIndexes: number[] = [];
    for (let node = violation; parentNode.get(node)! !== -1; node = parentNode.get(node)!) {
      edgeIndexes.push(parentEdge.get(node)!);
    }
    edgeIndexes.reverse();
    const steps: Step[] = edgeIndexes.map((i) => {
      const edge = space.edges[i]!;
      return {
        transitionId: edge.transitionId,
        ...(edge.binding !== undefined && { binding: edge.binding }),
      };
    });
    const stateId = Math.floor(violation / Q);
    return {
      ...base,
      verdict: 'violated',
      explanation:
        steps.length === 0
          ? 'The empty run, which ends in the initial marking, violates the property.'
          : `A run of ${steps.length} ${steps.length === 1 ? 'step' : 'steps'} that ends in ${describeFinal(final)} violates the property.`,
      counterexample: {
        steps,
        activities: steps.map((s) => labelOf.get(s.transitionId) ?? s.transitionId),
        stateId,
        marking: space.states[stateId]!.marking,
      },
      warnings,
      infiniteRuns,
    };
  }
  if (space.truncated) {
    return {
      ...base,
      verdict: 'unknown',
      explanation: `No violation in the ${space.states.length} states explored, but the state space is incomplete (${space.reason ?? 'limit reached'}). Raise the limit to be sure.`,
      warnings,
      infiniteRuns,
    };
  }
  const vacuous = !sawFinal;
  return {
    ...base,
    verdict: 'holds',
    explanation: vacuous
      ? `Holds vacuously: no run ends in ${describeFinal(final)}, so there is no trace to check.${final === 'deadlock' ? ' Check every prefix of a run ("any marking") to test the behaviour of nets that never stop.' : ''}`
      : `Every run that ends in ${describeFinal(final)} satisfies the property (${space.states.length} states searched).`,
    vacuous,
    warnings,
    infiniteRuns,
  };
}

/** Compiles and checks a list of properties on a state space. */
export function checkProperties(
  net: PetriNet,
  space: StateSpace,
  specs: readonly PropertySpec[],
  options: CheckOptions = {},
): CheckResult[] {
  const { labels } = activityLabels(net);
  return specs.map((spec) =>
    checkCompiled(net, space, compileProperty(spec, labels, options.ltlf), options),
  );
}
