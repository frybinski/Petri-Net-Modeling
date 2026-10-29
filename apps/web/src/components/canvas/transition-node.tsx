import type { NodeProps } from '@xyflow/react';
import { Clock } from 'lucide-react';
import { memo } from 'react';
import { en } from '../../i18n/en';
import { GUARD_LABEL_LENGTH } from '../../lib/flow-model';
import { truncate } from '../../lib/inscriptions';
import { NODE_STROKE, TRANSITION_HEIGHT, TRANSITION_WIDTH } from '@pnm/layout/geometry';
import { Tooltip } from '../ui/tooltip';
import { BindingPicker } from './binding-picker';
import { BreakpointMarker } from './breakpoint-marker';
import { ErrorMarker } from './error-marker';
import { RING_OUTSIDE, NodeHandles } from './node-handles';
import { useDropState } from './use-drop-state';
import { NodeLabel } from './node-label';
import type { TransitionFlowNode } from './types';

const HW = TRANSITION_WIDTH / 2;
const HH = TRANSITION_HEIGHT / 2;

function TransitionNodeView({ id, data, selected }: NodeProps<TransitionFlowNode>) {
  const {
    name,
    guard,
    bindings,
    picking,
    enabled,
    simulating,
    hasError,
    errorText,
    isArcSource,
    renaming,
    timing,
    running,
    progress,
    breakpoint,
  } = data;
  const drop = useDropState(id);
  const showBindings = simulating && enabled && bindings > 1;
  const busy = simulating && running > 0;
  const percent = Math.round(progress * 100);
  return (
    <div
      className="pn-node pn-transition relative"
      style={{ width: TRANSITION_WIDTH, height: TRANSITION_HEIGHT }}
      data-selected={selected || isArcSource}
      data-error={hasError}
      data-drop={drop}
      data-enabled={simulating ? String(enabled) : undefined}
      data-busy={busy ? 'true' : undefined}
    >
      <svg
        className="pn-svg pointer-events-none absolute inset-0 overflow-visible"
        viewBox={`${-HW} ${-HH} ${TRANSITION_WIDTH} ${TRANSITION_HEIGHT}`}
        aria-hidden="true"
      >
        <rect
          className="pn-hover-ring"
          x={-HW - RING_OUTSIDE / 2 + 0.5}
          y={-HH - RING_OUTSIDE / 2 + 0.5}
          width={TRANSITION_WIDTH + RING_OUTSIDE - 1}
          height={TRANSITION_HEIGHT + RING_OUTSIDE - 1}
          rx={5}
          strokeWidth={6}
        />
        <rect
          className="pn-halo"
          x={-HW - 1.5}
          y={-HH - 1.5}
          width={TRANSITION_WIDTH + 3}
          height={TRANSITION_HEIGHT + 3}
          rx={4.5}
        />
        <rect
          className="pn-body"
          x={-HW + NODE_STROKE / 2}
          y={-HH + NODE_STROKE / 2}
          width={TRANSITION_WIDTH - NODE_STROKE}
          height={TRANSITION_HEIGHT - NODE_STROKE}
          rx={3}
          strokeWidth={NODE_STROKE}
        />
      </svg>
      <div
        className={`pn-shape absolute inset-0 rounded-[3px] ${enabled ? 'cursor-pointer' : ''}`}
        data-testid="transition-shape"
        data-enabled={simulating ? String(enabled) : undefined}
      />
      {busy ? (
        <div
          className="pointer-events-none absolute inset-[1.5px] overflow-hidden rounded-[2px]"
          role="progressbar"
          aria-label={`${name}: ${en.simulation.progress(percent)}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          data-testid="transition-progress"
        >
          <div
            className="pn-progress absolute inset-x-0 bottom-0"
            style={{ height: `${percent}%` }}
          />
        </div>
      ) : null}
      {timing ? (
        <Clock
          size={11}
          strokeWidth={2.25}
          className="pn-detail pointer-events-none absolute right-[3px] bottom-[3px] text-muted"
          aria-hidden="true"
          data-testid="timing-icon"
        />
      ) : null}
      {busy && running > 1 ? (
        <span
          className="pointer-events-none absolute -top-2.5 -left-3 min-w-5 rounded-full bg-accent px-1.5 text-center text-[11px] leading-5 font-semibold text-accent-contrast select-none"
          data-testid="running-count"
        >
          {running}
        </span>
      ) : null}
      {simulating && breakpoint ? <BreakpointMarker /> : null}
      {guard ? (
        <Tooltip content={guard} side="top">
          <span
            className="pn-detail pn-pill absolute bottom-full left-1/2 mb-2 -translate-x-1/2 font-mono text-[11px]"
            data-testid="guard-label"
            data-no-hovercard
          >
            [ {truncate(guard, GUARD_LABEL_LENGTH)} ]
          </span>
        </Tooltip>
      ) : null}
      {showBindings ? (
        <span
          className="pointer-events-none absolute -top-2.5 -right-3 min-w-5 rounded-full bg-ok px-1.5 text-center text-[11px] leading-5 font-semibold text-accent-contrast select-none"
          data-testid="binding-count"
        >
          {bindings}
        </span>
      ) : null}
      {hasError ? <ErrorMarker text={errorText} corner={showBindings ? 'left' : 'right'} /> : null}
      <NodeLabel id={id} name={name} renaming={renaming} kind="transition" />
      {picking ? <BindingPicker transitionId={id} /> : null}
      <NodeHandles kind="transition" />
    </div>
  );
}

export const TransitionNode = memo(TransitionNodeView);
