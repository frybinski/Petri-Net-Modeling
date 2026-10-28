import { describe, expect, it } from 'vitest';
import {
  TYPE_TEMPLATES,
  canonicalJson,
  checkToken,
  clearTypeCache,
  compileType,
  isToken,
  tokenEquals,
  tokenLabel,
  validateTypeName,
} from '../src';
import { makeJsonNet } from './helpers';

describe('validateTypeName', () => {
  it('accepts letters, digits and underscores after a letter', () => {
    for (const name of ['Order', 'a', 'Order_2', 'x1']) expect(validateTypeName(name)).toBe(true);
  });
  it('rejects everything else', () => {
    for (const name of ['', '1a', '_a', 'a-b', 'a b', 'ä$'])
      expect(validateTypeName(name)).toBe(false);
  });
});

describe('compileType', () => {
  it('compiles every template', () => {
    for (const [name, schema] of Object.entries(TYPE_TEMPLATES)) {
      expect(compileType(schema).ok, name).toBe(true);
    }
  });

  it('checks tokens against the templates', () => {
    const check = (name: string, token: Parameters<typeof tokenLabel>[0]) => {
      const compiled = compileType(TYPE_TEMPLATES[name]);
      if (!compiled.ok) throw new Error(compiled.error);
      return compiled.check(token as never).ok;
    };
    expect(check('integer', 3)).toBe(true);
    expect(check('integer', 3.5)).toBe(false);
    expect(check('number', 3.5)).toBe(true);
    expect(check('string', 'a')).toBe(true);
    expect(check('string', 1)).toBe(false);
    expect(check('boolean', false)).toBe(true);
    expect(check('unit', 1)).toBe(true);
    expect(check('unit', 2)).toBe(false);
    expect(check('object', { a: 1 })).toBe(true);
    expect(check('object', [1])).toBe(false);
    expect(check('enum', 'red')).toBe(true);
    expect(check('enum', 'pink')).toBe(false);
  });

  it('reports readable errors with the location', () => {
    const compiled = compileType({
      type: 'object',
      required: ['id'],
      properties: { amount: { type: 'number' } },
    });
    if (!compiled.ok) throw new Error(compiled.error);
    const result = compiled.check({ amount: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain("the token must have required property 'id'");
      expect(result.errors).toContain('/amount must be number');
    }
  });

  it('supports string formats', () => {
    const compiled = compileType({ type: 'string', format: 'date' });
    if (!compiled.ok) throw new Error(compiled.error);
    expect(compiled.check('2026-10-28').ok).toBe(true);
    expect(compiled.check('tomorrow').ok).toBe(false);
  });

  it('accepts boolean schemas and ignores a foreign $schema URI', () => {
    expect(compileType(true).ok).toBe(true);
    const draft7 = compileType({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'string',
    });
    expect(draft7.ok).toBe(true);
  });

  it('rejects invalid schemas with a message', () => {
    const wrongType = compileType({ type: 'strng' });
    expect(wrongType.ok).toBe(false);
    const notAnObject = compileType('string');
    expect(notAnObject).toMatchObject({ ok: false });
    expect(compileType(null).ok).toBe(false);
    expect(compileType([]).ok).toBe(false);
  });

  it('allows several schemas with the same $id', () => {
    expect(compileType({ $id: 'https://example.com/schemas/x', type: 'string' }).ok).toBe(true);
    expect(compileType({ $id: 'https://example.com/schemas/x', type: 'number' }).ok).toBe(true);
  });

  it('caches per schema object and rebuilds when the schema changes', () => {
    clearTypeCache();
    const schema = { type: 'string' };
    expect(compileType(schema)).toBe(compileType(schema));
    expect(compileType({ type: 'string' })).toBe(compileType(schema)); // same text
    const changed = compileType({ type: 'number' });
    if (!changed.ok) throw new Error(changed.error);
    expect(changed.check('a').ok).toBe(false);
    expect(changed.check(1).ok).toBe(true);
  });
});

describe('checkToken', () => {
  const net = makeJsonNet({
    types: { Int: { type: 'integer' }, Broken: { type: 'nope' } },
    places: [
      { id: 'free' },
      { id: 'int', type: 'Int' },
      { id: 'broken', type: 'Broken' },
      { id: 'lost', type: 'Gone' },
    ],
  });

  it('accepts anything on untyped places and places with missing types', () => {
    expect(checkToken(net, 'free', { a: 1 })).toEqual({ ok: true });
    expect(checkToken(net, 'lost', 'x')).toEqual({ ok: true });
    expect(checkToken(net, 'nowhere', 'x')).toEqual({ ok: true });
  });

  it('checks typed places', () => {
    expect(checkToken(net, 'int', 1)).toEqual({ ok: true });
    expect(checkToken(net, 'int', 'x').ok).toBe(false);
  });

  it('rejects every token when the type schema is invalid', () => {
    const result = checkToken(net, 'broken', 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/invalid schema/);
  });
});

describe('token helpers', () => {
  it('tokenEquals compares structurally', () => {
    expect(tokenEquals({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(tokenEquals([1, 2], [2, 1])).toBe(false);
    expect(tokenEquals({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(tokenEquals(1, '1')).toBe(false);
    expect(tokenEquals([], {})).toBe(false);
    expect(tokenEquals({ a: null }, { a: null })).toBe(true);
    expect(tokenEquals({ a: 1 }, { b: 1 })).toBe(false);
  });

  it('canonicalJson sorts keys', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: 'x' } })).toBe(
      '{"a":{"c":"x","d":[1,{"y":2,"z":1}]},"b":1}',
    );
  });

  it('isToken rejects null, functions and non-finite numbers', () => {
    expect(isToken(null)).toBe(false);
    expect(isToken(undefined)).toBe(false);
    expect(isToken(NaN)).toBe(false);
    expect(isToken(() => 1)).toBe(false);
    expect(isToken({ a: undefined })).toBe(false);
    expect(isToken(new Date())).toBe(false);
    expect(isToken({ a: null, b: [1, 'x', true] })).toBe(true);
    expect(isToken(0)).toBe(true);
    expect(isToken('')).toBe(true);
  });

  it('tokenLabel renders short labels', () => {
    expect(tokenLabel(3)).toBe('3');
    expect(tokenLabel(true)).toBe('true');
    expect(tokenLabel('A-1')).toBe('"A-1"');
    expect(tokenLabel([1, 2])).toBe('[1,2]');
    expect(tokenLabel({ id: 'A-1' })).toBe('{id:"A-1"}');
    expect(tokenLabel({ 'a b': 1 })).toBe('{"a b":1}');
  });

  it('tokenLabel shortens long values within the limit', () => {
    const label = tokenLabel({ id: 'A-1', amount: 12.5, customer: 'c1' }, 16);
    expect(label.length).toBeLessThanOrEqual(16);
    expect(label.startsWith('{id:"A-1"')).toBe(true);
    expect(label.endsWith('…}')).toBe(true);
    const text = tokenLabel('a very long string value indeed', 10);
    expect(text.length).toBe(10);
    expect(text.endsWith('…')).toBe(true);
    expect(tokenLabel([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 8).length).toBeLessThanOrEqual(8);
  });
});
