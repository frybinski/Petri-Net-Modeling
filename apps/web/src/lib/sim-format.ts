import type { Timing } from '@pnm/core';

/** `1:05:09` for seconds of simulation time; days are counted in hours. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** A short span of time: `45 s`, `3 min 20 s`, `1 h 05 min`. `–` for no value. */
export function formatSpan(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '–';
  const total = Math.round(seconds);
  if (total < 60) return `${total} s`;
  if (total < 3600) {
    const s = total % 60;
    return s === 0 ? `${Math.floor(total / 60)} min` : `${Math.floor(total / 60)} min ${s} s`;
  }
  const m = Math.floor((total % 3600) / 60);
  return `${Math.floor(total / 3600)} h ${String(m).padStart(2, '0')} min`;
}

function trim(n: number): string {
  return String(Number(n.toFixed(2)));
}

/** The duration of a transition for labels: `10 s`, `5–15 s`, `exp. mean 10 s`. */
export function describeTiming(timing: Timing): string {
  switch (timing.kind) {
    case 'fixed':
      return `${trim(timing.value)} s`;
    case 'uniform':
      return `${trim(timing.min)}–${trim(timing.max)} s`;
    case 'exponential':
      return `exp. mean ${trim(timing.mean)} s`;
  }
}

/** A starting duration for a kind, kept close to the values of the timing it replaces. */
export function timingOfKind(kind: Timing['kind'], previous: Timing | undefined): Timing {
  const base =
    previous === undefined
      ? 10
      : previous.kind === 'fixed'
        ? previous.value
        : previous.kind === 'uniform'
          ? (previous.min + previous.max) / 2
          : previous.mean;
  const value = base > 0 ? Number(base.toFixed(2)) : 10;
  switch (kind) {
    case 'fixed':
      return { kind, value };
    case 'uniform':
      return { kind, min: Number((value * 0.5).toFixed(2)), max: Number((value * 1.5).toFixed(2)) };
    case 'exponential':
      return { kind, mean: value };
  }
}
