export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];

/** A token value. Any JSON value except a top-level `null`. */
export type Token = number | boolean | string | JsonObject | JsonArray;

/** Variable name (without the leading `$`) to bound token value. */
export type Bindings = Record<string, Token>;

/** A syntax or evaluation problem of an expression. Offsets are 0-based indices into the source. */
export interface ExpressionError {
  message: string;
  /** Start of the offending text. */
  position?: number;
  /** End (exclusive) of the offending text. */
  end?: number;
}

export interface EvalOptions {
  /** Wall-clock limit of one evaluation in milliseconds. Default 1000, `0` disables the limit. */
  timeoutMs?: number;
  /** Maximum evaluation depth (nested function calls). Default 500. */
  maxDepth?: number;
}

export interface CompiledExpression {
  readonly source: string;
  /** Free `$` variables the expression refers to (names without `$`, sorted, unique). */
  readonly variables: string[];
  /**
   * Evaluates the expression with the given variables. The bindings are available as `$name`
   * and, as the input document, as plain `name`. Rejects with an `ExpressionFailure` when
   * the evaluation fails (type errors, timeout, ...). Resolves to `undefined` for "no value".
   */
  evaluate(bindings: Bindings, opts?: EvalOptions): Promise<Token | undefined>;
}

export type CompileResult =
  { ok: true; expr: CompiledExpression } | { ok: false; error: ExpressionError };

export type InscriptionResult =
  { ok: true; variables: string[] } | { ok: false; error: ExpressionError };

export type GuardResult = { ok: boolean; error?: string };

export type OutputResult = { tokens: Token[] } | { error: string };
