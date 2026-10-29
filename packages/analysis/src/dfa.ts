/**
 * A deterministic finite automaton over finite traces of activities.
 *
 * The automaton names the activities that matter (`activities`); every other activity behaves like
 * the one symbol `other`, which has the index `activities.length`. Traces are lists of activity
 * names, so the alphabet of a property is independent of the net it is checked on.
 */
export interface Dfa {
  readonly activities: readonly string[];
  readonly initial: number;
  /** Per state: does the automaton accept a trace that ends here. */
  readonly accepting: readonly boolean[];
  /** `table[state][symbol]`; symbol `activities.length` is "any other activity". */
  readonly table: readonly (readonly number[])[];
  /** Number of states. */
  readonly states: number;
  /** Index of the symbol of an activity. */
  symbol(activity: string): number;
  /** The state after reading `activity` in `state`. */
  delta(state: number, activity: string): number;
  /** True if the automaton accepts the trace. */
  accepts(trace: readonly string[]): boolean;
}

export function makeDfa(
  activities: readonly string[],
  initial: number,
  accepting: readonly boolean[],
  table: readonly (readonly number[])[],
): Dfa {
  const index = new Map<string, number>(activities.map((a, i) => [a, i]));
  const other = activities.length;
  const symbol = (activity: string): number => index.get(activity) ?? other;
  const delta = (state: number, activity: string): number => table[state]![symbol(activity)]!;
  return {
    activities,
    initial,
    accepting,
    table,
    states: accepting.length,
    symbol,
    delta,
    accepts(trace) {
      let state = initial;
      for (const activity of trace) state = delta(state, activity);
      return accepting[state]!;
    },
  };
}

/**
 * Builds the reachable part of an automaton from a step function on any state type. States are
 * identified by `key`; `limit` stops runaway constructions (the function then returns `null`).
 */
export function exploreDfa<S>(
  activities: readonly string[],
  initial: S,
  step: (state: S, symbol: number) => S,
  isAccepting: (state: S) => boolean,
  key: (state: S) => string,
  limit = Number.POSITIVE_INFINITY,
): Dfa | null {
  const symbols = activities.length + 1;
  const ids = new Map<string, number>([[key(initial), 0]]);
  const states: S[] = [initial];
  const table: number[][] = [];
  for (let i = 0; i < states.length; i += 1) {
    const row: number[] = [];
    for (let symbol = 0; symbol < symbols; symbol += 1) {
      const next = step(states[i]!, symbol);
      const k = key(next);
      let id = ids.get(k);
      if (id === undefined) {
        if (states.length >= limit) return null;
        id = states.length;
        ids.set(k, id);
        states.push(next);
      }
      row.push(id);
    }
    table.push(row);
  }
  return makeDfa(activities, 0, states.map(isAccepting), table);
}

/** The automaton over the union of both alphabets that accepts what both accept. */
export function intersect(a: Dfa, b: Dfa): Dfa {
  return product(a, b, (x, y) => x && y);
}

/** The automaton that accepts what at least one of both accepts. */
export function union(a: Dfa, b: Dfa): Dfa {
  return product(a, b, (x, y) => x || y);
}

/** The automaton that accepts exactly the traces `dfa` rejects. */
export function complement(dfa: Dfa): Dfa {
  return makeDfa(
    dfa.activities,
    dfa.initial,
    dfa.accepting.map((x) => !x),
    dfa.table,
  );
}

function product(a: Dfa, b: Dfa, combine: (x: boolean, y: boolean) => boolean): Dfa {
  const activities = [...new Set([...a.activities, ...b.activities])];
  const symbolIn = (dfa: Dfa, activity: string | undefined): number =>
    activity === undefined ? dfa.activities.length : dfa.symbol(activity);
  const pairs = (symbol: number): [number, number] => {
    const activity = activities[symbol];
    return [symbolIn(a, activity), symbolIn(b, activity)];
  };
  const result = exploreDfa<[number, number]>(
    activities,
    [a.initial, b.initial],
    ([x, y], symbol) => {
      const [sa, sb] = pairs(symbol);
      return [a.table[x]![sa]!, b.table[y]![sb]!];
    },
    ([x, y]) => combine(a.accepting[x]!, b.accepting[y]!),
    ([x, y]) => `${x},${y}`,
  );
  return result!;
}

/** Merges equivalent states (Moore's partition refinement), keeping only reachable ones. */
export function minimize(dfa: Dfa): Dfa {
  const symbols = dfa.activities.length + 1;
  // Reachable states only.
  const reachable: number[] = [dfa.initial];
  const seen = new Set<number>(reachable);
  for (let i = 0; i < reachable.length; i += 1) {
    for (const next of dfa.table[reachable[i]!]!) {
      if (!seen.has(next)) {
        seen.add(next);
        reachable.push(next);
      }
    }
  }
  let block = new Map<number, number>(reachable.map((s) => [s, dfa.accepting[s]! ? 1 : 0]));
  let count = new Set(block.values()).size;
  for (;;) {
    const signatures = new Map<string, number>();
    const next = new Map<number, number>();
    for (const state of reachable) {
      const signature = `${block.get(state)!}|${dfa.table[state]!.map((t) => block.get(t)!).join(',')}`;
      let id = signatures.get(signature);
      if (id === undefined) {
        id = signatures.size;
        signatures.set(signature, id);
      }
      next.set(state, id);
    }
    block = next;
    if (signatures.size === count) break;
    count = signatures.size;
  }
  // Number the blocks in order of first appearance from the initial state, for a stable result.
  const order = new Map<number, number>();
  const representative: number[] = [];
  const queue = [dfa.initial];
  order.set(block.get(dfa.initial)!, 0);
  representative.push(dfa.initial);
  for (let i = 0; i < queue.length; i += 1) {
    const state = queue[i]!;
    for (const target of dfa.table[state]!) {
      const b = block.get(target)!;
      if (!order.has(b)) {
        order.set(b, order.size);
        representative.push(target);
        queue.push(target);
      }
    }
  }
  const table = representative.map((state) =>
    Array.from({ length: symbols }, (_, s) => order.get(block.get(dfa.table[state]![s]!)!)!),
  );
  return makeDfa(
    dfa.activities,
    0,
    representative.map((state) => dfa.accepting[state]!),
    table,
  );
}

/**
 * True if both automata accept the same traces (over the union of their alphabets). Decided by a
 * search through the product for a pair of states that differ in acceptance.
 */
export function equivalent(a: Dfa, b: Dfa): boolean {
  const activities = [...new Set([...a.activities, ...b.activities])];
  const symbolIn = (dfa: Dfa, activity: string | undefined): number =>
    activity === undefined ? dfa.activities.length : dfa.symbol(activity);
  const seen = new Set<string>([`${a.initial},${b.initial}`]);
  const queue: Array<[number, number]> = [[a.initial, b.initial]];
  for (let i = 0; i < queue.length; i += 1) {
    const [x, y] = queue[i]!;
    if (a.accepting[x] !== b.accepting[y]) return false;
    for (let symbol = 0; symbol <= activities.length; symbol += 1) {
      const activity = activities[symbol];
      const nx = a.table[x]![symbolIn(a, activity)]!;
      const ny = b.table[y]![symbolIn(b, activity)]!;
      const key = `${nx},${ny}`;
      if (!seen.has(key)) {
        seen.add(key);
        queue.push([nx, ny]);
      }
    }
  }
  return true;
}
