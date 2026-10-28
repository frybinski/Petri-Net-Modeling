import type { EdgeProps } from '@xyflow/react';
import { memo } from 'react';
import type { ArcFlowEdge } from './types';

function ArcEdgeView({ data, selected }: EdgeProps<ArcFlowEdge>) {
  if (!data) return null;
  const color = data.hasError ? 'var(--danger)' : selected ? 'var(--accent)' : 'var(--edge)';
  return (
    <g data-testid="arc" data-arc-id={data.arcId}>
      {/* Wide invisible stroke so thin arcs are easy to click. */}
      <path d={data.path} fill="none" stroke="transparent" strokeWidth={18} />
      <path
        className="arc-line"
        d={data.path}
        fill="none"
        stroke={color}
        strokeWidth={selected ? 2.4 : 1.6}
      />
      <polygon points={data.arrow} fill={color} />
      {data.weight !== 1 ? (
        <text
          x={data.label.x}
          y={data.label.y - 7}
          textAnchor="middle"
          fontSize={13}
          fontWeight={600}
          fill="var(--text)"
          stroke="var(--canvas)"
          strokeWidth={4}
          paintOrder="stroke"
          data-testid="arc-weight"
        >
          {data.weight}
        </text>
      ) : null}
    </g>
  );
}

export const ArcEdge = memo(ArcEdgeView);
