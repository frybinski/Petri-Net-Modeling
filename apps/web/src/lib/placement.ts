import type { PetriNet, Position } from '@pnm/core';
import { TRANSITION_HEIGHT, PLACE_SIZE } from '@pnm/layout/geometry';

/** Horizontal distance between a node and the node that Tab adds next to it. */
export const CHAIN_DISTANCE = 160;
/** Vertical step when the wanted position is taken. */
export const CHAIN_STEP = 80;

const CLEARANCE_X = PLACE_SIZE + 16;
const CLEARANCE_Y = TRANSITION_HEIGHT + 8;

/** True if a place or transition sits so close to `position` that a new node would overlap it. */
export function isOccupied(net: PetriNet, position: Position): boolean {
  return [...net.places, ...net.transitions].some(
    (node) =>
      Math.abs(node.position.x - position.x) < CLEARANCE_X &&
      Math.abs(node.position.y - position.y) < CLEARANCE_Y,
  );
}

/** Moves `position` down in steps until no node is in the way. */
export function freePosition(net: PetriNet, position: Position, step = CHAIN_STEP): Position {
  let candidate = { ...position };
  for (let i = 0; i < 200 && isOccupied(net, candidate); i++) {
    candidate = { x: position.x, y: candidate.y + step };
  }
  return candidate;
}

/**
 * Where Tab (direction 1) or Shift+Tab (direction -1) puts the next node: 160 px to the right or
 * left of `from`, one step further down for each node that is already in the way.
 */
export function chainPosition(net: PetriNet, from: Position, direction: 1 | -1): Position {
  return freePosition(net, { x: from.x + direction * CHAIN_DISTANCE, y: from.y });
}
