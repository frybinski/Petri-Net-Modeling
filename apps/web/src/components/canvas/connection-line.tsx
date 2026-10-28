import type { ConnectionLineComponentProps } from '@xyflow/react';

/** Line shown while dragging a connection from a handle; red when the drop target is not allowed. */
export function ConnectionLine({
  fromX,
  fromY,
  toX,
  toY,
  connectionStatus,
}: ConnectionLineComponentProps) {
  const color = connectionStatus === 'invalid' ? 'var(--danger)' : 'var(--accent)';
  return (
    <g>
      <path
        d={`M${fromX} ${fromY} L${toX} ${toY}`}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeDasharray={connectionStatus === 'invalid' ? '5 4' : undefined}
      />
      <circle cx={toX} cy={toY} r={4} fill={color} />
    </g>
  );
}
