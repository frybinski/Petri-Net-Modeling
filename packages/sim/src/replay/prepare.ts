import type { Id } from '@pnm/core';
import type { ActivityMapping, CompleteOnly, LogEvent } from './types';

/** One step of a replay: an event of the log whose activity is mapped (or not). */
export interface Item {
  time: number;
  type: 'start' | 'complete';
  activity: string;
  caseId: string;
  /** The transition of the activity; `null` if it is not mapped (the event is skipped). */
  transitionId: Id | null;
  attributes?: Record<string, string> | undefined;
  /** Starts only: the time of the `complete` that belongs to it in the log; unknown if absent. */
  end?: number | undefined;
}

/** The key under which the work of one case on one transition is tracked. */
export function keyOf(caseId: string, transitionId: Id): string {
  return `${caseId}\u0000${transitionId}`;
}

export function toItem(event: LogEvent, mapping: ActivityMapping): Item {
  const mapped = Object.hasOwn(mapping, event.activity) ? mapping[event.activity] : undefined;
  return {
    time: event.time,
    type: event.lifecycle,
    activity: event.activity,
    caseId: event.caseId,
    transitionId: mapped ?? null,
    ...(event.attributes !== undefined && { attributes: event.attributes }),
  };
}

/** Sorts by time; events at one time keep the order of the log (the sort is stable). */
function byTime(items: Item[]): Item[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.time - b.item.time || a.index - b.index)
    .map((entry) => entry.item);
}

/**
 * Brings the events of a log into the order of the replay. Events are sorted by time (ties keep
 * the order of the log). With `completeOnly: 'span'` an activity that has a `complete` but no
 * `start` gets a start when the previous activity of its case ended; with `'zero'` it gets none
 * here (the replay starts it at the instant of its end). Every `start` learns the time at which
 * its `complete` happens.
 */
export function prepareItems(
  events: readonly LogEvent[],
  mapping: ActivityMapping,
  completeOnly: CompleteOnly,
): Item[] {
  let items = byTime(events.map((event) => toItem(event, mapping)));
  if (completeOnly === 'span') items = withImpliedStarts(items);
  const waiting = new Map<string, Item[]>();
  const heads = new Map<string, number>();
  for (const item of items) {
    if (item.transitionId === null) continue;
    const key = keyOf(item.caseId, item.transitionId);
    if (item.type === 'start') {
      const queue = waiting.get(key);
      if (queue) queue.push(item);
      else waiting.set(key, [item]);
      continue;
    }
    const queue = waiting.get(key);
    const head = heads.get(key) ?? 0;
    const start = queue?.[head];
    if (start !== undefined) {
      start.end = item.time;
      heads.set(key, head + 1);
    }
  }
  return items;
}

/** Adds the starts of completes that have none, at the end of the previous activity of the case. */
function withImpliedStarts(items: Item[]): Item[] {
  const open = new Map<string, number>();
  /** The last `complete` of each case: its time and its position in `items`. */
  const lastComplete = new Map<string, { time: number; index: number }>();
  const implied: Array<{ item: Item; after: number }> = [];
  items.forEach((item, index) => {
    if (item.transitionId === null) return;
    const key = keyOf(item.caseId, item.transitionId);
    if (item.type === 'start') {
      open.set(key, (open.get(key) ?? 0) + 1);
      return;
    }
    const waiting = open.get(key) ?? 0;
    if (waiting > 0) open.set(key, waiting - 1);
    else {
      const previous = lastComplete.get(item.caseId);
      implied.push({
        item: {
          time: previous?.time ?? item.time,
          type: 'start',
          activity: item.activity,
          caseId: item.caseId,
          transitionId: item.transitionId,
          ...(item.attributes !== undefined && { attributes: item.attributes }),
        },
        // Right behind the previous complete of the case, or right in front of this complete.
        after: previous?.index ?? index - 1,
      });
    }
    lastComplete.set(item.caseId, { time: item.time, index });
  });
  if (implied.length === 0) return items;
  // Merge: an implied start sits behind the item at `after`, in the order in which it was found.
  const behind = new Map<number, Item[]>();
  for (const { item, after } of implied) {
    const list = behind.get(after);
    if (list) list.push(item);
    else behind.set(after, [item]);
  }
  const merged: Item[] = [];
  const front = behind.get(-1);
  if (front) merged.push(...front);
  items.forEach((item, index) => {
    merged.push(item);
    const list = behind.get(index);
    if (list) merged.push(...list);
  });
  return byTime(merged);
}

/** Puts `item` into the part of `items` from `from` on, behind every item that is not later. */
export function insertByTime(items: Item[], from: number, item: Item): void {
  let index = items.length;
  while (index > from && items[index - 1]!.time > item.time) index -= 1;
  items.splice(index, 0, item);
}
