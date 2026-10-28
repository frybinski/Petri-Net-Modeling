import { describe, expect, it } from 'vitest';
import { describeTiming, formatClock, formatSpan, timingOfKind } from './sim-format';

describe('formatClock', () => {
  it('writes hours, minutes and seconds', () => {
    expect(formatClock(0)).toBe('00:00:00');
    expect(formatClock(59.9)).toBe('00:00:59');
    expect(formatClock(3725)).toBe('01:02:05');
    expect(formatClock(100 * 3600)).toBe('100:00:00');
    expect(formatClock(-4)).toBe('00:00:00');
  });
});

describe('formatSpan', () => {
  it('chooses the unit by size', () => {
    expect(formatSpan(12.4)).toBe('12 s');
    expect(formatSpan(60)).toBe('1m 00s');
    expect(formatSpan(200)).toBe('3m 20s');
    expect(formatSpan(3900)).toBe('1h 05m');
    expect(formatSpan(null)).toBe('–');
    expect(formatSpan(Number.NaN)).toBe('–');
  });
});

describe('timing helpers', () => {
  it('describes every kind', () => {
    expect(describeTiming({ kind: 'fixed', value: 10 })).toBe('10 s');
    expect(describeTiming({ kind: 'uniform', min: 1.5, max: 2.5 })).toBe('1.5–2.5 s');
    expect(describeTiming({ kind: 'exponential', mean: 30 })).toBe('exp. mean 30 s');
  });

  it('keeps the size of the duration when the kind changes', () => {
    expect(timingOfKind('fixed', undefined)).toEqual({ kind: 'fixed', value: 10 });
    expect(timingOfKind('uniform', { kind: 'fixed', value: 20 })).toEqual({
      kind: 'uniform',
      min: 10,
      max: 30,
    });
    expect(timingOfKind('exponential', { kind: 'uniform', min: 10, max: 30 })).toEqual({
      kind: 'exponential',
      mean: 20,
    });
    expect(timingOfKind('fixed', { kind: 'fixed', value: 0 })).toEqual({
      kind: 'fixed',
      value: 10,
    });
  });
});
