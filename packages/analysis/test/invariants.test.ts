import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { analyzeInvariants, minimalSemiPositive } from '../src';
import { example, ptNet, type NetSpec } from './helpers';

/** `["Buffer:1", "Buffer (free):1"]` sorted, to compare invariants independent of their order. */
const shape = (terms: Array<{ name: string; coefficient: number }>): string =>
  terms
    .map((t) => `${t.coefficient}·${t.name}`)
    .sort()
    .join(' + ');

describe('P- and T-invariants of the examples', () => {
  it('producer/consumer: three P-invariants with the capacity as complement place, one T-invariant', () => {
    // Places: Producer idle (Pi), Item ready (IR), Buffer (B, capacity 3), Consumer idle (Ci),
    // Item received (Ir). Initial: Pi = 1, Ci = 1, others 0.
    // Columns of C (Post - Pre):
    //   produce: Pi -1, IR +1           deliver: Pi +1, IR -1, B +1
    //   remove:  B -1, Ci -1, Ir +1     consume: Ir -1, Ci +1
    // y = (1,1,0,0,0): -1+1 = 0 (produce), +1-1 = 0 (deliver), 0 (remove), 0 (consume): Pi + IR = 1.
    // y = (0,0,0,1,1): remove -1+1 = 0, consume +1-1 = 0:                              Ci + Ir = 1.
    // The columns add up to zero (produce+deliver+remove+consume = 0) and have rank 3, so the left
    // kernel has dimension 5 - 3 = 2: these are the only two P-invariants of the net without its
    // capacity. The capacity 3 of Buffer is the complement place Buffer (free) with
    // B + free = 3 (initially 0 + 3), which is the third one.
    const result = analyzeInvariants(example('producer-consumer'));
    expect(result.truncated).toBe(false);
    expect(result.pInvariants.map((i) => shape(i.terms)).sort()).toEqual(
      [
        '1·Buffer + 1·Buffer (free)',
        '1·Consumer idle + 1·Item received',
        '1·Item ready + 1·Producer idle',
      ].sort(),
    );
    expect(result.pInvariants.map((i) => i.value).sort()).toEqual([1, 1, 3]);
    expect(result.tInvariants).toHaveLength(1);
    expect(shape(result.tInvariants[0]!.terms)).toBe(
      '1·consume + 1·deliver + 1·produce + 1·remove',
    );
    expect(result.coveredByPInvariants).toBe(true);
    expect(result.coveredByTInvariants).toBe(true);
    // Every place holds at most floor(value / coefficient) tokens: 1 for the four cycle places, 3 for the buffer.
    expect(result.bounds).toEqual({
      prod_idle: 1,
      prod_ready: 1,
      buffer: 3,
      cons_idle: 1,
      cons_ready: 1,
    });
  });

  it('producer/consumer without the capacity has two P-invariants and leaves the buffer uncovered', () => {
    const net = example('producer-consumer');
    const result = analyzeInvariants(net, { capacities: false });
    expect(result.pInvariants).toHaveLength(2);
    expect(result.coveredByPInvariants).toBe(false);
    const buffer = net.places.find((p) => p.name === 'Buffer')!;
    expect(result.coveredPlaces).not.toContain(buffer.id);
  });

  it('mutual exclusion: both processes keep one token and the mutex guards the critical sections', () => {
    // Each process cycles idle -> waiting -> critical -> idle: its three places hold 1 token.
    // enter takes Mutex and leave returns it, so Mutex + critical 1 + critical 2 = 1.
    // C has 7 places and 6 transitions and rank 4 (two T-invariants), so the left kernel has
    // dimension 3: these are all of them.
    const result = analyzeInvariants(example('mutual-exclusion'));
    expect(result.pInvariants.map((i) => `${shape(i.terms)} = ${i.value}`).sort()).toEqual(
      [
        '1·Mutex + 1·Process 1 critical + 1·Process 2 critical = 1',
        '1·Process 1 critical + 1·Process 1 idle + 1·Process 1 waiting = 1',
        '1·Process 2 critical + 1·Process 2 idle + 1·Process 2 waiting = 1',
      ].sort(),
    );
    expect(result.tInvariants.map((i) => shape(i.terms)).sort()).toEqual([
      '1·enter 1 + 1·leave 1 + 1·request 1',
      '1·enter 2 + 1·leave 2 + 1·request 2',
    ]);
    expect(result.coveredByPInvariants).toBe(true);
  });

  it('dining philosophers: three cycles per philosopher and three fork balances', () => {
    // Per philosopher i: thinking + has left fork + eating = 1. Fork i is free, or held as the left
    // fork of philosopher i (has left or eating) or as the right fork of philosopher i-1 (eating):
    // Fork i + has left i + eating i + eating (i-1) = 1. C is 12 x 9 with rank 9 - 3 = 6 (the three
    // philosopher cycles are the T-invariants), so the left kernel has dimension 6.
    const result = analyzeInvariants(example('dining-philosophers-3'));
    expect(result.pInvariants).toHaveLength(6);
    const text = result.pInvariants.map((i) => `${shape(i.terms)} = ${i.value}`);
    expect(text).toContain(
      '1·Fork 1 + 1·Philosopher 1 eating + 1·Philosopher 1 has left fork + 1·Philosopher 3 eating = 1',
    );
    expect(text).toContain(
      '1·Philosopher 2 eating + 1·Philosopher 2 has left fork + 1·Philosopher 2 thinking = 1',
    );
    expect(result.tInvariants).toHaveLength(3);
    expect(result.coveredByPInvariants).toBe(true);
  });

  it('traffic light: three circuits, each with one token', () => {
    // The net is a marked graph; its minimal P-invariants are the places of its circuits.
    //   A circuit through A: A green + A yellow + A red = 1.
    //   B circuit:           B green + B yellow + B red = 1.
    //   Hand-over circuit:   A green + A yellow + A may go + B may go + B green + B yellow = 1.
    // Six transitions in one cycle (the only T-invariant) give rank 5, so the kernel has dimension 8 - 5 = 3.
    const result = analyzeInvariants(example('traffic-light'));
    expect(result.pInvariants.map((i) => `${shape(i.terms)} = ${i.value}`).sort()).toEqual(
      [
        '1·A green + 1·A red + 1·A yellow = 1',
        '1·B green + 1·B red + 1·B yellow = 1',
        '1·A green + 1·A may go + 1·A yellow + 1·B green + 1·B may go + 1·B yellow = 1',
      ].sort(),
    );
    expect(result.tInvariants).toHaveLength(1);
    expect(result.tInvariants[0]!.terms).toHaveLength(6);
  });

  it('parcel center: a source transition leaves the buffer uncovered', () => {
    const result = analyzeInvariants(example('parcel-center'));
    expect(result.coveredByPInvariants).toBe(false);
    // Resources (scanner, sorter, teams) each form an invariant with themselves: Scanner is returned.
    expect(result.pInvariants.map((i) => i.equation)).toContain('1·Scanner = 2');
  });

  it('weights count: a place that is consumed twice per token produced', () => {
    // t takes 2 from p and gives 1 to q: p + 2 q = constant (2 initially).
    const net = ptNet({
      places: [['p', 2], ['q']],
      transitions: ['t'],
      arcs: [
        ['p', 't', 2],
        ['t', 'q'],
      ],
    });
    const result = analyzeInvariants(net);
    expect(result.pInvariants).toHaveLength(1);
    expect(result.pInvariants[0]!.equation).toBe('1·p + 2·q = 2');
    expect(result.bounds).toEqual({ p: 2, q: 1 });
    expect(result.tInvariants).toEqual([]);
  });

  it('JSON nets are analysed on their skeleton and say so', () => {
    const result = analyzeInvariants(example('order-processing'));
    expect(result.approximate).toBe(true);
  });
});

// --- property tests --------------------------------------------------------------------------

/** Exact rational arithmetic with bigint, enough for the oracle. */
type Fraction = { n: bigint; d: bigint };
const gcdBig = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
};
const frac = (n: bigint, d = 1n): Fraction => {
  if (d < 0n) return frac(-n, -d);
  const g = gcdBig(n, d) || 1n;
  return { n: n / g, d: d / g };
};
const sub = (a: Fraction, b: Fraction): Fraction => frac(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Fraction, b: Fraction): Fraction => frac(a.n * b.n, a.d * b.d);
const div = (a: Fraction, b: Fraction): Fraction => frac(a.n * b.d, a.d * b.n);

/**
 * The independent oracle. A semi-positive solution has minimal support exactly when the solutions
 * with that support form a line through a strictly positive vector (a second independent solution
 * would allow reaching a smaller support, and a smaller support inside the set is itself a
 * solution on that set). So for every subset of items the null space of the restricted system is
 * computed exactly; dimension 1 with a positive generator gives one minimal invariant.
 */
function oracle(matrix: number[][]): string[] {
  const items = matrix.length;
  const constraints = items === 0 ? 0 : matrix[0]!.length;
  const found: string[] = [];
  for (let mask = 1; mask < 1 << items; mask += 1) {
    const subset: number[] = [];
    for (let i = 0; i < items; i += 1) if (mask & (1 << i)) subset.push(i);
    // A is constraints x |subset|; solve A x = 0.
    const a: Fraction[][] = Array.from({ length: constraints }, (_, k) =>
      subset.map((i) => frac(BigInt(matrix[i]![k]!))),
    );
    const pivots: number[] = [];
    let row = 0;
    for (let col = 0; col < subset.length && row < constraints; col += 1) {
      let pivot = -1;
      for (let r = row; r < constraints; r += 1) {
        if (a[r]![col]!.n !== 0n) {
          pivot = r;
          break;
        }
      }
      if (pivot < 0) continue;
      [a[row], a[pivot]] = [a[pivot]!, a[row]!];
      const p = a[row]![col]!;
      a[row] = a[row]!.map((v) => div(v, p));
      for (let r = 0; r < constraints; r += 1) {
        if (r !== row && a[r]![col]!.n !== 0n) {
          const factor = a[r]![col]!;
          a[r] = a[r]!.map((v, c) => sub(v, mul(factor, a[row]![c]!)));
        }
      }
      pivots.push(col);
      row += 1;
    }
    if (subset.length - pivots.length !== 1) continue;
    const free = [...Array(subset.length).keys()].find((c) => !pivots.includes(c))!;
    const solution: Fraction[] = subset.map(() => frac(0n));
    solution[free] = frac(1n);
    pivots.forEach((col, r) => {
      solution[col] = mul(frac(-1n), a[r]![free]!);
    });
    const signs = solution.map((v) => (v.n > 0n ? 1 : v.n < 0n ? -1 : 0));
    const sign = signs[0]!;
    if (sign === 0 || signs.some((s) => s !== sign)) continue;
    let lcm = 1n;
    for (const v of solution) lcm = (lcm * v.d) / gcdBig(lcm, v.d);
    let ints = solution.map((v) => v.n * (lcm / v.d) * BigInt(sign));
    let g = 0n;
    for (const v of ints) g = gcdBig(g, v);
    ints = ints.map((v) => v / g);
    const full = new Array<bigint>(items).fill(0n);
    subset.forEach((item, k) => (full[item] = ints[k]!));
    found.push(full.join(','));
  }
  return found.sort();
}

const matrixArbitrary = fc
  .tuple(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 4 }))
  .chain(([places, transitions]) =>
    fc.tuple(
      fc.array(
        fc.array(fc.integer({ min: -2, max: 2 }), {
          minLength: transitions,
          maxLength: transitions,
        }),
        {
          minLength: places,
          maxLength: places,
        },
      ),
    ),
  )
  .map(([matrix]) => matrix);

describe('minimalSemiPositive', () => {
  it('finds exactly the minimal-support solutions of the exact oracle', () => {
    fc.assert(
      fc.property(matrixArbitrary, (matrix) => {
        const result = minimalSemiPositive(
          matrix.map((r) => r.map(BigInt)),
          {
            maxSolutions: 1000,
            maxRows: 100000,
          },
        );
        expect(result.truncated).toBe(false);
        expect(result.solutions.map((s) => s.join(',')).sort()).toEqual(oracle(matrix));
      }),
      { numRuns: 300 },
    );
  });

  it('reports truncation when the row limit is hit', () => {
    // Pairing three positive with three negative rows needs 9 rows.
    const matrix = [[1], [1], [1], [-1], [-1], [-1]].map((r) => r.map(BigInt));
    const result = minimalSemiPositive(matrix, { maxSolutions: 100, maxRows: 4 });
    expect(result.truncated).toBe(true);
  });
});

describe('analyzeInvariants on random nets', () => {
  const specArbitrary: fc.Arbitrary<NetSpec> = fc
    .tuple(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 4 }))
    .chain(([places, transitions]) =>
      fc.record({
        pre: fc.array(
          fc.array(fc.constantFrom(0, 0, 1, 2), { minLength: transitions, maxLength: transitions }),
          { minLength: places, maxLength: places },
        ),
        post: fc.array(
          fc.array(fc.constantFrom(0, 0, 1, 2), { minLength: transitions, maxLength: transitions }),
          { minLength: places, maxLength: places },
        ),
        tokens: fc.array(fc.integer({ min: 0, max: 3 }), { minLength: places, maxLength: places }),
      }),
    )
    .map(({ pre, post, tokens }) => {
      const arcs: NetSpec['arcs'] = [];
      pre.forEach((row, p) => row.forEach((w, t) => w > 0 && arcs.push([`p${p}`, `t${t}`, w])));
      post.forEach((row, p) => row.forEach((w, t) => w > 0 && arcs.push([`t${t}`, `p${p}`, w])));
      return {
        places: tokens.map((n, p): [string, number] => [`p${p}`, n]),
        transitions: pre[0]!.map((_, t) => `t${t}`),
        arcs,
      };
    });

  it('every invariant satisfies y·C = 0 (P) and C·x = 0 (T) and keeps its value in every firing', () => {
    fc.assert(
      fc.property(specArbitrary, (spec) => {
        const net = ptNet(spec);
        const result = analyzeInvariants(net, { capacities: false });
        const weight = (from: string, to: string): number =>
          net.arcs
            .filter((a) => a.source === from && a.target === to)
            .reduce((n, a) => n + a.weight, 0);
        const c = (p: string, t: string): number => weight(t, p) - weight(p, t);
        for (const invariant of result.pInvariants) {
          for (const t of net.transitions) {
            const sum = invariant.terms.reduce(
              (n, term) => n + term.coefficient * c(term.id, t.id),
              0,
            );
            expect(sum).toBe(0);
          }
          const initial = invariant.terms.reduce(
            (n, term) => n + term.coefficient * (net.marking[term.id]?.length ?? 0),
            0,
          );
          expect(initial).toBe(invariant.value);
        }
        for (const invariant of result.tInvariants) {
          for (const p of net.places) {
            const sum = invariant.terms.reduce(
              (n, term) => n + term.coefficient * c(p.id, term.id),
              0,
            );
            expect(sum).toBe(0);
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});
