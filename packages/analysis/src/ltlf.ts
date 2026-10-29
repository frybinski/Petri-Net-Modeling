import { exploreDfa, makeDfa, minimize, type Dfa } from './dfa';

/**
 * Linear temporal logic on finite traces (LTLf). The atoms are activities: at a position of a
 * trace exactly one activity happens, so an atom holds there if it is that activity.
 *
 * Semantics. A trace `t` of length `n` is evaluated at positions `0..n-1`. `X f` needs a next
 * position (false at the last one), `Xw f` does not (true at the last one). `f U g` needs a `g` at
 * some position; `f W g` also holds if `g` never occurs and `f` holds to the end; `F f = true U f`,
 * `G f = f W false`, `f R g = !(!f U !g)`. The empty trace is evaluated like the empty suffix
 * behind the last position: atoms, `X`, `F` and `U` are false there, `Xw`, `G`, `W` and `R` true.
 * So `G(a -> F b)` holds on the empty trace and `F a` does not.
 */
export type Ltlf =
  | { op: 'true' }
  | { op: 'false' }
  | { op: 'atom'; name: string }
  | { op: 'not'; arg: Ltlf }
  | { op: 'and'; left: Ltlf; right: Ltlf }
  | { op: 'or'; left: Ltlf; right: Ltlf }
  | { op: 'implies'; left: Ltlf; right: Ltlf }
  | { op: 'iff'; left: Ltlf; right: Ltlf }
  | { op: 'next'; arg: Ltlf }
  | { op: 'weakNext'; arg: Ltlf }
  | { op: 'eventually'; arg: Ltlf }
  | { op: 'always'; arg: Ltlf }
  | { op: 'until'; left: Ltlf; right: Ltlf }
  | { op: 'weakUntil'; left: Ltlf; right: Ltlf }
  | { op: 'release'; left: Ltlf; right: Ltlf };

/** A formula that does not parse. `position` is the offset of the problem in the text. */
export class LtlfSyntaxError extends Error {
  readonly position: number;
  constructor(message: string, position: number) {
    super(message);
    this.name = 'LtlfSyntaxError';
    this.position = position;
  }
}

/** The translation to an automaton would exceed its limits. */
export class LtlfTooLarge extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LtlfTooLarge';
  }
}

// --- constructors -----------------------------------------------------------------------------

export const T: Ltlf = { op: 'true' };
export const F: Ltlf = { op: 'false' };
export const atom = (name: string): Ltlf => ({ op: 'atom', name });
export const not = (arg: Ltlf): Ltlf => ({ op: 'not', arg });
export const and = (left: Ltlf, right: Ltlf): Ltlf => ({ op: 'and', left, right });
export const or = (left: Ltlf, right: Ltlf): Ltlf => ({ op: 'or', left, right });
export const implies = (left: Ltlf, right: Ltlf): Ltlf => ({ op: 'implies', left, right });
export const iff = (left: Ltlf, right: Ltlf): Ltlf => ({ op: 'iff', left, right });
export const next = (arg: Ltlf): Ltlf => ({ op: 'next', arg });
export const weakNext = (arg: Ltlf): Ltlf => ({ op: 'weakNext', arg });
export const eventually = (arg: Ltlf): Ltlf => ({ op: 'eventually', arg });
export const always = (arg: Ltlf): Ltlf => ({ op: 'always', arg });
export const until = (left: Ltlf, right: Ltlf): Ltlf => ({ op: 'until', left, right });
export const weakUntil = (left: Ltlf, right: Ltlf): Ltlf => ({ op: 'weakUntil', left, right });
export const release = (left: Ltlf, right: Ltlf): Ltlf => ({ op: 'release', left, right });

// --- parser -----------------------------------------------------------------------------------

type Token =
  | { kind: 'punct'; text: '(' | ')' | '!' | '&' | '|' | '->' | '<->'; start: number; end: number }
  | { kind: 'word'; text: string; start: number; end: number }
  | { kind: 'string'; text: string; start: number; end: number }
  | { kind: 'end'; start: number; end: number };

const WORD_START = /[\p{L}_]/u;
const WORD_PART = /[\p{L}\p{N}_]/u;
const KEYWORDS = new Set(['true', 'false', 'X', 'Xw', 'F', 'G', 'U', 'W', 'R']);

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const char = text[i]!;
    if (/\s/u.test(char)) {
      i += 1;
      continue;
    }
    if (text.startsWith('<->', i)) {
      tokens.push({ kind: 'punct', text: '<->', start: i, end: i + 3 });
      i += 3;
    } else if (text.startsWith('->', i)) {
      tokens.push({ kind: 'punct', text: '->', start: i, end: i + 2 });
      i += 2;
    } else if (text.startsWith('&&', i) || text.startsWith('||', i)) {
      tokens.push({ kind: 'punct', text: char as '&' | '|', start: i, end: i + 2 });
      i += 2;
    } else if ('()!&|'.includes(char)) {
      tokens.push({
        kind: 'punct',
        text: char as '(' | ')' | '!' | '&' | '|',
        start: i,
        end: i + 1,
      });
      i += 1;
    } else if (char === '"' || char === "'") {
      let j = i + 1;
      let value = '';
      for (;;) {
        if (j >= text.length) {
          throw new LtlfSyntaxError(`The quotation mark at position ${i + 1} is not closed.`, i);
        }
        const c = text[j]!;
        if (c === '\\' && j + 1 < text.length) {
          value += text[j + 1]!;
          j += 2;
        } else if (c === char) {
          j += 1;
          break;
        } else {
          value += c;
          j += 1;
        }
      }
      tokens.push({ kind: 'string', text: value, start: i, end: j });
      i = j;
    } else if (WORD_START.test(char)) {
      let j = i + 1;
      while (j < text.length && WORD_PART.test(text[j]!)) j += 1;
      tokens.push({ kind: 'word', text: text.slice(i, j), start: i, end: j });
      i = j;
    } else {
      throw new LtlfSyntaxError(
        `Unexpected character "${char}" at position ${i + 1}. Put activity names with spaces or special characters in quotation marks.`,
        i,
      );
    }
  }
  tokens.push({ kind: 'end', start: text.length, end: text.length });
  return tokens;
}

function describeToken(token: Token): string {
  if (token.kind === 'end') return 'the end of the formula';
  if (token.kind === 'string') return `"${token.text}"`;
  return `"${token.text}"`;
}

/**
 * Parses an LTLf formula. Operators from tight to loose binding: `!`, `X`, `Xw`, `F`, `G` (prefix);
 * `U`, `W`, `R` (right associative); `&`; `|`; `->` (right associative); `<->`. Atoms are
 * identifiers (letters, digits, `_`) or quoted names (`"Create invoice"`); `true` and `false` are
 * constants. Throws `LtlfSyntaxError` with the position of the problem.
 */
export function parseLtlf(text: string): Ltlf {
  const tokens = tokenize(text);
  let pos = 0;
  const peek = (): Token => tokens[pos]!;
  const isPunct = (t: Token, p: string): boolean => t.kind === 'punct' && t.text === p;
  const isWord = (t: Token, w: string): boolean => t.kind === 'word' && t.text === w;
  const fail = (message: string, token: Token): never => {
    throw new LtlfSyntaxError(`${message} (position ${token.start + 1}).`, token.start);
  };

  function parseIff(): Ltlf {
    let left = parseImplies();
    while (isPunct(peek(), '<->')) {
      pos += 1;
      left = iff(left, parseImplies());
    }
    return left;
  }
  function parseImplies(): Ltlf {
    const left = parseOr();
    if (isPunct(peek(), '->')) {
      pos += 1;
      return implies(left, parseImplies());
    }
    return left;
  }
  function parseOr(): Ltlf {
    let left = parseAnd();
    while (isPunct(peek(), '|')) {
      pos += 1;
      left = or(left, parseAnd());
    }
    return left;
  }
  function parseAnd(): Ltlf {
    let left = parseUntil();
    while (isPunct(peek(), '&')) {
      pos += 1;
      left = and(left, parseUntil());
    }
    return left;
  }
  function parseUntil(): Ltlf {
    const left = parseUnary();
    const token = peek();
    if (token.kind === 'word' && (token.text === 'U' || token.text === 'W' || token.text === 'R')) {
      pos += 1;
      const right = parseUntil();
      return token.text === 'U'
        ? until(left, right)
        : token.text === 'W'
          ? weakUntil(left, right)
          : release(left, right);
    }
    return left;
  }
  function parseUnary(): Ltlf {
    const token = peek();
    if (isPunct(token, '!')) {
      pos += 1;
      return not(parseUnary());
    }
    if (token.kind === 'word') {
      switch (token.text) {
        case 'X':
          pos += 1;
          return next(parseUnary());
        case 'Xw':
          pos += 1;
          return weakNext(parseUnary());
        case 'F':
          pos += 1;
          return eventually(parseUnary());
        case 'G':
          pos += 1;
          return always(parseUnary());
        default:
          break;
      }
    }
    return parsePrimary();
  }
  function parsePrimary(): Ltlf {
    const token = peek();
    if (isPunct(token, '(')) {
      pos += 1;
      const inner = parseIff();
      const close = peek();
      if (!isPunct(close, ')')) {
        return fail(`Expected ")" but found ${describeToken(close)}`, close);
      }
      pos += 1;
      return inner;
    }
    if (token.kind === 'string') {
      pos += 1;
      return atom(token.text);
    }
    if (token.kind === 'word') {
      if (isWord(token, 'true')) {
        pos += 1;
        return T;
      }
      if (isWord(token, 'false')) {
        pos += 1;
        return F;
      }
      if (KEYWORDS.has(token.text)) {
        return fail(
          `"${token.text}" is an operator here; put an activity of that name in quotation marks`,
          token,
        );
      }
      pos += 1;
      return atom(token.text);
    }
    return fail(
      `Expected an activity, "(" or an operator but found ${describeToken(token)}`,
      token,
    );
  }

  if (text.trim() === '') throw new LtlfSyntaxError('The formula is empty.', 0);
  const result = parseIff();
  const rest = peek();
  if (rest.kind !== 'end') {
    return fail(`Unexpected ${describeToken(rest)} after the formula`, rest);
  }
  return result;
}

// --- printer ----------------------------------------------------------------------------------

const SIMPLE_NAME = /^[\p{L}_][\p{L}\p{N}_]*$/u;

function formatAtom(name: string): string {
  if (SIMPLE_NAME.test(name) && !KEYWORDS.has(name)) return name;
  return `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

const PRECEDENCE: Record<Ltlf['op'], number> = {
  iff: 1,
  implies: 2,
  or: 3,
  and: 4,
  until: 5,
  weakUntil: 5,
  release: 5,
  not: 6,
  next: 6,
  weakNext: 6,
  eventually: 6,
  always: 6,
  true: 7,
  false: 7,
  atom: 7,
};

/** The formula as text that `parseLtlf` reads back to an equal formula. */
export function formatLtlf(formula: Ltlf): string {
  const wrap = (f: Ltlf, minimum: number): string => {
    const text = formatLtlf(f);
    return PRECEDENCE[f.op] < minimum ? `(${text})` : text;
  };
  switch (formula.op) {
    case 'true':
      return 'true';
    case 'false':
      return 'false';
    case 'atom':
      return formatAtom(formula.name);
    case 'not':
      return `!${wrap(formula.arg, 6)}`;
    case 'next':
      return `X ${wrap(formula.arg, 6)}`;
    case 'weakNext':
      return `Xw ${wrap(formula.arg, 6)}`;
    case 'eventually':
      return `F ${wrap(formula.arg, 6)}`;
    case 'always':
      return `G ${wrap(formula.arg, 6)}`;
    case 'and':
      return `${wrap(formula.left, 4)} & ${wrap(formula.right, 5)}`;
    case 'or':
      return `${wrap(formula.left, 3)} | ${wrap(formula.right, 4)}`;
    case 'implies':
      return `${wrap(formula.left, 3)} -> ${wrap(formula.right, 2)}`;
    case 'iff':
      return `${wrap(formula.left, 1)} <-> ${wrap(formula.right, 2)}`;
    case 'until':
      return `${wrap(formula.left, 6)} U ${wrap(formula.right, 5)}`;
    case 'weakUntil':
      return `${wrap(formula.left, 6)} W ${wrap(formula.right, 5)}`;
    case 'release':
      return `${wrap(formula.left, 6)} R ${wrap(formula.right, 5)}`;
  }
}

/** The distinct activities a formula mentions, in order of appearance. */
export function ltlfAtoms(formula: Ltlf): string[] {
  const atoms = new Set<string>();
  const visit = (f: Ltlf): void => {
    switch (f.op) {
      case 'true':
      case 'false':
        return;
      case 'atom':
        atoms.add(f.name);
        return;
      case 'not':
      case 'next':
      case 'weakNext':
      case 'eventually':
      case 'always':
        visit(f.arg);
        return;
      default:
        visit(f.left);
        visit(f.right);
    }
  };
  visit(formula);
  return [...atoms];
}

// --- direct evaluation ------------------------------------------------------------------------

/**
 * Truth of every subformula at every position, computed from the end of the trace backwards:
 * linear in the size of the formula times the length of the trace. Index `n` is the empty suffix.
 */
export function evaluateLtlf(formula: Ltlf, trace: readonly string[]): boolean {
  const n = trace.length;
  const memo = new Map<Ltlf, boolean[]>();
  const vector = (f: Ltlf): boolean[] => {
    const known = memo.get(f);
    if (known) return known;
    const v = new Array<boolean>(n + 1).fill(false);
    switch (f.op) {
      case 'true':
        v.fill(true);
        break;
      case 'false':
        break;
      case 'atom':
        for (let i = 0; i < n; i += 1) v[i] = trace[i] === f.name;
        break;
      case 'not': {
        const a = vector(f.arg);
        for (let i = 0; i <= n; i += 1) v[i] = !a[i];
        break;
      }
      case 'and': {
        const a = vector(f.left);
        const b = vector(f.right);
        for (let i = 0; i <= n; i += 1) v[i] = a[i]! && b[i]!;
        break;
      }
      case 'or': {
        const a = vector(f.left);
        const b = vector(f.right);
        for (let i = 0; i <= n; i += 1) v[i] = a[i]! || b[i]!;
        break;
      }
      case 'implies': {
        const a = vector(f.left);
        const b = vector(f.right);
        for (let i = 0; i <= n; i += 1) v[i] = !a[i] || b[i]!;
        break;
      }
      case 'iff': {
        const a = vector(f.left);
        const b = vector(f.right);
        for (let i = 0; i <= n; i += 1) v[i] = a[i] === b[i];
        break;
      }
      case 'next': {
        const a = vector(f.arg);
        for (let i = 0; i < n; i += 1) v[i] = i + 1 < n && a[i + 1]!;
        break;
      }
      case 'weakNext': {
        const a = vector(f.arg);
        v[n] = true;
        for (let i = 0; i < n; i += 1) v[i] = i + 1 >= n || a[i + 1]!;
        break;
      }
      case 'eventually': {
        const a = vector(f.arg);
        for (let i = n - 1; i >= 0; i -= 1) v[i] = a[i]! || v[i + 1]!;
        break;
      }
      case 'always': {
        const a = vector(f.arg);
        v[n] = true;
        for (let i = n - 1; i >= 0; i -= 1) v[i] = a[i]! && v[i + 1]!;
        break;
      }
      case 'until': {
        const l = vector(f.left);
        const r = vector(f.right);
        for (let i = n - 1; i >= 0; i -= 1) v[i] = r[i]! || (l[i]! && v[i + 1]!);
        break;
      }
      case 'weakUntil': {
        const l = vector(f.left);
        const r = vector(f.right);
        v[n] = true;
        for (let i = n - 1; i >= 0; i -= 1) v[i] = r[i]! || (l[i]! && v[i + 1]!);
        break;
      }
      case 'release': {
        const l = vector(f.left);
        const r = vector(f.right);
        v[n] = true;
        for (let i = n - 1; i >= 0; i -= 1) v[i] = r[i]! && (l[i]! || v[i + 1]!);
        break;
      }
    }
    memo.set(f, v);
    return v;
  };
  return vector(formula)[0]!;
}

// --- translation to an automaton ---------------------------------------------------------------

/**
 * Formulas in negation normal form, shared (hash-consed), that describe what the rest of a trace
 * must satisfy. `end` holds on the empty rest, `nonempty` on every other one.
 */
interface Node {
  id: number;
  kind:
    | 'true'
    | 'false'
    | 'atom'
    | 'natom'
    | 'and'
    | 'or'
    | 'next'
    | 'wnext'
    | 'until'
    | 'release'
    | 'end'
    | 'nonempty';
  name?: string;
  args: Node[];
}

function compareTerms(x: Node[], y: Node[]): number {
  for (let i = 0; i < Math.min(x.length, y.length); i += 1) {
    if (x[i]!.id !== y[i]!.id) return x[i]!.id - y[i]!.id;
  }
  return x.length - y.length;
}

class Factory {
  private readonly nodes = new Map<string, Node>();
  private counter = 0;

  readonly yes = this.make('true', []);
  readonly no = this.make('false', []);
  readonly end = this.make('end', []);
  readonly nonempty = this.make('nonempty', []);

  private make(kind: Node['kind'], args: Node[], name?: string): Node {
    const key = `${kind}|${name ?? ''}|${args.map((a) => a.id).join(',')}`;
    let node = this.nodes.get(key);
    if (!node) {
      node = { id: this.counter, kind, args, ...(name !== undefined && { name }) };
      this.counter += 1;
      this.nodes.set(key, node);
    }
    return node;
  }

  atom(name: string, negated: boolean): Node {
    return this.make(negated ? 'natom' : 'atom', [], name);
  }
  next(arg: Node): Node {
    return arg === this.no ? this.no : this.make('next', [arg]);
  }
  weakNext(arg: Node): Node {
    return arg === this.yes ? this.yes : this.make('wnext', [arg]);
  }
  until(left: Node, right: Node): Node {
    return this.make('until', [left, right]);
  }
  release(left: Node, right: Node): Node {
    return this.make('release', [left, right]);
  }

  /**
   * The disjunctive normal form of a node: a list of terms, each a sorted list of leaves (every
   * node that is not a conjunction or disjunction). `true` is one empty term, `false` no term.
   */
  private terms(node: Node): Node[][] {
    switch (node.kind) {
      case 'true':
        return [[]];
      case 'false':
        return [];
      case 'or':
        return node.args.map((arg) => (arg.kind === 'and' ? arg.args : [arg]));
      case 'and':
        return [node.args];
      default:
        return [[node]];
    }
  }

  /** Builds the node of a list of terms: absorbed, sorted and shared, so equal functions are equal nodes. */
  private fromTerms(terms: Node[][]): Node {
    const unique = new Map<string, Node[]>();
    for (const term of terms) {
      const sorted = [...new Map(term.map((leaf) => [leaf.id, leaf])).values()].sort(
        (x, y) => x.id - y.id,
      );
      // end and nonempty exclude each other.
      if (sorted.some((x) => x === this.end) && sorted.some((x) => x === this.nonempty)) continue;
      unique.set(sorted.map((leaf) => leaf.id).join(','), sorted);
    }
    const all = [...unique.values()].sort((x, y) => x.length - y.length);
    const kept: Node[][] = [];
    for (const term of all) {
      const ids = new Set(term.map((leaf) => leaf.id));
      if (!kept.some((other) => other.every((leaf) => ids.has(leaf.id)))) kept.push(term);
    }
    if (kept.length === 0) return this.no;
    if (kept.some((term) => term.length === 0)) return this.yes;
    kept.sort((x, y) => compareTerms(x, y));
    const nodes = kept.map((term) => (term.length === 1 ? term[0]! : this.make('and', term)));
    return nodes.length === 1 ? nodes[0]! : this.make('or', nodes);
  }

  /**
   * Conjunction or disjunction in a canonical form (a minimal disjunctive normal form over the
   * temporal subformulas), which keeps the number of different states finite.
   */
  junction(kind: 'and' | 'or', parts: Node[]): Node {
    if (kind === 'or') return this.fromTerms(parts.flatMap((part) => this.terms(part)));
    let product: Node[][] = [[]];
    for (const part of parts) {
      const options = this.terms(part);
      const next: Node[][] = [];
      for (const left of product) for (const right of options) next.push([...left, ...right]);
      product = this.fromTermsList(next);
      if (product.length === 0) return this.no;
    }
    return this.fromTerms(product);
  }

  /** The terms of a list after absorption (used between the steps of a product). */
  private fromTermsList(terms: Node[][]): Node[][] {
    return this.terms(this.fromTerms(terms));
  }

  and(...parts: Node[]): Node {
    return this.junction('and', parts);
  }
  or(...parts: Node[]): Node {
    return this.junction('or', parts);
  }

  /** Negation normal form of `formula`, negated if `negate` is set. */
  nnf(formula: Ltlf, negate = false): Node {
    const flip = (f: Ltlf): Node => this.nnf(f, !negate);
    const same = (f: Ltlf): Node => this.nnf(f, negate);
    switch (formula.op) {
      case 'true':
        return negate ? this.no : this.yes;
      case 'false':
        return negate ? this.yes : this.no;
      case 'atom':
        return this.atom(formula.name, negate);
      case 'not':
        return flip(formula.arg);
      case 'and':
        return negate
          ? this.or(same(formula.left), same(formula.right))
          : this.and(same(formula.left), same(formula.right));
      case 'or':
        return negate
          ? this.and(same(formula.left), same(formula.right))
          : this.or(same(formula.left), same(formula.right));
      case 'implies':
        // a -> b = !a | b ; !(a -> b) = a & !b
        return negate
          ? this.and(this.nnf(formula.left), this.nnf(formula.right, true))
          : this.or(this.nnf(formula.left, true), this.nnf(formula.right));
      case 'iff':
        // a <-> b = (a & b) | (!a & !b) ; !(a <-> b) = (a & !b) | (!a & b)
        return negate
          ? this.or(
              this.and(this.nnf(formula.left), this.nnf(formula.right, true)),
              this.and(this.nnf(formula.left, true), this.nnf(formula.right)),
            )
          : this.or(
              this.and(this.nnf(formula.left), this.nnf(formula.right)),
              this.and(this.nnf(formula.left, true), this.nnf(formula.right, true)),
            );
      case 'next':
        return negate ? this.weakNext(same(formula.arg)) : this.next(same(formula.arg));
      case 'weakNext':
        return negate ? this.next(same(formula.arg)) : this.weakNext(same(formula.arg));
      case 'eventually':
        // F f = true U f ; !F f = false R !f
        return negate
          ? this.release(this.no, same(formula.arg))
          : this.until(this.yes, same(formula.arg));
      case 'always':
        // G f = false R f ; !G f = true U !f
        return negate
          ? this.until(this.yes, same(formula.arg))
          : this.release(this.no, same(formula.arg));
      case 'until':
        // !(f U g) = !f R !g
        return negate
          ? this.release(same(formula.left), same(formula.right))
          : this.until(same(formula.left), same(formula.right));
      case 'release':
        // !(f R g) = !f U !g
        return negate
          ? this.until(same(formula.left), same(formula.right))
          : this.release(same(formula.left), same(formula.right));
      case 'weakUntil': {
        // f W g = g R (f | g) ; !(f W g) = !g U (!f & !g)
        const f = formula.left;
        const g = formula.right;
        return negate
          ? this.until(this.nnf(g, true), this.and(this.nnf(f, true), this.nnf(g, true)))
          : this.release(this.nnf(g), this.or(this.nnf(f), this.nnf(g)));
      }
    }
  }

  private readonly progressed = new Map<string, Node>();

  /**
   * What the rest of the trace must satisfy after the event `symbol` (an activity, or `null` for
   * any activity that the formula does not mention), if `node` had to hold at the event.
   */
  progress(node: Node, symbol: string | null): Node {
    const key = `${node.id}|${symbol ?? ''}|${symbol === null ? 'o' : 'a'}`;
    const known = this.progressed.get(key);
    if (known) return known;
    let result: Node;
    switch (node.kind) {
      case 'true':
      case 'false':
        result = node;
        break;
      case 'atom':
        result = symbol === node.name ? this.yes : this.no;
        break;
      case 'natom':
        result = symbol === node.name ? this.no : this.yes;
        break;
      case 'end':
        result = this.no;
        break;
      case 'nonempty':
        result = this.yes;
        break;
      case 'and':
        result = this.and(...node.args.map((a) => this.progress(a, symbol)));
        break;
      case 'or':
        result = this.or(...node.args.map((a) => this.progress(a, symbol)));
        break;
      case 'next':
        result = this.and(node.args[0]!, this.nonempty);
        break;
      case 'wnext':
        result = this.or(node.args[0]!, this.end);
        break;
      case 'until': {
        const [l, r] = node.args as [Node, Node];
        result = this.or(
          this.progress(r, symbol),
          this.and(this.progress(l, symbol), node, this.nonempty),
        );
        break;
      }
      case 'release': {
        const [l, r] = node.args as [Node, Node];
        result = this.and(
          this.progress(r, symbol),
          this.or(this.progress(l, symbol), node, this.end),
        );
        break;
      }
    }
    this.progressed.set(key, result);
    return result;
  }

  /** Does the empty rest of a trace satisfy `node`. */
  acceptsEmpty(node: Node): boolean {
    switch (node.kind) {
      case 'true':
      case 'natom':
      case 'end':
      case 'wnext':
      case 'release':
        return true;
      case 'false':
      case 'atom':
      case 'nonempty':
      case 'next':
      case 'until':
        return false;
      case 'and':
        return node.args.every((a) => this.acceptsEmpty(a));
      case 'or':
        return node.args.some((a) => this.acceptsEmpty(a));
    }
  }
}

export interface LtlfDfaOptions {
  /** Maximum number of distinct activities in the formula. Default 10. */
  maxAtoms?: number;
  /** Maximum number of states of the automaton before minimisation. Default 4096 (2^12). */
  maxStates?: number;
}

export const DEFAULT_LTLF_MAX_ATOMS = 10;
export const DEFAULT_LTLF_MAX_STATES = 4096;

/**
 * Translates a formula into a minimal automaton over finite traces. The states are the formulas
 * (in negation normal form, as sets of closure formulas combined by `&` and `|`) that the rest of
 * the trace has to satisfy: reading an event rewrites every temporal operator once ("progression"),
 * which is the subset construction over the Fischer-Ladner closure of the formula. A trace is
 * accepted if the formula that is left when it ends holds on the empty rest.
 *
 * Throws `LtlfTooLarge` ("formula too large") beyond `maxAtoms` activities or `maxStates` states.
 */
export function ltlfToDfa(formula: Ltlf, options: LtlfDfaOptions = {}): Dfa {
  const maxAtoms = options.maxAtoms ?? DEFAULT_LTLF_MAX_ATOMS;
  const maxStates = options.maxStates ?? DEFAULT_LTLF_MAX_STATES;
  const activities = ltlfAtoms(formula);
  if (activities.length > maxAtoms) {
    throw new LtlfTooLarge(
      `Formula too large: it mentions ${activities.length} activities, the limit is ${maxAtoms}.`,
    );
  }
  const factory = new Factory();
  const start = factory.nnf(formula);
  const dfa = exploreDfa<Node>(
    activities,
    start,
    (state, symbol) => factory.progress(state, activities[symbol] ?? null),
    (state) => factory.acceptsEmpty(state),
    (state) => String(state.id),
    maxStates,
  );
  if (dfa === null) {
    throw new LtlfTooLarge(`Formula too large: its automaton has more than ${maxStates} states.`);
  }
  return minimize(dfa);
}

/** The automaton that accepts every trace (a formula that always holds). */
export function trivialDfa(accepting: boolean): Dfa {
  return makeDfa([], 0, [accepting], [[0]]);
}
