import jsonata from 'jsonata';
import { BUILTIN_NAMES } from './functions';
import type {
  Bindings,
  CompiledExpression,
  CompileResult,
  EvalOptions,
  ExpressionError,
  GuardResult,
  InscriptionResult,
  JsonValue,
  OutputResult,
  Token,
} from './types';

export const DEFAULT_TIMEOUT_MS = 1000;
export const DEFAULT_MAX_DEPTH = 500;

/** Thrown (as a rejection) when evaluating an expression fails. */
export class ExpressionFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpressionFailure';
  }
}

/** Shape of the errors thrown by JSONata (not an `Error` instance). */
interface JsonataThrown {
  code?: string;
  message?: string;
  position?: number;
  token?: string;
}

function asThrown(error: unknown): JsonataThrown {
  if (typeof error === 'object' && error !== null) return error as JsonataThrown;
  return { message: String(error) };
}

function syntaxError(source: string, thrown: JsonataThrown): ExpressionError {
  const message = thrown.message ?? 'Invalid expression';
  const end = thrown.position;
  if (typeof end !== 'number') return { message };
  // JSONata reports the end of the offending token; "(end)" stands for the end of the text.
  const token = thrown.token;
  const length = token === undefined || token === '(end)' ? 1 : token.length;
  const clampedEnd = Math.min(Math.max(end, 0), source.length);
  const start = Math.max(0, clampedEnd - length);
  return {
    message,
    position: start,
    end: Math.max(clampedEnd, Math.min(start + 1, source.length)),
  };
}

interface AstNode {
  type?: string;
  value?: unknown;
  procedure?: AstNode;
  [key: string]: unknown;
}

/** Collects free variable references from a JSONata AST. */
function collectVariables(ast: unknown): string[] {
  const referenced = new Set<string>();
  const declared = new Set<string>();

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    const n = node as AstNode;
    if (n.type === 'variable' && typeof n.value === 'string') {
      referenced.add(n.value);
      return;
    }
    if (n.type === 'bind') {
      // `$x := ...` declares a local variable.
      const lhs = n['lhs'] as AstNode | undefined;
      if (lhs?.type === 'variable' && typeof lhs.value === 'string') declared.add(lhs.value);
    }
    if (n.type === 'lambda') {
      for (const arg of (n['arguments'] as AstNode[] | undefined) ?? []) {
        if (arg.type === 'variable' && typeof arg.value === 'string') declared.add(arg.value);
      }
    }
    for (const [key, child] of Object.entries(n)) {
      // The callee of `$f(...)` is a function, not a data variable.
      if (key === 'procedure' && (n.type === 'function' || n.type === 'partial')) {
        const procedure = child as AstNode;
        if (procedure.type === 'variable') continue;
      }
      if (key === 'value' || key === 'type' || key === 'position') continue;
      visit(child);
    }
  };
  visit(ast);

  return [...referenced]
    .filter(
      (name) => name !== '' && name !== '$' && !declared.has(name) && !BUILTIN_NAMES.has(name),
    )
    .sort();
}

/** Converts a JSONata result into plain JSON. Rejects functions and non-finite numbers. */
function toPlainJson(value: unknown, path: string): JsonValue | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      if (!Number.isFinite(value)) throw new ExpressionFailure(`${path} is not a finite number.`);
      return value;
    case 'object': {
      if (Array.isArray(value)) {
        return value.map((item, index) => {
          const plain = toPlainJson(item, `${path}[${index}]`);
          return plain === undefined ? null : plain;
        });
      }
      const out: Record<string, JsonValue> = {};
      for (const [key, item] of Object.entries(value)) {
        const plain = toPlainJson(item, `${path}.${key}`);
        if (plain !== undefined) out[key] = plain;
      }
      return out;
    }
    default:
      throw new ExpressionFailure(`${path} is a ${typeof value}, not a JSON value.`);
  }
}

function describeFailure(error: unknown): string {
  if (error instanceof ExpressionFailure) return error.message;
  const thrown = asThrown(error);
  return thrown.message ?? 'Evaluation failed';
}

class Compiled implements CompiledExpression {
  readonly source: string;
  readonly variables: string[];
  private readonly instances = new Map<string, jsonata.Expression>();

  constructor(source: string, base: jsonata.Expression) {
    this.source = source;
    this.variables = collectVariables(base.ast());
    this.instances.set(this.key(DEFAULT_TIMEOUT_MS, DEFAULT_MAX_DEPTH), base);
  }

  private key(timeoutMs: number, maxDepth: number): string {
    return `${timeoutMs}/${maxDepth}`;
  }

  /** JSONata fixes timeout and depth when the expression is created, so each combination gets an instance. */
  private instance(timeoutMs: number, maxDepth: number): jsonata.Expression {
    const key = this.key(timeoutMs, maxDepth);
    let expression = this.instances.get(key);
    if (!expression) {
      expression = jsonata(this.source, { timeout: timeoutMs, stack: maxDepth });
      this.instances.set(key, expression);
    }
    return expression;
  }

  async evaluate(bindings: Bindings, opts: EvalOptions = {}): Promise<Token | undefined> {
    const expression = this.instance(
      opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      opts.maxDepth ?? DEFAULT_MAX_DEPTH,
    );
    let raw: unknown;
    try {
      raw = await expression.evaluate(bindings, bindings);
    } catch (error) {
      throw new ExpressionFailure(describeFailure(error));
    }
    if (raw === undefined) return undefined;
    const plain = toPlainJson(raw, 'The result');
    if (plain === null || plain === undefined) {
      throw new ExpressionFailure('The result is null; tokens must not be null.');
    }
    return plain;
  }
}

const CACHE_LIMIT = 500;
const cache = new Map<string, Compiled>();

/** Compiles an expression (cached by source text). Throws an `ExpressionError` for syntax errors. */
export function compile(source: string): CompiledExpression {
  const cached = cache.get(source);
  if (cached) return cached;
  if (source.trim() === '') {
    const error: ExpressionError = { message: 'The expression is empty.' };
    throw error;
  }
  let base: jsonata.Expression;
  try {
    base = jsonata(source, { timeout: DEFAULT_TIMEOUT_MS, stack: DEFAULT_MAX_DEPTH });
  } catch (thrown) {
    const error = syntaxError(source, asThrown(thrown));
    throw error;
  }
  const compiled = new Compiled(source, base);
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(source, compiled);
  return compiled;
}

export function tryCompile(source: string): CompileResult {
  try {
    return { ok: true, expr: compile(source) };
  } catch (thrown) {
    if (typeof thrown === 'object' && thrown !== null && 'message' in thrown) {
      return { ok: false, error: thrown as ExpressionError };
    }
    return { ok: false, error: { message: String(thrown) } };
  }
}

/** Drops all cached expressions. */
export function clearCache(): void {
  cache.clear();
}

/** Number of cached expressions (for tests and diagnostics). */
export function cacheSize(): number {
  return cache.size;
}

/** Free `$` variables of an expression (names without `$`). */
export function referencedVariables(expr: CompiledExpression): string[] {
  return expr.variables;
}

const VARIABLE = /^\$\p{L}[\p{L}\p{N}_]*$/u;

/**
 * Parses an input arc inscription: a comma separated list of variables such as `$a, $b`.
 * An empty text is valid and binds nothing. Variables are returned without `$`, in order of
 * appearance; a variable may occur more than once.
 */
export function parseInputInscription(source: string): InscriptionResult {
  if (source.trim() === '') return { ok: true, variables: [] };
  const variables: string[] = [];
  let offset = 0;
  for (const part of source.split(',')) {
    const text = part.trim();
    const start = offset + (part.length - part.trimStart().length);
    offset += part.length + 1;
    if (text === '') {
      return {
        ok: false,
        error: {
          message: 'Expected a variable such as $x between the commas.',
          position: Math.min(start, source.length),
          end: Math.min(start + 1, source.length),
        },
      };
    }
    if (!VARIABLE.test(text)) {
      return {
        ok: false,
        error: {
          message: text.startsWith('$')
            ? `"${text}" is not a valid variable name. Use a letter followed by letters, digits or _.`
            : `"${text}" is not a variable. Input inscriptions list variables such as $x, $y.`,
          position: start,
          end: start + text.length,
        },
      };
    }
    variables.push(text.slice(1));
  }
  return { ok: true, variables };
}

/** Evaluates a guard: only the result `true` counts as satisfied. */
export async function evaluateGuard(
  expr: CompiledExpression,
  bindings: Bindings,
  opts?: EvalOptions,
): Promise<GuardResult> {
  let value: Token | undefined;
  try {
    value = await expr.evaluate(bindings, opts);
  } catch (error) {
    return { ok: false, error: describeFailure(error) };
  }
  if (value === true) return { ok: true };
  if (value === undefined) return { ok: false, error: 'The guard has no value (undefined).' };
  if (value === false) return { ok: false };
  return { ok: false, error: `The guard must be true or false, not ${describeType(value)}.` };
}

/** Evaluates an output inscription: an array yields one token per element, any other value one token. */
export async function evaluateOutput(
  expr: CompiledExpression,
  bindings: Bindings,
  opts?: EvalOptions,
): Promise<OutputResult> {
  let value: Token | undefined;
  try {
    value = await expr.evaluate(bindings, opts);
  } catch (error) {
    return { error: describeFailure(error) };
  }
  if (value === undefined) {
    return { error: 'The inscription has no value (undefined). Check the variable names.' };
  }
  if (Array.isArray(value)) {
    const tokens: Token[] = [];
    for (const item of value) {
      if (item === null) return { error: 'The result contains null; tokens must not be null.' };
      tokens.push(item);
    }
    return { tokens };
  }
  return { tokens: [value] };
}

function describeType(value: Token): string {
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'object') return 'an object';
  return `a ${typeof value}`;
}
