import type { ConnectionLineComponentProps } from '@xyflow/react';
import { PLACE_SIZE, boundaryPoint, PLACE_SHAPE, TRANSITION_SHAPE } from '@pnm/layout/geometry';

/**
 * Line shown while an arc is dragged from the ring of a node. It starts on the outline of the
 * source node, like the finished arc, and turns red over a node that cannot be connected.
 */
export function ConnectionLine({
  fromNode,
  toX,
  toY,
  connectionStatus,
}: ConnectionLineComponentProps) {
  const invalid = connectionStatus === 'invalid';
  const color = invalid ? 'var(--danger)' : 'var(--accent)';
  const width = fromNode.measured.width ?? PLACE_SIZE;
  const height = fromNode.measured.height ?? PLACE_SIZE;
  const center = {
    x: fromNode.internals.positionAbsolute.x + width / 2,
    y: fromNode.internals.positionAbsolute.y + height / 2,
  };
  const shape = fromNode.type === 'transition' ? TRANSITION_SHAPE : PLACE_SHAPE;
  const start = boundaryPoint(center, shape, { x: toX, y: toY });
  return (
    <g data-testid="connection-line" data-invalid={invalid ? 'true' : 'false'}>
      <path
        d={`M${start.x} ${start.y} L${toX} ${toY}`}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={invalid ? '5 4' : undefined}
      />
      <circle cx={toX} cy={toY} r={4} fill={color} />
    </g>
  );
}
