import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { TRANSITION_HEIGHT, TRANSITION_WIDTH } from '../../lib/geometry';
import { NodeHandles } from './node-handles';
import { NodeLabel } from './node-label';
import type { TransitionFlowNode } from './types';

function TransitionNodeView({ id, data, selected }: NodeProps<TransitionFlowNode>) {
  const { name, enabled, simulating, hasError, isArcSource, renaming } = data;
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
      <NodeLabel id={id} name={name} renaming={renaming} kind="transition" />
      <NodeHandles />
    </div>
  );
}

export const TransitionNode = memo(TransitionNodeView);
