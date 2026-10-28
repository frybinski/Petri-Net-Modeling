import type { Id } from '@pnm/core';
import type { SimEvent } from '@pnm/sim';

/** One event in the life of a case. */
export interface TrailEntry {
  eventId: number;
  /** Simulation seconds. */
  t: number;
  type: 'spawn' | 'start' | 'complete';
  /** The transition of the event; a case of the initial marking has none. */
  transitionId?: Id;
  firingId?: number;
}

/** The events of the stream that concern one case, in order. */
export function caseTrail(events: readonly SimEvent[], caseId: string): TrailEntry[] {
  const trail: TrailEntry[] = [];
  for (const event of events) {
    if (event.type === 'spawn') {
      if (event.caseId !== caseId) continue;
      trail.push({
        eventId: event.id,
        t: event.t,
        type: 'spawn',
        ...(event.transitionId !== undefined && { transitionId: event.transitionId }),
      });
    } else if (event.type === 'start' || event.type === 'complete') {
      if (!event.caseIds.includes(caseId)) continue;
      trail.push({
        eventId: event.id,
        t: event.t,
        type: event.type,
        transitionId: event.transitionId,
        firingId: event.firingId,
      });
    }
  }
  return trail;
}

/** A step of a case at a transition. `end` is missing while the firing is under way. */
export interface Activity {
  transitionId: Id;
  firingId: number;
  start: number;
  end?: number;
}

/** The activities of a case: its firings, each from `start` to `complete`. */
export function caseActivities(trail: readonly TrailEntry[]): Activity[] {
  const activities: Activity[] = [];
  const open = new Map<number, Activity>();
  for (const entry of trail) {
    if (
      entry.type === 'start' &&
      entry.transitionId !== undefined &&
      entry.firingId !== undefined
    ) {
      const activity: Activity = {
        transitionId: entry.transitionId,
        firingId: entry.firingId,
        start: entry.t,
      };
      open.set(entry.firingId, activity);
      activities.push(activity);
    } else if (entry.type === 'complete' && entry.firingId !== undefined) {
      const activity = open.get(entry.firingId);
      if (activity) activity.end = entry.t;
    }
  }
  return activities;
}

/** The transitions a case has been at, in order of their first visit. */
export function visitedTransitions(trail: readonly TrailEntry[]): Id[] {
  const seen: Id[] = [];
  for (const entry of trail) {
    if (entry.transitionId !== undefined && !seen.includes(entry.transitionId)) {
      seen.push(entry.transitionId);
    }
  }
  return seen;
}
