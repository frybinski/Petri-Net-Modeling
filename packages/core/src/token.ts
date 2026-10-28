import type { JsonValue, Token } from './model';

/** True for values that are valid tokens: JSON data other than a top-level `null`. */
export function isToken(value: unknown): value is Token {
  return value !== null && isJson(value);
}

function isJson(value: unknown): value is JsonValue {
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object': {
      if (value === null) return true;
      if (Array.isArray(value)) return value.every(isJson);
      const proto: unknown = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) return false;
      return Object.values(value).every(isJson);
    }
    default:
      return false;
  }
}

function sortedKeys(object: object): string[] {
  return Object.keys(object).sort();
}

/** JSON text with sorted object keys and no whitespace. Equal tokens have equal canonical JSON. */
export function canonicalJson(token: JsonValue): string {
  if (token === null || typeof token !== 'object') return JSON.stringify(token);
  if (Array.isArray(token)) return `[${token.map(canonicalJson).join(',')}]`;
  const entries = sortedKeys(token).map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(token[key]!)}`,
  );
  return `{${entries.join(',')}}`;
}

/** Structural equality of two tokens. Object key order does not matter, array order does. */
export function tokenEquals(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => tokenEquals(item, b[index]!));
  }
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  return keysA.every(
    (key) => Object.prototype.hasOwnProperty.call(b, key) && tokenEquals(a[key]!, b[key]!),
  );
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Short single-line rendering for the canvas, at most `maxLength` characters:
 * `3`, `"A-1"`, `[1,2]`, `{id:"A-1",…}`. Longer values are cut off with `…`.
 */
export function tokenLabel(token: JsonValue, maxLength = 16): string {
  const limit = Math.max(3, maxLength);
  if (token === null || typeof token !== 'object') return clip(JSON.stringify(token), limit);
  if (Array.isArray(token))
    return clipStructure(
      token.map((item) => tokenLabel(item, limit)),
      '[',
      ']',
      limit,
    );
  const parts = Object.keys(token).map((key) => {
    const name = IDENTIFIER.test(key) ? key : JSON.stringify(key);
    return `${name}:${tokenLabel(token[key]!, limit)}`;
  });
  return clipStructure(parts, '{', '}', limit);
}

function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

/** Joins entries while they fit; if some are left out, `…` stands for them. */
function clipStructure(parts: string[], open: string, close: string, limit: number): string {
  const full = `${open}${parts.join(',')}${close}`;
  if (full.length <= limit) return full;
  let body = '';
  for (const part of parts) {
    const next = body === '' ? part : `${body},${part}`;
    // Reserve room for `,…` and the closing bracket.
    if (open.length + next.length + 2 + close.length > limit) break;
    body = next;
  }
  if (body === '') {
    const room = Math.max(1, limit - open.length - close.length - 1);
    return `${open}${clip(parts[0] ?? '', room + 1).replace(/…$/, '')}…${close}`;
  }
  return `${open}${body},…${close}`;
}

/** Compares tokens for a stable display order: numbers numerically, everything else by canonical JSON. */
export function compareTokens(a: JsonValue, b: JsonValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const left = canonicalJson(a);
  const right = canonicalJson(b);
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
