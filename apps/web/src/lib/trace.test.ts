import type { SimEvent } from '@pnm/sim';
import { describe, expect, it } from 'vitest';
import { eventTransition, recentEvents } from './trace';

const start = (id: number, transitionId: string): SimEvent => ({
  id,
  t: id,
  type: 'start',
  transitionId,
  firingId: id,
  slot: 0,
  caseIds: ['C-1'],
  binding: {},
  consumed: [],
});
const complete = (id: number, transitionId: string): SimEvent => ({
  id,
  t: id,
  type: 'complete',
  transitionId,
  firingId: id,
  slot: 0,
  caseIds: ['C-1'],
  produced: [],
});
const idle = (id: number): SimEvent => ({ id, t: id, type: 'idle' });

const log: SimEvent[] = [
  start(1, 'a'),
  complete(2, 'a'),
  start(3, 'b'),
  complete(4, 'b'),
  idle(5),
  start(6, 'a'),
];

describe('recentEvents', () => {
  it('lists the newest first', () => {
    expect(recentEvents(log, '', '').map((e) => e.id)).toEqual([6, 5, 4, 3, 2, 1]);
  });

  it('filters by event type and by transition', () => {
    expect(recentEvents(log, 'start', '').map((e) => e.id)).toEqual([6, 3, 1]);
    expect(recentEvents(log, '', 'a').map((e) => e.id)).toEqual([6, 2, 1]);
    expect(recentEvents(log, 'complete', 'b').map((e) => e.id)).toEqual([4]);
    expect(recentEvents(log, 'idle', 'a')).toEqual([]);
  });

  it('stops at the limit', () => {
    expect(recentEvents(log, '', '', 2).map((e) => e.id)).toEqual([6, 5]);
  });

  it('finds the transition of an event', () => {
    expect(eventTransition(start(1, 'x'))).toBe('x');
    expect(eventTransition(idle(2))).toBeUndefined();
  });
});
