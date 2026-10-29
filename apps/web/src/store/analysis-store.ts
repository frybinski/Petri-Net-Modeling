import {
  AnalysisCancelled,
  DEFAULT_MAX_STATES,
  DEFAULT_MAX_TIME_MS,
  endActivities,
  activityLabels,
  parseProperties,
  tracesFromRows,
  type AnalysisClient,
  type CheckReport,
  type ConformanceResult,
  type CoverabilityResult,
  type FinalStates,
  type InvariantResult,
  type PropertySpec,
  type StateSpaceProgress,
  type StateSpaceReport,
  type StructureResult,
} from '@pnm/analysis';
import { eventLogRows } from '@pnm/io';
import type { PetriNet } from '@pnm/core';
import { create } from 'zustand';
import { en } from '../i18n/en';
import { analysisKey } from '../lib/analysis-key';
import { createAnalysisClientForEditor } from '../lib/analysis-client';
import { useEditorStore } from './editor-store';
import { lastRun } from './sim-log';

export type FinalMode = 'deadlock' | 'all' | 'marking';

export type AnalysisKind = 'structure' | 'invariants' | 'space' | 'check' | 'conformance';

/** A result together with the key of the net it was computed for. */
export interface Computed<T> {
  value: T;
  key: string;
}

export interface SpaceOutcome {
  report: StateSpaceReport;
  /** The coverability graph, computed with the exploration for place/transition nets. */
  coverability: CoverabilityResult | null;
  limit: number;
}

export interface CheckOutcome {
  report: CheckReport;
  final: FinalMode;
  limit: number;
  /** The properties as they were when they were checked. */
  specs: PropertySpec[];
}

export interface ConformanceOutcome {
  result: ConformanceResult;
  /** Where the log came from. */
  source: string;
  skippedOpen: boolean;
  specs: PropertySpec[];
}

export const LIMIT_CHOICES = [1000, 5000, 20000, 100000] as const;
/** The choices for the time limit of an exploration, in seconds (the default is 10). */
export const TIME_LIMIT_CHOICES = [5, 10, 30, 60, 120, 300] as const;

interface AnalysisState {
  structure: Computed<StructureResult> | null;
  invariants: Computed<InvariantResult> | null;
  space: Computed<SpaceOutcome> | null;
  check: Computed<CheckOutcome> | null;
  conformance: Computed<ConformanceOutcome> | null;
  busy: Record<AnalysisKind, boolean>;
  progress: StateSpaceProgress | null;
  errors: Partial<Record<AnalysisKind, string>>;
  /** Maximum number of states of an exploration. */
  limit: number;
  /** The time limit of an exploration, in seconds. */
  timeLimit: number;
  finalMode: FinalMode;
  /** Count the cases of a log that have not finished (default: leave them out). */
  includeOpen: boolean;
  graphOpen: boolean;

  runStructure(): Promise<void>;
  runInvariants(): Promise<void>;
  exploreStateSpace(): Promise<void>;
  runAll(): Promise<void>;
  checkOnStateSpace(): Promise<void>;
  checkOnLog(): Promise<void>;
  /** Stops the running exploration or check. */
  cancel(): void;
  setLimit(limit: number): void;
  setTimeLimit(seconds: number): void;
  setFinalMode(mode: FinalMode): void;
  setIncludeOpen(include: boolean): void;
  openGraph(): void;
  closeGraph(): void;
  clear(): void;
}

const idle = (): Record<AnalysisKind, boolean> => ({
  structure: false,
  invariants: false,
  space: false,
  check: false,
  conformance: false,
});

const runtime: {
  client: AnalysisClient | null;
  controllers: Partial<Record<AnalysisKind, AbortController>>;
} = { client: null, controllers: {} };

function client(): AnalysisClient {
  runtime.client ??= createAnalysisClientForEditor();
  return runtime.client;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function finalStates(mode: FinalMode): FinalStates {
  if (mode === 'all') return 'all';
  if (mode === 'marking') {
    const marking = useEditorStore.getState().simMarking;
    if (marking) return { markings: [marking] };
  }
  return 'deadlock';
}

export const useAnalysisStore = create<AnalysisState>()((set, get) => {
  const begin = (kind: AnalysisKind): AbortController => {
    runtime.controllers[kind]?.abort();
    const controller = new AbortController();
    runtime.controllers[kind] = controller;
    set((s) => ({
      busy: { ...s.busy, [kind]: true },
      errors: { ...s.errors, [kind]: undefined },
      ...(kind === 'space' || kind === 'check' ? { progress: null } : {}),
    }));
    return controller;
  };
  const finish = (kind: AnalysisKind, controller: AbortController, error?: unknown): void => {
    if (runtime.controllers[kind] === controller) delete runtime.controllers[kind];
    set((s) => ({
      busy: { ...s.busy, [kind]: false },
      progress: kind === 'space' || kind === 'check' ? null : s.progress,
      errors:
        error === undefined || error instanceof AnalysisCancelled
          ? s.errors
          : { ...s.errors, [kind]: message(error) },
    }));
  };

  return {
    structure: null,
    invariants: null,
    space: null,
    check: null,
    conformance: null,
    busy: idle(),
    progress: null,
    errors: {},
    limit: DEFAULT_MAX_STATES,
    timeLimit: DEFAULT_MAX_TIME_MS / 1000,
    finalMode: 'deadlock',
    includeOpen: false,
    graphOpen: false,

    async runStructure() {
      const net = useEditorStore.getState().net;
      const controller = begin('structure');
      try {
        const value = await client().structure(net, undefined, { signal: controller.signal });
        set({ structure: { value, key: analysisKey(net) } });
        finish('structure', controller);
      } catch (error) {
        finish('structure', controller, error);
      }
    },
    async runInvariants() {
      const net = useEditorStore.getState().net;
      const controller = begin('invariants');
      try {
        const value = await client().invariants(net, undefined, { signal: controller.signal });
        set({ invariants: { value, key: analysisKey(net) } });
        finish('invariants', controller);
      } catch (error) {
        finish('invariants', controller, error);
      }
    },
    async exploreStateSpace() {
      const net = useEditorStore.getState().net;
      const { limit, timeLimit } = get();
      const controller = begin('space');
      try {
        const run = {
          signal: controller.signal,
          onProgress: (progress: StateSpaceProgress) => {
            set({ progress });
          },
        };
        const report = await client().stateSpace(
          net,
          { maxStates: limit, maxTimeMs: timeLimit * 1000 },
          run,
        );
        // The graph of place/transition nets is cheap and decides boundedness when the
        // exploration was cut off.
        const coverability =
          net.profile === 'pt-net'
            ? await client().coverability(net, undefined, { signal: controller.signal })
            : null;
        set({
          space: { value: { report, coverability, limit }, key: analysisKey(net) },
        });
        finish('space', controller);
      } catch (error) {
        finish('space', controller, error);
      }
    },
    async runAll() {
      await get().runStructure();
      await get().runInvariants();
      await get().exploreStateSpace();
    },
    async checkOnStateSpace() {
      const net = useEditorStore.getState().net;
      const { properties } = parseProperties(net.properties);
      if (properties.length === 0) return;
      const { limit, timeLimit, finalMode } = get();
      const controller = begin('check');
      try {
        const report = await client().check(
          net,
          properties,
          { maxStates: limit, maxTimeMs: timeLimit * 1000, final: finalStates(finalMode) },
          {
            signal: controller.signal,
            onProgress: (progress) => {
              set({ progress });
            },
          },
        );
        set({
          check: {
            value: { report, final: finalMode, limit, specs: properties },
            key: analysisKey(net),
          },
        });
        finish('check', controller);
      } catch (error) {
        finish('check', controller, error);
      }
    },
    async checkOnLog() {
      const editor = useEditorStore.getState();
      const net = editor.net;
      const { properties } = parseProperties(net.properties);
      const run = lastRun(net, editor.mode === 'simulate');
      if (properties.length === 0 || run === null) return;
      const controller = begin('conformance');
      try {
        const traces = tracesFromRows(eventLogRows(run.events, run.net));
        const ends = endActivities(net);
        const skip = !get().includeOpen && ends.length > 0;
        const result = await client().conformance(traces, properties, {
          ...(skip && { endActivities: ends }),
          activities: activityLabels(net).labels,
        });
        set({
          conformance: {
            value: {
              result,
              source: en.analysis.logSource(run.events.length, traces.length),
              skippedOpen: skip,
              specs: properties,
            },
            key: analysisKey(net),
          },
        });
        finish('conformance', controller);
      } catch (error) {
        finish('conformance', controller, error);
      }
    },
    cancel() {
      for (const controller of Object.values(runtime.controllers)) controller?.abort();
    },
    setLimit(limit) {
      set({ limit });
    },
    setTimeLimit(timeLimit) {
      set({ timeLimit });
    },
    setFinalMode(mode) {
      set({ finalMode: mode });
    },
    setIncludeOpen(include) {
      set({ includeOpen: include });
    },
    openGraph() {
      set({ graphOpen: true });
    },
    closeGraph() {
      set({ graphOpen: false });
    },
    clear() {
      get().cancel();
      set({
        structure: null,
        invariants: null,
        space: null,
        check: null,
        conformance: null,
        busy: idle(),
        progress: null,
        errors: {},
        graphOpen: false,
      });
    },
  };
});

// A different document starts without results of the previous one.
let seenDocument = useEditorStore.getState().docVersion;
useEditorStore.subscribe((state) => {
  if (state.docVersion !== seenDocument) {
    seenDocument = state.docVersion;
    useAnalysisStore.getState().clear();
  }
});

/** True if a result was computed for another version of the net than the current one. */
export function isStale(computed: Computed<unknown> | null, net: PetriNet): boolean {
  return computed !== null && computed.key !== analysisKey(net);
}
