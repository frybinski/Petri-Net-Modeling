import type { Marking, PetriNet } from '@pnm/core';
import type { CheckResult, FinalStates } from './check';
import type { ConformanceOptions, ConformanceResult, LogTrace } from './conformance';
import type { CoverabilityOptions, CoverabilityResult } from './coverability';
import type { InvariantOptions, InvariantResult } from './invariants';
import type { BehaviourProperties } from './properties';
import type { PropertySpec } from './spec';
import type { StateSpace, StateSpaceProgress } from './state-space';
import type { StructureOptions, StructureResult } from './structure';

/** The limits of an exploration; they can be sent to a worker (no callbacks). */
export interface SpaceLimits {
  maxStates?: number;
  maxTimeMs?: number;
  maxBindings?: number;
}

export interface StateSpaceRequestOptions extends SpaceLimits {
  /** What ends a run; marks the final states of the graph. */
  final?: 'deadlock' | { markings: Marking[] };
}

export interface CheckRequestOptions extends SpaceLimits {
  /** What ends a run for the check; `'all'` checks every prefix. */
  final?: FinalStates;
}

/** The state space together with what follows from it. */
export interface StateSpaceReport {
  space: StateSpace;
  behaviour: BehaviourProperties;
}

/** The verdicts on a property list and the size of the state space they were checked on. */
export interface CheckReport {
  results: CheckResult[];
  states: number;
  edges: number;
  truncated: boolean;
  reason?: string;
}

export interface Commands {
  structure: { args: { net: PetriNet; options?: StructureOptions }; result: StructureResult };
  invariants: { args: { net: PetriNet; options?: InvariantOptions }; result: InvariantResult };
  stateSpace: {
    args: { net: PetriNet; options?: StateSpaceRequestOptions };
    result: StateSpaceReport;
  };
  coverability: {
    args: { net: PetriNet; options?: Pick<CoverabilityOptions, 'maxNodes'> };
    result: CoverabilityResult;
  };
  check: {
    args: { net: PetriNet; properties: PropertySpec[]; options?: CheckRequestOptions };
    result: CheckReport;
  };
  conformance: {
    args: { traces: LogTrace[]; properties: PropertySpec[]; options?: ConformanceOptions };
    result: ConformanceResult;
  };
}

export type CommandName = keyof Commands;

export type AnalysisRequest = {
  [K in CommandName]: { id: number; cmd: K } & Commands[K]['args'];
}[CommandName];

/** Asks to stop the request with the number `target`. */
export interface CancelRequest {
  id: number;
  cmd: 'cancel';
  target: number;
}

export type AnalysisResponse =
  | { id: number; type: 'result'; result: Commands[CommandName]['result'] }
  | { id: number; type: 'progress'; progress: StateSpaceProgress }
  | { id: number; type: 'error'; message: string; cancelled?: boolean };

export interface RunOptions {
  /** Called with the progress of a state space exploration. */
  onProgress?: (progress: StateSpaceProgress) => void;
  /** Aborting stops the analysis; the promise rejects with `AnalysisCancelled`. */
  signal?: AbortSignal;
}

/**
 * The analyses as the editor uses them: every call is asynchronous, whether it runs in a Web Worker
 * or in the calling thread.
 */
export interface AnalysisClient {
  structure(net: PetriNet, options?: StructureOptions, run?: RunOptions): Promise<StructureResult>;
  invariants(net: PetriNet, options?: InvariantOptions, run?: RunOptions): Promise<InvariantResult>;
  stateSpace(
    net: PetriNet,
    options?: StateSpaceRequestOptions,
    run?: RunOptions,
  ): Promise<StateSpaceReport>;
  coverability(
    net: PetriNet,
    options?: Pick<CoverabilityOptions, 'maxNodes'>,
    run?: RunOptions,
  ): Promise<CoverabilityResult>;
  check(
    net: PetriNet,
    properties: PropertySpec[],
    options?: CheckRequestOptions,
    run?: RunOptions,
  ): Promise<CheckReport>;
  conformance(
    traces: LogTrace[],
    properties: PropertySpec[],
    options?: ConformanceOptions,
    run?: RunOptions,
  ): Promise<ConformanceResult>;
  /** Stops the worker; pending calls are rejected. */
  dispose(): void;
}
