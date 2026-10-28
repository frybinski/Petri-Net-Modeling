import type { SimEvent } from '@pnm/sim';
import { describe, expect, it } from 'vitest';
import { FLIGHT_MS, MAX_FLIGHTS, easeInOut, planFlights } from './token-flight';

const paths: Record<string, string> = {
  'p>t': 'M0 0 L10 0',
  't>q': 'M10 0 L20 0',
};
const pathOf = (s: string, t: string): string | undefined => paths[`${s}>${t}`];

const start = (consumed: string[]): SimEvent => ({
  id: 1,
  t: 0,
  type: 'start',
  transitionId: 't',
  firingId: 1,
  slot: 0,
  caseIds: [],
  binding: {},
  consumed: consumed.map((placeId, i) => ({ placeId, tokenId: `k${i}` })),
});
const complete = (produced: string[]): SimEvent => ({
  id: 2,
  t: 0,
  type: 'complete',
  transitionId: 't',
  firingId: 1,
  slot: 0,
  caseIds: [],
  produced: produced.map((placeId, i) => ({ placeId, tokenId: `k${i}` })),
});

describe('planFlights', () => {
  it('moves tokens to the transition at a start and away from it at a completion', () => {
    expect(planFlights([start(['p']), complete(['q'])], pathOf, 10)).toEqual([
      'M0 0 L10 0',
      'M10 0 L20 0',
    ]);
  });

  it('draws one token per consumed or produced token', () => {
    expect(planFlights([start(['p', 'p'])], pathOf, 10)).toHaveLength(2);
  });

  it('skips tokens without an arc and ignores other events', () => {
    const idle: SimEvent = { id: 3, t: 0, type: 'idle' };
    expect(planFlights([start(['x']), complete(['y']), idle], pathOf, 10)).toEqual([]);
  });

  it('keeps at most the limit, spread over the batch', () => {
    const events = Array.from({ length: 200 }, (_, i) =>
      i % 2 === 0 ? start(['p']) : complete(['q']),
    );
    const picked = planFlights(events, pathOf, MAX_FLIGHTS);
    expect(picked).toHaveLength(MAX_FLIGHTS);
    expect(new Set(picked).size).toBe(2);
  });
});

describe('easeInOut', () => {
  it('runs from 0 to 1 and is slower at the ends', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBe(0.5);
    expect(easeInOut(0.1)).toBeLessThan(0.1);
    expect(easeInOut(0.9)).toBeGreaterThan(0.9);
    expect(FLIGHT_MS).toBe(250);
    expect(MAX_FLIGHTS).toBe(60);
  });
});
