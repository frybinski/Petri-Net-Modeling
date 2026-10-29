import type { PetriNet } from '@pnm/core';
import type { Simulation } from '../types';
import { buildReplay } from './engine';
import type { LiveEvent, LogEvent, ReplayOptions } from './types';

/** A replay that is fed while it runs. */
export type LiveReplay = Simulation & {
  /**
   * Adds events. An event without `time` happens now (seconds since the replay was opened); one
   * whose time has passed is taken at the present moment. Throws after `close`.
   */
  push(events: readonly LiveEvent[]): void;
  /** The feed has ended; what has arrived is still played. */
  close(): void;
  readonly closed: boolean;
  /** Seconds since the replay was opened, the time that `push` gives events without one. */
  now(): number;
};

export interface LiveOptions extends ReplayOptions {
  /** Events that are there from the start. */
  events?: readonly LogEvent[];
  /** Seconds since the replay was opened; default the wall clock. */
  clock?: () => number;
}

/**
 * A replay for events that arrive while it runs. It works like `createReplay`, but `advance`
 * plays only up to the time of the latest event that has arrived and then waits (it reports
 * `idle` once); `push` adds events, `close` ends the feed. Time is the wall clock since opening,
 * and the times of events are relative to it.
 */
export function createLiveReplay(net: PetriNet, options: LiveOptions): LiveReplay {
  const opened = Date.now();
  const clock = options.clock ?? ((): number => (Date.now() - opened) / 1000);
  const { events = [], clock: _clock, ...replay } = options;
  const core = buildReplay(net, events, replay, true, clock);
  const live = core.sim as LiveReplay;
  Object.defineProperties(live, {
    push: { value: core.push },
    close: { value: core.close },
    now: { value: clock },
    closed: { get: () => core.closed, enumerable: true },
  });
  return live;
}
