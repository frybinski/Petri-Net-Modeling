import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  LtlfSyntaxError,
  LtlfTooLarge,
  and,
  atom,
  equivalent,
  evaluateLtlf,
  formatLtlf,
  ltlfAtoms,
  ltlfToDfa,
  not,
  parseLtlf,
  type Ltlf,
} from '../src';

const holds = (formula: string, trace: string[]): boolean =>
  evaluateLtlf(parseLtlf(formula), trace);

describe('parseLtlf', () => {
  it('reads atoms as identifiers or quoted names, also with umlauts and spaces', () => {
    expect(parseLtlf('a')).toEqual(atom('a'));
    expect(parseLtlf('"Create invoice"')).toEqual(atom('Create invoice'));
    expect(parseLtlf("'it\\'s'")).toEqual(atom("it's"));
    expect(parseLtlf('Prüfen_2')).toEqual(atom('Prüfen_2'));
  });

  it('binds operators in the usual order', () => {
    // ! and the temporal prefix operators bind tightest, then U W R, then &, |, ->, <->.
    expect(formatLtlf(parseLtlf('G a -> F b'))).toBe('G a -> F b');
    expect(parseLtlf('a & b | c')).toEqual(parseLtlf('(a & b) | c'));
    expect(parseLtlf('a | b & c')).toEqual(parseLtlf('a | (b & c)'));
    expect(parseLtlf('a -> b -> c')).toEqual(parseLtlf('a -> (b -> c)'));
    expect(parseLtlf('a <-> b <-> c')).toEqual(parseLtlf('(a <-> b) <-> c'));
    expect(parseLtlf('a U b & c')).toEqual(parseLtlf('(a U b) & c'));
    expect(parseLtlf('a U b U c')).toEqual(parseLtlf('a U (b U c)'));
    expect(parseLtlf('!a U b')).toEqual(parseLtlf('(!a) U b'));
    expect(parseLtlf('F a & b')).toEqual(parseLtlf('(F a) & b'));
    expect(parseLtlf('X !a')).toEqual(parseLtlf('X (!a)'));
    expect(parseLtlf('a && b || c')).toEqual(parseLtlf('(a & b) | c'));
  });

  it('knows the operators X Xw F G U W R and the constants', () => {
    for (const text of ['X a', 'Xw a', 'F a', 'G a', 'a U b', 'a W b', 'a R b', 'true', 'false']) {
      expect(formatLtlf(parseLtlf(text))).toBe(text);
    }
  });

  it('reports the position of the problem', () => {
    const position = (text: string): number => {
      try {
        parseLtlf(text);
      } catch (error) {
        if (error instanceof LtlfSyntaxError) return error.position;
      }
      return -1;
    };
    expect(position('a &')).toBe(3);
    expect(position('(a')).toBe(2);
    expect(position('a b')).toBe(2);
    expect(position('G(a ->')).toBe(6);
    expect(position('a # b')).toBe(2);
    expect(position('"abc')).toBe(0);
    expect(position('')).toBe(0);
    expect(position('a & U b')).toBe(4);
    expect(position('F')).toBe(1);
    expect(() => parseLtlf('X')).toThrow(/Expected an activity/);
    expect(() => parseLtlf('a & F')).toThrow(LtlfSyntaxError);
  });

  it('suggests quotation marks for operator letters used as activities', () => {
    expect(() => parseLtlf('U & a')).toThrow(/quotation marks/);
    expect(parseLtlf('"F" & a')).toEqual(and(atom('F'), atom('a')));
  });

  it('lists the activities of a formula once, in order', () => {
    expect(ltlfAtoms(parseLtlf('G(a -> F (b & a)) | "c d"'))).toEqual(['a', 'b', 'c d']);
  });
});

// A random formula over three activities and the constants, up to the given depth.
const formulaArbitrary = (names: string[], depth: number): fc.Arbitrary<Ltlf> => {
  const leaf: fc.Arbitrary<Ltlf> = fc.oneof(
    fc.constantFrom(...names).map(atom),
    fc.constant<Ltlf>({ op: 'true' }),
    fc.constant<Ltlf>({ op: 'false' }),
  );
  return fc.letrec<{ tree: Ltlf }>((tie) => ({
    tree: fc.oneof(
      { depthSize: 'small', maxDepth: depth },
      leaf,
      tie('tree').map((arg): Ltlf => ({ op: 'not', arg })),
      tie('tree').map((arg): Ltlf => ({ op: 'next', arg })),
      tie('tree').map((arg): Ltlf => ({ op: 'weakNext', arg })),
      tie('tree').map((arg): Ltlf => ({ op: 'eventually', arg })),
      tie('tree').map((arg): Ltlf => ({ op: 'always', arg })),
      fc
        .tuple(
          fc.constantFrom('and', 'or', 'implies', 'iff', 'until', 'weakUntil', 'release'),
          tie('tree'),
          tie('tree'),
        )
        .map(([op, left, right]) => ({ op, left, right }) as Ltlf),
    ),
  })).tree;
};

const traceArbitrary = fc.array(fc.constantFrom('a', 'b', 'c', 'd'), { maxLength: 7 });

describe('formatLtlf', () => {
  it('prints text that parses back to the same formula', () => {
    fc.assert(
      fc.property(formulaArbitrary(['a', 'b c', 'X', 'ä'], 4), (formula) => {
        expect(parseLtlf(formatLtlf(formula))).toEqual(formula);
      }),
      { numRuns: 500 },
    );
  });
});

describe('evaluateLtlf', () => {
  // Each line was worked out by hand from the definition (positions 0..n-1, the empty rest false
  // for atoms, X, F and U, true for Xw, G, W and R).
  const table: Array<[string, string[], boolean]> = [
    ['a', ['a', 'b'], true],
    ['a', ['b', 'a'], false],
    ['a', [], false],
    ['X a', ['b', 'a'], true],
    ['X a', ['a'], false], // strong next needs a next position
    ['Xw a', ['a'], true], // weak next is true at the last position
    ['Xw a', ['a', 'b'], false],
    ['F a', ['b', 'b', 'a'], true],
    ['F a', ['b', 'b'], false],
    ['F a', [], false],
    ['G a', ['a', 'a'], true],
    ['G a', ['a', 'b'], false],
    ['G a', [], true],
    ['a U b', ['a', 'a', 'b'], true],
    ['a U b', ['a', 'a'], false], // b never comes
    ['a U b', ['b'], true],
    ['a U b', ['a', 'c', 'b'], false],
    ['a W b', ['a', 'a'], true], // weak: b need not come
    ['a W b', ['a', 'c', 'b'], false],
    ['a W b', [], true],
    ['a R b', ['b', 'b'], true], // b holds to the end
    ['a R b', ['b', 'a'], false], // at the release point b must still hold
    ['b R a', ['a', 'a', 'b'], false], // a must hold up to and including the point where b holds
    ['b R a', ['a', 'a', 'b', 'c'], false],
    ['b R (a | b)', ['a', 'a', 'b', 'c'], true],
    ['G(a -> F b)', ['a', 'c', 'b', 'a', 'b'], true],
    ['G(a -> F b)', ['a', 'b', 'a'], false],
    ['G(a -> F b)', [], true],
    ['!a W b', ['c', 'b', 'a'], true], // precedence: no a before the first b is wrong direction check
    ['F a -> F b', ['a'], false],
    ['F a <-> F b', ['c'], true],
    ['G(a -> X b)', ['a', 'b'], true],
    ['G(a -> X b)', ['a'], false],
    ['G(a -> Xw b)', ['a'], true],
    ['true', [], true],
    ['false', ['a'], false],
    ['!X true', ['a'], true], // the last position has no next
    ['Xw false', ['a', 'b'], false],
    ['F(a & Xw false)', ['b', 'a'], true], // "a is the last event"
    ['F(a & Xw false)', ['a', 'b'], false],
  ];
  it.each(table)('%s on %j is %s', (formula, trace, expected) => {
    expect(holds(formula, trace)).toBe(expected);
  });

  it('obeys the dualities of the operators on random traces', () => {
    fc.assert(
      fc.property(
        formulaArbitrary(['a', 'b', 'c'], 3),
        formulaArbitrary(['a', 'b', 'c'], 3),
        traceArbitrary,
        (f, g, trace) => {
          const value = (x: Ltlf): boolean => evaluateLtlf(x, trace);
          expect(value({ op: 'next', arg: f })).toBe(!value({ op: 'weakNext', arg: not(f) }));
          expect(value({ op: 'eventually', arg: f })).toBe(
            value({ op: 'until', left: { op: 'true' }, right: f }),
          );
          expect(value({ op: 'always', arg: f })).toBe(!value({ op: 'eventually', arg: not(f) }));
          expect(value({ op: 'release', left: f, right: g })).toBe(
            !value({ op: 'until', left: not(f), right: not(g) }),
          );
          expect(value({ op: 'weakUntil', left: f, right: g })).toBe(
            value({
              op: 'or',
              left: { op: 'until', left: f, right: g },
              right: { op: 'always', arg: f },
            }),
          );
        },
      ),
      { numRuns: 400 },
    );
  });
});

describe('ltlfToDfa', () => {
  it('agrees with the direct evaluation on random formulas and traces', () => {
    fc.assert(
      fc.property(
        formulaArbitrary(['a', 'b', 'c'], 4),
        fc.array(traceArbitrary, { minLength: 8, maxLength: 8 }),
        (formula, traces) => {
          const dfa = ltlfToDfa(formula);
          for (const trace of traces) {
            expect(dfa.accepts(trace)).toBe(evaluateLtlf(formula, trace));
          }
        },
      ),
      { numRuns: 400 },
    );
  });

  it('is minimal: equivalent formulas give automata of the same size', () => {
    const a = ltlfToDfa(parseLtlf('G(a -> F b)'));
    const b = ltlfToDfa(parseLtlf('!F(a & G !b)'));
    expect(equivalent(a, b)).toBe(true);
    expect(a.states).toBe(b.states);
    // pending a, no pending a
    expect(a.states).toBe(2);
  });

  it('knows the three states of "F a & Xw false": not yet, a seen, last event was a', () => {
    // States: initial/no a as last event (rejecting), last event was a (accepting) after F(a & end)
    const dfa = ltlfToDfa(parseLtlf('F(a & Xw false)'));
    expect(dfa.states).toBe(2);
    expect(dfa.accepts(['b', 'a'])).toBe(true);
    expect(dfa.accepts(['a', 'b'])).toBe(false);
  });

  it('treats activities that the formula does not mention as one symbol', () => {
    const dfa = ltlfToDfa(parseLtlf('F a'));
    expect(dfa.activities).toEqual(['a']);
    expect(dfa.accepts(['x', 'y', 'a'])).toBe(true);
    expect(dfa.accepts(['x', 'y'])).toBe(false);
    expect(dfa.accepts([])).toBe(false);
  });

  it('decides trivial formulas', () => {
    expect(ltlfToDfa(parseLtlf('true')).accepts(['a'])).toBe(true);
    expect(ltlfToDfa(parseLtlf('false')).accepts([])).toBe(false);
    expect(ltlfToDfa(parseLtlf('a | !a')).states).toBe(1);
  });

  it('stops with "formula too large" beyond its limits', () => {
    const many = Array.from({ length: 11 }, (_, i) => `F a${i}`).join(' & ');
    expect(() => ltlfToDfa(parseLtlf(many))).toThrow(LtlfTooLarge);
    expect(() => ltlfToDfa(parseLtlf(many))).toThrow(/formula too large/i);
    // Three independent F need 2^3 = 8 states; with a limit of 5 the construction stops.
    expect(() => ltlfToDfa(parseLtlf('F a & F b & F c'), { maxStates: 5 })).toThrow(
      /formula too large/i,
    );
    // (the search sees one more state than the minimal automaton: the start before the first event)
    expect(ltlfToDfa(parseLtlf('F a & F b & F c'), { maxStates: 9 }).states).toBe(8);
    // Ten independent F stay within the limits: 2^10 states.
    const ten = Array.from({ length: 10 }, (_, i) => `F a${i}`).join(' & ');
    expect(ltlfToDfa(parseLtlf(ten)).states).toBe(1024);
  });
});
