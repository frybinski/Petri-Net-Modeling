import type { Diagnostic, EnabledBinding, Id, Marking, PetriNet, Token } from '@pnm/core';
import type { MetricsSnapshot } from './metrics';
import type { Breakpoints, SimEvent, SimOptions, SimSnapshot } from './types';

/** A firing that is under way, as shown in the editor. */
export interface RunningView {
  firingId: number;
  transitionId: Id;
  start: number;
  end: number;
  slot: number;
  caseIds: string[];
}

/** An enabled transition with the bindings under which it can start. */
export interface EnabledEntry {
  transitionId: Id;
  bindings: EnabledBinding[];
  /** True if there are more bindings than were computed. */
  truncated: boolean;
}

/** The state of the simulation after a command, in a form that can be sent between threads. */
export interface SimView {
  time: number;
  marking: Marking;
  running: RunningView[];
  /** Enabled transitions now; `null` if the command did not ask for them. */
  enabled: EnabledEntry[] | null;
  /** Evaluation problems found while computing `enabled`. */
  diagnostics: Diagnostic[];
  /** Time of the next instant at which something happens; `null` if nothing is scheduled. */
  nextEventTime: number | null;
  /** Current arrival rates per hour of the source transitions. */
  rates: Record<Id, number | null>;
  metrics: MetricsSnapshot;
  canStepBack: boolean;
  /** Number of events so far; events with a higher id belong to a state that was stepped back from. */
  eventCount: number;
  /** Number of firings started so far. */
  firingCount: number;
  /** True if the net uses durations or arrival rates. */
  timed: boolean;
}

export type Command =
  | { cmd: 'init'; net: PetriNet; options?: SimOptions }
  | { cmd: 'step' }
  | { cmd: 'stepRandom'; count?: number }
  | { cmd: 'advance'; seconds: number; maxEvents?: number }
  | { cmd: 'fire'; transitionId: Id; binding?: EnabledBinding }
  | { cmd: 'edit'; placeId: Id; tokens: Token[] }
  | { cmd: 'setRate'; transitionId: Id; perHour: number | null }
  | { cmd: 'setBreakpoints'; breakpoints: Breakpoints }
  | { cmd: 'back' }
  | { cmd: 'reset'; seed?: number }
  | { cmd: 'snapshot' }
  | { cmd: 'restore'; snapshot: SimSnapshot }
  | { cmd: 'view' };

/** A command with the number that ties the answer to it. */
export type Request = Command & {
  id: number;
  /** Include the enabled transitions in the returned view (costly for JSON nets). Default true. */
  enabled?: boolean;
};

export type Response =
  | { id: number; type: 'result'; events: SimEvent[]; view: SimView }
  | { id: number; type: 'snapshot'; snapshot: SimSnapshot }
  | { id: number; type: 'error'; message: string };

export interface SimResult {
  /** The events the command produced, in order. */
  events: SimEvent[];
  view: SimView;
}

export interface CommandOptions {
  /** Include the enabled transitions in the returned view. Default true. */
  enabled?: boolean;
}

/**
 * The simulation as the editor uses it: every call is asynchronous, whether the engine runs in a
 * Web Worker or in the same thread. Calls are answered in the order in which they were made.
 */
export interface SimulationClient {
  init(net: PetriNet, options?: SimOptions, opts?: CommandOptions): Promise<SimResult>;
  step(opts?: CommandOptions): Promise<SimResult>;
  stepRandom(count?: number, opts?: CommandOptions): Promise<SimResult>;
  advance(seconds: number, maxEvents?: number, opts?: CommandOptions): Promise<SimResult>;
  fire(transitionId: Id, binding?: EnabledBinding, opts?: CommandOptions): Promise<SimResult>;
  edit(placeId: Id, tokens: Token[], opts?: CommandOptions): Promise<SimResult>;
  setRate(transitionId: Id, perHour: number | null, opts?: CommandOptions): Promise<SimResult>;
  setBreakpoints(breakpoints: Breakpoints, opts?: CommandOptions): Promise<SimResult>;
  back(opts?: CommandOptions): Promise<SimResult>;
  reset(seed?: number, opts?: CommandOptions): Promise<SimResult>;
  view(opts?: CommandOptions): Promise<SimResult>;
  snapshot(): Promise<SimSnapshot>;
  restore(snapshot: SimSnapshot, opts?: CommandOptions): Promise<SimResult>;
  /** Stops the worker; pending calls are rejected. */
  dispose(): void;
}
