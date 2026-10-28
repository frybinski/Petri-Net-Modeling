import type { SimEvent } from '@pnm/sim';

/** Events kept for the trace and the export; the oldest are dropped beyond this. */
export const LOG_LIMIT = 200_000;
/** How many events are dropped at once when the limit is exceeded. */
const DROP = 20_000;

/**
 * The event stream of the running simulation. It is kept outside the React state because it grows
 * quickly; the store signals changes with a version number.
 */
class EventLog {
  private events: SimEvent[] = [];
  private lost = 0;

  /** Number of events dropped from the start because the log was full. */
  get dropped(): number {
    return this.lost;
  }

  get length(): number {
    return this.events.length;
  }

  all(): readonly SimEvent[] {
    return this.events;
  }

  push(events: readonly SimEvent[]): void {
    for (const event of events) this.events.push(event);
    if (this.events.length > LOG_LIMIT) {
      this.events.splice(0, DROP);
      this.lost += DROP;
    }
  }

  /** Forgets the events after the one with the given id (stepping back). */
  truncateAfter(id: number): void {
    let end = this.events.length;
    while (end > 0 && this.events[end - 1]!.id > id) end -= 1;
    this.events.length = end;
  }

  clear(): void {
    this.events = [];
    this.lost = 0;
  }
}

export const eventLog = new EventLog();

export type SimEventListener = (events: readonly SimEvent[]) => void;

const listeners = new Set<SimEventListener>();

/** Calls `listener` with every batch of new events (not with events that were stepped back). */
export function onSimEvents(listener: SimEventListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishSimEvents(events: readonly SimEvent[]): void {
  if (events.length === 0) return;
  for (const listener of listeners) listener(events);
}
