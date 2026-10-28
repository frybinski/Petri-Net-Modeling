import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { en } from '../../i18n/en';
import {
  MAX_TOKEN_DOTS,
  NODE_STROKE,
  PLACE_SIZE,
  TOKEN_DOT_RADIUS,
  tokenDotOffsets,
} from '../../lib/geometry';
import { RING_OUTSIDE, NodeHandles } from './node-handles';
import { useDropState } from './use-drop-state';
import { NodeLabel } from './node-label';
import { ErrorMarker } from './error-marker';
import type { PlaceFlowNode } from './types';

const HALF = PLACE_SIZE / 2;

function PlaceNodeView({ id, data, selected }: NodeProps<PlaceFlowNode>) {
  const {
    name,
    tokens,
    json,
    chips,
    chipsMore,
    typeName,
    capacity,
    hasError,
    errorText,
    isArcSource,
    renaming,
  } = data;
  const drop = useDropState(id);
  const dots = !json && tokens > 0 && tokens <= MAX_TOKEN_DOTS;
  const count = json ? tokens > 0 : tokens > MAX_TOKEN_DOTS;
  return (
    <div
      className="pn-node pn-place relative"
      style={{ width: PLACE_SIZE, height: PLACE_SIZE }}
      data-selected={selected || isArcSource}
      data-error={hasError}
      data-drop={drop}
      data-testid="place-node"
    >
      <svg
        className="pn-svg pointer-events-none absolute inset-0 overflow-visible"
        viewBox={`${-HALF} ${-HALF} ${PLACE_SIZE} ${PLACE_SIZE}`}
        aria-hidden="true"
      >
        <circle className="pn-hover-ring" r={HALF + RING_OUTSIDE / 2 - 0.5} strokeWidth={6} />
        <circle className="pn-halo" r={HALF + 1.5} />
        <circle className="pn-body" r={HALF - NODE_STROKE / 2} strokeWidth={NODE_STROKE} />
        {dots
          ? tokenDotOffsets(tokens).map((o) => (
              <circle
                key={`${o.x},${o.y}`}
                className="pn-token"
                cx={o.x}
                cy={o.y}
                r={TOKEN_DOT_RADIUS}
                data-testid="token-dot"
              />
            ))
          : null}
        {count ? (
          <text
            className="pn-token-count"
            x={0}
            y={0}
            dy="0.36em"
            textAnchor="middle"
            data-testid="token-count"
          >
            {tokens}
          </text>
        ) : null}
      </svg>
      <div className="pn-shape absolute inset-0 rounded-full" data-testid="place-shape" />
      {typeName ? (
        <span
          className="pn-detail pn-badge pointer-events-none absolute top-[-9px] left-[62%] select-none"
          data-testid="place-type"
        >
          {typeName}
        </span>
      ) : null}
      {capacity !== undefined ? (
        <span
          className="pn-detail pointer-events-none absolute top-[86%] left-[88%] font-mono text-[10px] leading-3 whitespace-nowrap text-muted select-none"
          data-testid="place-capacity"
        >
          {en.elements.capacityShort(capacity)}
        </span>
      ) : null}
      {hasError ? <ErrorMarker text={errorText} corner={typeName ? 'left' : 'right'} /> : null}
      {json && chips.length > 0 ? (
        <div
          className="pn-chips pointer-events-none absolute top-1/2 left-full ml-3 flex -translate-y-1/2 flex-col items-start gap-1 rounded-lg border border-border bg-surface p-1.5 shadow-panel"
          data-testid="token-chips"
        >
          {chips.map((chip, i) => (
            <span
              key={`${i}:${chip}`}
              className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] leading-4 whitespace-nowrap text-fg"
            >
              {chip}
            </span>
          ))}
          {chipsMore > 0 ? (
            <span className="px-1.5 text-[11px] text-muted">{en.tokens.more(chipsMore)}</span>
          ) : null}
        </div>
      ) : null}
      <NodeLabel id={id} name={name} renaming={renaming} kind="place" />
      <NodeHandles kind="place" />
    </div>
  );
}

export const PlaceNode = memo(PlaceNodeView);
