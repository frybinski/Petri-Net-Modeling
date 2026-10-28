import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { TRANSITION_HEIGHT, TRANSITION_WIDTH } from '../../lib/geometry';
import { GUARD_LABEL_LENGTH } from '../../lib/flow-model';
import { truncate } from '../../lib/inscriptions';
import { BindingPicker } from './binding-picker';
import { NodeHandles } from './node-handles';
import { NodeLabel } from './node-label';
import type { TransitionFlowNode } from './types';

function TransitionNodeView({ id, data, selected }: NodeProps<TransitionFlowNode>) {
  const { name, guard, bindings, picking, enabled, simulating, hasError, isArcSource, renaming } =
    data;
  let tone: string;
  if (hasError) tone = 'border-danger shadow-[0_0_0_3px_var(--danger-soft)]';
  else if (enabled)
    tone =
      'border-ok bg-ok-soft shadow-[0_0_0_4px_var(--ok-soft)] cursor-pointer hover:brightness-95';
  else if (selected || isArcSource) tone = 'border-accent shadow-[0_0_0_4px_var(--accent-soft)]';
  else tone = 'border-[var(--node-stroke)]';
  const fill = enabled && !hasError ? '' : 'bg-[var(--node-fill)]';
  return (
    <div className="relative" style={{ width: TRANSITION_WIDTH, height: TRANSITION_HEIGHT }}>
      <div
        className={`pn-shape absolute inset-0 rounded-[3px] border-2 transition-shadow ${fill} ${tone}`}
        data-testid="transition-shape"
        data-enabled={simulating ? String(enabled) : undefined}
      />
      {guard ? (
        <span
          className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 font-mono text-[10px] leading-3 whitespace-nowrap text-muted select-none"
          title={guard}
          data-testid="guard-label"
        >
          [ {truncate(guard, GUARD_LABEL_LENGTH)} ]
        </span>
      ) : null}
      {simulating && enabled && bindings > 1 ? (
        <span
          className="pointer-events-none absolute -top-2 -right-3 min-w-4 rounded-full bg-ok px-1 text-center text-[10px] leading-4 font-semibold text-white select-none"
          title={`${bindings} bindings`}
          data-testid="binding-count"
        >
          {bindings}
        </span>
      ) : null}
      <NodeLabel id={id} name={name} renaming={renaming} kind="transition" />
      {picking ? <BindingPicker transitionId={id} /> : null}
      <NodeHandles />
    </div>
  );
}

export const TransitionNode = memo(TransitionNodeView);
