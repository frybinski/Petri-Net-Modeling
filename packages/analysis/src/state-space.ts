import {
  canonicalJson,
  findEnabled,
  fireBinding,
  type Binding,
  type Diagnostic,
  type Id,
  type Marking,
  type PetriNet,
  type Token,
} from '@pnm/core';
import { compilePt, ptEnabled, ptFire, type PtModel } from './pt-engine';

/** A firing in a trace: the transition and, in JSON nets, the binding that was fired. */
export interface Step {
  transitionId: Id;
  binding?: Binding;
}

export interface State {
  id: number;
  marking: Marking;
  /** Canonical key of the marking: equal markings have equal keys. */
  key: string;
  /** Transitions enabled here (empty if the state was not expanded). */
  enabled: Id[];
  /** Nothing is enabled. Only set for states whose enabled transitions were computed. */
  deadlock: boolean;
  /** An end state of the traces (see `StateSpaceOptions.final`). */
  final: boolean;
  /** All successors are in the graph. False for the border of a cut-off exploration. */
  expanded: boolean;
  /** The edge by which the breadth-first search first reached the state; -1 for the initial state. */
  parentEdge: number;
}

export interface Edge {
  from: number;
  to: number;
  transitionId: Id;
  /** The binding of the firing; absent in P/T nets. */
  binding?: Binding;
}

export interface StateSpace {
  states: State[];
  edges: Edge[];
  initial: number;
  /** The exploration stopped at a limit; the graph is a prefix of the real state space. */
  truncated: boolean;
  reason?: string;
  /** Problems found while evaluating guards and inscriptions (JSON nets). */
  diagnostics: Diagnostic[];
}

export interface StateSpaceProgress {
  states: number;
  edges: number;
  /** States found but not yet expanded. */
  queued: number;
  elapsedMs: number;
}

export interface StateSpaceOptions {
  /** Maximum number of states. Default 20000. */
  maxStates?: number;
  /** Maximum time in milliseconds. Default 10000. */
  maxTimeMs?: number;
  /**
   * What ends a trace: `'deadlock'` (default) marks the states without enabled transition, a list
   * of markings marks the states with exactly one of these markings.
   */
  final?: 'deadlock' | { markings: Marking[] };
  /** Maximum number of bindings per transition and marking (JSON nets). */
  maxBindings?: number;
  onProgress?: (progress: StateSpaceProgress) => void;
  /** Aborting rejects the returned promise with an `AnalysisCancelled` error. */
  signal?: AbortSignal;
}

export const DEFAULT_MAX_STATES = 20_000;
export const DEFAULT_MAX_TIME_MS = 10_000;

/** Raised when an analysis is stopped through its `AbortSignal`. */
export class AnalysisCancelled extends Error {
  constructor() {
    super('The analysis was cancelled');
    this.name = 'AnalysisCancelled';
  }
}

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** How often the long-running loops give the event loop a turn (progress messages, cancellation). */
const SLICE_MS = 40;

function tokenKey(tokens: readonly Token[]): string {
  return tokens
    .map((t) => canonicalJson(t))
    .sort()
    .join('|');
}

/** Canonical key of a marking of a JSON net: the tokens of each place as a sorted multiset. */
function jsonKey(net: PetriNet, marking: Marking): string {
  return JSON.stringify(net.places.map((p) => tokenKey(marking[p.id] ?? [])));
}

/**
 * The canonical key of a marking: for P/T nets the token counts per place, for JSON nets the sorted
 * token values per place. Markings with equal keys are the same state.
 */
export function markingKey(net: PetriNet, marking: Marking): string {
  if (net.profile === 'pt-net') {
    return net.places.map((p) => marking[p.id]?.length ?? 0).join(',');
  }
  return jsonKey(net, marking);
}

interface Successor {
  transitionId: Id;
  binding?: Binding;
  key: string;
  /** Builds the marking on demand; only called for states that are new. */
  marking: () => Marking;
  /** Opaque data handed back when the state is expanded. */
  next: unknown;
}

interface Expansion {
  enabled: Id[];
  successors: Successor[];
  /** Bindings were cut off for some transition. */
  bindingsTruncated: boolean;
  diagnostics: Diagnostic[];
}

type Expander = (data: unknown) => Expansion | Promise<Expansion>;

function ptExpander(model: PtModel): {
  initial: unknown;
  key: (d: unknown) => string;
  marking: (d: unknown) => Marking;
  expand: Expander;
} {
  const toMarking = (counts: readonly number[]): Marking => {
    const marking: Marking = {};
    counts.forEach((n, p) => {
      if (n > 0) marking[model.placeIds[p]!] = Array.from({ length: n }, () => 1);
    });
    return marking;
  };
  return {
    initial: model.initial,
    key: (d) => (d as number[]).join(','),
    marking: (d) => toMarking(d as number[]),
    expand(data) {
      const counts = data as number[];
      const enabled: Id[] = [];
      const successors: Successor[] = [];
      for (let t = 0; t < model.transitionIds.length; t += 1) {
        if (!ptEnabled(model, counts, t)) continue;
        const transitionId = model.transitionIds[t]!;
        enabled.push(transitionId);
        const next = ptFire(model, counts, t);
        successors.push({
          transitionId,
          key: next.join(','),
          marking: () => toMarking(next),
          next,
        });
      }
      return { enabled, successors, bindingsTruncated: false, diagnostics: [] };
    },
  };
}

function jsonExpander(
  net: PetriNet,
  maxBindings: number | undefined,
): {
  initial: unknown;
  key: (d: unknown) => string;
  marking: (d: unknown) => Marking;
  expand: Expander;
} {
  return {
    initial: net.marking,
    key: (d) => jsonKey(net, d as Marking),
    marking: (d) => d as Marking,
    async expand(data) {
      const marking = data as Marking;
      const result = await findEnabled(
        net,
        marking,
        maxBindings === undefined ? undefined : { maxBindings },
      );
      const enabled: Id[] = [];
      const successors: Successor[] = [];
      let bindingsTruncated = false;
      for (const transition of net.transitions) {
        const found = result.enabled.get(transition.id);
        if (!found || found.bindings.length === 0) continue;
        enabled.push(transition.id);
        if (found.truncated) bindingsTruncated = true;
        for (const binding of found.bindings) {
          const next = fireBinding(net, marking, binding);
          successors.push({
            transitionId: transition.id,
            binding: binding.binding,
            key: jsonKey(net, next),
            marking: () => next,
            next,
          });
        }
      }
      return { enabled, successors, bindingsTruncated, diagnostics: result.diagnostics };
    },
  };
}

/**
 * Builds the reachability graph of a net by breadth-first search from the initial marking, with the
 * atomic firing rule of `@pnm/core` (interleaving, no time). P/T nets run on count vectors, JSON
 * nets go through `findEnabled`, one edge per binding. The exploration stops at `maxStates` or
 * `maxTimeMs`; the result is then marked `truncated` and the states at the border are not expanded.
 */
export async function buildStateSpace(
  net: PetriNet,
  options: StateSpaceOptions = {},
): Promise<StateSpace> {
  const maxStates = options.maxStates ?? DEFAULT_MAX_STATES;
  const maxTimeMs = options.maxTimeMs ?? DEFAULT_MAX_TIME_MS;
  const started = Date.now();
  const engine =
    net.profile === 'pt-net' ? ptExpander(compilePt(net)) : jsonExpander(net, options.maxBindings);

  const states: State[] = [];
  const edges: Edge[] = [];
  const data: unknown[] = [];
  const index = new Map<string, number>();
  const diagnostics = new Map<string, Diagnostic>();
  let truncated = false;
  let reason: string | undefined;
  const stop = (why: string): void => {
    if (!truncated) {
      truncated = true;
      reason = why;
    }
  };

  const initialKey = engine.key(engine.initial);
  states.push({
    id: 0,
    marking: engine.marking(engine.initial),
    key: initialKey,
    enabled: [],
    deadlock: false,
    final: false,
    expanded: false,
    parentEdge: -1,
  });
  data.push(engine.initial);
  index.set(initialKey, 0);

  let head = 0;
  let sliceStart = Date.now();
  while (head < states.length) {
    if (options.signal?.aborted) throw new AnalysisCancelled();
    const now = Date.now();
    if (now - started > maxTimeMs) {
      stop(`time limit of ${maxTimeMs} ms reached`);
      break;
    }
    if (now - sliceStart > SLICE_MS) {
      options.onProgress?.({
        states: states.length,
        edges: edges.length,
        queued: states.length - head,
        elapsedMs: now - started,
      });
      await yieldToEventLoop();
      sliceStart = Date.now();
    }
    const id = head;
    head += 1;
    const expansion = await engine.expand(data[id]);
    for (const d of expansion.diagnostics)
      diagnostics.set(`${d.code}:${d.elementId ?? ''}:${d.message}`, d);
    if (expansion.bindingsTruncated) stop('binding limit reached for some transition');
    const state = states[id]!;
    state.enabled = expansion.enabled;
    state.deadlock = expansion.enabled.length === 0;
    let complete = !expansion.bindingsTruncated;
    for (const successor of expansion.successors) {
      let target = index.get(successor.key);
      if (target === undefined) {
        if (states.length >= maxStates) {
          stop(`state limit of ${maxStates} reached`);
          complete = false;
          continue;
        }
        target = states.length;
        const edgeId = edges.length;
        states.push({
          id: target,
          marking: successor.marking(),
          key: successor.key,
          enabled: [],
          deadlock: false,
          final: false,
          expanded: false,
          parentEdge: edgeId,
        });
        data.push(successor.next);
        index.set(successor.key, target);
      }
      edges.push({
        from: id,
        to: target,
        transitionId: successor.transitionId,
        ...(successor.binding !== undefined && { binding: successor.binding }),
      });
    }
    state.expanded = complete;
  }
  const final = options.final ?? 'deadlock';
  if (final === 'deadlock') {
    for (const state of states) state.final = state.deadlock;
  } else {
    const keys = new Set(final.markings.map((m) => markingKey(net, m)));
    for (const state of states) state.final = keys.has(state.key);
  }

  options.onProgress?.({
    states: states.length,
    edges: edges.length,
    queued: states.length - head,
    elapsedMs: Date.now() - started,
  });
  return {
    states,
    edges,
    initial: 0,
    truncated,
    ...(reason !== undefined && { reason }),
    diagnostics: [...diagnostics.values()],
  };
}

/** The shortest firing sequence from the initial state to `stateId` (as found by the search). */
export function traceTo(space: StateSpace, stateId: number): Step[] {
  const steps: Step[] = [];
  let current = space.states[stateId];
  while (current !== undefined && current.parentEdge >= 0) {
    const edge = space.edges[current.parentEdge]!;
    steps.push({
      transitionId: edge.transitionId,
      ...(edge.binding !== undefined && { binding: edge.binding }),
    });
    current = space.states[edge.from];
  }
  return steps.reverse();
}
