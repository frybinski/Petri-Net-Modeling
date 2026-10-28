import {
  computeBindings,
  countsToMarking,
  findEnabled,
  findEnabledPt,
  isSourceTransition,
  markingToCounts,
  placeRoles,
  tokenEquals,
  type BindingResult,
  type EnabledBinding,
  type EnabledResult,
  type Id,
  type Marking,
  type PetriNet,
  type PlaceRole,
  type Timing,
  type Token,
  type Transition,
} from '@pnm/core';
import { createMetrics, type MetricsSnapshot } from './metrics';
import { createRng, type Rng } from './random';
import type {
  AdvanceOptions,
  Breakpoints,
  EnabledView,
  Firing,
  SimEvent,
  SimOptions,
  SimSnapshot,
  SimState,
  Simulation,
  TokenMeta,
  TokenRef,
} from './types';

export const DEFAULT_START_TIME = '2026-01-05T08:00:00Z';
export const DEFAULT_CASE_PREFIX = 'C-';
const DEFAULT_MAX_FIRINGS_PER_INSTANT = 10_000;
const DEFAULT_HISTORY_LIMIT = 500;
/** A rate of at least this many arrivals per hour is treated as "arrivals switched on". */
const MIN_RATE = 1e-9;

type EventInput =
  | { type: 'spawn'; transitionId?: Id; caseId: string }
  | {
      type: 'start';
      transitionId: Id;
      firingId: number;
      slot: number;
      caseIds: string[];
      binding: Record<string, Token>;
      consumed: TokenRef[];
    }
  | {
      type: 'complete';
      transitionId: Id;
      firingId: number;
      slot: number;
      caseIds: string[];
      produced: TokenRef[];
    }
  | { type: 'marking-edited'; placeId: Id; delta: number; reason: 'user' }
  | { type: 'idle' }
  | { type: 'breakpoint'; kind: 'transition' | 'place'; elementId: Id }
  | { type: 'warning'; code: string; message: string; elementId?: Id };

/** The marking a simulation starts from. P/T nets only count tokens, so theirs are normalised. */
export function initialMarking(net: PetriNet): Marking {
  return net.profile === 'pt-net'
    ? countsToMarking(markingToCounts(net.marking))
    : structuredClone(net.marking);
}

/** True if the net uses time: some transition has a duration or an arrival rate. */
export function isTimedNet(net: PetriNet): boolean {
  return net.transitions.some(
    (t) => (t.timing !== undefined && timingMax(t.timing) > 0) || (t.rate ?? 0) > 0,
  );
}

function timingMax(timing: Timing): number {
  switch (timing.kind) {
    case 'fixed':
      return timing.value;
    case 'uniform':
      return timing.max;
    case 'exponential':
      return timing.mean;
  }
}

/**
 * Creates a discrete-event simulation of `net`.
 *
 * The enabling of transitions and their bindings come from the firing rule of `@pnm/core`. A
 * firing is split in two: at the start the tokens of the binding are taken, at the end (after the
 * duration of the transition) its output is put on the places. With every duration 0 this is the
 * atomic firing rule.
 */
export function createSimulation(net: PetriNet, options: SimOptions = {}): Simulation {
  const settings = net.simulation ?? {};
  const warmup = options.warmup ?? settings.warmup ?? 0;
  const maxFirings = options.maxFiringsPerInstant ?? DEFAULT_MAX_FIRINGS_PER_INSTANT;
  const historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
  const prefix = settings.caseIdPrefix ?? DEFAULT_CASE_PREFIX;
  const bindingOptions =
    options.maxBindings === undefined ? {} : { maxBindings: options.maxBindings };
  const isPt = net.profile === 'pt-net';

  const roles: Map<Id, PlaceRole> = placeRoles(net);
  const transitions: readonly Transition[] = net.transitions;
  const transitionById = new Map(transitions.map((t) => [t.id, t]));
  const sourceIds = new Set(
    transitions.filter((t) => isSourceTransition(net, t.id)).map((t) => t.id),
  );
  const bounded = net.places.filter((p) => p.capacity !== undefined);

  let seed = options.seed ?? settings.seed ?? 1;
  const rng: Rng = createRng(seed);
  const metrics = createMetrics(net, warmup);

  // --- mutable state -------------------------------------------------------------------------
  const s: SimState = {
    time: 0,
    marking: {},
    meta: {},
    running: [],
    nextArrival: {},
    counters: { event: 0, case: 0, firing: 0, token: 0 },
  };
  let rates: Record<Id, number | null> = {};
  let startsPending = true;
  let idleReported = false;
  /** Source transitions whose last arrival found no room; they are reported once. */
  let blocked = new Set<Id>();
  let breakpoints: Breakpoints = { transitions: [], places: {} };
  let history: SimSnapshot[] = [];
  let initialEvents: SimEvent[] = [];
  /** Events of the call in progress. */
  let out: SimEvent[] = [];

  const caseId = (n: number): string => `${prefix}${String(n).padStart(4, '0')}`;

  const emit = (input: EventInput): SimEvent => {
    s.counters.event += 1;
    const event = { ...input, id: s.counters.event, t: s.time } as SimEvent;
    metrics.apply(event);
    out.push(event);
    return event;
  };

  const newCase = (): string => {
    s.counters.case += 1;
    return caseId(s.counters.case);
  };

  const newMeta = (caseOf: string | undefined, t: number): TokenMeta => {
    s.counters.token += 1;
    return {
      id: `k${s.counters.token}`,
      ...(caseOf !== undefined && { caseId: caseOf }),
      enteredAt: t,
    };
  };

  // --- initial state ---------------------------------------------------------------------------
  function initialise(newSeed: number): SimEvent[] {
    seed = newSeed;
    rng.setState(createRng(seed).getState());
    s.time = 0;
    s.marking = initialMarking(net);
    s.meta = {};
    s.running = [];
    s.nextArrival = {};
    s.counters = { event: 0, case: 0, firing: 0, token: 0 };
    rates = {};
    for (const t of transitions) {
      if (!sourceIds.has(t.id)) continue;
      const override = options.rates?.[t.id];
      const rate = override !== undefined ? override : (t.rate ?? null);
      rates[t.id] = rate !== null && rate > MIN_RATE ? rate : null;
    }
    startsPending = true;
    idleReported = false;
    blocked = new Set();
    history = [];
    metrics.setState(createMetrics(net, warmup).getState());
    out = [];
    // Tokens that are there from the start belong to cases of their own (resources do not).
    for (const place of net.places) {
      const tokens = s.marking[place.id] ?? [];
      if (tokens.length === 0) continue;
      const resource = roles.get(place.id) === 'resource';
      s.meta[place.id] = tokens.map(() => {
        if (resource) return newMeta(undefined, 0);
        const id = newCase();
        emit({ type: 'spawn', caseId: id });
        return newMeta(id, 0);
      });
    }
    for (const t of transitions) {
      const rate = rates[t.id];
      if (rate) s.nextArrival[t.id] = rng.exponential(3600 / rate);
    }
    return out.splice(0);
  }

  // --- snapshots ---------------------------------------------------------------------------------
  function takeSnapshot(): SimSnapshot {
    return {
      time: s.time,
      marking: { ...s.marking },
      meta: { ...s.meta },
      running: [...s.running],
      nextArrival: { ...s.nextArrival },
      counters: { ...s.counters },
      rates: { ...rates },
      rngState: rng.getState(),
      startsPending,
      idleReported,
      blocked: [...blocked],
      metrics: metrics.getState(),
    };
  }

  function applySnapshot(snapshot: SimSnapshot): void {
    s.time = snapshot.time;
    s.marking = { ...snapshot.marking };
    s.meta = { ...snapshot.meta };
    s.running = [...snapshot.running];
    s.nextArrival = { ...snapshot.nextArrival };
    s.counters = { ...snapshot.counters };
    rates = { ...snapshot.rates };
    rng.setState(snapshot.rngState);
    startsPending = snapshot.startsPending;
    idleReported = snapshot.idleReported;
    blocked = new Set(snapshot.blocked);
    metrics.setState(snapshot.metrics);
  }

  function remember(): void {
    history.push(takeSnapshot());
    if (history.length > historyLimit) history.shift();
  }

  // --- serialisation of calls ------------------------------------------------------------------
  let tail: Promise<unknown> = Promise.resolve();
  function exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = tail.then(work, work);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** Runs `work` and returns the events it produced. */
  async function collecting(work: () => Promise<void>): Promise<SimEvent[]> {
    out = [];
    try {
      await work();
      return out;
    } finally {
      out = [];
    }
  }

  // --- enabling ----------------------------------------------------------------------------------
  /** Tokens that running firings will put on each place when they complete. */
  function reservedCounts(): Map<Id, number> {
    const reserved = new Map<Id, number>();
    for (const firing of s.running) {
      for (const [placeId, tokens] of Object.entries(firing.binding.produces)) {
        reserved.set(placeId, (reserved.get(placeId) ?? 0) + tokens.length);
      }
    }
    return reserved;
  }

  /** The strong capacity check: tokens now, plus those on their way, plus the new ones. */
  function fits(binding: EnabledBinding, reserved: Map<Id, number>): boolean {
    for (const place of bounded) {
      const now = s.marking[place.id]?.length ?? 0;
      const taken = binding.consumes[place.id]?.length ?? 0;
      const put = binding.produces[place.id]?.length ?? 0;
      if (now + (reserved.get(place.id) ?? 0) - taken + put > place.capacity!) return false;
    }
    return true;
  }

  async function computeEnabled(): Promise<EnabledResult> {
    const result = isPt
      ? findEnabledPt(net, s.marking)
      : await findEnabled(net, s.marking, bindingOptions);
    if (bounded.length === 0 || s.running.length === 0) return result;
    const reserved = reservedCounts();
    const enabled = new Map<Id, BindingResult>();
    for (const [id, found] of result.enabled) {
      const bindings = found.bindings.filter((b) => fits(b, reserved));
      if (bindings.length > 0) enabled.set(id, { ...found, bindings });
    }
    return { enabled, diagnostics: result.diagnostics };
  }

  /** The bindings of one transition, capacity reservations included. */
  async function bindingsOf(transitionId: Id): Promise<EnabledBinding[]> {
    if (isPt) {
      const found = findEnabledPt(net, s.marking).enabled.get(transitionId);
      if (!found) return [];
      const reserved = reservedCounts();
      return found.bindings.filter((b) => fits(b, reserved));
    }
    const found = await computeBindings(net, s.marking, transitionId, bindingOptions);
    const reserved = reservedCounts();
    return found.bindings.filter((b) => fits(b, reserved));
  }

  // --- firing -----------------------------------------------------------------------------------
  function drawDuration(transition: Transition): number {
    const timing = transition.timing;
    if (!timing) return 0;
    switch (timing.kind) {
      case 'fixed':
        return Math.max(0, timing.value);
      case 'uniform':
        return timing.max > timing.min ? rng.uniform(timing.min, timing.max) : timing.min;
      case 'exponential':
        return rng.exponential(timing.mean);
    }
  }

  /** Takes the tokens of a binding from the places (the first token equal to each one). */
  function takeTokens(binding: EnabledBinding): TokenRef[] {
    const refs: TokenRef[] = [];
    for (const [placeId, tokens] of Object.entries(binding.consumes)) {
      const values = [...(s.marking[placeId] ?? [])];
      const metas = [...(s.meta[placeId] ?? [])];
      for (const token of tokens) {
        const index = values.findIndex((candidate) => tokenEquals(candidate, token));
        if (index < 0) {
          throw new Error(`Token is not on place ${placeId}; the binding is stale`);
        }
        const meta = metas[index];
        values.splice(index, 1);
        metas.splice(index, 1);
        if (meta) {
          refs.push({
            placeId,
            tokenId: meta.id,
            ...(meta.caseId !== undefined && { caseId: meta.caseId }),
            since: meta.enteredAt,
          });
        }
      }
      setPlace(placeId, values, metas);
    }
    return refs;
  }

  function setPlace(placeId: Id, values: Token[], metas: TokenMeta[]): void {
    const marking = { ...s.marking };
    const meta = { ...s.meta };
    if (values.length === 0) {
      delete marking[placeId];
      delete meta[placeId];
    } else {
      marking[placeId] = values;
      meta[placeId] = metas;
    }
    s.marking = marking;
    s.meta = meta;
  }

  /** Starts a firing now. `forcedCase` is the case of an arrival at a source transition. */
  function start(binding: EnabledBinding, forcedCase?: string): Firing {
    const transition = transitionById.get(binding.transitionId)!;
    const consumed = takeTokens(binding);
    const caseIds: string[] = [];
    if (forcedCase !== undefined) caseIds.push(forcedCase);
    for (const ref of consumed) {
      if (ref.caseId !== undefined && roles.get(ref.placeId) !== 'resource') {
        if (!caseIds.includes(ref.caseId)) caseIds.push(ref.caseId);
      }
    }
    const used = new Set(
      s.running.filter((f) => f.transitionId === binding.transitionId).map((f) => f.slot),
    );
    let slot = 0;
    while (used.has(slot)) slot += 1;
    s.counters.firing += 1;
    const firing: Firing = {
      id: s.counters.firing,
      transitionId: binding.transitionId,
      binding,
      caseIds,
      start: s.time,
      end: s.time + drawDuration(transition),
      slot,
    };
    s.running = [...s.running, firing];
    emit({
      type: 'start',
      transitionId: firing.transitionId,
      firingId: firing.id,
      slot,
      caseIds: [...caseIds],
      binding: binding.binding,
      consumed,
    });
    return firing;
  }

  /** Puts the output of a firing on the places. */
  function complete(firing: Firing): void {
    s.running = s.running.filter((f) => f.id !== firing.id);
    const inherited = firing.caseIds[0];
    const produced: TokenRef[] = [];
    for (const [placeId, tokens] of Object.entries(firing.binding.produces)) {
      const resource = roles.get(placeId) === 'resource';
      const values = [...(s.marking[placeId] ?? [])];
      const metas = [...(s.meta[placeId] ?? [])];
      for (const token of tokens) {
        const meta = newMeta(resource ? undefined : inherited, s.time);
        values.push(token);
        metas.push(meta);
        produced.push({
          placeId,
          tokenId: meta.id,
          ...(meta.caseId !== undefined && { caseId: meta.caseId }),
        });
      }
      setPlace(placeId, values, metas);
    }
    emit({
      type: 'complete',
      transitionId: firing.transitionId,
      firingId: firing.id,
      slot: firing.slot,
      caseIds: [...firing.caseIds],
      produced,
    });
  }

  /** Starts a firing and, if it takes no time, completes it at once. */
  function begin(binding: EnabledBinding, forcedCase?: string): void {
    const firing = start(binding, forcedCase);
    if (firing.end <= s.time) complete(firing);
  }

  function pickIndex(count: number): number {
    return count <= 1 ? 0 : Math.min(count - 1, Math.floor(rng.next() * count));
  }

  /** Chooses an enabled transition by weight and one of its bindings uniformly. */
  function choose(enabled: Map<Id, BindingResult>, allowSources: boolean): EnabledBinding | null {
    const candidates = [...enabled.entries()].filter(([id]) => allowSources || !sourceIds.has(id));
    if (candidates.length === 0) return null;
    const weights = candidates.map(([id]) => {
      const priority = transitionById.get(id)?.priority;
      return priority !== undefined && Number.isFinite(priority) && priority > 0 ? priority : 1;
    });
    const [, result] = candidates[candidates.length === 1 ? 0 : rng.pick(weights)]!;
    return result.bindings[pickIndex(result.bindings.length)]!;
  }

  // --- one instant -------------------------------------------------------------------------------
  function warn(code: string, message: string, elementId?: Id): void {
    emit({ type: 'warning', code, message, ...(elementId !== undefined && { elementId }) });
  }

  async function arrival(transition: Transition): Promise<void> {
    const bindings = await bindingsOf(transition.id);
    const binding = bindings[pickIndex(bindings.length)];
    if (!binding) {
      if (!blocked.has(transition.id)) {
        blocked.add(transition.id);
        warn(
          'ARRIVAL_BLOCKED',
          `An arrival at "${transition.name}" found no room and was lost.`,
          transition.id,
        );
      }
      return;
    }
    blocked.delete(transition.id);
    const id = newCase();
    emit({ type: 'spawn', transitionId: transition.id, caseId: id });
    begin(binding, id);
  }

  /** Processes everything that happens at time `t`. */
  async function instant(t: number): Promise<void> {
    s.time = t;
    idleReported = false;

    // 1. Completions, in order of their end and then of their start.
    const due = s.running.filter((f) => f.end <= t).sort((a, b) => a.end - b.end || a.id - b.id);
    for (const firing of due) complete(firing);

    // 2. Arrivals.
    for (const transition of transitions) {
      let guard = 0;
      while (
        s.nextArrival[transition.id] !== undefined &&
        s.nextArrival[transition.id]! <= t &&
        guard < 1000
      ) {
        guard += 1;
        const rate = rates[transition.id];
        if (rate) {
          s.nextArrival = {
            ...s.nextArrival,
            [transition.id]: Math.max(
              s.nextArrival[transition.id]! + rng.exponential(3600 / rate),
              t + 1e-9,
            ),
          };
        } else {
          const { [transition.id]: _gone, ...rest } = s.nextArrival;
          s.nextArrival = rest;
        }
        await arrival(transition);
      }
    }

    // 3. Starts, until nothing more is enabled.
    let starts = 0;
    for (;;) {
      const { enabled } = await computeEnabled();
      const binding = choose(enabled, false);
      if (!binding) break;
      if (starts >= maxFirings) {
        warn(
          'ZERO_TIME_CYCLE',
          `More than ${maxFirings} transitions started at the same instant; the net has a cycle without duration.`,
        );
        break;
      }
      starts += 1;
      begin(binding);
    }
    startsPending = false;
  }

  function nextTime(): number | null {
    if (startsPending) return s.time;
    let next: number | null = null;
    for (const firing of s.running) if (next === null || firing.end < next) next = firing.end;
    for (const at of Object.values(s.nextArrival)) if (next === null || at < next) next = at;
    return next === null ? null : Math.max(next, s.time);
  }

  function reportIdle(): void {
    if (idleReported) return;
    idleReported = true;
    emit({ type: 'idle' });
  }

  /** Counts of the places that have a breakpoint, before an instant. */
  function watchedCounts(): Map<Id, number> {
    const counts = new Map<Id, number>();
    for (const placeId of Object.keys(breakpoints.places)) {
      counts.set(placeId, s.marking[placeId]?.length ?? 0);
    }
    return counts;
  }

  /** Emits a `breakpoint` event if the last instant reached one. Returns true if it did. */
  function checkBreakpoints(before: Map<Id, number>, from: number): boolean {
    let hit = false;
    const watched = new Set(breakpoints.transitions);
    if (watched.size > 0) {
      for (let i = from; i < out.length; i += 1) {
        const event = out[i]!;
        if (event.type === 'start' && watched.has(event.transitionId)) {
          emit({ type: 'breakpoint', kind: 'transition', elementId: event.transitionId });
          watched.delete(event.transitionId);
          hit = true;
        }
      }
    }
    for (const [placeId, limit] of Object.entries(breakpoints.places)) {
      const now = s.marking[placeId]?.length ?? 0;
      if ((before.get(placeId) ?? 0) < limit && now >= limit) {
        emit({ type: 'breakpoint', kind: 'place', elementId: placeId });
        hit = true;
      }
    }
    return hit;
  }

  /** One instant with history and breakpoints. Returns true if a breakpoint was hit. */
  async function processInstant(t: number): Promise<boolean> {
    const previous = takeSnapshot();
    const before = watchedCounts();
    const from = out.length;
    await instant(t);
    // An instant in which nothing happened (for example after a manual change that enabled
    // nothing) is not worth a step back.
    if (out.length > from) {
      history.push(previous);
      if (history.length > historyLimit) history.shift();
    }
    return checkBreakpoints(before, from);
  }

  // --- public operations -------------------------------------------------------------------------
  async function runStep(): Promise<void> {
    for (;;) {
      const t = nextTime();
      if (t === null) {
        reportIdle();
        return;
      }
      const from = out.length;
      await processInstant(t);
      if (out.length > from) return;
    }
  }

  async function runAdvance(seconds: number, opts: AdvanceOptions): Promise<void> {
    const target = s.time + Math.max(0, seconds);
    for (;;) {
      const t = nextTime();
      if (t === null) {
        reportIdle();
        if (Number.isFinite(target)) s.time = Math.max(s.time, target);
        return;
      }
      if (t > target) {
        s.time = target;
        return;
      }
      const hit = await processInstant(t);
      if (hit) return;
      if (opts.maxEvents !== undefined && out.length >= opts.maxEvents) return;
    }
  }

  async function runFire(transitionId: Id, wanted?: EnabledBinding): Promise<void> {
    if (!transitionById.has(transitionId)) throw new Error(`Unknown transition: ${transitionId}`);
    const bindings = await bindingsOf(transitionId);
    if (bindings.length === 0) throw new Error('The transition is not enabled');
    let binding: EnabledBinding | undefined;
    if (wanted) {
      const key = JSON.stringify(wanted.binding);
      binding = bindings.find((b) => JSON.stringify(b.binding) === key);
      if (!binding) throw new Error('The binding is no longer enabled');
    } else if (bindings.length === 1) {
      binding = bindings[0];
    } else {
      throw new Error('The transition has several bindings; choose one');
    }
    if (!binding) return;
    remember();
    idleReported = false;
    startsPending = true;
    if (sourceIds.has(transitionId)) {
      const id = newCase();
      emit({ type: 'spawn', transitionId, caseId: id });
      begin(binding, id);
    } else {
      begin(binding);
    }
  }

  async function runStepRandom(): Promise<void> {
    const { enabled } = await computeEnabled();
    const binding = choose(enabled, true);
    if (!binding) {
      await runStep();
      return;
    }
    remember();
    idleReported = false;
    startsPending = true;
    if (sourceIds.has(binding.transitionId)) {
      const id = newCase();
      emit({ type: 'spawn', transitionId: binding.transitionId, caseId: id });
      begin(binding, id);
    } else {
      begin(binding);
    }
  }

  function runEdit(placeId: Id, tokens: Token[]): void {
    const place = net.places.find((p) => p.id === placeId);
    if (!place) throw new Error(`Unknown place: ${placeId}`);
    const old = s.marking[placeId] ?? [];
    const oldMeta = s.meta[placeId] ?? [];
    const values = isPt ? tokens.map(() => 1 as Token) : structuredClone(tokens);
    const reserved = reservedCounts().get(placeId) ?? 0;
    if (place.capacity !== undefined && values.length + reserved > place.capacity) {
      throw new Error(`"${place.name}" holds at most ${place.capacity} tokens`);
    }
    const metas = values.map((value, index) => {
      const before = old[index];
      const meta = oldMeta[index];
      return before !== undefined && meta && tokenEquals(before, value)
        ? meta
        : newMeta(undefined, s.time);
    });
    const delta = values.length - old.length;
    const changed =
      delta !== 0 || values.some((value, index) => !tokenEquals(value, old[index] as Token));
    if (!changed) return;
    remember();
    idleReported = false;
    startsPending = true;
    setPlace(placeId, values, metas);
    emit({ type: 'marking-edited', placeId, delta, reason: 'user' });
  }

  function runSetRate(transitionId: Id, perHour: number | null): void {
    if (!sourceIds.has(transitionId)) {
      throw new Error('Only transitions without input places have an arrival rate');
    }
    const rate = perHour !== null && perHour > MIN_RATE ? perHour : null;
    if ((rates[transitionId] ?? null) === rate) return;
    remember();
    idleReported = false;
    rates = { ...rates, [transitionId]: rate };
    if (rate) {
      // Arrivals are memoryless: the next one is drawn afresh from now.
      s.nextArrival = { ...s.nextArrival, [transitionId]: s.time + rng.exponential(3600 / rate) };
    } else {
      const { [transitionId]: _gone, ...rest } = s.nextArrival;
      s.nextArrival = rest;
    }
  }

  initialEvents = initialise(seed);

  return {
    get state() {
      return s;
    },
    net,
    get initialEvents() {
      return initialEvents;
    },
    nextEventTime: nextTime,
    step: () => exclusive(() => collecting(runStep)),
    advance: (seconds, opts = {}) => exclusive(() => collecting(() => runAdvance(seconds, opts))),
    stepRandom: () => exclusive(() => collecting(runStepRandom)),
    fireManually: (transitionId, binding) =>
      exclusive(() => collecting(() => runFire(transitionId, binding))),
    enabled: () =>
      exclusive(async (): Promise<EnabledView> => {
        const { enabled, diagnostics } = await computeEnabled();
        return { enabled, diagnostics };
      }),
    editMarking: (placeId, tokens) =>
      exclusive(() =>
        collecting(() => {
          runEdit(placeId, tokens);
          return Promise.resolve();
        }),
      ),
    setRate: (transitionId, perHour) =>
      exclusive(() => {
        runSetRate(transitionId, perHour);
        return Promise.resolve();
      }),
    rates: () => ({ ...rates }),
    setBreakpoints(next) {
      breakpoints = { transitions: [...next.transitions], places: { ...next.places } };
    },
    metrics: (): MetricsSnapshot => metrics.snapshot(s.time),
    canStepBack: () => history.length > 0,
    stepBack: () =>
      exclusive(() => {
        const previous = history.pop();
        if (previous) applySnapshot(previous);
        return Promise.resolve(previous !== undefined);
      }),
    snapshot: takeSnapshot,
    restore: (snapshot) =>
      exclusive(() => {
        applySnapshot(snapshot);
        return Promise.resolve();
      }),
    reset: (newSeed) =>
      exclusive(() => {
        initialEvents = initialise(newSeed ?? seed);
        return Promise.resolve([...initialEvents]);
      }),
  };
}
