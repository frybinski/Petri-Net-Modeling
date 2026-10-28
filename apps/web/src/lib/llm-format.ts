/** Seconds with one decimal, for durations in the progress list and the log. */
export function seconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
}
