import type { Id } from '@pnm/core';
import { layoutContext, type LayoutContext, type LayoutFiring } from './token-layout';
import type { DomainView } from './schema';
import type { PetriNet } from '@pnm/core';

/** How a station is doing, from the point of view of the cases that want to use it. */
export type StationStatus =
  /** No slot is in use and cases are waiting (a moment before the next firing starts). */
  | 'free'
  /** At least one slot is in use. */
  | 'busy'
  /** Every slot is in use and cases are waiting in front of it: a bottleneck. */
  | 'blocked'
  /** No slot is in use and nothing waits: the station lacks input. Drawn neutral. */
  | 'starved';

export interface StationInfo {
  transitionId: Id;
  status: StationStatus;
  /** Firings under way. */
  busy: number;
  /** Slots the view gives the station; 0 if it has none. */
  capacity: number;
  /** Tokens waiting on the case places in front of the station. */
  waiting: number;
}

/** The numbers of waiting tokens from which a queue turns yellow and red. */
export interface Thresholds {
  warn: number;
  critical: number;
}

/** The defaults of the key figures (M3): yellow from 6, red from 10. */
export const DEFAULT_THRESHOLDS: Thresholds = { warn: 6, critical: 10 };

export type QueueLevel = 'ok' | 'warn' | 'crit';

export function queueLevel(count: number, thresholds: Thresholds = DEFAULT_THRESHOLDS): QueueLevel {
  if (count >= thresholds.critical) return 'crit';
  if (count >= thresholds.warn) return 'warn';
  return 'ok';
}

/**
 * The status of a station from the number of slots in use and the tokens that wait in front of it.
 * `blocked` needs both full slots and waiting cases; `starved` needs free slots and nothing waiting.
 */
export function stationStatus(busy: number, capacity: number, waiting: number): StationStatus {
  if (capacity > 0 && busy >= capacity && waiting > 0) return 'blocked';
  if (busy > 0) return 'busy';
  return waiting > 0 ? 'free' : 'starved';
}

/**
 * The status of every transition that is drawn as a card, an area or rooms. Sources (arrivals),
 * doors, docks and waypoints have none.
 */
export function stationInfos(
  net: PetriNet,
  view: DomainView,
  counts: ReadonlyMap<Id, number>,
  running: readonly LayoutFiring[],
  context: LayoutContext = layoutContext(net, view),
): Map<Id, StationInfo> {
  const busyOf = new Map<Id, number>();
  for (const firing of running) {
    busyOf.set(firing.transitionId, (busyOf.get(firing.transitionId) ?? 0) + 1);
  }
  const infos = new Map<Id, StationInfo>();
  for (const transition of net.transitions) {
    const entry = view.transitions[transition.id];
    if (!entry || !('box' in entry)) continue;
    const inputs = context.inputs.get(transition.id) ?? [];
    if (inputs.length === 0) continue;
    let waiting = 0;
    for (const placeId of inputs) {
      if (context.roles.get(placeId) === 'resource') continue;
      waiting += counts.get(placeId) ?? 0;
    }
    const capacity = entry.slots?.length ?? 0;
    const busy = busyOf.get(transition.id) ?? 0;
    infos.set(transition.id, {
      transitionId: transition.id,
      status: stationStatus(busy, capacity, waiting),
      busy,
      capacity,
      waiting,
    });
  }
  return infos;
}
