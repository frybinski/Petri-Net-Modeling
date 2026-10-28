import {
  evaluateGuard,
  evaluateOutput,
  parseInputInscription,
  tryCompile,
  type CompiledExpression,
  type EvalOptions,
} from '@pnm/expr';
import type { Diagnostic, DiagnosticCode } from '../diagnostic';
import type { Arc, Id, Marking, PetriNet, Token } from '../model';
import { canonicalJson, compareTokens, tokenEquals, tokenLabel } from '../token';
import { typeChecker } from '../types';

/** Variable name (without `$`) to the token it is bound to. */
export type Binding = Record<string, Token>;

/** A transition together with one binding under which it is enabled, and the resulting token flow. */
export interface EnabledBinding {
  transitionId: Id;
  binding: Binding;
  /** Tokens removed from each input place. */
  consumes: Record<Id, Token[]>;
  /** Tokens added to each output place. */
  produces: Record<Id, Token[]>;
}

export interface BindingResult {
  /** Valid bindings, deduplicated and sorted. At most `maxBindings` entries. */
  bindings: EnabledBinding[];
  /** True if there are more bindings (or candidates) than the limits allow. */
  truncated: boolean;
  /** Syntax and evaluation problems, one per expression. */
  diagnostics: Diagnostic[];
}

export interface BindingOptions {
  /** Maximum number of bindings returned per transition. Default 1000. */
  maxBindings?: number;
  /** Maximum number of token combinations tried per transition. Default 20000. */
  maxCandidates?: number;
  /** Limits for the evaluation of one expression. */
  eval?: EvalOptions;
}

export const DEFAULT_MAX_BINDINGS = 1000;
export const DEFAULT_MAX_CANDIDATES = 20_000;

interface InputSpec {
  arc: Arc;
  placeId: Id;
  /** Variables of the inscription; empty for arcs without inscription. */
  variables: string[];
  /** Anonymous tokens to consume (arcs without inscription). */
  plain: number;
}

interface Slot {
  placeId: Id;
  name: string;
}

/** Tokens of one place with equal value; they are interchangeable for binding purposes. */
interface Group {
  key: string;
  value: Token;
  indices: number[];
}

interface Candidate {
  binding: Binding;
  consumes: Record<Id, Token[]>;
}

function isBlank(text: string | undefined): boolean {
  return text === undefined || text.trim() === '';
}

function groupTokens(tokens: readonly Token[]): Group[] {
  const groups = new Map<string, Group>();
  tokens.forEach((token, index) => {
    const key = canonicalJson(token);
    const group = groups.get(key);
    if (group) group.indices.push(index);
    else groups.set(key, { key, value: token, indices: [index] });
  });
  return [...groups.values()];
}

/**
 * Enumerates the ways to bind the variables of the input inscriptions. Variables used more than
 * once must be bound to equal values, and no token instance is used twice. Tokens of equal value
 * are tried only once per slot, which keeps the enumeration free of duplicates.
 */
function* enumerateCandidates(
  slots: readonly Slot[],
  plainDemand: ReadonlyMap<Id, number>,
  marking: Marking,
): Generator<Candidate> {
  const groupsByPlace = new Map<Id, Group[]>();
  for (const slot of slots) {
    if (!groupsByPlace.has(slot.placeId)) {
      groupsByPlace.set(slot.placeId, groupTokens(marking[slot.placeId] ?? []));
    }
  }
  const bound = new Map<string, { value: Token; key: string }>();
  const usedInGroup = new Map<Group, number>();
  const picks: Array<{ placeId: Id; group: Group; ordinal: number }> = [];

  function* go(i: number): Generator<Candidate> {
    const slot = slots[i];
    if (slot === undefined) {
      const candidate = finish();
      if (candidate) yield candidate;
      return;
    }
    const existing = bound.get(slot.name);
    for (const group of groupsByPlace.get(slot.placeId) ?? []) {
      if (existing !== undefined && existing.key !== group.key) continue;
      const used = usedInGroup.get(group) ?? 0;
      if (used >= group.indices.length) continue;
      usedInGroup.set(group, used + 1);
      picks.push({ placeId: slot.placeId, group, ordinal: used });
      if (existing === undefined) bound.set(slot.name, { value: group.value, key: group.key });
      yield* go(i + 1);
      if (existing === undefined) bound.delete(slot.name);
      picks.pop();
      usedInGroup.set(group, used);
    }
  }

  /** Completes a variable assignment with the anonymous tokens of arcs without inscription. */
  function finish(): Candidate | null {
    const consumes: Record<Id, Token[]> = {};
    const takenIndices = new Map<Id, Set<number>>();
    for (const pick of picks) {
      const index = pick.group.indices[pick.ordinal]!;
      (consumes[pick.placeId] ??= []).push(pick.group.value);
      let taken = takenIndices.get(pick.placeId);
      if (!taken) takenIndices.set(pick.placeId, (taken = new Set()));
      taken.add(index);
    }
    for (const [placeId, count] of plainDemand) {
      const tokens = marking[placeId] ?? [];
      const taken = takenIndices.get(placeId) ?? new Set<number>();
      takenIndices.set(placeId, taken);
      let needed = count;
      for (let index = 0; index < tokens.length && needed > 0; index += 1) {
        if (taken.has(index)) continue;
        taken.add(index);
        (consumes[placeId] ??= []).push(tokens[index]!);
        needed -= 1;
      }
      if (needed > 0) return null;
    }
    const binding: Binding = {};
    for (const [name, entry] of bound) binding[name] = entry.value;
    return { binding, consumes };
  }

  yield* go(0);
}

function compareBindings(a: Binding, b: Binding): number {
  const names = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const name of names) {
    const left = a[name];
    const right = b[name];
    if (left === undefined || right === undefined) {
      if (left !== right) return left === undefined ? -1 : 1;
      continue;
    }
    const order = compareTokens(left, right);
    if (order !== 0) return order;
  }
  return 0;
}

/**
 * Computes all bindings under which the transition is enabled: every input arc can be served,
 * the guard holds, all output inscriptions evaluate to tokens that satisfy the types of their
 * places, and the capacities are respected after firing.
 */
export async function computeBindings(
  net: PetriNet,
  marking: Marking,
  transitionId: Id,
  opts: BindingOptions = {},
): Promise<BindingResult> {
  const maxBindings = opts.maxBindings ?? DEFAULT_MAX_BINDINGS;
  const maxCandidates = opts.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const result: BindingResult = { bindings: [], truncated: false, diagnostics: [] };
  const transition = net.transitions.find((t) => t.id === transitionId);
  if (!transition) return result;

  const diagnostics = new Map<string, Diagnostic>();
  const report = (
    key: string,
    code: DiagnosticCode,
    message: string,
    elementId: Id | undefined,
  ): void => {
    if (diagnostics.has(`${code}:${key}`)) return;
    diagnostics.set(`${code}:${key}`, {
      severity: 'error',
      code,
      message,
      ...(elementId !== undefined && { elementId }),
    });
  };
  const finishWith = (): BindingResult => {
    result.diagnostics = [...diagnostics.values()];
    return result;
  };

  const placesById = new Map(net.places.map((p) => [p.id, p]));
  const inputArcs = net.arcs.filter((a) => a.target === transitionId && placesById.has(a.source));
  const outputArcs = net.arcs.filter((a) => a.source === transitionId && placesById.has(a.target));

  // Input side: parse inscriptions into variable lists.
  const inputs: InputSpec[] = [];
  for (const arc of inputArcs) {
    if (isBlank(arc.inscription)) {
      if (!Number.isInteger(arc.weight) || arc.weight < 1) return finishWith();
      inputs.push({ arc, placeId: arc.source, variables: [], plain: arc.weight });
      continue;
    }
    const parsed = parseInputInscription(arc.inscription!);
    if (!parsed.ok) {
      report(arc.id, 'INSCRIPTION_SYNTAX', parsed.error.message, arc.id);
      return finishWith();
    }
    inputs.push({ arc, placeId: arc.source, variables: parsed.variables, plain: 0 });
  }

  // Guard and output inscriptions.
  let guard: CompiledExpression | undefined;
  if (!isBlank(transition.guard)) {
    const compiled = tryCompile(transition.guard!);
    if (!compiled.ok) {
      report(transition.id, 'GUARD_SYNTAX', compiled.error.message, transition.id);
      return finishWith();
    }
    guard = compiled.expr;
  }
  const outputs: Array<{ arc: Arc; expr?: CompiledExpression }> = [];
  for (const arc of outputArcs) {
    if (isBlank(arc.inscription)) {
      if (!Number.isInteger(arc.weight) || arc.weight < 1) return finishWith();
      outputs.push({ arc });
      continue;
    }
    const compiled = tryCompile(arc.inscription!);
    if (!compiled.ok) {
      report(arc.id, 'INSCRIPTION_SYNTAX', compiled.error.message, arc.id);
      return finishWith();
    }
    outputs.push({ arc, expr: compiled.expr });
  }

  const slots: Slot[] = inputs.flatMap((input) =>
    input.variables.map((name) => ({ placeId: input.placeId, name })),
  );
  const plainDemand = new Map<Id, number>();
  for (const input of inputs) {
    if (input.plain > 0)
      plainDemand.set(input.placeId, (plainDemand.get(input.placeId) ?? 0) + input.plain);
  }

  const baseCounts = new Map<Id, number>();
  for (const place of net.places) baseCounts.set(place.id, marking[place.id]?.length ?? 0);
  const boundedPlaces = net.places.filter((p) => p.capacity !== undefined);

  const evaluate = async (candidate: Candidate): Promise<EnabledBinding | null> => {
    if (guard) {
      const verdict = await evaluateGuard(guard, candidate.binding, opts.eval);
      if (!verdict.ok) {
        if (verdict.error !== undefined) {
          report(
            transition.id,
            'GUARD_ERROR',
            `Guard of "${transition.name}": ${verdict.error}`,
            transition.id,
          );
        }
        return null;
      }
    }
    const produces: Record<Id, Token[]> = {};
    for (const { arc, expr } of outputs) {
      let tokens: Token[];
      if (expr) {
        const out = await evaluateOutput(expr, candidate.binding, opts.eval);
        if ('error' in out) {
          report(
            arc.id,
            'INSCRIPTION_ERROR',
            `Output inscription "${arc.inscription}": ${out.error}`,
            arc.id,
          );
          return null;
        }
        tokens = out.tokens;
      } else {
        tokens = Array.from({ length: arc.weight }, () => 1);
      }
      const place = placesById.get(arc.target)!;
      const check = typeChecker(net, place.type);
      if (check) {
        for (const token of tokens) {
          const verdict = check(token);
          if (!verdict.ok) {
            report(
              arc.id,
              'TOKEN_TYPE_MISMATCH',
              `Token ${tokenLabel(token, 40)} for "${place.name}" does not match type "${place.type}": ${verdict.errors.join('; ')}`,
              arc.id,
            );
            return null;
          }
        }
      }
      (produces[arc.target] ??= []).push(...tokens);
    }
    // Weak capacity rule, evaluated on the net effect like in P/T nets.
    for (const place of boundedPlaces) {
      const next =
        (baseCounts.get(place.id) ?? 0) -
        (candidate.consumes[place.id]?.length ?? 0) +
        (produces[place.id]?.length ?? 0);
      if (next > place.capacity!) return null;
    }
    return { transitionId, binding: candidate.binding, consumes: candidate.consumes, produces };
  };

  const found: EnabledBinding[] = [];
  const seen = new Set<string>();
  let tried = 0;
  for (const candidate of enumerateCandidates(slots, plainDemand, marking)) {
    tried += 1;
    if (tried > maxCandidates) {
      result.truncated = true;
      break;
    }
    const key = canonicalJson(candidate.binding);
    if (seen.has(key)) continue;
    seen.add(key);
    const enabled = await evaluate(candidate);
    if (!enabled) continue;
    if (found.length >= maxBindings) {
      result.truncated = true;
      break;
    }
    found.push(enabled);
  }
  found.sort((a, b) => compareBindings(a.binding, b.binding));
  result.bindings = found;
  return finishWith();
}

export interface EnabledResult {
  /** Transitions with at least one binding, in the order of `net.transitions`. */
  enabled: Map<Id, BindingResult>;
  /** Problems of all transitions, including those that are not enabled. */
  diagnostics: Diagnostic[];
}

/** Computes the bindings of every transition of a JSON net. */
export async function enabledTransitionsHigher(
  net: PetriNet,
  marking: Marking,
  opts?: BindingOptions,
): Promise<EnabledResult> {
  const enabled = new Map<Id, BindingResult>();
  const diagnostics: Diagnostic[] = [];
  for (const transition of net.transitions) {
    const result = await computeBindings(net, marking, transition.id, opts);
    diagnostics.push(...result.diagnostics);
    if (result.bindings.length > 0) enabled.set(transition.id, result);
  }
  return { enabled, diagnostics };
}

/**
 * Fires a binding and returns the successor marking. The input marking is not modified.
 * Throws if a token to consume is not on its place (the binding is stale).
 */
export function fireBinding(net: PetriNet, marking: Marking, enabled: EnabledBinding): Marking {
  if (!net.transitions.some((t) => t.id === enabled.transitionId)) {
    throw new Error(`Unknown transition: ${enabled.transitionId}`);
  }
  const next: Marking = {};
  for (const [placeId, tokens] of Object.entries(marking)) next[placeId] = [...tokens];
  for (const [placeId, tokens] of Object.entries(enabled.consumes)) {
    const list = next[placeId] ?? [];
    for (const token of tokens) {
      const index = list.findIndex((candidate) => tokenEquals(candidate, token));
      if (index < 0) {
        throw new Error(
          `Token ${tokenLabel(token)} is not on place ${placeId}; the binding is stale`,
        );
      }
      list.splice(index, 1);
    }
    next[placeId] = list;
  }
  for (const [placeId, tokens] of Object.entries(enabled.produces)) {
    next[placeId] = [...(next[placeId] ?? []), ...tokens];
  }
  for (const placeId of Object.keys(next)) {
    if (next[placeId]!.length === 0) delete next[placeId];
  }
  return next;
}
