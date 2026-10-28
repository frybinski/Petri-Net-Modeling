import { beforeEach, describe, expect, it } from 'vitest';
import {
  cacheSize,
  clearCache,
  compile,
  evaluateGuard,
  evaluateOutput,
  parseInputInscription,
  referencedVariables,
  tryCompile,
} from '../src';

beforeEach(() => {
  clearCache();
});

describe('compile', () => {
  it('reports syntax errors with a position', () => {
    const result = tryCompile('$o.amount >');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/end of expression/i);
      expect(result.error.position).toBe(10);
      expect(result.error.end).toBe(11);
    }
  });

  it('locates an unexpected token', () => {
    const result = tryCompile('$a $b');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.position).toBe(4);
      expect(result.error.end).toBe(5);
    }
  });

  it('rejects empty expressions', () => {
    expect(tryCompile('   ').ok).toBe(false);
    expect(() => compile('')).toThrow();
  });

  it('throws an ExpressionError from compile', () => {
    try {
      compile('1 +');
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ message: expect.stringMatching(/\S/) as string });
    }
  });
});

describe('variables', () => {
  const vars = (source: string): string[] => referencedVariables(compile(source));

  it('extracts data variables sorted and unique', () => {
    expect(vars('$b.x + $a + $a')).toEqual(['a', 'b']);
  });

  it('ignores built-in functions called or passed', () => {
    expect(vars('$count($a) + $sum($map($b, $string))')).toEqual(['a', 'b']);
  });

  it('ignores local variables and lambda parameters', () => {
    expect(vars('($z := $a; $f := function($q){$q + $z}; $f(1))')).toEqual(['a']);
  });

  it('ignores the context variables $ and $$', () => {
    expect(vars('$ = $$')).toEqual([]);
  });

  it('finds variables in object and array constructors and conditions', () => {
    expect(vars('{ "id": $o.id, "list": [$x, $y] }')).toEqual(['o', 'x', 'y']);
    expect(vars('$c ? $t : $e')).toEqual(['c', 'e', 't']);
  });
});

describe('evaluate', () => {
  it('provides $name and plain name access', async () => {
    const o = { amount: 12.5 };
    expect(await compile('$o.amount').evaluate({ o })).toBe(12.5);
    expect(await compile('o.amount').evaluate({ o })).toBe(12.5);
  });

  it('returns undefined for missing values', async () => {
    expect(await compile('$o.missing').evaluate({ o: {} })).toBeUndefined();
  });

  it('returns plain JSON without sequence markers or null prototypes', async () => {
    const value = await compile('{ "id": $o.id, "tags": ["a", "b"] }').evaluate({ o: { id: 'x' } });
    expect(value).toEqual({ id: 'x', tags: ['a', 'b'] });
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(JSON.parse(JSON.stringify(value))).toEqual(value);
  });

  it('fails for results that are not JSON', async () => {
    await expect(compile('function($x){$x}').evaluate({})).rejects.toThrow(/not a JSON value/);
  });

  it('fails for a null result', async () => {
    await expect(compile('null').evaluate({})).rejects.toThrow(/null/);
  });

  it('wraps runtime errors', async () => {
    await expect(compile('$a + $b').evaluate({ a: 1, b: 'x' })).rejects.toThrow(/number/i);
  });

  it('aborts runaway recursion by timeout', async () => {
    const expr = compile('($f := function($n){$f($n+1)}; $f(0))');
    const started = Date.now();
    await expect(expr.evaluate({}, { timeoutMs: 200, maxDepth: 1_000_000 })).rejects.toThrow(
      /timeout/i,
    );
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('aborts runaway recursion by depth', async () => {
    // Not a tail call, so the depth grows with every call.
    const expr = compile('($f := function($n){$f($n+1)+1}; $f(0))');
    await expect(expr.evaluate({}, { timeoutMs: 0 })).rejects.toThrow(/stack|recursi/i);
  });

  it('allows moderate recursion', async () => {
    const expr = compile('($f := function($n){$n=0?0:$f($n-1)+1}; $f(50))');
    expect(await expr.evaluate({})).toBe(50);
  });

  it('lets bound variables shadow built-in names', async () => {
    expect(await compile('$count + 1').evaluate({ count: 5 })).toBe(6);
  });
});

describe('evaluateGuard', () => {
  const guard = (source: string, bindings = {}) => evaluateGuard(compile(source), bindings);

  it('accepts exactly true', async () => {
    expect(await guard('$n > 1', { n: 2 })).toEqual({ ok: true });
  });

  it('rejects false without an error', async () => {
    expect(await guard('$n > 1', { n: 1 })).toEqual({ ok: false });
  });

  it('rejects undefined with an explanation', async () => {
    const result = await guard('$o.flag', { o: {} });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/undefined/);
  });

  it('rejects non-boolean values with an explanation', async () => {
    const result = await guard('$n', { n: 1 });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/true or false/);
  });

  it('turns evaluation errors into a rejected guard', async () => {
    const result = await guard('$a + $b', { a: 1, b: 'x' });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe('evaluateOutput', () => {
  const output = (source: string, bindings = {}) => evaluateOutput(compile(source), bindings);

  it('creates one token for a single value', async () => {
    expect(await output('$n + 1', { n: 1 })).toEqual({ tokens: [2] });
    expect(await output('{ "id": $o.id }', { o: { id: 'a' } })).toEqual({ tokens: [{ id: 'a' }] });
  });

  it('creates one token per array element', async () => {
    expect(await output('[1, 2, 3]')).toEqual({ tokens: [1, 2, 3] });
  });

  it('writes a single array token as a nested array', async () => {
    expect(await output('[[1, 2]]')).toEqual({ tokens: [[1, 2]] });
  });

  it('produces no tokens for an empty array', async () => {
    expect(await output('[]')).toEqual({ tokens: [] });
  });

  it('reports undefined as an error', async () => {
    expect(await output('$o.nothing', { o: {} })).toEqual({
      error: expect.stringMatching(/undefined/) as string,
    });
  });

  it('reports evaluation errors', async () => {
    expect(await output('$a + $b', { a: 1, b: 'x' })).toHaveProperty('error');
  });
});

describe('parseInputInscription', () => {
  it('parses one or more variables', () => {
    expect(parseInputInscription('$o')).toEqual({ ok: true, variables: ['o'] });
    expect(parseInputInscription(' $a ,  $b_2 ')).toEqual({ ok: true, variables: ['a', 'b_2'] });
  });

  it('treats an empty text as no variables', () => {
    expect(parseInputInscription('')).toEqual({ ok: true, variables: [] });
    expect(parseInputInscription('  ')).toEqual({ ok: true, variables: [] });
  });

  it('keeps repeated variables', () => {
    expect(parseInputInscription('$a, $a')).toEqual({ ok: true, variables: ['a', 'a'] });
  });

  it('rejects names without a dollar sign, with position', () => {
    const result = parseInputInscription('$a, b');
    expect(result).toMatchObject({ ok: false, error: { position: 4, end: 5 } });
  });

  it('rejects names starting with a digit and other junk', () => {
    expect(parseInputInscription('$1a').ok).toBe(false);
    expect(parseInputInscription('$a.b').ok).toBe(false);
    expect(parseInputInscription('$a $b').ok).toBe(false);
    expect(parseInputInscription('$').ok).toBe(false);
  });

  it('rejects empty list items', () => {
    expect(parseInputInscription('$a,').ok).toBe(false);
    expect(parseInputInscription(',$a').ok).toBe(false);
  });
});

describe('cache', () => {
  it('returns the same compiled expression for the same source', () => {
    expect(compile('$a + 1')).toBe(compile('$a + 1'));
    expect(cacheSize()).toBe(1);
  });

  it('can be cleared', () => {
    compile('$a');
    compile('$b');
    expect(cacheSize()).toBe(2);
    clearCache();
    expect(cacheSize()).toBe(0);
  });

  it('does not cache syntax errors', () => {
    tryCompile('1 +');
    expect(cacheSize()).toBe(0);
  });
});
