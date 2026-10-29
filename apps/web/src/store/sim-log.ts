import type { PetriNet } from '@pnm/core';
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
  private warned = false;

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

  /**
   * Adds events. Returns true the first time that events had to be dropped since the log was
   * cleared, so that the person can be told once.
   */
  push(events: readonly SimEvent[]): boolean {
    for (const event of events) this.events.push(event);
    if (this.events.length > LOG_LIMIT) {
      this.events.splice(0, DROP);
      this.lost += DROP;
      if (!this.warned) {
        this.warned = true;
        return true;
      }
    }
    return false;
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
    this.warned = false;
  }
}

export const eventLog = new EventLog();

/** The event stream of the last run that ended, with the net it ran on. */
interface ArchivedRun {
  net: PetriNet;
  events: readonly SimEvent[];
}

let archived: ArchivedRun | null = null;

/** Keeps a copy of the current event stream (if there is one) when a run ends or restarts. */
export function archiveRun(net: PetriNet): void {
  if (eventLog.length === 0) return;
  archived = { net, events: [...eventLog.all()] };
}

export function clearArchive(): void {
  archived = null;
}

/** The latest run: the one in progress, else the last one that ended. `null` if there is none. */
export function lastRun(net: PetriNet, simulating: boolean): ArchivedRun | null {
  if (simulating && eventLog.length > 0) return { net, events: eventLog.all() };
  return archived;
}

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

const jumpListeners = new Set<() => void>();

/** Calls `listener` when the state changes without events: stepping back, a reset, a new start. */
export function onSimJump(listener: () => void): () => void {
  jumpListeners.add(listener);
  return () => {
    jumpListeners.delete(listener);
  };
}

export function publishSimJump(): void {
  for (const listener of jumpListeners) listener();
}
