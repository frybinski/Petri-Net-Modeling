import { describe, expect, it } from 'vitest';
import { describeError } from '../src/errors';

describe('describeError', () => {
  it('says what kind of error it was, not what text caused it', () => {
    const error = new SyntaxError(`Unexpected token 'x', "{"secret net": x" is not valid JSON`);
    expect(describeError(error)).toBe('SyntaxError');
    expect(describeError(new Error('the prompt was: tell me about the confidential process'))).toBe(
      'Error',
    );
  });

  it('keeps the message of an error of the system, which holds a path', () => {
    const error = Object.assign(
      new Error("ENOENT: no such file or directory, open '/data/projects/x'"),
      {
        code: 'ENOENT',
      },
    );
    expect(describeError(error)).toContain('ENOENT');
    expect(describeError(error)).toContain('/data/projects/x');
  });

  it('names the cause of a failed request', () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:443'), {
      code: 'ECONNREFUSED',
    });
    const error = new TypeError('fetch failed', { cause });
    expect(describeError(error)).toBe('TypeError (ECONNREFUSED)');
    const tls = Object.assign(new Error('unable to verify'), {
      code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    });
    expect(describeError(new TypeError('fetch failed', { cause: tls }))).toBe(
      'TypeError (UNABLE_TO_VERIFY_LEAF_SIGNATURE)',
    );
  });

  it('copes with values that are not errors', () => {
    expect(describeError('text')).toBe('non-error value thrown');
    expect(describeError(null)).toBe('non-error value thrown');
  });
});
