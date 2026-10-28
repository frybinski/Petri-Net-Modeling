import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { en } from '../../i18n/en';
import { MAX_TOKEN_DOTS, PLACE_SIZE, tokenDotOffsets } from '../../lib/geometry';
import { NodeHandles } from './node-handles';
import { NodeLabel } from './node-label';
import type { PlaceFlowNode } from './types';

function PlaceNodeView({ id, data, selected }: NodeProps<PlaceFlowNode>) {
  const { name, tokens, capacity, hasError, isArcSource, renaming } = data;
  const ring = hasError
    ? 'border-danger shadow-[0_0_0_3px_var(--danger-soft)]'
    : selected || isArcSource
      ? 'border-accent shadow-[0_0_0_4px_var(--accent-soft)]'
      : 'border-[var(--node-stroke)]';
  return (
    <div className="relative" style={{ width: PLACE_SIZE, height: PLACE_SIZE }}>
      <div
        className={`pn-shape absolute inset-0 rounded-full border-2 bg-[var(--node-fill)] transition-shadow ${ring}`}
        data-testid="place-shape"
      />
      <svg
        className="pointer-events-none absolute inset-0"
        viewBox={`${-PLACE_SIZE / 2} ${-PLACE_SIZE / 2} ${PLACE_SIZE} ${PLACE_SIZE}`}
        aria-hidden="true"
      >
        {tokens > 0 && tokens <= MAX_TOKEN_DOTS
          ? tokenDotOffsets(tokens).map((o) => (
              <circle key={`${o.x},${o.y}`} cx={o.x} cy={o.y} r={3.4} fill="var(--token)" />
            ))
          : null}
        {tokens > MAX_TOKEN_DOTS ? (
          <text
            x={0}
            y={5}
            textAnchor="middle"
            fontSize={14}
            fontWeight={600}
            fill="var(--token)"
            data-testid="token-count"
          >
            {tokens}
          </text>
        ) : null}
      </svg>
      {capacity !== undefined ? (
        <span
          className="pointer-events-none absolute -top-2 left-full ml-0.5 text-[10px] leading-3 whitespace-nowrap text-muted select-none"
          title={`${en.properties.capacity} ${capacity}`}
        >
          {en.elements.capacityShort(capacity)}
        </span>
      ) : null}
      <NodeLabel id={id} name={name} renaming={renaming} kind="place" />
      <NodeHandles />
    </div>
  );
}

export const PlaceNode = memo(PlaceNodeView);
