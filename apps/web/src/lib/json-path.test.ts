import { describe, expect, it } from 'vitest';
import { locateJsonPath, splitPath } from './json-path';

const text = `{
  "a": 1,
  "places": {
    "q": { "kind": "queue", "path": [[1, 2], [3, "x"]] }
  }
}`;

function slice(path: string): string | null {
  const range = locateJsonPath(text, splitPath(path));
  return range ? text.slice(range.from, range.to) : null;
}

describe('splitPath', () => {
  it('splits keys and indices', () => {
    expect(splitPath('places.q.path[0][1]')).toEqual(['places', 'q', 'path', 0, 1]);
    expect(splitPath('netHash')).toEqual(['netHash']);
    expect(splitPath('(root)')).toEqual([]);
  });
});

describe('locateJsonPath', () => {
  it('finds values', () => {
    expect(slice('places.q.kind')).toBe('"queue"');
    expect(slice('places.q.path[1][1]')).toBe('"x"');
    expect(slice('places.q.path[0]')).toBe('[1, 2]');
  });

  it('finds the whole document for the root', () => {
    expect(locateJsonPath(text, [])).toEqual({ from: 0, to: text.length });
  });

  it('falls back to the deepest part that exists', () => {
    expect(slice('places.q.missing')).toBe('"q"');
    expect(slice('places.ghost')).toBe('"places"');
    expect(slice('nothing')).toBe('{');
  });

  it('copes with text that is not JSON', () => {
    expect(locateJsonPath('', ['a'])).toBeNull();
    expect(locateJsonPath('{"a": ', ['a'])).not.toBeNull();
  });
});
