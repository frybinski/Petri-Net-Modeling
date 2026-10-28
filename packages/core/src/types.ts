import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { ErrorObject, ValidateFunction } from 'ajv';
import type { Id, JsonValue, PetriNet, Token } from './model';
import { isToken } from './token';

export type TokenCheck = { ok: true } | { ok: false; errors: string[] };

export type CompiledType =
  { ok: true; check: (token: Token) => TokenCheck } | { ok: false; error: string };

const TYPE_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/** A type name starts with a letter and continues with letters, digits or `_`. */
export function validateTypeName(name: string): boolean {
  return TYPE_NAME.test(name);
}

/** Ready-made schemas offered by the type editor. */
export const TYPE_TEMPLATES: Readonly<Record<string, unknown>> = {
  integer: { type: 'integer' },
  number: { type: 'number' },
  string: { type: 'string' },
  boolean: { type: 'boolean' },
  unit: { const: 1 },
  object: { type: 'object', properties: {}, additionalProperties: true },
  enum: { enum: ['red', 'green', 'blue'] },
};

function formatError(error: ErrorObject): string {
  const where = error.instancePath === '' ? 'the token' : error.instancePath;
  return `${where} ${error.message ?? 'is invalid'}`;
}

function buildValidator(schema: unknown): ValidateFunction {
  // One instance per schema: schemas may declare the same `$id` and must not clash.
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  let source = schema;
  if (typeof schema === 'object' && schema !== null && '$schema' in schema) {
    // Types are always checked as JSON Schema 2020-12; a foreign `$schema` URI is not resolvable.
    const { $schema: _ignored, ...rest } = schema as Record<string, unknown>;
    source = rest;
  }
  return ajv.compile(source as object | boolean);
}

const byIdentity = new WeakMap<object, CompiledType>();
const byText = new Map<string, CompiledType>();
const TEXT_CACHE_LIMIT = 200;

function compileUncached(schema: unknown): CompiledType {
  if (
    typeof schema !== 'boolean' &&
    (typeof schema !== 'object' || schema === null || Array.isArray(schema))
  ) {
    return { ok: false, error: 'A type must be a JSON Schema object (or true/false).' };
  }
  try {
    const validate = buildValidator(schema);
    return {
      ok: true,
      check(token) {
        if (validate(token)) return { ok: true };
        return { ok: false, errors: (validate.errors ?? []).map(formatError) };
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Compiles a JSON Schema into a token checker. Results are cached per schema object
 * and per schema text, so editing a schema (which creates a new object) rebuilds it.
 */
export function compileType(schema: unknown): CompiledType {
  const isObject = typeof schema === 'object' && schema !== null;
  if (isObject) {
    const cached = byIdentity.get(schema);
    if (cached) return cached;
  }
  let text: string | undefined;
  try {
    text = JSON.stringify(schema);
  } catch {
    text = undefined;
  }
  let result = text === undefined ? undefined : byText.get(text);
  if (!result) {
    result = compileUncached(schema);
    if (text !== undefined) {
      if (byText.size >= TEXT_CACHE_LIMIT) {
        const oldest = byText.keys().next();
        if (!oldest.done) byText.delete(oldest.value);
      }
      byText.set(text, result);
    }
  }
  if (isObject) byIdentity.set(schema, result);
  return result;
}

/** Drops all cached validators. */
export function clearTypeCache(): void {
  byText.clear();
}

/**
 * Returns the checker for a place type, or `undefined` if the place is untyped or the type is
 * not defined (the missing type is a validation error, tokens are accepted meanwhile).
 * A type with an invalid schema rejects every token.
 */
export function typeChecker(
  net: PetriNet,
  typeName: string | undefined,
): ((token: Token) => TokenCheck) | undefined {
  if (typeName === undefined || !Object.hasOwn(net.types, typeName)) return undefined;
  const compiled = compileType(net.types[typeName]);
  if (!compiled.ok) {
    const errors = [`Type "${typeName}" has an invalid schema: ${compiled.error}`];
    return () => ({ ok: false, errors });
  }
  return compiled.check;
}

/** Checks a token against the type of a place. Untyped places accept every token. */
export function checkToken(net: PetriNet, placeId: Id, token: Token): TokenCheck {
  const place = net.places.find((p) => p.id === placeId);
  const check = typeChecker(net, place?.type);
  return check ? check(token) : { ok: true };
}

export type SimpleKind = 'integer' | 'number' | 'string' | 'boolean';

/** The primitive kind of a schema such as `{ "type": "integer" }`, for simple input fields. */
export function simpleKind(schema: unknown): SimpleKind | undefined {
  if (typeof schema !== 'object' || schema === null) return undefined;
  const type = (schema as { type?: unknown }).type;
  return type === 'integer' || type === 'number' || type === 'string' || type === 'boolean'
    ? type
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A plausible token for a schema, used as the starting value when a token is added.
 * Follows `const`, `default`, `enum`, the primitive kinds and required object properties;
 * everything else yields `1`, the token of a place/transition net.
 */
export function exampleToken(schema: unknown, depth = 0): Token {
  if (!isRecord(schema) || depth > 4) return 1;
  if ('const' in schema && isToken(schema.const)) return structuredClone(schema.const);
  if ('default' in schema && isToken(schema.default)) return structuredClone(schema.default);
  if (Array.isArray(schema.enum)) {
    const first = schema.enum.find(isToken);
    if (first !== undefined) return structuredClone(first);
  }
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    const alternatives = schema[key];
    if (Array.isArray(alternatives) && alternatives.length > 0) {
      return exampleToken(alternatives[0], depth + 1);
    }
  }
  const declared = schema.type;
  const type = Array.isArray(declared) ? declared.find((t) => t !== 'null') : declared;
  switch (type) {
    case 'integer':
    case 'number': {
      const minimum = typeof schema.minimum === 'number' ? Math.ceil(schema.minimum) : undefined;
      const above =
        typeof schema.exclusiveMinimum === 'number'
          ? Math.floor(schema.exclusiveMinimum) + 1
          : undefined;
      // 0 is the natural start, unless a lower bound excludes it.
      return Math.max(
        0,
        ...(minimum !== undefined && minimum > 0 ? [minimum] : []),
        ...(above !== undefined && above > 0 ? [above] : []),
      );
    }
    case 'string':
      return '';
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object': {
      const result: Record<string, JsonValue> = {};
      const properties = isRecord(schema.properties) ? schema.properties : {};
      const required = Array.isArray(schema.required) ? schema.required : [];
      for (const name of required) {
        if (typeof name === 'string') result[name] = exampleToken(properties[name], depth + 1);
      }
      return result;
    }
    default:
      return 1;
  }
}
