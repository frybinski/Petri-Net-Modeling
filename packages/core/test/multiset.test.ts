import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Multiset } from '../src';

const ms = fc
  .array(fc.tuple(fc.constantFrom('a', 'b', 'c', 'd'), fc.integer({ min: 0, max: 6 })))
  .map((entries) => Multiset.fromEntries(entries));

describe('Multiset', () => {
  it('counts elements and ignores zero multiplicities', () => {
    const m = Multiset.of(['a', 'b', 'a']);
    expect(m.count('a')).toBe(2);
    expect(m.count('z')).toBe(0);
    expect(m.cardinality).toBe(3);
    expect(m.size).toBe(2);
    expect(Multiset.fromEntries([['a', 0]]).isEmpty()).toBe(true);
    expect(Multiset.empty<string>().isEmpty()).toBe(true);
  });

  it('is immutable', () => {
    const m = Multiset.of(['a']);
    m.add('a', 3);
    m.remove('a');
    expect(m.count('a')).toBe(1);
  });

  it('add and remove adjust multiplicities', () => {
    const m = Multiset.empty<string>().add('x', 3).remove('x', 2);
    expect(m.count('x')).toBe(1);
    expect(m.remove('x').isEmpty()).toBe(true);
    expect(m.add('x', 0)).toBe(m);
    expect(m.remove('x', 0)).toBe(m);
  });

  it('remove throws when too few elements are present', () => {
    expect(() => Multiset.of(['a']).remove('a', 2)).toThrow(RangeError);
    expect(() => Multiset.empty<string>().remove('a')).toThrow(RangeError);
  });

  it('rejects invalid multiplicities', () => {
    expect(() => Multiset.empty<string>().add('a', -1)).toThrow(RangeError);
    expect(() => Multiset.empty<string>().add('a', 1.5)).toThrow(RangeError);
    expect(() => Multiset.fromEntries([['a', -2]])).toThrow(RangeError);
  });

  it('contains and includes', () => {
    const m = Multiset.fromEntries([
      ['a', 2],
      ['b', 1],
    ]);
    expect(m.contains('a', 2)).toBe(true);
    expect(m.contains('a', 3)).toBe(false);
    expect(m.includes(Multiset.of(['a', 'b']))).toBe(true);
    expect(m.includes(Multiset.of(['b', 'b']))).toBe(false);
  });

  it('round-trips through records and iterates entries', () => {
    const m = Multiset.fromRecord({ p: 2, q: 0, r: 1 });
    expect(m.toRecord()).toEqual({ p: 2, r: 1 });
    expect(m.keys().sort()).toEqual(['p', 'r']);
    expect([...m].sort()).toEqual([
      ['p', 2],
      ['r', 1],
    ]);
  });

  it('union is commutative', () => {
    fc.assert(fc.property(ms, ms, (a, b) => a.union(b).equals(b.union(a))));
  });

  it('union is associative', () => {
    fc.assert(
      fc.property(ms, ms, ms, (a, b, c) =>
        a
          .union(b)
          .union(c)
          .equals(a.union(b.union(c))),
      ),
    );
  });

  it('empty is the neutral element of union', () => {
    fc.assert(fc.property(ms, (a) => a.union(Multiset.empty()).equals(a)));
  });

  it('difference after union returns the original', () => {
    fc.assert(fc.property(ms, ms, (a, b) => a.union(b).difference(b).equals(a)));
  });

  it('difference never leaves negative multiplicities and is bounded by the minuend', () => {
    fc.assert(
      fc.property(ms, ms, (a, b) => {
        const d = a.difference(b);
        return a.includes(d) && [...d].every(([, n]) => n > 0);
      }),
    );
  });

  it('cardinality is additive over union', () => {
    fc.assert(
      fc.property(ms, ms, (a, b) => a.union(b).cardinality === a.cardinality + b.cardinality),
    );
  });

  it('equals distinguishes different multisets', () => {
    expect(Multiset.of(['a']).equals(Multiset.of(['a', 'a']))).toBe(false);
    expect(Multiset.of(['a']).equals(Multiset.of(['b']))).toBe(false);
  });
});
