import {
  always,
  and,
  atom,
  eventually,
  F as FALSE,
  formatLtlf,
  iff,
  implies,
  next,
  not,
  or,
  until,
  weakNext,
  weakUntil,
  type Ltlf,
} from './ltlf';
import { exploreDfa, intersect, type Dfa } from './dfa';

/**
 * The DECLARE templates. `a` is the first activity, `b` the second. With a number `n` for
 * `existence` (at least n times), `absence` (at most n times, default 0) and `exactly`.
 */
export const DECLARE_TEMPLATES = [
  'existence',
  'absence',
  'exactly',
  'init',
  'end',
  'respondedExistence',
  'coExistence',
  'response',
  'precedence',
  'succession',
  'alternateResponse',
  'alternatePrecedence',
  'alternateSuccession',
  'chainResponse',
  'chainPrecedence',
  'chainSuccession',
  'notCoExistence',
  'notSuccession',
  'notChainSuccession',
  'choice',
  'exclusiveChoice',
] as const;

export type DeclareTemplate = (typeof DECLARE_TEMPLATES)[number];

export interface DeclareSpec {
  template: DeclareTemplate;
  /** One activity for the unary templates, two for the binary ones. */
  activities: string[];
  /** The count of `existence`, `absence` and `exactly`. */
  n?: number;
}

export interface TemplateInfo {
  template: DeclareTemplate;
  /** Name as the editor shows it. */
  label: string;
  arity: 1 | 2;
  /** The template takes a number. */
  counted: boolean;
  group: 'existence' | 'choice' | 'relation' | 'negative';
}

export const TEMPLATE_INFO: Record<DeclareTemplate, TemplateInfo> = {
  existence: {
    template: 'existence',
    label: 'Existence',
    arity: 1,
    counted: true,
    group: 'existence',
  },
  absence: { template: 'absence', label: 'Absence', arity: 1, counted: true, group: 'existence' },
  exactly: { template: 'exactly', label: 'Exactly', arity: 1, counted: true, group: 'existence' },
  init: { template: 'init', label: 'Init', arity: 1, counted: false, group: 'existence' },
  end: { template: 'end', label: 'End', arity: 1, counted: false, group: 'existence' },
  respondedExistence: {
    template: 'respondedExistence',
    label: 'Responded existence',
    arity: 2,
    counted: false,
    group: 'relation',
  },
  coExistence: {
    template: 'coExistence',
    label: 'Co-existence',
    arity: 2,
    counted: false,
    group: 'relation',
  },
  response: {
    template: 'response',
    label: 'Response',
    arity: 2,
    counted: false,
    group: 'relation',
  },
  precedence: {
    template: 'precedence',
    label: 'Precedence',
    arity: 2,
    counted: false,
    group: 'relation',
  },
  succession: {
    template: 'succession',
    label: 'Succession',
    arity: 2,
    counted: false,
    group: 'relation',
  },
  alternateResponse: {
    template: 'alternateResponse',
    label: 'Alternate response',
    arity: 2,
    counted: false,
    group: 'relation',
  },
  alternatePrecedence: {
    template: 'alternatePrecedence',
    label: 'Alternate precedence',
    arity: 2,
    counted: false,
    group: 'relation',
  },
  alternateSuccession: {
    template: 'alternateSuccession',
    label: 'Alternate succession',
    arity: 2,
    counted: false,
    group: 'relation',
  },
  chainResponse: {
    template: 'chainResponse',
    label: 'Chain response',
    arity: 2,
    counted: false,
    group: 'relation',
  },
  chainPrecedence: {
    template: 'chainPrecedence',
    label: 'Chain precedence',
    arity: 2,
    counted: false,
    group: 'relation',
  },
  chainSuccession: {
    template: 'chainSuccession',
    label: 'Chain succession',
    arity: 2,
    counted: false,
    group: 'relation',
  },
  notCoExistence: {
    template: 'notCoExistence',
    label: 'Not co-existence',
    arity: 2,
    counted: false,
    group: 'negative',
  },
  notSuccession: {
    template: 'notSuccession',
    label: 'Not succession',
    arity: 2,
    counted: false,
    group: 'negative',
  },
  notChainSuccession: {
    template: 'notChainSuccession',
    label: 'Not chain succession',
    arity: 2,
    counted: false,
    group: 'negative',
  },
  choice: { template: 'choice', label: 'Choice', arity: 2, counted: false, group: 'choice' },
  exclusiveChoice: {
    template: 'exclusiveChoice',
    label: 'Exclusive choice',
    arity: 2,
    counted: false,
    group: 'choice',
  },
};

/** The default count of a counted template. */
export function defaultCount(template: DeclareTemplate): number {
  return template === 'absence' ? 0 : 1;
}

/** The template for a name such as `response`, `Responded existence` or `chain-succession`. */
export function templateByName(name: string): DeclareTemplate | undefined {
  const key = name.toLowerCase().replace(/[^a-z]/g, '');
  return DECLARE_TEMPLATES.find((t) => t.toLowerCase() === key);
}

/** The reason why a specification is not usable, or `null`. */
export function validateDeclare(spec: DeclareSpec): string | null {
  const info = TEMPLATE_INFO[spec.template];
  if (spec.activities.length !== info.arity) {
    return `${info.label} needs ${info.arity === 1 ? 'one activity' : 'two activities'}.`;
  }
  if (spec.activities.some((a) => a.trim() === '')) return `${info.label} needs named activities.`;
  if (info.arity === 2 && spec.activities[0] === spec.activities[1]) {
    return `${info.label} needs two different activities.`;
  }
  if (info.counted) {
    const n = spec.n ?? defaultCount(spec.template);
    const minimum = spec.template === 'existence' ? 1 : 0;
    if (!Number.isInteger(n) || n < minimum || n > 50) {
      return `The count of ${info.label} must be a whole number from ${minimum} to 50.`;
    }
  }
  return null;
}

function quoteIfNeeded(name: string): string {
  return /^[^\s,()"']+$/u.test(name)
    ? name
    : `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** The specification as text, for example `response(Approve, Create invoice)`. */
export function formatDeclare(spec: DeclareSpec): string {
  const parts = spec.activities.map(quoteIfNeeded);
  if (TEMPLATE_INFO[spec.template].counted)
    parts.push(String(spec.n ?? defaultCount(spec.template)));
  return `${spec.template}(${parts.join(', ')})`;
}

/** Splits an argument list at commas that are outside of quotation marks. */
function splitArguments(text: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quote !== null) {
      if (char === '\\' && i + 1 < text.length) {
        current += text[i + 1]!;
        i += 1;
      } else if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ',') {
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (quote !== null) throw new Error('A quotation mark is not closed.');
  parts.push(current.trim());
  return parts;
}

/**
 * Reads `response(Approve, Create invoice)`, `existence(Pay, 2)` or `init("Start process")`. The
 * template name ignores case, spaces, hyphens and underscores (`chain-succession` works). Names
 * with commas or parentheses go in quotation marks. Throws an `Error` with a message that says
 * what is wrong.
 */
export function parseDeclare(text: string): DeclareSpec {
  const match = /^\s*([A-Za-z][A-Za-z _-]*?)\s*\(([\s\S]*)\)\s*$/.exec(text);
  if (!match) throw new Error(`"${text}" is not a template call such as response(a, b).`);
  const template = templateByName(match[1]!);
  if (!template) {
    throw new Error(
      `Unknown template "${match[1]!.trim()}". Known: ${DECLARE_TEMPLATES.join(', ')}.`,
    );
  }
  const info = TEMPLATE_INFO[template];
  const args = splitArguments(match[2]!);
  let n: number | undefined;
  if (info.counted && args.length === info.arity + 1) {
    const last = args.pop()!;
    n = Number(last);
    if (last === '' || !Number.isInteger(n)) {
      throw new Error(`The count "${last}" of ${template} is not a whole number.`);
    }
  }
  const spec: DeclareSpec = { template, activities: args, ...(n !== undefined && { n }) };
  const problem = validateDeclare(spec);
  if (problem) throw new Error(problem);
  return spec;
}

// --- semantics as LTLf ------------------------------------------------------------------------

function atLeast(a: Ltlf, n: number): Ltlf {
  // F(a & X(at least n-1 more))
  return n <= 1 ? eventually(a) : eventually(and(a, next(atLeast(a, n - 1))));
}

/**
 * The LTLf formula that defines the template (the standard semantics on finite traces). The
 * explicit automata of `declareDfa` are tested against it.
 */
export function declareFormula(spec: DeclareSpec): Ltlf {
  const a = atom(spec.activities[0] ?? '');
  const b = atom(spec.activities[1] ?? '');
  const n = spec.n ?? defaultCount(spec.template);
  const response = always(implies(a, eventually(b)));
  const precedence = weakUntil(not(b), a);
  const alternateResponse = always(implies(a, next(until(not(a), b))));
  const alternatePrecedence = and(
    weakUntil(not(b), a),
    always(implies(b, weakNext(weakUntil(not(b), a)))),
  );
  const chainResponse = always(implies(a, next(b)));
  const chainPrecedence = and(not(b), always(implies(next(b), a)));
  switch (spec.template) {
    case 'existence':
      return atLeast(a, n);
    case 'absence':
      return not(atLeast(a, n + 1));
    case 'exactly':
      return n === 0 ? not(atLeast(a, 1)) : and(atLeast(a, n), not(atLeast(a, n + 1)));
    case 'init':
      return a;
    case 'end':
      return eventually(and(a, weakNext(FALSE)));
    case 'respondedExistence':
      return implies(eventually(a), eventually(b));
    case 'coExistence':
      return iff(eventually(a), eventually(b));
    case 'response':
      return response;
    case 'precedence':
      return precedence;
    case 'succession':
      return and(response, precedence);
    case 'alternateResponse':
      return alternateResponse;
    case 'alternatePrecedence':
      return alternatePrecedence;
    case 'alternateSuccession':
      return and(alternateResponse, alternatePrecedence);
    case 'chainResponse':
      return chainResponse;
    case 'chainPrecedence':
      return chainPrecedence;
    case 'chainSuccession':
      return and(chainResponse, chainPrecedence);
    case 'notCoExistence':
      return not(and(eventually(a), eventually(b)));
    case 'notSuccession':
      return always(implies(a, not(eventually(b))));
    case 'notChainSuccession':
      return always(implies(a, weakNext(not(b))));
    case 'choice':
      return or(eventually(a), eventually(b));
    case 'exclusiveChoice':
      return and(or(eventually(a), eventually(b)), not(and(eventually(a), eventually(b))));
  }
}

/** The formula of a template as text. */
export function declareFormulaText(spec: DeclareSpec): string {
  return formatLtlf(declareFormula(spec));
}

// --- explicit automata ------------------------------------------------------------------------

/** Symbols of the binary templates: 0 = a, 1 = b, 2 = any other activity. */
const A = 0;
const B = 1;

function small<S>(
  activities: string[],
  initial: S,
  step: (state: S, symbol: number) => S,
  accepting: (state: S) => boolean,
): Dfa {
  // The state types are small enums, numbers or tuples; JSON is a faithful key.
  return exploreDfa(activities, initial, step, accepting, (s) => JSON.stringify(s))!;
}

/** Counter automaton for the number of occurrences of `a`, capped at `cap`. */
function counting(a: string, cap: number, accepting: (count: number) => boolean): Dfa {
  return small<number>([a], 0, (k, s) => (s === 0 ? Math.min(k + 1, cap) : k), accepting);
}

/** The finite automaton of a binary template; `a` and `b` are the two activities. */
function binary(template: DeclareTemplate, a: string, b: string): Dfa {
  const acts = [a, b];
  switch (template) {
    case 'respondedExistence':
      // (seen a, seen b): rejected only if a occurred and b never.
      return small<[boolean, boolean]>(
        acts,
        [false, false],
        ([sa, sb], s) => [sa || s === A, sb || s === B],
        ([sa, sb]) => !sa || sb,
      );
    case 'coExistence':
      return small<[boolean, boolean]>(
        acts,
        [false, false],
        ([sa, sb], s) => [sa || s === A, sb || s === B],
        ([sa, sb]) => sa === sb,
      );
    case 'response':
      // pending: an a is waiting for a b.
      return small<boolean>(
        acts,
        false,
        (pending, s) => (s === A ? true : s === B ? false : pending),
        (pending) => !pending,
      );
    case 'precedence':
      // 0: no a yet, 1: an a occurred, 2: a b came before every a.
      return small<number>(
        acts,
        0,
        (k, s) => (k === 2 ? 2 : k === 1 ? 1 : s === A ? 1 : s === B ? 2 : 0),
        (k) => k !== 2,
      );
    case 'succession':
      return intersect(binary('response', a, b), binary('precedence', a, b));
    case 'alternateResponse':
      // 0: nothing pending, 1: an a waits for its b, 2: a second a came first.
      return small<number>(
        acts,
        0,
        (k, s) => (k === 2 ? 2 : k === 0 ? (s === A ? 1 : 0) : s === A ? 2 : s === B ? 0 : 1),
        (k) => k === 0,
      );
    case 'alternatePrecedence':
      // 0: a b is not allowed yet, 1: a b is allowed (an a came since the last b), 2: violated.
      return small<number>(
        acts,
        0,
        (k, s) => (k === 2 ? 2 : k === 0 ? (s === A ? 1 : s === B ? 2 : 0) : s === B ? 0 : 1),
        (k) => k !== 2,
      );
    case 'alternateSuccession':
      return intersect(binary('alternateResponse', a, b), binary('alternatePrecedence', a, b));
    case 'chainResponse':
      // 0: free, 1: the last event was a and b must come next, 2: violated.
      return small<number>(
        acts,
        0,
        (k, s) => (k === 2 ? 2 : k === 0 ? (s === A ? 1 : 0) : s === B ? 0 : 2),
        (k) => k === 0,
      );
    case 'chainPrecedence':
      // 0: the last event was not a (b not allowed), 1: the last event was a, 2: violated.
      return small<number>(
        acts,
        0,
        (k, s) => (k === 2 ? 2 : k === 0 ? (s === A ? 1 : s === B ? 2 : 0) : s === A ? 1 : 0),
        (k) => k !== 2,
      );
    case 'chainSuccession':
      return intersect(binary('chainResponse', a, b), binary('chainPrecedence', a, b));
    case 'notCoExistence':
      return small<[boolean, boolean]>(
        acts,
        [false, false],
        ([sa, sb], s) => [sa || s === A, sb || s === B],
        ([sa, sb]) => !(sa && sb),
      );
    case 'notSuccession':
      // 0: no a yet, 1: an a occurred (no b may follow), 2: a b followed an a.
      return small<number>(
        acts,
        0,
        (k, s) => (k === 2 ? 2 : k === 0 ? (s === A ? 1 : 0) : s === B ? 2 : 1),
        (k) => k !== 2,
      );
    case 'notChainSuccession':
      // 0: free, 1: the last event was a (b may not follow), 2: violated.
      return small<number>(
        acts,
        0,
        (k, s) => (k === 2 ? 2 : k === 0 ? (s === A ? 1 : 0) : s === B ? 2 : s === A ? 1 : 0),
        (k) => k !== 2,
      );
    case 'choice':
      return small<[boolean, boolean]>(
        acts,
        [false, false],
        ([sa, sb], s) => [sa || s === A, sb || s === B],
        ([sa, sb]) => sa || sb,
      );
    case 'exclusiveChoice':
      return small<[boolean, boolean]>(
        acts,
        [false, false],
        ([sa, sb], s) => [sa || s === A, sb || s === B],
        ([sa, sb]) => sa !== sb,
      );
    default:
      throw new Error(`${template} is not a binary template`);
  }
}

/**
 * The explicit automaton of a template over finite traces (built by hand from the meaning of the
 * template, independent of the LTLf translation).
 */
export function declareDfa(spec: DeclareSpec): Dfa {
  const problem = validateDeclare(spec);
  if (problem) throw new Error(problem);
  const a = spec.activities[0]!;
  const n = spec.n ?? defaultCount(spec.template);
  switch (spec.template) {
    case 'existence':
      return counting(a, n, (k) => k >= n);
    case 'absence':
      return counting(a, n + 1, (k) => k <= n);
    case 'exactly':
      return counting(a, n + 1, (k) => k === n);
    case 'init':
      // 0: nothing yet (an empty trace has no first event), 1: it was a, 2: it was not a.
      return small<number>(
        [a],
        0,
        (k, s) => (k === 0 ? (s === 0 ? 1 : 2) : k),
        (k) => k === 1,
      );
    case 'end':
      // The last event so far was a.
      return small<boolean>(
        [a],
        false,
        (_, s) => s === 0,
        (last) => last,
      );
    default:
      return binary(spec.template, a, spec.activities[1]!);
  }
}

// --- activations ------------------------------------------------------------------------------

export interface Activation {
  /** How often the template was triggered in the trace. */
  activations: number;
  /** How often the trigger was satisfied. */
  fulfilled: number;
}

/**
 * Counts activations and fulfilments of a template in a trace, for the templates that react to an
 * activity: for `response`-like templates every `a` is an activation that is fulfilled by a `b` (any
 * time later, before the next `a`, or right after, depending on the template); for
 * `precedence`-like templates every `b` is an activation that needs an `a` before it; the
 * `succession` templates add both. Returns `null` for templates without activation.
 */
export function declareActivation(spec: DeclareSpec, trace: readonly string[]): Activation | null {
  const [a, b] = spec.activities;
  if (a === undefined) return null;
  const n = trace.length;
  const response = (kind: 'plain' | 'alternate' | 'chain'): Activation => {
    let activations = 0;
    let fulfilled = 0;
    for (let i = 0; i < n; i += 1) {
      if (trace[i] !== a) continue;
      activations += 1;
      if (kind === 'chain') {
        if (trace[i + 1] === b) fulfilled += 1;
        continue;
      }
      for (let j = i + 1; j < n; j += 1) {
        if (trace[j] === b) {
          fulfilled += 1;
          break;
        }
        if (kind === 'alternate' && trace[j] === a) break;
      }
    }
    return { activations, fulfilled };
  };
  const precedence = (kind: 'plain' | 'alternate' | 'chain'): Activation => {
    let activations = 0;
    let fulfilled = 0;
    for (let i = 0; i < n; i += 1) {
      if (trace[i] !== b) continue;
      activations += 1;
      if (kind === 'chain') {
        if (i > 0 && trace[i - 1] === a) fulfilled += 1;
        continue;
      }
      for (let j = i - 1; j >= 0; j -= 1) {
        if (trace[j] === a) {
          fulfilled += 1;
          break;
        }
        if (kind === 'alternate' && trace[j] === b) break;
      }
    }
    return { activations, fulfilled };
  };
  const sum = (x: Activation, y: Activation): Activation => ({
    activations: x.activations + y.activations,
    fulfilled: x.fulfilled + y.fulfilled,
  });
  switch (spec.template) {
    case 'respondedExistence': {
      const activations = trace.filter((x) => x === a).length;
      return { activations, fulfilled: trace.includes(b ?? '') ? activations : 0 };
    }
    case 'response':
      return response('plain');
    case 'alternateResponse':
      return response('alternate');
    case 'chainResponse':
      return response('chain');
    case 'precedence':
      return precedence('plain');
    case 'alternatePrecedence':
      return precedence('alternate');
    case 'chainPrecedence':
      return precedence('chain');
    case 'succession':
      return sum(response('plain'), precedence('plain'));
    case 'alternateSuccession':
      return sum(response('alternate'), precedence('alternate'));
    case 'chainSuccession':
      return sum(response('chain'), precedence('chain'));
    case 'notSuccession': {
      // An a is fulfilled if no b follows it.
      let activations = 0;
      let fulfilled = 0;
      for (let i = 0; i < n; i += 1) {
        if (trace[i] !== a) continue;
        activations += 1;
        if (!trace.slice(i + 1).includes(b ?? '')) fulfilled += 1;
      }
      return { activations, fulfilled };
    }
    case 'notChainSuccession': {
      let activations = 0;
      let fulfilled = 0;
      for (let i = 0; i < n; i += 1) {
        if (trace[i] !== a) continue;
        activations += 1;
        if (trace[i + 1] !== b) fulfilled += 1;
      }
      return { activations, fulfilled };
    }
    default:
      return null;
  }
}

/** A sentence that says what the template demands. */
export function describeDeclare(spec: DeclareSpec): string {
  const [a = '?', b = '?'] = spec.activities;
  const n = spec.n ?? defaultCount(spec.template);
  const times = (k: number): string => (k === 1 ? 'once' : `${k} times`);
  switch (spec.template) {
    case 'existence':
      return `${a} occurs at least ${times(n)}.`;
    case 'absence':
      return n === 0 ? `${a} never occurs.` : `${a} occurs at most ${times(n)}.`;
    case 'exactly':
      return n === 0 ? `${a} never occurs.` : `${a} occurs exactly ${times(n)}.`;
    case 'init':
      return `${a} is the first activity.`;
    case 'end':
      return `${a} is the last activity.`;
    case 'respondedExistence':
      return `If ${a} occurs, ${b} occurs as well (before or after).`;
    case 'coExistence':
      return `${a} and ${b} occur together or not at all.`;
    case 'response':
      return `Every ${a} is eventually followed by ${b}.`;
    case 'precedence':
      return `${b} only occurs after ${a} has occurred.`;
    case 'succession':
      return `Every ${a} is eventually followed by ${b}, and ${b} only occurs after ${a}.`;
    case 'alternateResponse':
      return `After every ${a} comes a ${b} before the next ${a}.`;
    case 'alternatePrecedence':
      return `Every ${b} is preceded by an ${a}, and between two ${b} there is an ${a}.`;
    case 'alternateSuccession':
      return `${a} and ${b} alternate, starting with ${a}, and every ${a} gets its ${b}.`;
    case 'chainResponse':
      return `Every ${a} is immediately followed by ${b}.`;
    case 'chainPrecedence':
      return `Every ${b} is immediately preceded by ${a}.`;
    case 'chainSuccession':
      return `${a} is always immediately followed by ${b}, and ${b} always immediately follows ${a}.`;
    case 'notCoExistence':
      return `${a} and ${b} never occur in the same run.`;
    case 'notSuccession':
      return `${b} never occurs after ${a}.`;
    case 'notChainSuccession':
      return `${a} is never immediately followed by ${b}.`;
    case 'choice':
      return `At least one of ${a} and ${b} occurs.`;
    case 'exclusiveChoice':
      return `Exactly one of ${a} and ${b} occurs.`;
  }
}
