import type { TextRange } from './json-text';

/** Splits a path such as `places.q.path[0][1]` into its parts: `['places', 'q', 'path', 0, 1]`. */
export function splitPath(path: string): Array<string | number> {
  if (path === '(root)' || path === '') return [];
  const parts: Array<string | number> = [];
  const pattern = /\[(\d+)\]|([^.[\]]+)/g;
  for (const match of path.matchAll(pattern)) {
    if (match[1] !== undefined) parts.push(Number(match[1]));
    else if (match[2] !== undefined) parts.push(match[2]);
  }
  return parts;
}

/**
 * Where the value at `path` is in a JSON text. When the path leads to something that is not in the
 * text (a missing key), the range of the deepest part that exists is returned. Returns `null` for
 * text that is not JSON. The scanner is tolerant: it only needs the text to be well formed up to
 * the place it looks for.
 */
export function locateJsonPath(
  text: string,
  path: ReadonlyArray<string | number>,
): TextRange | null {
  let i = 0;
  const skipWhitespace = (): void => {
    while (i < text.length && /\s/.test(text[i] ?? '')) i += 1;
  };
  const skipString = (): boolean => {
    if (text[i] !== '"') return false;
    i += 1;
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    i += 1;
    return i <= text.length;
  };
  const skipValue = (): boolean => {
    skipWhitespace();
    const c = text[i];
    if (c === '"') return skipString();
    if (c === '{' || c === '[') {
      const close = c === '{' ? '}' : ']';
      i += 1;
      skipWhitespace();
      if (text[i] === close) {
        i += 1;
        return true;
      }
      for (;;) {
        skipWhitespace();
        if (c === '{') {
          if (!skipString()) return false;
          skipWhitespace();
          if (text[i] !== ':') return false;
          i += 1;
        }
        if (!skipValue()) return false;
        skipWhitespace();
        if (text[i] === ',') {
          i += 1;
          continue;
        }
        if (text[i] === close) {
          i += 1;
          return true;
        }
        return false;
      }
    }
    const start = i;
    while (i < text.length && /[^\s,\]}]/.test(text[i] ?? '')) i += 1;
    return i > start;
  };

  let best: TextRange | null = null;
  const walk = (index: number): TextRange | null => {
    skipWhitespace();
    if (index === path.length) {
      const from = i;
      return skipValue() ? { from, to: i } : best;
    }
    const wanted = path[index];
    const here = text[i];
    if (here === '{' && typeof wanted === 'string') {
      i += 1;
      for (;;) {
        skipWhitespace();
        if (text[i] === '}' || i >= text.length) return best;
        const keyFrom = i;
        if (!skipString()) return best;
        const keyTo = i;
        const key = text.slice(keyFrom + 1, keyTo - 1);
        skipWhitespace();
        if (text[i] !== ':') return best;
        i += 1;
        if (key === wanted) {
          best = { from: keyFrom, to: keyTo };
          return walk(index + 1);
        }
        if (!skipValue()) return best;
        skipWhitespace();
        if (text[i] === ',') i += 1;
      }
    }
    if (here === '[' && typeof wanted === 'number') {
      i += 1;
      let count = 0;
      for (;;) {
        skipWhitespace();
        if (text[i] === ']' || i >= text.length) return best;
        if (count === wanted) {
          best = { from: i, to: Math.min(text.length, i + 1) };
          return walk(index + 1);
        }
        if (!skipValue()) return best;
        count += 1;
        skipWhitespace();
        if (text[i] === ',') i += 1;
      }
    }
    return best;
  };
  const first = text.search(/\S/);
  if (first < 0) return null;
  best = { from: first, to: first + 1 };
  return walk(0);
}
