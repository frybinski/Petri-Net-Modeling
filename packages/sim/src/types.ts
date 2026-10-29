import type {
  Binding,
  BindingResult,
  Diagnostic,
  EnabledBinding,
  Id,
  Marking,
  PetriNet,
  Token,
} from '@pnm/core';
import type { MetricsSnapshot, MetricsState } from './metrics';
import type { DeviationKind } from './replay/types';

/** What the simulation knows about one token beyond its value. */
export interface TokenMeta {
  /** Unique id of the token, stable while it moves between places. */
  id: string;
  /** The case the token belongs to. Tokens of resources have none. */
  caseId?: string;
  /** Simulation time at which the token arrived on its current place. */
  enteredAt: number;
}

/** A token as it appears in an event. */
export interface TokenRef {
  placeId: Id;
  tokenId: string;
  caseId?: string;
  /** On consumed tokens: the time at which the token arrived on the place it is taken from. */
  since?: number;
}

/** A firing that has started and not yet completed. */
export interface Firing {
  id: number;
  transitionId: Id;
  /** The binding that was started; its `produces` are put on the places at completion. */
  binding: EnabledBinding;
  /** Cases of the consumed tokens (resource tokens excluded), in order of consumption. */
  caseIds: string[];
  start: number;
  end: number;
  /** Lowest free index among the running firings of the same transition. */
  slot: number;
}

export interface SimCounters {
  event: number;
  case: number;
  firing: number;
  token: number;
}

export interface SimState {
  /** Simulation seconds since the start. */
  time: number;
  marking: Marking;
  /** Parallel to `marking[placeId]`: metadata of each token. */
  meta: Record<Id, TokenMeta[]>;
  running: Firing[];
  /** Time of the next arrival per source transition with a rate. */
  nextArrival: Record<Id, number>;
  counters: SimCounters;
}

interface EventBase {
  /** Sequence number of the event, starting at 1. */
  id: number;
  /** Simulation time in seconds. */
  t: number;
}

export type SimEvent =
  /**
   * A new case enters, through a source transition (before its firing starts) or, at time 0,
   * as a token of the initial marking (no transition). In a replay a case enters with its first
   * event; `tokens` are the tokens that were created for it because no source transition does.
   */
  | (EventBase & { type: 'spawn'; transitionId?: Id; caseId: string; tokens?: TokenRef[] })
  | (EventBase & {
      type: 'start';
      transitionId: Id;
      firingId: number;
      slot: number;
      caseIds: string[];
      binding: Binding;
      consumed: TokenRef[];
    })
  | (EventBase & {
      type: 'complete';
      transitionId: Id;
      firingId: number;
      slot: number;
      caseIds: string[];
      produced: TokenRef[];
    })
  /** The user replaced the tokens of a place. */
  | (EventBase & { type: 'marking-edited'; placeId: Id; delta: number; reason: 'user' })
  /** Nothing is enabled and nothing is scheduled. */
  | (EventBase & { type: 'idle' })
  /** A breakpoint was reached; a running `advance` stops here. */
  | (EventBase & { type: 'breakpoint'; kind: 'transition' | 'place'; elementId: Id })
  | (EventBase & { type: 'warning'; code: string; message: string; elementId?: Id })
  /**
   * Replay only: the event log does not fit the net here. `missing`: the activity had no token to
   * take on `placeId` and one was created; `ignored`: the activity is not mapped to a transition;
   * `guard`: the guard of the transition is not satisfied by the tokens of the case.
   */
  | (EventBase & {
      type: 'deviation';
      kind: DeviationKind;
      message: string;
      caseId?: string;
      transitionId?: Id;
      placeId?: Id;
      /** The activity as written in the log. */
      activity?: string;
    });

export type SimEventType = SimEvent['type'];

export interface Breakpoints {
  /** Pause when one of these transitions starts. */
  transitions: Id[];
  /** Pause when the place holds at least this many tokens. */
  places: Record<Id, number>;
}

export interface SimOptions {
  /** Seed of the random number generator. Default: `net.simulation.seed`, else 1. */
  seed?: number;
  /** Seconds left out of the key figures. Default: `net.simulation.warmup`, else 0. */
  warmup?: number;
  /** Arrival rates per hour that replace those of the net (`null` switches arrivals off). */
  rates?: Record<Id, number | null>;
  /** Maximum number of bindings considered per transition (JSON nets). Default 1000. */
  maxBindings?: number;
  /** Starts in one instant before the engine reports a zero-time cycle. Default 10000. */
  maxFiringsPerInstant?: number;
  /** Number of states kept for `stepBack`. Default 500. */
  historyLimit?: number;
}

export interface AdvanceOptions {
  /** Stop after the instant that brought the number of events of this call to at least this. */
  maxEvents?: number;
}

/** The complete state of a simulation, for `restore`. Plain data that can be cloned. */
export interface SimSnapshot {
  time: number;
  marking: Marking;
  meta: Record<Id, TokenMeta[]>;
  running: Firing[];
  nextArrival: Record<Id, number>;
  counters: SimCounters;
  rates: Record<Id, number | null>;
  rngState: number;
  startsPending: boolean;
  idleReported: boolean;
  blocked: Id[];
  metrics: MetricsState;
  /** Replay only: where in the log the replay is, and its tallies. */
  replay?: ReplaySnapshot;
}

/** The part of the state that only a replay has. Plain data. */
export interface ReplaySnapshot {
  /** Number of events of the log that have been taken. */
  cursor: number;
  consumed: number;
  produced: number;
  missing: number;
  ignored: number;
  guard: number;
  /** The note that guards are not checked has been given. */
  guardNoted: boolean;
  /** Number of cases that have started. */
  seen: number;
}

export interface EnabledView {
  /** Enabled transitions with their bindings, in the order of the net. */
  enabled: Map<Id, BindingResult>;
  diagnostics: Diagnostic[];
}

/**
 * The simulation engine. All methods that change the state are serialised: a call waits for the
 * previous one to finish.
 */
export interface Simulation {
  readonly state: Readonly<SimState>;
  readonly net: PetriNet;
  /** The events that created the initial cases (time 0), produced by creation and `reset`. */
  readonly initialEvents: readonly SimEvent[];
  /** Time of the next instant at which something happens, or `null` if nothing is scheduled. */
  nextEventTime(): number | null;
  /** Processes the next instant completely. */
  step(): Promise<SimEvent[]>;
  /** Processes all instants up to `time + seconds`, then sets the clock to that time. */
  advance(seconds: number, options?: AdvanceOptions): Promise<SimEvent[]>;
  /** Starts one randomly chosen enabled transition now (weighted by priority). */
  stepRandom(): Promise<SimEvent[]>;
  /** Starts a transition now. Without `binding`, the transition must have exactly one. */
  fireManually(transitionId: Id, binding?: EnabledBinding): Promise<SimEvent[]>;
  /** The enabled transitions now, taking the capacity reserved by running firings into account. */
  enabled(): Promise<EnabledView>;
  /** Replaces the tokens of a place (resources can be added or withdrawn while running). */
  editMarking(placeId: Id, tokens: Token[]): Promise<SimEvent[]>;
  /** Changes the arrival rate (per hour) of a source transition; `null` switches it off. */
  setRate(transitionId: Id, perHour: number | null): Promise<void>;
  rates(): Record<Id, number | null>;
  setBreakpoints(breakpoints: Breakpoints): void;
  metrics(): MetricsSnapshot;
  canStepBack(): boolean;
  /** Restores the state before the last instant or manual intervention. */
  stepBack(): Promise<boolean>;
  snapshot(): SimSnapshot;
  restore(snapshot: SimSnapshot): Promise<void>;
  /** Starts over, optionally with another seed. Returns the events of the initial cases. */
  reset(seed?: number): Promise<SimEvent[]>;
}
