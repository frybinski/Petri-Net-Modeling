import { describe, expect, it } from 'vitest';
import {
  HISTORY_LIMIT,
  HISTORY_WINDOW_SECONDS,
  appendHistory,
  compactHistory,
  stepLine,
  trimHistory,
  type HistoryPoint,
} from '../src';

const p = (t: number, v: number): HistoryPoint => ({ t, v });

describe('appendHistory', () => {
  it('adds points in time order', () => {
    expect(appendHistory([p(0, 0)], p(10, 5))).toEqual([p(0, 0), p(10, 5)]);
    expect(appendHistory([], p(3, 1))).toEqual([p(3, 1)]);
  });

  it('a second change at one instant is one step, and a change back leaves none', () => {
    expect(appendHistory([p(0, 0), p(10, 5)], p(10, 8))).toEqual([p(0, 0), p(10, 8)]);
    expect(appendHistory([p(0, 0), p(10, 5)], p(10, 0))).toEqual([p(0, 0)]);
  });

  it('does not repeat a value', () => {
    expect(appendHistory([p(0, 4)], p(9, 4))).toEqual([p(0, 4)]);
  });

  it('leaves its argument alone', () => {
    const points = [p(0, 0)];
    appendHistory(points, p(5, 1));
    expect(points).toEqual([p(0, 0)]);
  });
});

describe('trimHistory', () => {
  const day = [p(0, 1), p(3600, 2), p(7200, 3), p(40_000, 4)];

  it('keeps everything while the series is shorter than the window', () => {
    expect(trimHistory(day, 20_000)).toEqual(day);
  });

  it('cuts to the last eight hours and keeps the value at their start', () => {
    const now = 40_000;
    const start = now - HISTORY_WINDOW_SECONDS;
    // 11 200 s is the start; the value then was that of the point at 7200.
    expect(trimHistory(day, now)).toEqual([p(start, 3), p(40_000, 4)]);
  });
});

describe('compactHistory', () => {
  /** A saw tooth with jumps: +80 every so often, small steps in between. */
  function series(n: number): HistoryPoint[] {
    const out: HistoryPoint[] = [];
    let v = 0;
    for (let i = 0; i < n; i += 1) {
      v += i % 37 === 0 ? 80 : i % 5 === 0 ? -3 : 1;
      out.push(p(i * 10, v));
    }
    return out;
  }

  it('leaves a short series as it is', () => {
    const short = series(120);
    expect(compactHistory(short)).toEqual(short);
  });

  it('brings a long series down to the limit and keeps the order of time', () => {
    for (const n of [501, 800, 2000, 20_000]) {
      const compact = compactHistory(series(n));
      expect(compact.length).toBeLessThanOrEqual(HISTORY_LIMIT);
      for (let i = 1; i < compact.length; i += 1) {
        expect(compact[i]!.t).toBeGreaterThanOrEqual(compact[i - 1]!.t);
      }
    }
  });

  it('does not lose a jump: the highest and the lowest value stay, and the newest points are untouched', () => {
    const long = series(3000);
    const compact = compactHistory(long);
    expect(Math.max(...compact.map((q) => q.v))).toBe(Math.max(...long.map((q) => q.v)));
    expect(Math.min(...compact.map((q) => q.v))).toBe(Math.min(...long.map((q) => q.v)));
    expect(compact.slice(-250)).toEqual(long.slice(-250));
    // Repeated compaction while the series grows keeps the same promise.
    let grown: HistoryPoint[] = [];
    let high = 0;
    for (const point of long) {
      grown = compactHistory([...grown, point]);
      high = Math.max(high, point.v);
    }
    expect(Math.max(...grown.map((q) => q.v))).toBe(high);
    expect(grown.length).toBeLessThanOrEqual(HISTORY_LIMIT);
  });

  it('a window keeps its jump even if the point is in the middle of it', () => {
    const flat: HistoryPoint[] = Array.from({ length: 900 }, (_, i) => p(i, 10));
    flat[100] = p(100, 90);
    flat[101] = p(101, 10);
    const compact = compactHistory(flat);
    expect(compact.some((q) => q.v === 90)).toBe(true);
  });
});

describe('stepLine', () => {
  const rect = [100, 10, 200, 40] as const;

  it('draws a step line: the value holds until the next point, then jumps', () => {
    const line = stepLine([p(0, 0), p(100, 10)], 200, rect, 10);
    // Time 0 to 200 over x 100 to 300; value 0 to 10 over y 50 to 10.
    expect(line).toEqual([
      [100, 50],
      [200, 50],
      [200, 10],
      [300, 10],
    ]);
  });

  it('runs to the end of the time even if nothing changed', () => {
    expect(stepLine([p(0, 4)], 50, rect, 8)).toEqual([
      [100, 30],
      [300, 30],
    ]);
    expect(stepLine([], 50, rect, 8)).toEqual([]);
  });

  it('shows the last eight hours once the series is longer', () => {
    const now = 3 * HISTORY_WINDOW_SECONDS;
    const line = stepLine([p(0, 0), p(now - 100, 6)], now, rect, 6);
    expect(line[0]).toEqual([100, 50]);
    // The jump is just before the right end.
    const jump = line.find((q) => q[1] === 10)!;
    expect(jump[0]).toBeGreaterThan(299);
    for (const [x, y] of line) {
      expect(x).toBeGreaterThanOrEqual(100);
      expect(x).toBeLessThanOrEqual(300);
      expect(y).toBeGreaterThanOrEqual(10);
      expect(y).toBeLessThanOrEqual(50);
    }
  });

  it('scales to the highest value if that is above the top', () => {
    const line = stepLine([p(0, 0), p(10, 40)], 20, rect, 10);
    expect(Math.min(...line.map((q) => q[1]))).toBe(10);
  });
});
