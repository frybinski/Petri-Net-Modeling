import {
  addAnnotation as coreAddAnnotation,
  addArc as coreAddArc,
  addPlace as coreAddPlace,
  addToken as coreAddToken,
  addTransition as coreAddTransition,
  addType as coreAddType,
  alignNodes,
  canConnect,
  createEmptyNet,
  createId,
  distributeNodes,
  exampleToken,
  extractFragment,
  findArc,
  insertFragment,
  isEmptyFragment,
  moveNodes as coreMoveNodes,
  NetOpError,
  removeElements,
  removeToken as coreRemoveToken,
  removeType as coreRemoveType,
  renameNet as coreRenameNet,
  renameType as coreRenameType,
  reverseArc as coreReverseArc,
  setInitialTokens,
  setPlaceType as corePlaceType,
  setDomainView as coreSetDomainView,
  setDomainViewGeneration as coreSetDomainViewGeneration,
  setProfile as coreSetProfile,
  setProperties as coreSetProperties,
  setSimulationSettings as coreSetSimulationSettings,
  setTokens as coreSetTokens,
  setWeight,
  uniqueName,
  updateAnnotation as coreUpdateAnnotation,
  updateArc as coreUpdateArc,
  updateNode,
  updateToken as coreUpdateToken,
  updateType as coreUpdateType,
  validate,
  type AlignMode,
  type Annotation,
  type Arc,
  canonicalJson,
  type Binding,
  type BindingResult,
  type Diagnostic,
  type DistributeAxis,
  type Id,
  type Marking,
  type NetFragment,
  type PetriNet,
  type Place,
  type Position,
  type Profile,
  type SimulationSettings,
  type Token,
  type Transition,
} from '@pnm/core';
import { markingKey, type Step } from '@pnm/analysis';
import {
  initialMarking,
  isTimedNet,
  type Breakpoints,
  type MetricsSnapshot,
  type RunningView,
  type SimResult,
  type TokenMeta,
  type SimulationClient,
} from '@pnm/sim';
import { create } from 'zustand';
import { en } from '../i18n/en';
import { chainPosition } from '../lib/placement';
import { createSimulationClientForEditor } from '../lib/sim-client';
import { getViewApi } from '../lib/view-api';
import { archiveRun, clearArchive, eventLog, publishSimEvents, publishSimJump } from './sim-log';
import { notify } from './ui-store';

export type Tool = 'select' | 'place' | 'transition' | 'arc' | 'annotation';
export type Mode = 'edit' | 'simulate';

export type SimSpeed = 1 | 2 | 5 | 10 | 30 | 60 | 'max';

/** The speeds offered by the simulation controls. */
export const SIM_SPEEDS: readonly SimSpeed[] = [1, 2, 5, 10, 30, 60, 'max'];

/** At most this many fired steps are listed in the panel. */
export const SIM_HISTORY_LIMIT = 200;

/** Events per round trip to the engine at maximum speed. */
export const MAX_SPEED_BUNDLE = 200;

/** Firings per round trip at maximum speed in nets without time. */
const MAX_SPEED_STEPS = 25;

/** Wall-clock time between two steps of the clock while playing (milliseconds). */
export const PLAY_TICK_MS = 40;

/** The clock advances by at most this many seconds (times the speed) per tick. */
export const MAX_TICK_SECONDS = 0.1;

export interface SimStep {
  index: number;
  transitionId: Id;
  transitionName: string;
  /** The binding that was fired; empty in P/T nets. */
  binding: Binding;
}

/** Wall-clock time between two steps while a replay plays. */
export const REPLAY_STEP_MS = 650;

/** A recorded firing sequence (a counterexample, the way to a deadlock) played back in the simulation. */
export interface ReplayState {
  label: string;
  steps: Step[];
  /** Number of steps fired so far. */
  position: number;
  /** The marking in which the sequence ends according to the analysis. */
  target: Marking | null;
  /** `diverged`: a step could not be fired because the net does not allow it any more. */
  status: 'ready' | 'done' | 'diverged';
  /** After the last step: does the simulation show the marking the analysis reported. */
  reached: boolean | null;
}

export interface ReplayRequest {
  label: string;
  steps: Step[];
  target?: Marking | null;
  /** Fire all steps at once and stop at the end (to show a state of the state space). */
  immediate?: boolean;
}

/** Maximum number of undo steps kept in memory. */
export const HISTORY_LIMIT = 200;

/** Distance between a copy and its original when pasting or duplicating. */
export const PASTE_OFFSET = 40;

export interface EditorState {
  /** The document. Only this part is covered by undo and redo. */
  net: PetriNet;
  past: PetriNet[];
  future: PetriNet[];
  /** The net as last saved or loaded; the document is dirty when `net` differs. */
  savedNet: PetriNet;
  fileName: string | null;
  /** Incremented whenever a different document is loaded; the canvas refits its view. */
  docVersion: number;

  selection: Id[];
  tool: Tool;
  /** The tool stays active after use (double click on the tool) until Escape or another tool. */
  toolSticky: boolean;
  mode: Mode;
  /** First click of the two-click arc tool. */
  arcSource: Id | null;
  /** Element whose name, weight or inscription is being edited in place. */
  renamingId: Id | null;
  /**
   * Node that Tab just added: renaming it again is merged into the step that created it, so that
   * one undo removes the node together with its first name.
   */
  amendId: Id | null;
  /** Positions of nodes while they are being dragged (not part of the document). */
  dragPositions: Record<Id, Position> | null;

  simMarking: Marking | null;
  /** Parallel to `simMarking`: the identity of every token (the animation follows tokens by it). */
  simMeta: Record<Id, TokenMeta[]>;
  /** The latest fired steps (the start of a firing), oldest first. */
  simHistory: SimStep[];
  /** Enabled transitions with their bindings under `simMarking`. Empty while `computing`. */
  enabled: Map<Id, BindingResult>;
  /** True while the bindings of the current marking are being computed. */
  computing: boolean;
  /** Evaluation problems found while computing the bindings. */
  simDiagnostics: Diagnostic[];
  /** Transition whose list of bindings is open for the user to choose from. */
  picker: Id | null;
  /** Simulation seconds since the start. */
  simTime: number;
  /** Firings that have started and not yet completed. */
  simRunning: RunningView[];
  simMetrics: MetricsSnapshot | null;
  simPlaying: boolean;
  simSpeed: SimSpeed;
  /** The net uses durations or arrival rates (the engine runs on a clock). */
  simTimed: boolean;
  simNextEvent: number | null;
  simCanBack: boolean;
  /** Current arrival rates per hour of the source transitions. */
  simRates: Record<Id, number | null>;
  simBreakpoints: Breakpoints;
  /** Increases whenever the event log changes; the log itself lives in `eventLog`. */
  simLogVersion: number;
  /** The last command left nothing to do. */
  simIdle: boolean;
  /** The last warning of the engine, for the status bar. */
  simNotice: string | null;
  /** The simulation ignores durations and arrival rates (the replay of an analysis trace). */
  simUntimed: boolean;
  /** The recorded firing sequence that is being played, if any. */
  replay: ReplayState | null;
  replayPlaying: boolean;

  diagnostics: Diagnostic[];
  clipboard: NetFragment | null;
  pasteCount: number;

  // Document actions
  addPlace(position: Position): Id | null;
  addTransition(position: Position): Id | null;
  addAnnotation(position: Position): Id | null;
  addArc(source: Id, target: Id): Id | null;
  removeSelected(): void;
  updatePlace(id: Id, patch: Partial<Omit<Place, 'id'>>): void;
  updateTransition(id: Id, patch: Partial<Omit<Transition, 'id'>>): void;
  updateArc(id: Id, patch: Partial<Omit<Arc, 'id' | 'source' | 'target'>>): void;
  updateAnnotation(id: Id, patch: Partial<Omit<Annotation, 'id'>>): void;
  reverseArc(id: Id): void;
  /** Renames a place, transition or note (inline editing). */
  renameElement(id: Id, name: string): void;
  /**
   * Adds the next node of the other kind 160 px to the right (`direction` 1) or the previous
   * node to the left (-1), connects it, selects it and starts renaming it. One undo step.
   */
  extendFrom(id: Id, direction: 1 | -1): Id | null;
  /** Adds a node with the active tool; the tool falls back to Select unless it is kept. */
  placeWithTool(position: Position, options: { keepTool: boolean; rename: boolean }): Id | null;
  moveNodes(moves: Record<Id, Position>): void;
  nudgeSelected(dx: number, dy: number): void;
  setTokens(placeId: Id, count: number): void;
  adjustTokens(delta: number): void;
  /** Replaces the initial tokens of a place (JSON nets). */
  setPlaceTokens(placeId: Id, tokens: Token[]): void;
  addToken(placeId: Id, token?: Token): void;
  updateToken(placeId: Id, index: number, token: Token): void;
  removeToken(placeId: Id, index: number): void;
  duplicateToken(placeId: Id, index: number): void;
  setProfile(profile: Profile): void;
  /**
   * Creates a type (`original` is `null`) or changes an existing one, including a rename.
   * One undo step. Returns false if the change was rejected.
   */
  saveType(original: string | null, name: string, schema: unknown): boolean;
  duplicateType(name: string): string | null;
  removeType(name: string): void;
  setPlaceType(placeId: Id, type: string | undefined): void;
  renameNet(name: string): void;
  /** Changes the simulation settings of the net; a key set to `undefined` is removed. */
  updateSimulationSettings(patch: Partial<SimulationSettings>): void;
  /** Sets the domain view of the net, or removes it with `undefined`. One undo step. */
  setDomainView(view: unknown): void;
  /**
   * Replaces the domain view and the record of how it was generated (`undefined` removes the
   * record) in one undo step.
   */
  replaceDomainView(view: unknown, generation: unknown): void;
  /**
   * Replaces the list of properties to check (one undo step). The list is not part of the net's
   * structure, so it can be edited while a simulation runs; `undefined` removes it.
   */
  setProperties(properties: unknown): void;
  align(mode: AlignMode): void;
  distribute(axis: DistributeAxis): void;
  applyLayout(positions: Record<Id, Position>): void;

  // History
  undo(): void;
  redo(): void;

  // Clipboard
  copy(): void;
  cut(): void;
  paste(): void;
  duplicate(): void;

  // Selection and tools
  select(ids: Id[]): void;
  selectAll(): void;
  clearSelection(): void;
  setTool(tool: Tool, sticky?: boolean): void;
  /** Double click on a tool: makes it sticky, or turns stickiness off again. */
  toggleStickyTool(tool: Tool): void;
  setArcSource(id: Id | null): void;
  startRename(id: Id | null): void;
  setDragPositions(positions: Record<Id, Position> | null): void;

  // Files
  newNet(): void;
  /** Replaces the document. With `unsaved` it counts as changed (an import, not yet saved as a file). */
  loadNet(net: PetriNet, fileName?: string | null, options?: { unsaved?: boolean }): void;
  markSaved(fileName: string): void;

  // Simulation
  /** Starts the simulation; `untimed` ignores durations and arrival rates. Resolves when it is ready. */
  startSimulation(options?: { untimed?: boolean }): Promise<void>;
  stopSimulation(): void;
  /** Fires a transition: directly if it has one binding, otherwise opens the binding list. */
  fireTransition(id: Id): void;
  fireBindingAt(id: Id, index: number): void;
  setPicker(id: Id | null): void;
  /** Starts one randomly chosen enabled transition (weighted by priority). */
  stepRandom(): Promise<void>;
  /** Processes the next instant of a timed simulation. */
  stepNext(): Promise<void>;
  /** Goes back to the state before the last step or intervention. */
  stepBack(): Promise<void>;
  resetSimulation(): Promise<void>;
  setPlaying(playing: boolean): void;
  togglePlaying(): void;
  setSimSpeed(speed: SimSpeed): void;
  /** Changes the arrival rate (per hour) of a source transition while running. */
  setArrivalRate(transitionId: Id, perHour: number): void;
  /** Adds (+1) or withdraws (-1) a token of a place while running. */
  adjustPlaceTokens(placeId: Id, delta: number): void;
  /** Plays a recorded firing sequence in the (untimed) simulation, starting it if needed. */
  startReplay(request: ReplayRequest): Promise<void>;
  /** Fires the next step of the replay. */
  replayStep(): Promise<void>;
  setReplayPlaying(playing: boolean): void;
  /** Goes back to the initial marking and keeps the replay. */
  restartReplay(): Promise<void>;
  /** Leaves the replay; the simulation stays where it is. */
  endReplay(): void;
  toggleTransitionBreakpoint(transitionId: Id): void;
  /** Pauses when the place holds `count` tokens or more; `null` removes the breakpoint. */
  setPlaceBreakpoint(placeId: Id, count: number | null): void;
}

function freshNet(name: string = en.app.untitled): PetriNet {
  return createEmptyNet(name);
}

function allIds(net: PetriNet): Id[] {
  return [
    ...net.places.map((p) => p.id),
    ...net.transitions.map((t) => t.id),
    ...net.arcs.map((a) => a.id),
    ...(net.annotations ?? []).map((a) => a.id),
  ];
}

/** The id of the element being renamed, or null when it no longer exists in `net`. */
function renamingExists(id: Id | null, net: PetriNet): Id | null {
  return id !== null && allIds(net).includes(id) ? id : null;
}

function prune(selection: Id[], net: PetriNet): Id[] {
  const existing = new Set(allIds(net));
  const kept = selection.filter((id) => existing.has(id));
  return kept.length === selection.length ? selection : kept;
}

/** True if applying `patch` would not change `target`. */
function isNoop(target: object, patch: object): boolean {
  const current = target as Record<string, unknown>;
  return Object.entries(patch).every(([key, value]) => {
    const existing = current[key];
    if (typeof value === 'object' && value !== null) {
      return JSON.stringify(existing) === JSON.stringify(value);
    }
    return existing === value;
  });
}

const initialNet = freshNet();

const NO_ENABLED = (): Map<Id, BindingResult> => new Map();

const NO_BREAKPOINTS = (): Breakpoints => ({ transitions: [], places: {} });

/** The simulation fields while no simulation runs. */
function idleSimulation() {
  return {
    simMarking: null as Marking | null,
    simMeta: {} as Record<Id, TokenMeta[]>,
    simHistory: [] as SimStep[],
    enabled: NO_ENABLED(),
    computing: false,
    simDiagnostics: [] as Diagnostic[],
    picker: null as Id | null,
    simTime: 0,
    simRunning: [] as RunningView[],
    simMetrics: null as MetricsSnapshot | null,
    simPlaying: false,
    simSpeed: 1 as SimSpeed,
    simTimed: false,
    simNextEvent: null as number | null,
    simCanBack: false,
    simRates: {} as Record<Id, number | null>,
    simLogVersion: 0,
    simIdle: false,
    simNotice: null as string | null,
    simUntimed: false,
    replay: null as ReplayState | null,
    replayPlaying: false,
  };
}

function nameOfElement(net: PetriNet, id: Id): string {
  return (
    net.places.find((p) => p.id === id)?.name ??
    net.transitions.find((t) => t.id === id)?.name ??
    id
  );
}

/** The part of the simulation that lives outside the React state. */
const runtime: {
  client: SimulationClient | null;
  /** Incremented whenever a simulation starts or stops; answers of an older one are dropped. */
  session: number;
  /** Commands the user triggered that have not been answered yet. */
  pending: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  lastTick: number;
  lastEnabledAt: number;
  ticking: boolean;
  replayTimer: ReturnType<typeof setTimeout> | undefined;
} = {
  client: null,
  session: 0,
  pending: 0,
  timer: undefined,
  lastTick: 0,
  lastEnabledAt: 0,
  ticking: false,
  replayTimer: undefined,
};

function clearPlayTimer(): void {
  if (runtime.timer !== undefined) clearTimeout(runtime.timer);
  runtime.timer = undefined;
}

function clearReplayTimer(): void {
  if (runtime.replayTimer !== undefined) clearTimeout(runtime.replayTimer);
  runtime.replayTimer = undefined;
}

/** The net without durations and arrival rates: every firing is atomic. */
function withoutTime(net: PetriNet): PetriNet {
  return {
    ...net,
    transitions: net.transitions.map((t) => {
      const { timing: _timing, rate: _rate, ...rest } = t;
      return rest;
    }),
  };
}

/** Stops the engine and everything that belongs to it. */
function disposeRuntime(): void {
  runtime.session += 1;
  clearPlayTimer();
  clearReplayTimer();
  runtime.pending = 0;
  runtime.ticking = false;
  runtime.client?.dispose();
  runtime.client = null;
}

function toEnabledMap(entries: NonNullable<SimResult['view']['enabled']>): Map<Id, BindingResult> {
  return new Map(
    entries.map((entry) => [
      entry.transitionId,
      { bindings: entry.bindings, truncated: entry.truncated, diagnostics: [] },
    ]),
  );
}

export const useEditorStore = create<EditorState>()((set, get) => {
  /** Replaces the document by `next` and records an undo step. */
  const commit = (next: PetriNet, selection?: Id[]): void => {
    const { net, past } = get();
    if (next === net) return;
    set({
      net: next,
      past: [...past.slice(-(HISTORY_LIMIT - 1)), net],
      future: [],
      diagnostics: validate(next),
      selection: prune(selection ?? get().selection, next),
      amendId: null,
      // The element that is being renamed may have been removed.
      renamingId: renamingExists(get().renamingId, next),
    });
  };

  /** Runs a document edit if the editor is not locked; reports operation errors. */
  const edit = (change: (net: PetriNet) => PetriNet, selection?: Id[]): boolean => {
    if (get().mode === 'simulate') {
      notify('info', en.messages.editLocked);
      return false;
    }
    try {
      commit(change(get().net), selection);
      return true;
    } catch (error) {
      if (error instanceof NetOpError) {
        notify('error', error.message);
        return false;
      }
      throw error;
    }
  };

  const replaceDocument = (
    net: PetriNet,
    fileName: string | null,
    options: { unsaved?: boolean } = {},
  ): void => {
    disposeRuntime();
    eventLog.clear();
    clearArchive();
    set({
      net,
      // A different object than the net makes the document count as changed.
      savedNet: options.unsaved ? createEmptyNet() : net,
      fileName,
      past: [],
      future: [],
      docVersion: get().docVersion + 1,
      selection: [],
      diagnostics: validate(net),
      mode: 'edit',
      tool: 'select',
      toolSticky: false,
      arcSource: null,
      renamingId: null,
      amendId: null,
      dragPositions: null,
      ...idleSimulation(),
      simBreakpoints: NO_BREAKPOINTS(),
    });
  };

  /** Applies the answer of the engine to the state, the event log and the listeners. */
  const apply = (
    result: SimResult,
    options: { truncate?: boolean; reset?: boolean } = {},
  ): void => {
    const { events, view } = result;
    if (options.reset) eventLog.clear();
    else if (options.truncate) eventLog.truncateAfter(view.eventCount);
    eventLog.push(events);

    const state = get();
    let history = options.reset
      ? []
      : options.truncate
        ? state.simHistory.filter((step) => step.index <= view.firingCount)
        : state.simHistory;
    const names = new Map(state.net.transitions.map((t) => [t.id, t.name]));
    const fired: SimStep[] = [];
    for (const event of events) {
      if (event.type === 'start') {
        fired.push({
          index: event.firingId,
          transitionId: event.transitionId,
          transitionName: names.get(event.transitionId) ?? event.transitionId,
          binding: event.binding,
        });
      }
    }
    if (fired.length > 0) history = [...history, ...fired].slice(-SIM_HISTORY_LIMIT);

    const idle = events.some((e) => e.type === 'idle');
    const warning = [...events].reverse().find((e) => e.type === 'warning');
    if (view.enabled) runtime.lastEnabledAt = performance.now();
    const replay = state.replay;
    const replayAfter =
      replay === null
        ? null
        : options.reset
          ? { ...replay, position: 0, status: 'ready' as const, reached: null }
          : options.truncate
            ? {
                ...replay,
                position: Math.max(0, replay.position - 1),
                status: 'ready' as const,
                reached: null,
              }
            : replay;
    set({
      ...(replay !== null && { replay: replayAfter }),
      simMarking: view.marking,
      simMeta: view.meta,
      ...(view.enabled && {
        enabled: toEnabledMap(view.enabled),
        simDiagnostics: view.diagnostics,
      }),
      simHistory: history,
      simTime: view.time,
      simRunning: view.running,
      simMetrics: view.metrics,
      simNextEvent: view.nextEventTime,
      simCanBack: view.canStepBack,
      simRates: view.rates,
      simLogVersion: state.simLogVersion + 1,
      simIdle: idle ? true : events.length > 0 ? false : state.simIdle,
      ...(warning?.type === 'warning' && { simNotice: warning.message }),
    });
    // The picture of the domain view snaps to a state it cannot reach by events.
    if (options.reset || options.truncate) publishSimJump();
    if (!options.truncate) publishSimEvents(events);

    const stop = events.find((e) => e.type === 'breakpoint');
    if (stop?.type === 'breakpoint') {
      get().setPlaying(false);
      set({ selection: [stop.elementId] });
      notify('info', en.simulation.breakpointHit(nameOfElement(get().net, stop.elementId)));
    } else if (idle && get().simPlaying) {
      get().setPlaying(false);
      notify('info', get().simTimed ? en.simulation.finished : en.messages.noEnabled);
    }
  };

  /**
   * Sends a command the user triggered. While it is under way `computing` is true and clicks on
   * transitions are ignored; an answer of a simulation that has been stopped meanwhile is dropped.
   */
  const command = (
    send: (client: SimulationClient) => Promise<SimResult>,
    options: { truncate?: boolean; reset?: boolean } = {},
  ): Promise<boolean> => {
    const client = runtime.client;
    if (!client) return Promise.resolve(false);
    const session = runtime.session;
    runtime.pending += 1;
    set({ computing: true });
    return send(client).then(
      (result) => {
        if (session !== runtime.session) return false;
        runtime.pending -= 1;
        apply(result, options);
        if (runtime.pending === 0) set({ computing: false });
        return true;
      },
      (error: unknown) => {
        if (session !== runtime.session) return false;
        runtime.pending -= 1;
        if (runtime.pending === 0) set({ computing: false });
        notify('error', error instanceof Error ? error.message : String(error));
        return false;
      },
    );
  };

  /** The user took over from the replay: it stops, the simulation stays. */
  const leaveReplay = (): void => {
    if (get().replay !== null || get().replayPlaying) {
      clearReplayTimer();
      set({ replay: null, replayPlaying: false });
    }
  };

  /** One step of the clock while playing. */
  const tick = async (): Promise<void> => {
    runtime.timer = undefined;
    const client = runtime.client;
    const session = runtime.session;
    if (!client || !get().simPlaying || runtime.ticking) return;
    runtime.ticking = true;
    const started = performance.now();
    const wall = Math.min(Math.max((started - runtime.lastTick) / 1000, 0), MAX_TICK_SECONDS);
    runtime.lastTick = started;
    const { net, simSpeed, simTimed } = get();
    // The bindings of JSON nets are costly to compute; while playing they are refreshed now and then.
    const enabled = net.profile === 'pt-net' || started - runtime.lastEnabledAt > 400;
    let delay = PLAY_TICK_MS;
    try {
      let result: SimResult;
      if (simTimed) {
        result =
          simSpeed === 'max'
            ? await client.advance(Infinity, MAX_SPEED_BUNDLE, { enabled })
            : await client.advance(wall * simSpeed, undefined, { enabled });
      } else if (simSpeed === 'max') {
        result = await client.stepRandom(MAX_SPEED_STEPS, { enabled });
        delay = 0;
      } else {
        result = await client.stepRandom(1, { enabled });
        delay = 1000 / simSpeed;
      }
      if (session !== runtime.session) return;
      apply(result);
    } catch (error) {
      if (session !== runtime.session) return;
      get().setPlaying(false);
      notify('error', error instanceof Error ? error.message : String(error));
      return;
    } finally {
      if (session === runtime.session) runtime.ticking = false;
    }
    if (session === runtime.session && get().simPlaying) {
      runtime.timer = setTimeout(
        () => {
          void tick();
        },
        Math.max(0, delay - (performance.now() - started)),
      );
    }
  };

  return {
    net: initialNet,
    past: [],
    future: [],
    savedNet: initialNet,
    fileName: null,
    docVersion: 0,

    selection: [],
    tool: 'select',
    toolSticky: false,
    mode: 'edit',
    arcSource: null,
    renamingId: null,
    amendId: null,
    dragPositions: null,

    ...idleSimulation(),
    simBreakpoints: NO_BREAKPOINTS(),

    diagnostics: validate(initialNet),
    clipboard: null,
    pasteCount: 0,

    addPlace(position) {
      const id = createId();
      return edit((net) => coreAddPlace(net, { id, position }), [id]) ? id : null;
    },
    addTransition(position) {
      const id = createId();
      return edit((net) => coreAddTransition(net, { id, position }), [id]) ? id : null;
    },
    addAnnotation(position) {
      const id = createId();
      return edit((net) => coreAddAnnotation(net, { id, position }), [id]) ? id : null;
    },
    addArc(source, target) {
      const check = canConnect(get().net, source, target);
      if (!check.ok) {
        notify('error', check.reason);
        return null;
      }
      const existing = findArc(get().net, source, target);
      if (existing) {
        const weight = existing.weight + 1;
        // The weight label on the canvas shows the result; no toast needed.
        return edit((net) => setWeight(net, existing.id, weight), [existing.id])
          ? existing.id
          : null;
      }
      const id = createId();
      return edit((net) => coreAddArc(net, source, target, { id }), [id]) ? id : null;
    },
    removeSelected() {
      const { selection } = get();
      if (selection.length === 0) return;
      edit((net) => removeElements(net, selection), []);
    },
    updatePlace(id, patch) {
      const place = get().net.places.find((p) => p.id === id);
      if (!place || isNoop(place, patch)) return;
      edit((net) => updateNode(net, id, patch));
    },
    updateTransition(id, patch) {
      const transition = get().net.transitions.find((t) => t.id === id);
      if (!transition || isNoop(transition, patch)) return;
      edit((net) => updateNode(net, id, patch));
    },
    updateArc(id, patch) {
      const arc = get().net.arcs.find((a) => a.id === id);
      if (!arc || isNoop(arc, patch)) return;
      edit((net) => coreUpdateArc(net, id, patch));
    },
    updateAnnotation(id, patch) {
      const annotation = get().net.annotations?.find((a) => a.id === id);
      if (!annotation || isNoop(annotation, patch)) return;
      edit((net) => coreUpdateAnnotation(net, id, patch));
    },
    reverseArc(id) {
      edit((net) => coreReverseArc(net, id));
    },
    renameElement(id, name) {
      const { net, amendId } = get();
      const target =
        net.places.find((p) => p.id === id) ??
        net.transitions.find((t) => t.id === id) ??
        net.annotations?.find((a) => a.id === id);
      if (!target) return;
      if (amendId === id && get().mode === 'edit' && 'name' in target) {
        if (target.name === name) return;
        // Part of the step that created the node: change the document without a new undo step.
        const next = updateNode(net, id, { name });
        set({ net: next, diagnostics: validate(next), amendId: null });
        return;
      }
      if (net.places.some((p) => p.id === id)) get().updatePlace(id, { name });
      else if (net.transitions.some((t) => t.id === id)) get().updateTransition(id, { name });
      else get().updateAnnotation(id, { text: name });
    },
    extendFrom(id, direction) {
      const { net, mode } = get();
      if (mode === 'simulate') return null;
      const place = net.places.find((p) => p.id === id);
      const transition = net.transitions.find((t) => t.id === id);
      const from = place ?? transition;
      if (!from) return null;
      const position = chainPosition(net, from.position, direction);
      const created = createId();
      const arcId = createId();
      const ok = edit(
        (current) => {
          const next = place
            ? coreAddTransition(current, { id: created, position })
            : coreAddPlace(current, { id: created, position });
          return direction === 1
            ? coreAddArc(next, id, created, { id: arcId })
            : coreAddArc(next, created, id, { id: arcId });
        },
        [created],
      );
      if (!ok) return null;
      set({ renamingId: created, amendId: created });
      getViewApi()?.reveal([created]);
      return created;
    },
    placeWithTool(position, options) {
      const { tool, toolSticky } = get();
      const id =
        tool === 'place'
          ? get().addPlace(position)
          : tool === 'transition'
            ? get().addTransition(position)
            : tool === 'annotation'
              ? get().addAnnotation(position)
              : null;
      if (id === null) return null;
      if (tool === 'annotation' || options.rename) get().startRename(id);
      // The first name of a node that was just added belongs to the step that added it.
      if (options.rename && tool !== 'annotation') set({ amendId: id });
      if (!toolSticky && !options.keepTool) set({ tool: 'select', toolSticky: false });
      return id;
    },
    moveNodes(moves) {
      const { net } = get();
      const items = [...net.places, ...net.transitions, ...(net.annotations ?? [])];
      const changed = items.some((item) => {
        const to = moves[item.id];
        return to !== undefined && (to.x !== item.position.x || to.y !== item.position.y);
      });
      if (!changed) return;
      edit((current) => coreMoveNodes(current, moves));
    },
    nudgeSelected(dx, dy) {
      const { net, selection } = get();
      const selected = new Set(selection);
      const moves: Record<Id, Position> = {};
      for (const item of [...net.places, ...net.transitions, ...(net.annotations ?? [])]) {
        if (selected.has(item.id)) {
          moves[item.id] = { x: item.position.x + dx, y: item.position.y + dy };
        }
      }
      if (Object.keys(moves).length > 0) get().moveNodes(moves);
    },
    setTokens(placeId, count) {
      const place = get().net.places.find((p) => p.id === placeId);
      if (!place) return;
      let target = Math.max(0, Math.round(count));
      if (place.capacity !== undefined && target > place.capacity) {
        target = place.capacity;
        notify('info', en.messages.capacityReached(place.capacity));
      }
      if ((get().net.marking[placeId]?.length ?? 0) === target) return;
      edit((net) => setInitialTokens(net, placeId, target));
    },
    adjustTokens(delta) {
      const { net, selection } = get();
      const places = net.places.filter((p) => selection.includes(p.id));
      if (places.length === 0) return;
      edit((current) => {
        let next = current;
        for (const place of places) {
          const tokens = current.marking[place.id] ?? [];
          let target = Math.max(0, tokens.length + delta);
          if (place.capacity !== undefined) target = Math.min(target, place.capacity);
          if (current.profile === 'json-net') {
            // Typed tokens keep their values: drop the last ones or add a starting value.
            const sample = exampleToken(
              place.type === undefined ? undefined : current.types[place.type],
            );
            const adjusted = [...tokens.slice(0, target)];
            while (adjusted.length < target) adjusted.push(structuredClone(sample));
            next = coreSetTokens(next, place.id, adjusted);
          } else {
            next = setInitialTokens(next, place.id, target);
          }
        }
        return next;
      });
    },
    setPlaceTokens(placeId, tokens) {
      edit((net) => coreSetTokens(net, placeId, tokens));
    },
    addToken(placeId, token) {
      const { net } = get();
      const place = net.places.find((p) => p.id === placeId);
      if (!place) return;
      if (place.capacity !== undefined && (net.marking[placeId]?.length ?? 0) >= place.capacity) {
        notify('info', en.messages.capacityReached(place.capacity));
        return;
      }
      const value =
        token ?? exampleToken(place.type === undefined ? undefined : net.types[place.type]);
      edit((current) => coreAddToken(current, placeId, value));
    },
    updateToken(placeId, index, token) {
      edit((net) => coreUpdateToken(net, placeId, index, token));
    },
    removeToken(placeId, index) {
      edit((net) => coreRemoveToken(net, placeId, index));
    },
    duplicateToken(placeId, index) {
      const token = get().net.marking[placeId]?.[index];
      if (token !== undefined) get().addToken(placeId, structuredClone(token));
    },
    setProfile(profile) {
      if (profile === get().net.profile) return;
      edit((net) => coreSetProfile(net, profile));
    },
    saveType(original, name, schema) {
      const trimmed = name.trim();
      return edit((net) => {
        let next = net;
        if (original === null) return coreAddType(next, trimmed, schema);
        if (original !== trimmed) next = coreRenameType(next, original, trimmed);
        return coreUpdateType(next, trimmed, schema);
      });
    },
    duplicateType(name) {
      const schema = get().net.types[name];
      if (schema === undefined) return null;
      const copy = uniqueName(Object.keys(get().net.types), `${name}Copy`);
      return edit((net) => coreAddType(net, copy, structuredClone(schema))) ? copy : null;
    },
    removeType(name) {
      edit((net) => coreRemoveType(net, name));
    },
    setPlaceType(placeId, type) {
      const place = get().net.places.find((p) => p.id === placeId);
      if (!place || place.type === type) return;
      edit((net) => corePlaceType(net, placeId, type));
    },
    renameNet(name) {
      if (name === get().net.name) return;
      edit((net) => coreRenameNet(net, name));
    },
    updateSimulationSettings(patch) {
      edit((net) => coreSetSimulationSettings(net, patch));
    },
    setDomainView(view) {
      edit((net) => coreSetDomainView(net, view));
    },
    setProperties(properties) {
      commit(coreSetProperties(get().net, properties));
    },
    replaceDomainView(view, generation) {
      edit((net) => coreSetDomainViewGeneration(coreSetDomainView(net, view), generation));
    },
    align(mode) {
      edit((net) => alignNodes(net, get().selection, mode));
    },
    distribute(axis) {
      edit((net) => distributeNodes(net, get().selection, axis));
    },
    applyLayout(positions) {
      get().moveNodes(positions);
    },

    undo() {
      const { past, future, net, mode } = get();
      const previous = past[past.length - 1];
      if (mode === 'simulate' || previous === undefined) return;
      set({
        net: previous,
        past: past.slice(0, -1),
        future: [net, ...future],
        diagnostics: validate(previous),
        selection: prune(get().selection, previous),
        renamingId: null,
        amendId: null,
      });
    },
    redo() {
      const { past, future, net, mode } = get();
      const next = future[0];
      if (mode === 'simulate' || next === undefined) return;
      set({
        net: next,
        past: [...past, net],
        future: future.slice(1),
        diagnostics: validate(next),
        selection: prune(get().selection, next),
        renamingId: null,
        amendId: null,
      });
    },

    copy() {
      const fragment = extractFragment(get().net, get().selection);
      if (isEmptyFragment(fragment)) return;
      set({ clipboard: fragment, pasteCount: 0 });
    },
    cut() {
      if (get().mode === 'simulate') return;
      get().copy();
      get().removeSelected();
    },
    paste() {
      const { clipboard, pasteCount } = get();
      if (!clipboard) return;
      const step = pasteCount + 1;
      let inserted: Id[] = [];
      const ok = edit((net) => {
        const result = insertFragment(net, clipboard, {
          x: PASTE_OFFSET * step,
          y: PASTE_OFFSET * step,
        });
        inserted = result.ids;
        return result.net;
      });
      if (ok) {
        set({ pasteCount: step });
        set({ selection: inserted });
      }
    },
    duplicate() {
      const fragment = extractFragment(get().net, get().selection);
      if (isEmptyFragment(fragment)) return;
      let inserted: Id[] = [];
      edit((net) => {
        const result = insertFragment(net, fragment, { x: PASTE_OFFSET, y: PASTE_OFFSET });
        inserted = result.ids;
        return result.net;
      });
      if (inserted.length > 0) set({ selection: inserted });
    },

    select(ids) {
      const current = get().selection;
      if (ids.length === current.length && ids.every((id, i) => id === current[i])) return;
      set({ selection: ids });
    },
    selectAll() {
      set({ selection: allIds(get().net) });
    },
    clearSelection() {
      if (get().selection.length > 0) set({ selection: [] });
    },
    setTool(tool, sticky = false) {
      if (get().mode === 'simulate' && tool !== 'select') return;
      set({ tool, toolSticky: sticky && tool !== 'select', arcSource: null });
    },
    toggleStickyTool(tool) {
      if (tool === 'select') return;
      const { tool: active, toolSticky } = get();
      get().setTool(tool, !(active === tool && toolSticky));
    },
    setArcSource(id) {
      set({ arcSource: id });
    },
    startRename(id) {
      if (id !== null && get().mode === 'simulate') return;
      set(id === null ? { renamingId: null, amendId: null } : { renamingId: id });
    },
    setDragPositions(positions) {
      set({ dragPositions: positions });
    },

    newNet() {
      replaceDocument(freshNet(), null);
    },
    loadNet(net, fileName = null, options) {
      replaceDocument(net, fileName, options);
    },
    markSaved(fileName) {
      set({ savedNet: get().net, fileName });
    },

    startSimulation(options = {}) {
      const { net, simBreakpoints } = get();
      disposeRuntime();
      archiveRun(net);
      eventLog.clear();
      const client = createSimulationClientForEditor();
      runtime.client = client;
      const untimed = options.untimed === true;
      const simNet = untimed ? withoutTime(net) : net;
      const timed = isTimedNet(simNet);
      // Breakpoints on elements that no longer exist are dropped.
      const known = new Set([...net.places, ...net.transitions].map((n) => n.id));
      const breakpoints: Breakpoints = {
        transitions: simBreakpoints.transitions.filter((id) => known.has(id)),
        places: Object.fromEntries(
          Object.entries(simBreakpoints.places).filter(([id]) => known.has(id)),
        ),
      };
      set({
        ...idleSimulation(),
        mode: 'simulate',
        tool: 'select',
        toolSticky: false,
        arcSource: null,
        renamingId: null,
        dragPositions: null,
        simMarking: initialMarking(simNet),
        simTimed: timed,
        simUntimed: untimed,
        simSpeed: timed ? 10 : 1,
        simBreakpoints: breakpoints,
        computing: true,
      });
      runtime.pending = 1;
      const session = runtime.session;
      const hasBreakpoints =
        breakpoints.transitions.length > 0 || Object.keys(breakpoints.places).length > 0;
      return client
        .init(simNet, undefined)
        .then(async (result) => {
          if (hasBreakpoints) await client.setBreakpoints(breakpoints, { enabled: false });
          return result;
        })
        .then(
          (result) => {
            if (session !== runtime.session) return;
            runtime.pending -= 1;
            apply(result, { reset: true });
            if (runtime.pending === 0) set({ computing: false });
          },
          (error: unknown) => {
            if (session !== runtime.session) return;
            runtime.pending -= 1;
            set({ computing: false });
            notify('error', error instanceof Error ? error.message : String(error));
          },
        );
    },
    stopSimulation() {
      disposeRuntime();
      archiveRun(get().net);
      eventLog.clear();
      set({ mode: 'edit', ...idleSimulation() });
    },
    fireTransition(id) {
      const { mode, enabled, computing } = get();
      if (mode !== 'simulate' || computing) return;
      const result = enabled.get(id);
      if (!result || result.bindings.length === 0) return;
      if (result.bindings.length === 1) get().fireBindingAt(id, 0);
      else set({ picker: get().picker === id ? null : id });
    },
    fireBindingAt(id, index) {
      const { mode, enabled, computing } = get();
      if (mode !== 'simulate' || computing) return;
      const chosen = enabled.get(id)?.bindings[index];
      if (!chosen) return;
      set({ picker: null });
      leaveReplay();
      void command((client) => client.fire(id, chosen));
    },
    setPicker(id) {
      if (get().mode !== 'simulate') return;
      set({ picker: id });
    },
    async stepRandom() {
      if (get().mode !== 'simulate' || get().computing) return;
      leaveReplay();
      await command((client) => client.stepRandom(1));
      if (get().simIdle) notify('info', en.messages.noEnabled);
    },
    async stepNext() {
      if (get().mode !== 'simulate' || get().computing) return;
      get().setPlaying(false);
      leaveReplay();
      await command((client) => client.step());
      if (get().simIdle) notify('info', en.simulation.finished);
    },
    async stepBack() {
      const { mode, simCanBack, computing } = get();
      if (mode !== 'simulate' || !simCanBack || computing) return;
      get().setPlaying(false);
      set({ picker: null });
      await command((client) => client.back(), { truncate: true });
    },
    async resetSimulation() {
      if (get().mode !== 'simulate') return;
      get().setPlaying(false);
      set({ picker: null });
      await command((client) => client.reset(), { reset: true });
    },
    setPlaying(playing) {
      const { mode, simPlaying } = get();
      if (playing === simPlaying) return;
      if (playing && (mode !== 'simulate' || runtime.client === null)) return;
      set(playing ? { simPlaying: true, simIdle: false } : { simPlaying: false });
      clearPlayTimer();
      if (playing) {
        runtime.lastTick = performance.now();
        runtime.timer = setTimeout(() => {
          void tick();
        }, PLAY_TICK_MS);
      }
    },
    togglePlaying() {
      get().setPlaying(!get().simPlaying);
    },
    setSimSpeed(speed) {
      set({ simSpeed: speed });
    },
    setArrivalRate(transitionId, perHour) {
      if (get().mode !== 'simulate') return;
      void command((client) => client.setRate(transitionId, perHour, { enabled: false }));
    },
    adjustPlaceTokens(placeId, delta) {
      const { mode, net, simMarking } = get();
      if (mode !== 'simulate' || simMarking === null) return;
      const place = net.places.find((p) => p.id === placeId);
      if (!place) return;
      const count = simMarking[placeId]?.length ?? 0;
      if (delta > 0 && place.capacity !== undefined && count >= place.capacity) {
        notify('info', en.messages.capacityReached(place.capacity));
        return;
      }
      // Tokens of a JSON net are copies of the last one, or a typical value of the type.
      const sample =
        net.profile === 'json-net' && count === 0
          ? exampleToken(place.type === undefined ? undefined : net.types[place.type])
          : undefined;
      void command((client) => client.adjust(placeId, delta > 0 ? 1 : -1, sample));
    },
    async startReplay(request) {
      const { mode, simUntimed, net } = get();
      get().setPlaying(false);
      clearReplayTimer();
      // A fresh untimed run; the replay is shown on its trace and on the canvas.
      if (
        mode !== 'simulate' ||
        !simUntimed ||
        get().simHistory.length > 0 ||
        get().replay !== null
      ) {
        await get().startSimulation({ untimed: true });
      } else {
        await command((client) => client.reset(), { reset: true });
      }
      if (get().mode !== 'simulate') return;
      set({
        replayPlaying: false,
        replay: {
          label: request.label,
          steps: request.steps,
          position: 0,
          target: request.target ?? null,
          status: request.steps.length === 0 ? 'done' : 'ready',
          reached:
            request.steps.length === 0 && request.target
              ? markingKey(net, get().simMarking ?? {}) === markingKey(net, request.target)
              : null,
        },
      });
      if (request.immediate === true) {
        while (get().replay?.status === 'ready') {
          const before = get().replay?.position ?? 0;
          await get().replayStep();
          if ((get().replay?.position ?? 0) === before) break;
        }
      }
    },
    async replayStep() {
      const state = get();
      const replay = state.replay;
      if (!replay || state.mode !== 'simulate' || state.computing || replay.status !== 'ready')
        return;
      const step = replay.steps[replay.position];
      if (!step) return;
      const wanted = canonicalJson(step.binding ?? {});
      const chosen = state.enabled
        .get(step.transitionId)
        ?.bindings.find((candidate) => canonicalJson(candidate.binding) === wanted);
      if (!chosen) {
        clearReplayTimer();
        set({ replay: { ...replay, status: 'diverged' }, replayPlaying: false });
        notify('error', en.analysis.replayDiverged(nameOfElement(state.net, step.transitionId)));
        return;
      }
      const ok = await command((client) => client.fire(step.transitionId, chosen));
      const after = get().replay;
      if (!ok || !after) return;
      const position = after.position + 1;
      const finished = position >= after.steps.length;
      const reached =
        finished && after.target
          ? markingKey(get().net, get().simMarking ?? {}) === markingKey(get().net, after.target)
          : null;
      set({
        replay: {
          ...after,
          position,
          status: finished ? 'done' : 'ready',
          reached,
        },
        ...(finished && { replayPlaying: false }),
      });
      if (finished) clearReplayTimer();
    },
    setReplayPlaying(playing) {
      const { replay, replayPlaying } = get();
      if (playing === replayPlaying) return;
      clearReplayTimer();
      if (!playing || !replay || replay.status !== 'ready') {
        set({ replayPlaying: false });
        return;
      }
      set({ replayPlaying: true });
      const loop = async (): Promise<void> => {
        runtime.replayTimer = undefined;
        if (!get().replayPlaying) return;
        await get().replayStep();
        const next = get();
        if (next.replayPlaying && next.replay?.status === 'ready') {
          runtime.replayTimer = setTimeout(() => {
            void loop();
          }, REPLAY_STEP_MS);
        } else if (next.replayPlaying) {
          set({ replayPlaying: false });
        }
      };
      runtime.replayTimer = setTimeout(() => {
        void loop();
      }, 0);
    },
    async restartReplay() {
      const replay = get().replay;
      if (!replay || get().mode !== 'simulate') return;
      get().setReplayPlaying(false);
      get().setPlaying(false);
      await command((client) => client.reset(), { reset: true });
    },
    endReplay() {
      clearReplayTimer();
      set({ replay: null, replayPlaying: false });
    },
    toggleTransitionBreakpoint(transitionId) {
      const { simBreakpoints } = get();
      const has = simBreakpoints.transitions.includes(transitionId);
      const next: Breakpoints = {
        ...simBreakpoints,
        transitions: has
          ? simBreakpoints.transitions.filter((id) => id !== transitionId)
          : [...simBreakpoints.transitions, transitionId],
      };
      set({ simBreakpoints: next });
      void runtime.client?.setBreakpoints(next, { enabled: false }).catch(() => undefined);
    },
    setPlaceBreakpoint(placeId, count) {
      const { simBreakpoints } = get();
      const places = { ...simBreakpoints.places };
      if (count === null || count < 1) delete places[placeId];
      else places[placeId] = Math.round(count);
      const next: Breakpoints = { ...simBreakpoints, places };
      set({ simBreakpoints: next });
      void runtime.client?.setBreakpoints(next, { enabled: false }).catch(() => undefined);
    },
  };
});

export const selectIsDirty = (s: EditorState): boolean => s.net !== s.savedNet;
export const selectCanUndo = (s: EditorState): boolean => s.past.length > 0 && s.mode === 'edit';
export const selectCanRedo = (s: EditorState): boolean => s.future.length > 0 && s.mode === 'edit';

/** The marking shown on the canvas: the simulated one while simulating, otherwise the initial one. */
export function currentMarking(s: Pick<EditorState, 'net' | 'mode' | 'simMarking'>): Marking {
  return s.mode === 'simulate' && s.simMarking ? s.simMarking : s.net.marking;
}
