import { describe, expect, it } from 'vitest';
import { LlmError, parseJsonLoose } from '../src';

describe('parseJsonLoose', () => {
  it('reads plain JSON', () => {
    expect(parseJsonLoose('{"a": 1}')).toEqual({ a: 1 });
    expect(parseJsonLoose('  \n{"a": [1, 2]}\n ')).toEqual({ a: [1, 2] });
  });

  it('reads JSON in a code block, with or without a language', () => {
    expect(parseJsonLoose('Here you go:\n```json\n{"a": 1}\n```\nDone.')).toEqual({ a: 1 });
    expect(parseJsonLoose('```\n{"b": 2}\n```')).toEqual({ b: 2 });
  });

  it('finds the first complete object in the text', () => {
    expect(parseJsonLoose('Sure! {"a": {"b": "}"}} hope that helps')).toEqual({ a: { b: '}' } });
    expect(parseJsonLoose('x {not json} then {"ok": true}')).toEqual({ ok: true });
  });

  it('ignores the thoughts of reasoning models', () => {
    expect(parseJsonLoose('<think>maybe {"a": 0}</think>\n{"a": 1}')).toEqual({ a: 1 });
  });

  it('throws an LlmError of kind parse if there is no JSON', () => {
    for (const text of ['', 'no json here', '{"cut": off', '```json\nnope\n```']) {
      try {
        parseJsonLoose(text);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(LlmError);
        expect((error as LlmError).kind).toBe('parse');
      }
    }
  });
});
