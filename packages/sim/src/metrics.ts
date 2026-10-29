import { placeRoles, type Id, type PetriNet, type PlaceRole } from '@pnm/core';
import type { ReplayStats } from './replay/types';
import type { SimEvent, TokenRef } from './types';

export interface PlaceStats {
  placeId: Id;
  role: PlaceRole;
  /** Tokens on the place now. */
  current: number;
  /** Time-weighted mean number of tokens since the warm-up. */
  mean: number;
  max: number;
  /** Mean time a token waited on the place before it was taken (seconds); `null` if none was. */
  meanWait: number | null;
}

export interface ResourceStats {
  placeId: Id;
  free: number;
  inUse: number;
  /** Free plus in use. */
  capacity: number;
  /** Share of the capacity that was in use since the warm-up, 0 to 1. */
  utilization: number;
}

export interface MetricsSnapshot {
  /** Time up to which the figures are accrued. */
  time: number;
  /** Seconds observed (since the warm-up). */
  observed: number;
  places: PlaceStats[];
  resources: ResourceStats[];
  /** Cases that have entered and not yet reached a sink. */
  casesInSystem: number;
  /** Cases that reached a sink since the warm-up. */
  completedCases: number;
  /** Completed cases per hour of observed time; `null` before one second was observed. */
  throughputPerHour: number | null;
  /** Mean time from the arrival of a case to its first token in a sink (seconds). */
  meanCycleTime: number | null;
  maxCycleTime: number | null;
  /** Fitness and deviations; only a replay of an event log has them. */
  replay?: ReplayStats;
}

/** Everything `Metrics` needs to continue from an earlier point. Cheap to take. */
export interface MetricsState {
  lastTime: number;
  count: Record<Id, number>;
  area: Record<Id, number>;
  max: Record<Id, number>;
  waitSum: Record<Id, number>;
  waitN: Record<Id, number>;
  inUse: Record<Id, number>;
  inUseArea: Record<Id, number>;
  capacityArea: Record<Id, number>;
  caseCount: number;
  doneCount: number;
  cycleSum: number;
  cycleN: number;
  cycleMax: number;
}

export interface Metrics {
  apply(event: SimEvent): void;
  /** The figures, accrued up to `time` (default: the time of the last event). */
  snapshot(time?: number): MetricsSnapshot;
  getState(): MetricsState;
  setState(state: MetricsState): void;
}

const copy = (record: Record<Id, number>): Record<Id, number> => ({ ...record });

/**
 * Key figures computed incrementally from the event stream. Events before `warmup` seconds are
 * applied to the state but not counted in the figures.
 */
export function createMetrics(net: PetriNet, warmup = 0): Metrics {
  const roles = placeRoles(net);
  const placeIds = net.places.map((p) => p.id);
  const resourceIds = placeIds.filter((id) => roles.get(id) === 'resource');

  // Append-only records of cases, so that a state is just a pair of lengths.
  const caseOrder: string[] = [];
  const caseBorn: number[] = [];
  const caseDone: boolean[] = [];
  const caseIndex = new Map<string, number>();
  const doneLog: number[] = [];

  let st: MetricsState = {
    lastTime: 0,
    count: {},
    area: {},
    max: {},
    waitSum: {},
    waitN: {},
    inUse: {},
    inUseArea: {},
    capacityArea: {},
    caseCount: 0,
    doneCount: 0,
    cycleSum: 0,
    cycleN: 0,
    cycleMax: 0,
  };
  for (const id of placeIds) {
    const n = net.marking[id]?.length ?? 0;
    st.count[id] = n;
    st.max[id] = 0;
    st.area[id] = 0;
    st.waitSum[id] = 0;
    st.waitN[id] = 0;
  }
  for (const id of resourceIds) {
    st.inUse[id] = 0;
    st.inUseArea[id] = 0;
    st.capacityArea[id] = 0;
  }

  /** Brings the time-weighted sums up to `t`. */
  const accrue = (t: number): void => {
    if (t <= st.lastTime) return;
    const from = Math.max(st.lastTime, warmup);
    if (t > from) {
      const dt = t - from;
      // The counts are constant between two events. A state that lasts no time (tokens that
      // arrive and are taken within one instant) is not a maximum.
      for (const id of placeIds) st.max[id] = Math.max(st.max[id] ?? 0, st.count[id] ?? 0);
      for (const id of placeIds) st.area[id] = (st.area[id] ?? 0) + (st.count[id] ?? 0) * dt;
      for (const id of resourceIds) {
        const busy = st.inUse[id] ?? 0;
        st.inUseArea[id] = (st.inUseArea[id] ?? 0) + busy * dt;
        st.capacityArea[id] = (st.capacityArea[id] ?? 0) + ((st.count[id] ?? 0) + busy) * dt;
      }
    }
    st.lastTime = t;
  };

  const add = (placeId: Id, delta: number): void => {
    st.count[placeId] = (st.count[placeId] ?? 0) + delta;
  };

  const finishCase = (caseId: string, t: number): void => {
    const index = caseIndex.get(caseId);
    if (index === undefined || caseDone[index]) return;
    caseDone[index] = true;
    doneLog.push(index);
    st.doneCount = doneLog.length;
    if (t >= warmup) {
      const cycle = t - (caseBorn[index] ?? t);
      st.cycleSum += cycle;
      st.cycleN += 1;
      st.cycleMax = Math.max(st.cycleMax, cycle);
    }
  };

  const arrive = (ref: TokenRef, t: number): void => {
    add(ref.placeId, 1);
    if (roles.get(ref.placeId) === 'resource') {
      st.inUse[ref.placeId] = Math.max(0, (st.inUse[ref.placeId] ?? 0) - 1);
    } else if (roles.get(ref.placeId) === 'sink' && ref.caseId !== undefined) {
      finishCase(ref.caseId, t);
    }
  };

  return {
    apply(event) {
      accrue(event.t);
      switch (event.type) {
        case 'spawn': {
          // Tokens that a replay creates for a new case.
          for (const ref of event.tokens ?? []) add(ref.placeId, 1);
          if (!caseIndex.has(event.caseId)) {
            caseIndex.set(event.caseId, caseOrder.length);
            caseOrder.push(event.caseId);
            caseBorn.push(event.t);
            caseDone.push(false);
            st.caseCount = caseOrder.length;
          }
          break;
        }
        case 'start': {
          for (const ref of event.consumed) {
            add(ref.placeId, -1);
            const role = roles.get(ref.placeId);
            if (role === 'resource') {
              st.inUse[ref.placeId] = (st.inUse[ref.placeId] ?? 0) + 1;
            } else if (ref.since !== undefined && event.t >= warmup) {
              st.waitSum[ref.placeId] = (st.waitSum[ref.placeId] ?? 0) + (event.t - ref.since);
              st.waitN[ref.placeId] = (st.waitN[ref.placeId] ?? 0) + 1;
            }
          }
          break;
        }
        case 'complete': {
          for (const ref of event.produced) arrive(ref, event.t);
          break;
        }
        case 'marking-edited':
          add(event.placeId, event.delta);
          break;
        case 'deviation':
          // The token that the replay had to create is taken by the `start` that follows.
          if (event.kind === 'missing' && event.placeId !== undefined) add(event.placeId, 1);
          break;
        default:
          break;
      }
    },

    snapshot(time) {
      accrue(time ?? st.lastTime);
      const observed = Math.max(0, st.lastTime - warmup);
      const places: PlaceStats[] = placeIds.map((id) => ({
        placeId: id,
        role: roles.get(id) ?? 'case',
        current: st.count[id] ?? 0,
        mean: observed > 0 ? (st.area[id] ?? 0) / observed : (st.count[id] ?? 0),
        // The state now has held since the last event.
        max: Math.max(st.max[id] ?? 0, st.lastTime >= warmup ? (st.count[id] ?? 0) : 0),
        meanWait: (st.waitN[id] ?? 0) > 0 ? (st.waitSum[id] ?? 0) / (st.waitN[id] ?? 1) : null,
      }));
      const resources: ResourceStats[] = resourceIds.map((id) => {
        const free = st.count[id] ?? 0;
        const inUse = st.inUse[id] ?? 0;
        const capacityArea = st.capacityArea[id] ?? 0;
        return {
          placeId: id,
          free,
          inUse,
          capacity: free + inUse,
          utilization: capacityArea > 0 ? (st.inUseArea[id] ?? 0) / capacityArea : 0,
        };
      });
      return {
        time: st.lastTime,
        observed,
        places,
        resources,
        casesInSystem: st.caseCount - st.doneCount,
        completedCases: st.cycleN,
        throughputPerHour: observed >= 1 ? (st.cycleN / observed) * 3600 : null,
        meanCycleTime: st.cycleN > 0 ? st.cycleSum / st.cycleN : null,
        maxCycleTime: st.cycleN > 0 ? st.cycleMax : null,
      };
    },

    getState() {
      return {
        ...st,
        count: copy(st.count),
        area: copy(st.area),
        max: copy(st.max),
        waitSum: copy(st.waitSum),
        waitN: copy(st.waitN),
        inUse: copy(st.inUse),
        inUseArea: copy(st.inUseArea),
        capacityArea: copy(st.capacityArea),
      };
    },

    setState(state) {
      // Cases born or finished after the state was taken are forgotten again.
      while (doneLog.length > state.doneCount) {
        const index = doneLog.pop()!;
        caseDone[index] = false;
      }
      while (caseOrder.length > state.caseCount) {
        const id = caseOrder.pop()!;
        caseBorn.pop();
        caseDone.pop();
        caseIndex.delete(id);
      }
      st = {
        ...state,
        count: copy(state.count),
        area: copy(state.area),
        max: copy(state.max),
        waitSum: copy(state.waitSum),
        waitN: copy(state.waitN),
        inUse: copy(state.inUse),
        inUseArea: copy(state.inUseArea),
        capacityArea: copy(state.capacityArea),
      };
    },
  };
}
