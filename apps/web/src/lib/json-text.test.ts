import { describe, expect, it } from 'vitest';
import { formatJson, parseJson } from './json-text';

describe('parseJson', () => {
  it('parses valid JSON', () => {
    expect(parseJson('{"a": [1, 2]}')).toEqual({ ok: true, value: { a: [1, 2] } });
  });

  it('reports an error range inside the text', () => {
    const text = '{ "a": 1, }';
    const result = parseJson(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.range.from).toBeGreaterThanOrEqual(0);
      expect(result.range.to).toBeLessThanOrEqual(text.length);
      expect(result.range.to).toBeGreaterThan(result.range.from);
      expect(result.message).not.toMatch(/is not valid JSON/);
    }
  });

  it('handles empty input', () => {
    const result = parseJson('');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.range).toEqual({ from: 0, to: 0 });
  });
});

describe('formatJson', () => {
  it('keeps short values on one line and indents long ones', () => {
    expect(formatJson({ a: 1 })).toBe('{"a":1}');
    expect(
      formatJson({ description: 'a fairly long value that does not fit', n: 12345 }),
    ).toContain('\n');
    expect(formatJson('x')).toBe('"x"');
  });
});
