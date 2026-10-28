import type { Id } from '@pnm/core';
import type { SimEvent } from '@pnm/sim';

/** How long a token takes along an arc (milliseconds of wall-clock time, whatever the speed). */
export const FLIGHT_MS = 250;

/** At most this many tokens fly at the same time; further tokens jump. */
export const MAX_FLIGHTS = 60;

/**
 * The paths along which tokens move for a batch of events: at the start of a firing from each
 * place it takes tokens from to the transition, at its end from the transition to each place it
 * puts tokens on. `pathOf(source, target)` gives the path of the arc between two nodes, if any.
 * At most `limit` paths are returned; they are taken evenly from the batch, so that a large batch
 * still shows movement all along the net.
 */
export function planFlights(
  events: readonly SimEvent[],
  pathOf: (source: Id, target: Id) => string | undefined,
  limit: number,
): string[] {
  const paths: string[] = [];
  for (const event of events) {
    if (event.type === 'start') {
      for (const ref of event.consumed) {
        const path = pathOf(ref.placeId, event.transitionId);
        if (path !== undefined) paths.push(path);
      }
    } else if (event.type === 'complete') {
      for (const ref of event.produced) {
        const path = pathOf(event.transitionId, ref.placeId);
        if (path !== undefined) paths.push(path);
      }
    }
  }
  if (paths.length <= limit) return paths;
  const picked: string[] = [];
  for (let i = 0; i < limit; i += 1) picked.push(paths[Math.floor((i * paths.length) / limit)]!);
  return picked;
}

/** Slow start, slow end. */
export function easeInOut(k: number): number {
  return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
}
