import { Handle, Position } from '@xyflow/react';
import type { CSSProperties } from 'react';
import { PLACE_SIZE, TRANSITION_HEIGHT, TRANSITION_WIDTH } from '../../lib/geometry';

/** How far the connection ring reaches beyond the outline of a node, and into the node. */
export const RING_OUTSIDE = 5;
export const RING_INSIDE = 1;
export const RING_WIDTH = RING_OUTSIDE + RING_INSIDE;

interface NodeHandlesProps {
  kind: 'place' | 'transition';
}

/** Clip path that leaves only the ring around the node outline hit-testable. */
function ringClip(kind: 'place' | 'transition'): string {
  if (kind === 'place') {
    const outer = PLACE_SIZE / 2 + RING_OUTSIDE;
    const inner = PLACE_SIZE / 2 - RING_INSIDE;
    const circle = (r: number): string =>
      `M${outer} ${outer - r} a${r} ${r} 0 1 0 0 ${2 * r} a${r} ${r} 0 1 0 0 ${-2 * r} z`;
    return `path(evenodd, "${circle(outer)} ${circle(inner)}")`;
  }
  const w = RING_WIDTH;
  return `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${w}px ${w}px, ${w}px calc(100% - ${w}px), calc(100% - ${w}px) calc(100% - ${w}px), calc(100% - ${w}px) ${w}px, ${w}px ${w}px)`;
}

/**
 * Invisible connection handles of a node. Arcs are drawn from the model, so the handles only
 * serve to start and to end a drag:
 * - `ring` is a thin band around the node outline. Dragging from it starts an arc, dragging the
 *   inside of the node moves it. While Alt is held the whole node acts as the ring.
 * - `body` covers the node and only reacts while an arc is being dragged, so that a drop
 *   anywhere on a node connects to it.
 */
export function NodeHandles({ kind }: NodeHandlesProps) {
  const width = (kind === 'place' ? PLACE_SIZE : TRANSITION_WIDTH) + 2 * RING_OUTSIDE;
  const height = (kind === 'place' ? PLACE_SIZE : TRANSITION_HEIGHT) + 2 * RING_OUTSIDE;
  const ring: CSSProperties = {
    width,
    height,
    left: -RING_OUTSIDE,
    top: -RING_OUTSIDE,
    clipPath: ringClip(kind),
  };
  return (
    <>
      <Handle
        id="body"
        type="target"
        position={Position.Top}
        isConnectableStart={false}
        className={`pn-body-handle pn-body-handle-${kind}`}
      />
      <Handle
        id="ring"
        type="source"
        position={Position.Top}
        className={`pn-ring-handle pn-ring-handle-${kind}`}
        style={ring}
      />
    </>
  );
}
