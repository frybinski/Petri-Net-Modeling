import { placeRoles, type Id, type Marking, type PetriNet } from '@pnm/core';
import type { RunningView } from '@pnm/sim';

/** What the canvas shows of the firings of one transition that are under way. */
export interface RunInfo {
  /** Parallel firings of the transition. */
  count: number;
  /** Progress of the firing that finishes first, 0 to 1. */
  progress: number;
}

export type Bottleneck = 'warn' | 'crit';

/** Groups the running firings by transition. */
export function runningByTransition(
  running: readonly RunningView[],
  time: number,
): Map<Id, RunInfo> {
  const result = new Map<Id, { count: number; end: number; progress: number }>();
  for (const firing of running) {
    const span = firing.end - firing.start;
    const progress = span > 0 ? Math.min(1, Math.max(0, (time - firing.start) / span)) : 1;
    const entry = result.get(firing.transitionId);
    if (!entry) {
      result.set(firing.transitionId, { count: 1, end: firing.end, progress });
    } else {
      entry.count += 1;
      if (firing.end < entry.end) {
        entry.end = firing.end;
        entry.progress = progress;
      }
    }
  }
  return new Map([...result].map(([id, { count, progress }]) => [id, { count, progress }]));
}

/**
 * Places that hold cases and have reached the warning or critical number of waiting tokens.
 * Sources, sinks and resources are not queues and are left out.
 */
export function findBottlenecks(
  net: PetriNet,
  marking: Marking,
  warn: number,
  critical: number,
): Map<Id, Bottleneck> {
  const roles = placeRoles(net);
  const result = new Map<Id, Bottleneck>();
  for (const place of net.places) {
    if (roles.get(place.id) !== 'case') continue;
    const count = marking[place.id]?.length ?? 0;
    if (count >= critical) result.set(place.id, 'crit');
    else if (count >= warn) result.set(place.id, 'warn');
  }
  return result;
}
