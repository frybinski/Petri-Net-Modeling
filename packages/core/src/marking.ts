import type { Id, Marking } from './model';

/** Token count per place. Places without an entry are empty. */
export type Counts = Record<Id, number>;

/**
 * Reduces a marking to token counts. In P/T nets only the number of tokens on a
 * place matters, so the values themselves are ignored.
 */
export function markingToCounts(marking: Marking): Counts {
  const counts: Counts = {};
  for (const [placeId, tokens] of Object.entries(marking)) {
    if (tokens.length > 0) counts[placeId] = tokens.length;
  }
  return counts;
}

/** Inverse of `markingToCounts`: each counted token becomes the value `1`. */
export function countsToMarking(counts: Counts): Marking {
  const marking: Marking = {};
  for (const [placeId, n] of Object.entries(counts)) {
    if (n > 0) marking[placeId] = Array.from({ length: n }, () => 1);
  }
  return marking;
}

export function countsEqual(a: Counts, b: Counts): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if ((a[key] ?? 0) !== (b[key] ?? 0)) return false;
  }
  return true;
}

export function totalTokens(marking: Marking): number {
  let sum = 0;
  for (const tokens of Object.values(marking)) sum += tokens.length;
  return sum;
}
