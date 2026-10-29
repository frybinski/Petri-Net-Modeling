import { createEmptyNet, type PetriNet } from '@pnm/core';
import type { ActivityMapping, LogEvent } from '@pnm/sim';
import type { ReplayLog } from '../lib/replay-log';

/** arrive (360/h) -> wait -> serve (10 s, one clerk) -> done */
export function shop(): PetriNet {
  const net = createEmptyNet('Shop');
  for (const id of ['wait', 'clerk', 'done']) {
    net.places.push({ id, name: id === 'wait' ? 'Queue' : id, position: { x: 0, y: 0 } });
  }
  net.marking['clerk'] = [1];
  net.transitions.push(
    { id: 'arrive', name: 'Arrive', position: { x: 0, y: 0 }, rate: 360 },
    { id: 'serve', name: 'Serve', position: { x: 0, y: 0 }, timing: { kind: 'fixed', value: 10 } },
  );
  const arcs: Array<[string, string]> = [
    ['arrive', 'wait'],
    ['wait', 'serve'],
    ['clerk', 'serve'],
    ['serve', 'clerk'],
    ['serve', 'done'],
  ];
  arcs.forEach(([source, target], i) => net.arcs.push({ id: `a${i}`, source, target, weight: 1 }));
  net.simulation = { startTime: '2026-01-05T08:00:00Z' };
  return net;
}

const row = (
  caseId: string,
  activity: string,
  time: number,
  lifecycle: LogEvent['lifecycle'],
): LogEvent => ({ caseId, activity, time, lifecycle });

/** Three customers, one after the other at the one clerk: the log fits the net. */
export function fittingLog(): LogEvent[] {
  return ['c1', 'c2', 'c3'].flatMap((id, i) => [
    row(id, 'Arrive', i * 10, 'start'),
    row(id, 'Arrive', i * 10, 'complete'),
    row(id, 'Serve', i * 10 + 1, 'start'),
    row(id, 'Serve', i * 10 + 11, 'complete'),
  ]);
}

/** Two customers are served at the same time by the one clerk: a token has to be created. */
export function overlappingLog(): LogEvent[] {
  return [
    row('c1', 'Arrive', 0, 'start'),
    row('c1', 'Arrive', 0, 'complete'),
    row('c2', 'Arrive', 1, 'start'),
    row('c2', 'Arrive', 1, 'complete'),
    row('c1', 'Serve', 2, 'start'),
    row('c2', 'Serve', 3, 'start'),
    row('c1', 'Serve', 12, 'complete'),
    row('c2', 'Serve', 13, 'complete'),
  ];
}

export const SHOP_MAPPING: ActivityMapping = { Arrive: 'arrive', Serve: 'serve' };

export function replayLogOf(events: LogEvent[], fileName = 'shop.csv'): ReplayLog {
  const activities = [...new Set(events.map((e) => e.activity))];
  return {
    fileName,
    events,
    activities,
    cases: new Set(events.map((e) => e.caseId)).size,
    span: (events.at(-1)?.time ?? 0) - (events[0]?.time ?? 0),
    origin: '2026-01-05T08:00:00.000Z',
    mapping: SHOP_MAPPING,
    completeOnly: 'zero',
    strict: false,
  };
}

/** The CSV of a log in the format of the export. */
export function csvOf(events: LogEvent[]): string {
  const lines = events.map((e) => {
    const stamp = new Date(Date.parse('2026-01-05T08:00:00Z') + e.time * 1000).toISOString();
    return `${e.caseId},${e.activity},${stamp},${e.lifecycle}`;
  });
  return `case_id,activity,timestamp,lifecycle\n${lines.join('\n')}\n`;
}

/** The log of an engine run of `net` (seed 1), with the names of the transitions as activities. */
export async function engineLog(net: PetriNet, seconds: number): Promise<LogEvent[]> {
  const { createSimulation } = await import('@pnm/sim');
  const sim = createSimulation(net, { seed: 1 });
  const events = [...sim.initialEvents, ...(await sim.advance(seconds))];
  const names = new Map(net.transitions.map((t) => [t.id, t.name]));
  return events.flatMap((event) =>
    event.type === 'start' || event.type === 'complete'
      ? event.caseIds.map((caseId): LogEvent => ({
          caseId,
          activity: names.get(event.transitionId) ?? event.transitionId,
          time: event.t,
          lifecycle: event.type,
        }))
      : [],
  );
}

/** Every activity mapped to the transition of the same name. */
export function mappingByName(net: PetriNet): ActivityMapping {
  return Object.fromEntries(net.transitions.map((t) => [t.name, t.id]));
}
