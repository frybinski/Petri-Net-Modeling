/** A seedable random number generator with the distributions the simulation needs. */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  uniform(min: number, max: number): number;
  /** Exponentially distributed with the given mean. */
  exponential(mean: number): number;
  /** Index into `weights`, chosen with probability proportional to the weight. */
  pick(weights: readonly number[]): number;
  /** The internal state, to be restored with `setState`. */
  getState(): number;
  setState(state: number): void;
}

/**
 * mulberry32: a small, fast generator with 32 bits of state. Good enough for simulation
 * (not for cryptography) and fully reproducible across platforms because it uses only
 * 32-bit integer arithmetic.
 */
export function createRng(seed: number): Rng {
  let state = Math.trunc(seed) >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    uniform(min, max) {
      return min + next() * (max - min);
    },
    exponential(mean) {
      // 1 - next() lies in (0, 1], so the logarithm is finite.
      return -Math.log(1 - next()) * mean;
    },
    pick(weights) {
      let total = 0;
      for (const w of weights) total += w;
      if (!(total > 0)) return Math.min(weights.length - 1, Math.floor(next() * weights.length));
      let r = next() * total;
      for (let i = 0; i < weights.length; i += 1) {
        r -= weights[i]!;
        if (r < 0) return i;
      }
      return weights.length - 1;
    },
    getState() {
      return state;
    },
    setState(value) {
      state = value >>> 0;
    },
  };
}
