import { addPlace, addTransition, createEmptyNet } from '@pnm/core';
import { describe, expect, it } from 'vitest';
import { CHAIN_DISTANCE, CHAIN_STEP, chainPosition, freePosition, isOccupied } from './placement';

describe('placement', () => {
  const net = addPlace(createEmptyNet('x'), { id: 'p', position: { x: 100, y: 100 } });

  it('puts the next node 160 px to the right and the previous one to the left', () => {
    expect(chainPosition(net, { x: 100, y: 100 }, 1)).toEqual({ x: 100 + CHAIN_DISTANCE, y: 100 });
    expect(chainPosition(net, { x: 100, y: 100 }, -1)).toEqual({ x: 100 - CHAIN_DISTANCE, y: 100 });
  });

  it('moves down while a node is in the way', () => {
    const crowded = addTransition(net, { id: 't', position: { x: 260, y: 100 } });
    expect(isOccupied(crowded, { x: 260, y: 100 })).toBe(true);
    expect(chainPosition(crowded, { x: 100, y: 100 }, 1)).toEqual({ x: 260, y: 100 + CHAIN_STEP });
    const more = addPlace(crowded, { id: 'q', position: { x: 260, y: 180 } });
    expect(chainPosition(more, { x: 100, y: 100 }, 1)).toEqual({ x: 260, y: 100 + 2 * CHAIN_STEP });
  });

  it('keeps free positions as they are', () => {
    expect(freePosition(net, { x: 400, y: 400 })).toEqual({ x: 400, y: 400 });
  });
});
