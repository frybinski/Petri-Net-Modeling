/**
 * Immutable multiset over a `Map<K, number>`. Keys are compared with
 * SameValueZero (like `Map`). Every operation returns a new multiset; entries
 * with multiplicity 0 are never stored, so structural equality is well defined.
 */
export class Multiset<K> implements Iterable<[K, number]> {
  private readonly counts: ReadonlyMap<K, number>;

  private constructor(counts: ReadonlyMap<K, number>) {
    this.counts = counts;
  }

  static empty<K>(): Multiset<K> {
    return new Multiset<K>(new Map());
  }

  /** Builds a multiset from elements; each occurrence counts once. */
  static of<K>(items: Iterable<K> = []): Multiset<K> {
    const counts = new Map<K, number>();
    for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
    return new Multiset(counts);
  }

  /** Builds a multiset from `[element, multiplicity]` pairs; repeated elements are summed. */
  static fromEntries<K>(entries: Iterable<readonly [K, number]>): Multiset<K> {
    const counts = new Map<K, number>();
    for (const [key, n] of entries) {
      assertCount(n);
      if (n > 0) counts.set(key, (counts.get(key) ?? 0) + n);
    }
    return new Multiset(counts);
  }

  /** Builds a multiset from a plain record of non-negative integer counts. */
  static fromRecord(record: Readonly<Record<string, number>>): Multiset<string> {
    return Multiset.fromEntries(Object.entries(record));
  }

  /** Number of distinct elements. */
  get size(): number {
    return this.counts.size;
  }

  /** Total number of elements counted with multiplicity. */
  get cardinality(): number {
    let sum = 0;
    for (const n of this.counts.values()) sum += n;
    return sum;
  }

  /** Multiplicity of `key` (0 if absent). */
  count(key: K): number {
    return this.counts.get(key) ?? 0;
  }

  /** True if `key` occurs at least `n` times (default 1). */
  contains(key: K, n = 1): boolean {
    return this.count(key) >= n;
  }

  /** True if `other` is a sub-multiset of this multiset. */
  includes(other: Multiset<K>): boolean {
    for (const [key, n] of other.counts) {
      if (this.count(key) < n) return false;
    }
    return true;
  }

  add(key: K, n = 1): Multiset<K> {
    assertCount(n);
    if (n === 0) return this;
    const next = new Map(this.counts);
    next.set(key, this.count(key) + n);
    return new Multiset(next);
  }

  /** Removes `n` occurrences of `key`. Throws a `RangeError` if fewer than `n` are present. */
  remove(key: K, n = 1): Multiset<K> {
    assertCount(n);
    if (n === 0) return this;
    const current = this.count(key);
    if (current < n) {
      throw new RangeError(`Cannot remove ${n} of ${String(key)}: only ${current} present`);
    }
    const next = new Map(this.counts);
    if (current === n) next.delete(key);
    else next.set(key, current - n);
    return new Multiset(next);
  }

  /** Multiset sum: multiplicities are added. */
  union(other: Multiset<K>): Multiset<K> {
    const next = new Map(this.counts);
    for (const [key, n] of other.counts) next.set(key, (next.get(key) ?? 0) + n);
    return new Multiset(next);
  }

  /** Truncated difference: multiplicities are subtracted and clamped at 0. */
  difference(other: Multiset<K>): Multiset<K> {
    const next = new Map<K, number>();
    for (const [key, n] of this.counts) {
      const rest = n - other.count(key);
      if (rest > 0) next.set(key, rest);
    }
    return new Multiset(next);
  }

  equals(other: Multiset<K>): boolean {
    if (this.counts.size !== other.counts.size) return false;
    for (const [key, n] of this.counts) {
      if (other.count(key) !== n) return false;
    }
    return true;
  }

  isEmpty(): boolean {
    return this.counts.size === 0;
  }

  keys(): K[] {
    return [...this.counts.keys()];
  }

  [Symbol.iterator](): Iterator<[K, number]> {
    return this.counts.entries();
  }

  /** Plain record of counts. Only available for string-keyed multisets. */
  toRecord(this: Multiset<string>): Record<string, number> {
    return Object.fromEntries(this.counts);
  }
}

function assertCount(n: number): void {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(`Multiplicity must be a non-negative integer, got ${n}`);
  }
}
