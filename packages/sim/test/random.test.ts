import { describe, expect, it } from 'vitest';
import { createRng } from '../src';

describe('rng', () => {
  it('is reproducible for a seed and differs between seeds', () => {
    const a = createRng(42);
    const b = createRng(42);
    const c = createRng(43);
    const first = Array.from({ length: 20 }, () => a.next());
    expect(Array.from({ length: 20 }, () => b.next())).toEqual(first);
    expect(Array.from({ length: 20 }, () => c.next())).not.toEqual(first);
    expect(first.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it('can save and restore its state', () => {
    const rng = createRng(7);
    rng.next();
    const state = rng.getState();
    const expected = [rng.next(), rng.next(), rng.next()];
    rng.setState(state);
    expect([rng.next(), rng.next(), rng.next()]).toEqual(expected);
  });

  it('uniform stays in range and has the right mean', () => {
    const rng = createRng(1);
    const values = Array.from({ length: 20000 }, () => rng.uniform(10, 20));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(10);
    expect(Math.max(...values)).toBeLessThan(20);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeGreaterThan(14.8);
    expect(mean).toBeLessThan(15.2);
  });

  it('exponential has the requested mean and is never negative', () => {
    const rng = createRng(2);
    const values = Array.from({ length: 40000 }, () => rng.exponential(30));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeGreaterThan(28.5);
    expect(mean).toBeLessThan(31.5);
  });

  it('pick follows the weights', () => {
    const rng = createRng(3);
    const counts = [0, 0, 0];
    for (let i = 0; i < 30000; i += 1) counts[rng.pick([1, 2, 7])]! += 1;
    expect(counts[0]! / 30000).toBeGreaterThan(0.09);
    expect(counts[0]! / 30000).toBeLessThan(0.11);
    expect(counts[1]! / 30000).toBeGreaterThan(0.19);
    expect(counts[1]! / 30000).toBeLessThan(0.21);
    expect(counts[2]! / 30000).toBeGreaterThan(0.68);
    expect(counts[2]! / 30000).toBeLessThan(0.72);
  });

  it('pick copes with all-zero weights', () => {
    expect(createRng(1).pick([0, 0])).toBeGreaterThanOrEqual(0);
  });
});
