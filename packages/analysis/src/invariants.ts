import type { Id, PetriNet } from '@pnm/core';
import { gcd, normalize } from './bigint';
import { buildSkeleton, incidenceOf } from './skeleton';

/** One term of an invariant: a place (or transition) with its coefficient. */
export interface InvariantTerm {
  id: Id;
  name: string;
  coefficient: number;
  /** For a P-invariant: the term is the free capacity of this place (a complement place). */
  complementOf?: Id;
}

export interface Invariant {
  terms: InvariantTerm[];
  /** For a P-invariant `y`: the constant value `y . m0` of the weighted token sum. */
  value: number | null;
  /** The equation, for example `1·Producer idle + 1·Item ready = 1` (P) or `1·produce + 1·deliver` (T). */
  equation: string;
}

export interface InvariantOptions {
  /** Maximum number of invariants per kind. Default 500. */
  maxInvariants?: number;
  /** Maximum number of intermediate rows in the elimination. Default 20000. */
  maxRows?: number;
  /**
   * Treat the capacity of a place as a complement place whose tokens are the free capacity
   * (`m(p) + free(p) = capacity`). Without it a capacity is a restriction that no invariant sees.
   * Default true.
   */
  capacities?: boolean;
}

export interface InvariantResult {
  /** `y . C = 0`: weighted token sums that every firing preserves. */
  pInvariants: Invariant[];
  /** `C . x = 0`: firing counts that bring the net back to the marking it started from. */
  tInvariants: Invariant[];
  /** Cut off at a limit; the lists are then incomplete. */
  truncated: boolean;
  /** JSON net: computed on the skeleton, see `Skeleton`. */
  approximate: boolean;
  /** Places covered by a P-invariant with a positive coefficient. */
  coveredPlaces: Id[];
  /** The net is covered by P-invariants (every real place), hence bounded. */
  coveredByPInvariants: boolean;
  /** Upper bound of the tokens on a place that follows from the P-invariants (bounded places only). */
  bounds: Record<Id, number>;
  /** Transitions that occur in a T-invariant. */
  coveredTransitions: Id[];
  /** Every transition occurs in a T-invariant (necessary for a live and bounded net). */
  coveredByTInvariants: boolean;
  warnings: string[];
}

export const DEFAULT_MAX_INVARIANTS = 500;
const DEFAULT_MAX_ROWS = 20_000;

interface Row {
  /** The remaining constraint columns. */
  c: bigint[];
  /** The combination of the original items that produced the row. */
  y: bigint[];
  /** Bit set over the items with a non-zero coefficient. */
  support: bigint;
}

function isSubset(a: bigint, b: bigint): boolean {
  return (a & b) === a;
}

/**
 * Minimal-support semi-positive integer solutions `y >= 0`, `y != 0` of `y . M = 0` for the matrix
 * `M` with one row per item and one column per constraint (Farkas' algorithm in the form of
 * Martinez and Silva): the constraints are eliminated one at a time by adding rows with opposite
 * signs, rows whose support contains the support of another row are dropped. Solutions are
 * normalised to coprime coefficients. `truncated` is set when a limit stopped the computation.
 */
export function minimalSemiPositive(
  matrix: bigint[][],
  limits: { maxSolutions: number; maxRows: number },
): { solutions: bigint[][]; truncated: boolean } {
  const items = matrix.length;
  const constraints = items === 0 ? 0 : matrix[0]!.length;
  let rows: Row[] = matrix.map((c, i) => {
    const y = new Array<bigint>(items).fill(0n);
    y[i] = 1n;
    return { c: [...c], y, support: 1n << BigInt(i) };
  });
  let truncated = false;

  for (let j = 0; j < constraints && !truncated; j += 1) {
    const positive = rows.filter((r) => r.c[j]! > 0n);
    const negative = rows.filter((r) => r.c[j]! < 0n);
    const next: Row[] = rows.filter((r) => r.c[j]! === 0n);
    const seen = new Set<string>(next.map((r) => r.y.join(',')));
    outer: for (const a of positive) {
      for (const b of negative) {
        const ca = a.c[j]!;
        const cb = -b.c[j]!;
        const g = gcd(ca, cb);
        const fa = cb / g;
        const fb = ca / g;
        const combinedC = a.c.map((v, k) => fa * v + fb * b.c[k]!);
        const combinedY = a.y.map((v, k) => fa * v + fb * b.y[k]!);
        const factor = gcdOf([...combinedC, ...combinedY]);
        const c = factor > 1n ? combinedC.map((v) => v / factor) : combinedC;
        const y = factor > 1n ? combinedY.map((v) => v / factor) : combinedY;
        const key = y.join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        next.push({ c, y, support: a.support | b.support });
        if (next.length > limits.maxRows) {
          truncated = true;
          break outer;
        }
      }
    }
    rows = pruneNonMinimal(next);
  }

  // Rows of a cut-off elimination still have constraints left; keep only the finished ones.
  const finished = truncated ? [] : rows.filter((r) => r.c.every((v) => v === 0n));
  let solutions = pruneNonMinimal(finished)
    .map((r) => normalize(r.y))
    .sort(compareVectors);
  if (solutions.length > limits.maxSolutions) {
    solutions = solutions.slice(0, limits.maxSolutions);
    truncated = true;
  }
  return { solutions, truncated };
}

function gcdOf(values: bigint[]): bigint {
  let g = 0n;
  for (const v of values) g = gcd(g, v);
  return g;
}

/** Removes rows whose support strictly contains the support of another row. */
function pruneNonMinimal(rows: Row[]): Row[] {
  const order = [...rows].sort((a, b) => popcount(a.support) - popcount(b.support));
  const kept: Row[] = [];
  for (const row of order) {
    if (!kept.some((k) => k.support !== row.support && isSubset(k.support, row.support))) {
      kept.push(row);
    }
  }
  return kept;
}

function popcount(mask: bigint): number {
  let n = 0;
  let m = mask;
  while (m > 0n) {
    if ((m & 1n) === 1n) n += 1;
    m >>= 1n;
  }
  return n;
}

/** Smaller supports first, then lexicographic, so that the order is deterministic. */
function compareVectors(a: bigint[], b: bigint[]): number {
  const sa = a.filter((v) => v !== 0n).length;
  const sb = b.filter((v) => v !== 0n).length;
  if (sa !== sb) return sa - sb;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i]! > b[i]! ? -1 : 1;
  }
  return 0;
}

function toNumber(value: bigint): number | null {
  return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= 0n ? Number(value) : null;
}

/** `2·A + 1·B = 3`: the terms in the order of the net. */
export function formatEquation(terms: readonly InvariantTerm[], value: number | null): string {
  const left = terms.map((t) => `${t.coefficient}·${t.name}`).join(' + ');
  return value === null ? left : `${left} = ${value}`;
}

/** Place and transition invariants of the skeleton of the net. */
export function analyzeInvariants(net: PetriNet, options: InvariantOptions = {}): InvariantResult {
  const maxSolutions = options.maxInvariants ?? DEFAULT_MAX_INVARIANTS;
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  const useCapacities = options.capacities ?? true;
  const s = buildSkeleton(net);
  const warnings = [...s.warnings];
  const incidence = incidenceOf(s);

  // The items of the P-invariants: the places and one complement place per capacity.
  interface Item {
    id: Id;
    name: string;
    row: number[];
    initial: number;
    complementOf?: Id;
    real: boolean;
  }
  const items: Item[] = s.placeIds.map((id, p) => ({
    id,
    name: s.placeNames[p]!,
    row: incidence[p]!,
    initial: s.initial[p]!,
    real: true,
  }));
  if (useCapacities) {
    s.placeIds.forEach((id, p) => {
      const capacity = s.capacity[p];
      if (capacity === undefined) return;
      if (!Number.isInteger(capacity) || capacity < 1 || s.initial[p]! > capacity) {
        warnings.push(`The capacity of "${s.placeNames[p]!}" is not usable and is left out.`);
        return;
      }
      // Weak capacity rule: the free tokens move opposite to the tokens of the place.
      items.push({
        id: `${id}#free`,
        name: `${s.placeNames[p]!} (free)`,
        row: incidence[p]!.map((v) => -v),
        initial: capacity - s.initial[p]!,
        complementOf: id,
        real: false,
      });
    });
  }

  const pMatrix = items.map((item) => item.row.map((v) => BigInt(v)));
  const pSolutions = minimalSemiPositive(pMatrix, { maxSolutions, maxRows });

  const transposed: bigint[][] = s.transitionIds.map((_, t) =>
    incidence.map((row) => BigInt(row[t]!)),
  );
  const tSolutions = minimalSemiPositive(transposed, { maxSolutions, maxRows });

  let truncated = pSolutions.truncated || tSolutions.truncated;

  const pInvariants: Invariant[] = [];
  for (const solution of pSolutions.solutions) {
    const terms: InvariantTerm[] = [];
    let value = 0n;
    let safe = true;
    solution.forEach((coefficient, i) => {
      if (coefficient === 0n) return;
      const item = items[i]!;
      const number = toNumber(coefficient);
      if (number === null) {
        safe = false;
        return;
      }
      terms.push({
        id: item.id,
        name: item.name,
        coefficient: number,
        ...(item.complementOf !== undefined && { complementOf: item.complementOf }),
      });
      value += coefficient * BigInt(item.initial);
    });
    const total = toNumber(value);
    if (!safe || total === null) {
      truncated = true;
      continue;
    }
    pInvariants.push({ terms, value: total, equation: formatEquation(terms, total) });
  }

  const tInvariants: Invariant[] = [];
  for (const solution of tSolutions.solutions) {
    const terms: InvariantTerm[] = [];
    let safe = true;
    solution.forEach((coefficient, t) => {
      if (coefficient === 0n) return;
      const number = toNumber(coefficient);
      if (number === null) {
        safe = false;
        return;
      }
      terms.push({ id: s.transitionIds[t]!, name: s.transitionNames[t]!, coefficient: number });
    });
    if (!safe) {
      truncated = true;
      continue;
    }
    tInvariants.push({ terms, value: null, equation: formatEquation(terms, null) });
  }

  // Bounds: a place with coefficient y in an invariant with value v holds at most floor(v / y).
  const bounds: Record<Id, number> = {};
  for (const invariant of pInvariants) {
    for (const term of invariant.terms) {
      if (term.complementOf !== undefined || invariant.value === null) continue;
      const bound = Math.floor(invariant.value / term.coefficient);
      const known = bounds[term.id];
      if (known === undefined || bound < known) bounds[term.id] = bound;
    }
  }
  const coveredPlaces = s.placeIds.filter((id) => bounds[id] !== undefined);
  const tCovered = new Set(tInvariants.flatMap((inv) => inv.terms.map((t) => t.id)));

  return {
    pInvariants,
    tInvariants,
    truncated,
    approximate: s.approximate,
    coveredPlaces,
    coveredByPInvariants: coveredPlaces.length === s.placeIds.length && !truncated,
    bounds,
    coveredTransitions: s.transitionIds.filter((id) => tCovered.has(id)),
    coveredByTInvariants: s.transitionIds.every((id) => tCovered.has(id)) && !truncated,
    warnings,
  };
}
