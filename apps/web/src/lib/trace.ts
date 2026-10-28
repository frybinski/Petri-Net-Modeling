import type { Id } from '@pnm/core';
import type { SimEvent, SimEventType } from '@pnm/sim';

/** Rows shown in the trace table; the export always contains every event. */
export const TRACE_ROWS = 200;

/** The transition an event concerns, if any. */
export function eventTransition(event: SimEvent): Id | undefined {
  switch (event.type) {
    case 'spawn':
    case 'start':
    case 'complete':
      return event.transitionId;
    default:
      return undefined;
  }
}

/**
 * The newest events that match the filter, newest first. Looks at the log from the end and stops
 * once enough rows are found.
 */
export function recentEvents(
  events: readonly SimEvent[],
  type: SimEventType | '',
  transitionId: Id | '',
  limit = TRACE_ROWS,
): SimEvent[] {
  const result: SimEvent[] = [];
  for (let i = events.length - 1; i >= 0 && result.length < limit; i -= 1) {
    const event = events[i]!;
    if (type !== '' && event.type !== type) continue;
    if (transitionId !== '' && eventTransition(event) !== transitionId) continue;
    result.push(event);
  }
  return result;
}
