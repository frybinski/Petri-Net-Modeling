import type { Id } from '@pnm/core';

/**
 * One event of a recorded or live event log, as the replay takes it. `readLog` of `@pnm/io` makes
 * these out of a CSV or XES file.
 */
export interface LogEvent {
  caseId: string;
  /** The activity as written in the log. */
  activity: string;
  /** Seconds since the start of the log (or since the time origin that was chosen). */
  time: number;
  lifecycle: 'start' | 'complete';
  /** Further columns or attributes of the event; they become fields of the tokens of JSON nets. */
  attributes?: Record<string, string>;
}

/** An event pushed into a live replay; without a time it happens now. */
export type LiveEvent = Omit<LogEvent, 'time'> & { time?: number };

/** Activity of the log to transition of the net; `null` ignores the activity. */
export interface ActivityMapping {
  [activity: string]: Id | null;
}

/**
 * What to do with a `complete` event whose `start` is not in the log: `zero` lets the activity take
 * no time, `span` lets it start when the previous event of the case ended.
 */
export type CompleteOnly = 'zero' | 'span';

export interface ReplayOptions {
  mapping: ActivityMapping;
  /** Default `zero`. */
  completeOnly?: CompleteOnly;
  /**
   * Check the guards of the transitions (JSON nets). By default a replay only describes what the
   * log says and does not check them; with `strict` a guard that is not satisfied by the tokens of
   * the case is reported as a deviation.
   */
  strict?: boolean;
  /**
   * Choose among several free tokens of a resource place at random (seeded). Without a seed the
   * oldest token is taken, like the engine does.
   */
  seed?: number;
  /** Seconds left out of the key figures. Default: `net.simulation.warmup`, else 0. */
  warmup?: number;
  /**
   * Live replays: an activity that is not in the mapping when its first event arrives is matched to
   * a transition like `autoMapActivities` does, and skipped if none fits.
   */
  autoMap?: boolean;
}

/** What the worker needs to start a replay. Plain data. */
export interface ReplayInit {
  events: LogEvent[];
  options: ReplayOptions;
  /** The events arrive later (`push`); `events` are the ones that are there from the start. */
  live?: boolean;
}

export type DeviationKind = 'missing' | 'ignored' | 'guard';

/** The figures of a replay, added to the key figures as `MetricsSnapshot.replay`. */
export interface ReplayStats {
  /**
   * Token-replay fitness `1 - missing / consumed / 2 - remaining / produced / 2` (Rozinat and van der
   * Aalst); `null` while nothing was consumed or produced.
   */
  fitness: number | null;
  /** Tokens taken by started activities, the ones that had to be created included. */
  consumed: number;
  /** Tokens put by completed activities, plus those that start a case. */
  produced: number;
  /** Tokens that had to be created because the activity had none to take. */
  missing: number;
  /** Tokens that cases which reached a sink place left behind elsewhere. */
  remaining: number;
  /** The tokens that had to be created, by place. */
  missingByPlace: Record<string, number>;
  /** Events of the log that were skipped because their activity is not mapped. */
  ignored: number;
  /** Activities whose guard was not satisfied (only with `strict`). */
  guard: number;
  /** Cases that have started and not reached a sink place. */
  openCases: number;
  /** Events of the log taken so far and in all. */
  processed: number;
  total: number;
}
