import {
  computeBindings,
  isSourceTransition,
  placeRoles,
  type EnabledBinding,
  type Id,
  type Marking,
  type PetriNet,
  type PlaceRole,
  type Token,
  type Transition,
} from '@pnm/core';
import { initialMarking } from '../engine';
import { createMetrics, type MetricsSnapshot } from '../metrics';
import { createRng, type Rng } from '../random';
import type {
  AdvanceOptions,
  Breakpoints,
  EnabledView,
  Firing,
  ReplaySnapshot,
  SimEvent,
  SimSnapshot,
  SimState,
  Simulation,
  TokenMeta,
  TokenRef,
} from '../types';
import { autoMapActivities } from './mapping';
import { insertByTime, keyOf, prepareItems, toItem, type Item } from './prepare';
import type {
  ActivityMapping,
  DeviationKind,
  LiveEvent,
  LogEvent,
  ReplayOptions,
  ReplayStats,
} from './types';

type EventInput =
  | { type: 'spawn'; transitionId?: Id; caseId: string; tokens?: TokenRef[] }
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
  | { type: 'idle' }
  | { type: 'breakpoint'; kind: 'transition' | 'place'; elementId: Id }
  | { type: 'warning'; code: string; message: string; elementId?: Id }
  | {
      type: 'deviation';
      kind: DeviationKind;
      message: string;
      caseId?: string;
      transitionId?: Id;
      placeId?: Id;
      activity?: string;
    };

const DEFAULT_HISTORY_LIMIT = 500;

/** Tokens an arc moves: its weight, or the number of variables of an input inscription. */
interface Flow {
  placeId: Id;
  count: number;
}

/** What a replay needs besides the `Simulation` interface: feeding it events as they arrive. */
export interface ReplayCore {
  sim: Simulation;
  /** Adds events; those in the past are moved to the present. Only for `live` replays. */
  push(events: readonly LiveEvent[]): void;
  close(): void;
  readonly closed: boolean;
}

/** A tolerant reading of an attribute: numbers and truth values become such, the rest stays text. */
function typed(value: string): Token {
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

function isPlainObject(value: Token): value is Record<string, Token> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Builds the replay of an event log on a net. It is the engine of `createReplay` and
 * `createLiveReplay`; see `docs/replay.md` for the rules.
 */
export function buildReplay(
  net: PetriNet,
  events: readonly LogEvent[],
  options: ReplayOptions,
  live: boolean,
  now: () => number = () => 0,
): ReplayCore {
  const settings = net.simulation ?? {};
  const warmup = options.warmup ?? settings.warmup ?? 0;
  const isPt = net.profile === 'pt-net';
  const strict = options.strict === true;
  const mapping = options.mapping;

  const transitionById = new Map(net.transitions.map((t) => [t.id, t]));
  const placeById = new Map(net.places.map((p) => [p.id, p]));
  for (const [activity, id] of Object.entries(mapping)) {
    if (id !== null && !transitionById.has(id)) {
      throw new Error(
        `The activity "${activity}" is mapped to "${id}", which is not a transition of the net.`,
      );
    }
  }
  const roles: Map<Id, PlaceRole> = placeRoles(net);
  const sourceIds = new Set(
    net.transitions.filter((t) => isSourceTransition(net, t.id)).map((t) => t.id),
  );

  const countOf = (inscription: string | undefined, weight: number, input: boolean): number => {
    if (isPt || !input || inscription === undefined || inscription.trim() === '') return weight;
    return Math.max(1, inscription.split(',').filter((part) => part.trim() !== '').length);
  };
  const flows = (transitionId: Id, input: boolean): Flow[] => {
    const result = new Map<Id, number>();
    for (const arc of net.arcs) {
      const place = input ? arc.source : arc.target;
      const other = input ? arc.target : arc.source;
      if (other !== transitionId || !placeById.has(place)) continue;
      result.set(place, (result.get(place) ?? 0) + countOf(arc.inscription, arc.weight, input));
    }
    return [...result].map(([placeId, count]) => ({ placeId, count }));
  };
  const inputsOf = new Map<Id, Flow[]>();
  const outputsOf = new Map<Id, Flow[]>();
  for (const t of net.transitions) {
    inputsOf.set(t.id, flows(t.id, true));
    outputsOf.set(t.id, flows(t.id, false));
  }

  /** The mapping of a live replay grows when activities are matched as they arrive. */
  const liveMapping: ActivityMapping = { ...mapping };
  const useRandom = options.seed !== undefined;
  const rng: Rng = createRng(options.seed ?? 1);
  const metrics = createMetrics(net, warmup);
  const historyLimit = DEFAULT_HISTORY_LIMIT;

  // --- the log -----------------------------------------------------------------------------------
  const items: Item[] = prepareItems(
    events,
    mapping,
    live ? 'zero' : (options.completeOnly ?? 'zero'),
  );
  /** Live only: the latest time of any event that has arrived. */
  let frontier = items.reduce((latest, item) => Math.max(latest, item.time), 0);
  let closed = false;

  // --- mutable state -------------------------------------------------------------------------
  const s: SimState = {
    time: 0,
    marking: {},
    meta: {},
    running: [],
    nextArrival: {},
    counters: { event: 0, case: 0, firing: 0, token: 0 },
  };
  let cursor = 0;
  let consumed = 0;
  let produced = 0;
  let missing = 0;
  let missingBy: Record<Id, number> = {};
  let ignored = 0;
  let guardCount = 0;
  let guardNoted = false;
  let idleReported = false;
  /**
   * Within one instant: starts and completes that another row of the same activity already carried
   * out (a firing of several cases is listed once per case).
   */
  let absorbedStarts: Record<string, number> = {};
  let skipCompletes: Record<string, number> = {};
  /** Cases that have started, in order; append-only so that a state is just a length. */
  const seenOrder: string[] = [];
  const seen = new Set<string>();
  let breakpoints: Breakpoints = { transitions: [], places: {} };
  let history: SimSnapshot[] = [];
  let out: SimEvent[] = [];

  const emit = (input: EventInput): SimEvent => {
    s.counters.event += 1;
    const event = { ...input, id: s.counters.event, t: s.time } as SimEvent;
    metrics.apply(event);
    out.push(event);
    return event;
  };

  const newMeta = (caseId: string | undefined, t: number): TokenMeta => {
    s.counters.token += 1;
    return {
      id: `k${s.counters.token}`,
      ...(caseId !== undefined && { caseId }),
      enteredAt: t,
    };
  };

  const nameOfPlace = (id: Id): string => placeById.get(id)?.name ?? id;
  const nameOfTransition = (id: Id): string => transitionById.get(id)?.name ?? id;

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

  // --- initial state ---------------------------------------------------------------------------
  function initialise(): void {
    s.time = 0;
    s.marking = initialMarking(net);
    s.meta = {};
    s.running = [];
    s.nextArrival = {};
    s.counters = { event: 0, case: 0, firing: 0, token: 0 };
    cursor = 0;
    consumed = 0;
    produced = 0;
    missing = 0;
    missingBy = {};
    ignored = 0;
    guardCount = 0;
    guardNoted = false;
    idleReported = false;
    seenOrder.length = 0;
    seen.clear();
    history = [];
    metrics.setState(createMetrics(net, warmup).getState());
    out = [];
    rng.setState(createRng(options.seed ?? 1).getState());
    // Tokens of resources stay. The tokens of the other places have no case yet: the first event
    // of a case that needs one takes it over.
    for (const place of net.places) {
      const tokens = s.marking[place.id] ?? [];
      if (tokens.length === 0) continue;
      s.meta[place.id] = tokens.map(() => newMeta(undefined, 0));
    }
  }

  // --- snapshots -------------------------------------------------------------------------------
  function takeSnapshot(): SimSnapshot {
    const replay: ReplaySnapshot = {
      cursor,
      consumed,
      produced,
      missing,
      missingByPlace: { ...missingBy },
      ignored,
      guard: guardCount,
      guardNoted,
      seen: seenOrder.length,
    };
    return {
      time: s.time,
      marking: { ...s.marking },
      meta: { ...s.meta },
      running: [...s.running],
      nextArrival: {},
      counters: { ...s.counters },
      rates: {},
      rngState: rng.getState(),
      startsPending: false,
      idleReported,
      blocked: [],
      metrics: metrics.getState(),
      replay,
    };
  }

  function applySnapshot(snapshot: SimSnapshot): void {
    const replay = snapshot.replay;
    if (!replay) throw new Error('This snapshot does not belong to a replay of an event log');
    s.time = snapshot.time;
    s.marking = { ...snapshot.marking };
    s.meta = { ...snapshot.meta };
    s.running = [...snapshot.running];
    s.nextArrival = {};
    s.counters = { ...snapshot.counters };
    rng.setState(snapshot.rngState);
    idleReported = snapshot.idleReported;
    metrics.setState(snapshot.metrics);
    cursor = replay.cursor;
    consumed = replay.consumed;
    produced = replay.produced;
    missing = replay.missing;
    missingBy = { ...replay.missingByPlace };
    ignored = replay.ignored;
    guardCount = replay.guard;
    guardNoted = replay.guardNoted;
    while (seenOrder.length > replay.seen) seen.delete(seenOrder.pop()!);
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

  async function collecting(work: () => Promise<void>): Promise<SimEvent[]> {
    out = [];
    try {
      await work();
      return out;
    } finally {
      out = [];
    }
  }

  // --- tokens ----------------------------------------------------------------------------------
  /** The value of a token that the replay makes for a case: `1`, or in JSON nets the case with its data. */
  function tokenValue(caseId: string, attributes: Item['attributes'], base?: Token): Token {
    if (isPt) return 1;
    const data: Record<string, Token> = {};
    for (const [key, value] of Object.entries(attributes ?? {})) data[key] = typed(value);
    return { ...(base !== undefined && isPlainObject(base) ? base : {}), caseId, ...data };
  }

  function deviate(
    kind: DeviationKind,
    message: string,
    extra: { caseId?: string; transitionId?: Id; placeId?: Id; activity?: string },
  ): void {
    emit({ type: 'deviation', kind, message, ...extra });
  }

  function slotFor(transitionId: Id): number {
    const used = new Set(
      s.running.filter((f) => f.transitionId === transitionId).map((f) => f.slot),
    );
    let slot = 0;
    while (used.has(slot)) slot += 1;
    return slot;
  }

  /** Starts a firing now with the tokens that were taken. */
  function launch(
    transition: Transition,
    caseIds: string[],
    consumes: Record<Id, Token[]>,
    refs: TokenRef[],
    end: number,
  ): Firing {
    s.counters.firing += 1;
    const binding: EnabledBinding = {
      transitionId: transition.id,
      binding: {},
      consumes,
      produces: {},
    };
    const firing: Firing = {
      id: s.counters.firing,
      transitionId: transition.id,
      binding,
      caseIds,
      start: s.time,
      end,
      slot: slotFor(transition.id),
    };
    s.running = [...s.running, firing];
    emit({
      type: 'start',
      transitionId: transition.id,
      firingId: firing.id,
      slot: firing.slot,
      caseIds: [...caseIds],
      binding: {},
      consumed: refs,
    });
    consumed += refs.length;
    return firing;
  }

  /** Puts the output of a firing on the places. */
  function finish(firing: Firing, attributes: Item['attributes']): void {
    s.running = s.running.filter((f) => f.id !== firing.id);
    const inherited = firing.caseIds[0];
    const tokensOfCase = Object.entries(firing.binding.consumes)
      .filter(([placeId]) => roles.get(placeId) !== 'resource')
      .flatMap(([, tokens]) => tokens);
    const base = tokensOfCase[0];
    const refs: TokenRef[] = [];
    for (const { placeId, count } of outputsOf.get(firing.transitionId) ?? []) {
      const resource = roles.get(placeId) === 'resource';
      // A resource is given back as it was taken.
      const returned = resource ? [...(firing.binding.consumes[placeId] ?? [])] : [];
      const values = [...(s.marking[placeId] ?? [])];
      const metas = [...(s.meta[placeId] ?? [])];
      for (let k = 0; k < count; k += 1) {
        const value: Token = resource
          ? (returned.shift() ?? 1)
          : tokenValue(inherited ?? '', attributes, base);
        const meta = newMeta(resource ? undefined : inherited, s.time);
        values.push(value);
        metas.push(meta);
        refs.push({
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
      produced: refs,
    });
    produced += refs.length;
  }

  // --- the beginning of a case ---------------------------------------------------------------------
  /** A source transition that puts tokens on one of `placeIds`. */
  function sourceFeeding(placeIds: ReadonlySet<Id>): Transition | undefined {
    return net.transitions.find(
      (t) =>
        sourceIds.has(t.id) && (outputsOf.get(t.id) ?? []).some((f) => placeIds.has(f.placeId)),
    );
  }

  /**
   * A case enters with its first event: it takes over a token of the initial marking, enters
   * through a source transition that feeds the transition, or gets the tokens it needs.
   */
  function beginCase(caseId: string, transition: Transition, attributes: Item['attributes']): void {
    seen.add(caseId);
    seenOrder.push(caseId);
    s.counters.case += 1;
    const inputs = (inputsOf.get(transition.id) ?? []).filter(
      (f) => roles.get(f.placeId) !== 'resource',
    );
    if (inputs.length === 0) {
      emit({
        type: 'spawn',
        ...(sourceIds.has(transition.id) && { transitionId: transition.id }),
        caseId,
      });
      return;
    }
    // 1. Tokens of the initial marking that no case has yet.
    const lacking: Flow[] = [];
    for (const { placeId, count } of inputs) {
      const values = s.marking[placeId] ?? [];
      const metas = [...(s.meta[placeId] ?? [])];
      let need = count;
      for (let i = 0; i < metas.length && need > 0; i += 1) {
        const meta = metas[i]!;
        if (meta.caseId !== undefined) continue;
        metas[i] = { ...meta, caseId };
        need -= 1;
        produced += 1;
      }
      if (need < count) setPlace(placeId, [...values], metas);
      if (need > 0) lacking.push({ placeId, count: need });
    }
    // 2. A source transition lets the case in.
    const via =
      lacking.length > 0 ? sourceFeeding(new Set(lacking.map((f) => f.placeId))) : undefined;
    if (via !== undefined) {
      emit({ type: 'spawn', transitionId: via.id, caseId });
      const firing = launch(via, [caseId], {}, [], s.time);
      finish(firing, attributes);
      return;
    }
    // 3. No transition brings cases in: the tokens it needs appear with the case.
    const refs: TokenRef[] = [];
    for (const { placeId, count } of lacking) {
      const values = [...(s.marking[placeId] ?? [])];
      const metas = [...(s.meta[placeId] ?? [])];
      for (let k = 0; k < count; k += 1) {
        const meta = newMeta(caseId, s.time);
        values.push(tokenValue(caseId, attributes));
        metas.push(meta);
        refs.push({ placeId, tokenId: meta.id, caseId });
      }
      setPlace(placeId, values, metas);
    }
    produced += refs.length;
    emit({ type: 'spawn', caseId, ...(refs.length > 0 && { tokens: refs }) });
  }

  // --- guards ------------------------------------------------------------------------------------
  const guardNets = new Map<Id, PetriNet>();
  /** Does the transition accept the tokens it took? Only the guard and the input inscriptions count. */
  async function guardHolds(
    transition: Transition,
    consumes: Record<Id, Token[]>,
  ): Promise<boolean> {
    let guardNet = guardNets.get(transition.id);
    if (!guardNet) {
      guardNet = { ...net, arcs: net.arcs.filter((a) => a.source !== transition.id) };
      guardNets.set(transition.id, guardNet);
    }
    const marking: Marking = {};
    for (const [placeId, tokens] of Object.entries(consumes)) marking[placeId] = tokens;
    const found = await computeBindings(guardNet, marking, transition.id, { maxBindings: 1 });
    return found.bindings.length > 0;
  }

  // --- one event of the log ----------------------------------------------------------------------
  /** Cases that start `transitionId` at the same time as the event at the cursor does. */
  function fellowsOf(item: Item): Set<string> {
    const cases = new Set<string>();
    for (let i = cursor + 1; i < items.length; i += 1) {
      const other = items[i]!;
      if (other.time > item.time) break;
      if (
        other.type === 'start' &&
        other.transitionId === item.transitionId &&
        other.caseId !== item.caseId
      ) {
        cases.add(other.caseId);
      }
    }
    return cases;
  }

  async function startActivity(item: Item, end: number): Promise<Firing> {
    const transition = transitionById.get(item.transitionId!)!;
    const caseId = item.caseId;
    if (!seen.has(caseId)) beginCase(caseId, transition, item.attributes);
    const inputs = inputsOf.get(transition.id) ?? [];
    // An activity that joins several case places takes the oldest token of each, whichever case
    // it belongs to (cases overtake each other). The log then lists the activity once per case,
    // at the same time: those cases carry out one firing.
    const joins = inputs.filter((f) => roles.get(f.placeId) !== 'resource').length >= 2;
    const fellows = joins ? fellowsOf(item) : null;
    /** The cases whose tokens the firing takes, in the order of consumption. */
    const participants: string[] = [];
    const refs: TokenRef[] = [];
    const consumes: Record<Id, Token[]> = {};
    for (const { placeId, count } of inputs) {
      const resource = roles.get(placeId) === 'resource';
      const values = [...(s.marking[placeId] ?? [])];
      const metas = [...(s.meta[placeId] ?? [])];
      const picked: number[] = [];
      if (resource) {
        const free = values.map((_, i) => i);
        while (picked.length < count && free.length > 0) {
          const at = useRandom
            ? Math.min(free.length - 1, Math.floor(rng.next() * free.length))
            : 0;
          picked.push(free.splice(at, 1)[0]!);
        }
      } else {
        for (let i = 0; i < metas.length && picked.length < count; i += 1) {
          const owner = metas[i]!.caseId;
          if (owner === undefined) continue;
          if (owner === caseId || (fellows !== null && fellows.has(owner))) {
            picked.push(i);
            if (!participants.includes(owner)) participants.push(owner);
          }
        }
      }
      const taken: Token[] = [];
      for (const index of picked) {
        const meta = metas[index]!;
        taken.push(values[index]!);
        refs.push({
          placeId,
          tokenId: meta.id,
          ...(meta.caseId !== undefined && { caseId: meta.caseId }),
          since: meta.enteredAt,
        });
      }
      [...picked]
        .sort((a, b) => b - a)
        .forEach((index) => {
          values.splice(index, 1);
          metas.splice(index, 1);
        });
      setPlace(placeId, values, metas);
      // What the activity found missing is created, reported, and taken on the spot.
      for (let k = picked.length; k < count; k += 1) {
        const meta = newMeta(resource ? undefined : caseId, s.time);
        const value: Token = resource ? 1 : tokenValue(caseId, item.attributes);
        missing += 1;
        missingBy = { ...missingBy, [placeId]: (missingBy[placeId] ?? 0) + 1 };
        deviate(
          'missing',
          `"${nameOfTransition(transition.id)}" of case ${caseId} found no token on "${nameOfPlace(placeId)}"; one was created.`,
          { caseId, transitionId: transition.id, placeId, activity: item.activity },
        );
        taken.push(value);
        refs.push({
          placeId,
          tokenId: meta.id,
          ...(meta.caseId !== undefined && { caseId: meta.caseId }),
          since: s.time,
        });
      }
      consumes[placeId] = taken;
    }
    // The case of the event is part of the firing even if its own tokens were not the oldest.
    const caseIds = participants.includes(caseId) ? participants : [caseId, ...participants];
    for (const other of caseIds) {
      if (other === caseId) continue;
      const key = keyOf(other, transition.id);
      absorbedStarts[key] = (absorbedStarts[key] ?? 0) + 1;
    }
    if (!isPt && (transition.guard ?? '').trim() !== '') {
      if (strict) {
        if (!(await guardHolds(transition, consumes))) {
          guardCount += 1;
          deviate(
            'guard',
            `The guard of "${nameOfTransition(transition.id)}" is not satisfied by the tokens of case ${caseId}.`,
            { caseId, transitionId: transition.id, activity: item.activity },
          );
        }
      } else if (!guardNoted) {
        guardNoted = true;
        emit({
          type: 'warning',
          code: 'REPLAY_GUARDS_NOT_CHECKED',
          message: `A replay does not check guards (first one met: "${nameOfTransition(transition.id)}").`,
          elementId: transition.id,
        });
      }
    }
    return launch(transition, caseIds, consumes, refs, end);
  }

  /** The cases of the rows that end `transitionId` from the cursor on within this instant, in order. */
  function completersOf(item: Item): string[] {
    const cases = [item.caseId];
    for (let i = cursor + 1; i < items.length; i += 1) {
      const other = items[i]!;
      if (other.time > item.time) break;
      if (
        other.type === 'complete' &&
        other.transitionId === item.transitionId &&
        !cases.includes(other.caseId)
      ) {
        cases.push(other.caseId);
      }
    }
    return cases;
  }

  async function completeActivity(item: Item): Promise<void> {
    const transitionId = item.transitionId!;
    const key = keyOf(item.caseId, transitionId);
    if ((skipCompletes[key] ?? 0) > 0) {
      // A row of the same activity at this time has already ended the firing of this case.
      skipCompletes[key] = skipCompletes[key]! - 1;
      return;
    }
    const candidates = s.running.filter(
      (f) => f.transitionId === transitionId && f.caseIds.includes(item.caseId),
    );
    // Of several firings of the case, the one whose cases are the next rows of the log, in their
    // order (a firing is listed case by case), else one whose cases all end now, else the oldest.
    let firing = candidates[0];
    if (candidates.length > 1) {
      const rows = completersOf(item);
      firing =
        candidates.find((f) => f.caseIds.every((c, i) => rows[i] === c)) ??
        candidates.find((f) => f.caseIds.every((c) => rows.includes(c))) ??
        firing;
    }
    // The log has no start for this activity: it takes no time (`span` was settled beforehand).
    firing ??= await startActivity(item, s.time);
    for (const other of firing.caseIds) {
      if (other === item.caseId) continue;
      const otherKey = keyOf(other, transitionId);
      skipCompletes[otherKey] = (skipCompletes[otherKey] ?? 0) + 1;
    }
    finish(firing, item.attributes);
  }

  async function processItem(item: Item): Promise<void> {
    if (item.transitionId === null) {
      ignored += 1;
      deviate(
        'ignored',
        `"${item.activity}" of case ${item.caseId} is not mapped to a transition and was skipped.`,
        { caseId: item.caseId, activity: item.activity },
      );
      return;
    }
    if (item.type === 'complete') {
      await completeActivity(item);
      return;
    }
    const key = keyOf(item.caseId, item.transitionId);
    if ((absorbedStarts[key] ?? 0) > 0) {
      // Another case of the log already carried this activity out.
      absorbedStarts[key] = absorbedStarts[key]! - 1;
      return;
    }
    await startActivity(item, item.end ?? Infinity);
  }

  // --- one instant -------------------------------------------------------------------------------
  async function instant(t: number): Promise<void> {
    s.time = Math.max(s.time, t);
    idleReported = false;
    absorbedStarts = {};
    skipCompletes = {};
    while (cursor < items.length && items[cursor]!.time <= t) {
      await processItem(items[cursor]!);
      cursor += 1;
    }
  }

  function nextTime(): number | null {
    const item = items[cursor];
    return item === undefined ? null : Math.max(item.time, s.time);
  }

  function reportIdle(): void {
    if (idleReported) return;
    idleReported = true;
    emit({ type: 'idle' });
  }

  function watchedCounts(): Map<Id, number> {
    const counts = new Map<Id, number>();
    for (const placeId of Object.keys(breakpoints.places)) {
      counts.set(placeId, s.marking[placeId]?.length ?? 0);
    }
    return counts;
  }

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

  async function processInstant(t: number): Promise<boolean> {
    const previous = takeSnapshot();
    const before = watchedCounts();
    const from = out.length;
    await instant(t);
    if (out.length > from || cursor !== previous.replay!.cursor) {
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
    // A live replay never runs ahead of the events that have arrived.
    const target = Math.min(
      s.time + Math.max(0, seconds),
      live ? Math.max(frontier, s.time) : Infinity,
    );
    for (;;) {
      const t = nextTime();
      if (t === null) {
        reportIdle();
        if (Number.isFinite(target)) s.time = Math.max(s.time, target);
        return;
      }
      if (t > target) {
        s.time = Math.max(s.time, target);
        return;
      }
      const hit = await processInstant(t);
      if (hit) return;
      if (opts.maxEvents !== undefined && out.length >= opts.maxEvents) return;
    }
  }

  // --- statistics --------------------------------------------------------------------------------
  function replayStats(base: MetricsSnapshot): ReplayStats {
    // A case is finished when one of its tokens is on a sink place; tokens it leaves behind
    // elsewhere were never consumed.
    const finished = new Set<string>();
    for (const [placeId, metas] of Object.entries(s.meta)) {
      if (roles.get(placeId) !== 'sink') continue;
      for (const meta of metas) if (meta.caseId !== undefined) finished.add(meta.caseId);
    }
    let remaining = 0;
    for (const [placeId, metas] of Object.entries(s.meta)) {
      const role = roles.get(placeId);
      if (role === 'sink' || role === 'resource') continue;
      for (const meta of metas)
        if (meta.caseId !== undefined && finished.has(meta.caseId)) remaining += 1;
    }
    const fitness =
      consumed === 0 && produced === 0
        ? null
        : 1 -
          (consumed > 0 ? missing / consumed : 0) / 2 -
          (produced > 0 ? remaining / produced : 0) / 2;
    return {
      fitness,
      consumed,
      produced,
      missing,
      remaining,
      missingByPlace: { ...missingBy },
      ignored,
      guard: guardCount,
      openCases: base.casesInSystem,
      processed: cursor,
      total: items.length,
    };
  }

  initialise();

  const sim: Simulation = {
    get state() {
      return s;
    },
    net,
    initialEvents: [],
    nextEventTime: nextTime,
    step: () => exclusive(() => collecting(runStep)),
    advance: (seconds, opts = {}) => exclusive(() => collecting(() => runAdvance(seconds, opts))),
    stepRandom: () => exclusive(() => collecting(runStep)),
    fireManually: () =>
      Promise.reject(
        new Error('Transitions cannot be fired by hand while an event log is replayed.'),
      ),
    enabled: () => Promise.resolve<EnabledView>({ enabled: new Map(), diagnostics: [] }),
    editMarking: () =>
      Promise.reject(new Error('The marking cannot be edited while an event log is replayed.')),
    setRate: () =>
      Promise.reject(new Error('Arrival rates do not apply while an event log is replayed.')),
    rates: () => ({}),
    setBreakpoints(next) {
      breakpoints = { transitions: [...next.transitions], places: { ...next.places } };
    },
    metrics: (): MetricsSnapshot => {
      const base = metrics.snapshot(s.time);
      return { ...base, replay: replayStats(base) };
    },
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
    reset: () =>
      exclusive(() => {
        initialise();
        return Promise.resolve([]);
      }),
  };

  function push(input: readonly LiveEvent[]): void {
    if (!live) throw new Error('Events can only be added to a live replay.');
    if (closed) throw new Error('The live feed has been closed.');
    for (const entry of input) {
      const stamped = entry.time ?? now();
      if (!Number.isFinite(stamped)) {
        throw new Error(`The event of case ${entry.caseId} has no valid time.`);
      }
      if (entry.lifecycle !== 'start' && entry.lifecycle !== 'complete') {
        throw new Error(`The lifecycle of an event must be "start" or "complete".`);
      }
      // An event that arrives late is taken at the present moment.
      const time = Math.max(stamped, s.time);
      if (options.autoMap === true && !Object.hasOwn(liveMapping, entry.activity)) {
        const found = autoMapActivities(net, [entry.activity]).mapping[entry.activity];
        liveMapping[entry.activity] = found ?? null;
      }
      const item = toItem({ ...entry, time }, liveMapping);
      insertByTime(items, cursor, item);
      frontier = Math.max(frontier, time);
      // The firing that this event ends now knows when.
      if (item.type === 'complete' && item.transitionId !== null) {
        const firing = s.running.find(
          (f) =>
            f.transitionId === item.transitionId &&
            f.caseIds.includes(item.caseId) &&
            f.end === Infinity,
        );
        if (firing) s.running = s.running.map((f) => (f === firing ? { ...f, end: time } : f));
      }
    }
    idleReported = false;
  }

  return {
    sim,
    push,
    close() {
      closed = true;
    },
    get closed() {
      return closed;
    },
  };
}

/**
 * Replays an event log on a net as a simulation: cases enter with their first event, activities
 * take the tokens of their case when they start and put tokens on the next places when they end,
 * at the times of the log. Where the log does not fit the net, tokens are created and deviations
 * reported. It has the interface of the engine, so everything that works on a simulation works on
 * a replay; the rules are in `docs/replay.md`.
 */
export function createReplay(
  net: PetriNet,
  events: readonly LogEvent[],
  options: ReplayOptions,
): Simulation {
  return buildReplay(net, events, options, false).sim;
}
