import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';
import { memo, useState, type MouseEvent } from 'react';
import { targetElement } from '../../lib/context-target';
import { INSCRIPTION_LABEL_LENGTH } from '../../lib/flow-model';
import { truncate } from '../../lib/inscriptions';
import { useEditorStore } from '../../store/editor-store';
import { Tooltip } from '../ui/tooltip';
import { ArcEditor } from './arc-editor';
import type { ArcFlowEdge } from './types';

function selectArc(arcId: string, event: MouseEvent): void {
  const store = useEditorStore.getState();
  if (store.tool !== 'select') return;
  if (event.shiftKey || event.ctrlKey || event.metaKey) {
    const set = new Set(store.selection);
    if (set.has(arcId)) set.delete(arcId);
    else set.add(arcId);
    store.select([...set]);
  } else {
    store.select([arcId]);
  }
}

function ArcEdgeView({ data, selected, interactionWidth }: EdgeProps<ArcFlowEdge>) {
  const [hover, setHover] = useState(false);
  const arcId = data?.arcId;
  const editing = useEditorStore((s) => s.renamingId === arcId);
  if (!data) return null;
  const inscription = data.inscription;
  const showWeight = inscription === undefined && data.weight !== 1;
  const hasLabel = editing || inscription !== undefined || showWeight;

  const enter = (): void => {
    setHover(true);
  };
  const leave = (): void => {
    setHover(false);
  };

  return (
    <>
      <g
        className="pn-arc"
        data-testid="arc"
        data-arc-id={data.arcId}
        data-selected={selected ? 'true' : undefined}
        data-error={data.hasError ? 'true' : undefined}
        data-hover={hover ? 'true' : undefined}
        onMouseEnter={enter}
        onMouseLeave={leave}
      >
        <BaseEdge path={data.path} className="arc-line" interactionWidth={interactionWidth ?? 20} />
        <polygon className="arc-arrow" points={data.arrow} />
      </g>
      {hasLabel ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pn-arc-label absolute"
            style={{
              transform: `translate(-50%, -50%) translate(${data.label.x}px, ${data.label.y}px)`,
              pointerEvents: 'all',
              zIndex: editing ? 10 : undefined,
            }}
            data-selected={selected ? 'true' : undefined}
            data-error={data.hasError ? 'true' : undefined}
            data-hover={hover ? 'true' : undefined}
            onMouseEnter={enter}
            onMouseLeave={leave}
            onClick={(event) => {
              selectArc(data.arcId, event);
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              useEditorStore.getState().startRename(data.arcId);
            }}
            onContextMenu={() => {
              targetElement(data.arcId, 'edge');
            }}
          >
            {editing ? (
              <ArcEditor arcId={data.arcId} />
            ) : inscription !== undefined ? (
              <Tooltip
                content={inscription}
                side="top"
                disabled={inscription.length <= INSCRIPTION_LABEL_LENGTH}
              >
                <span
                  className="pn-detail pn-pill pn-pill-arc font-mono text-[11px]"
                  data-testid="arc-inscription"
                >
                  {truncate(inscription, INSCRIPTION_LABEL_LENGTH)}
                </span>
              </Tooltip>
            ) : (
              <span
                className="pn-weight pn-pill pn-pill-arc text-[12px] font-semibold tabular-nums"
                data-testid="arc-weight"
              >
                {data.weight}
              </span>
            )}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const ArcEdge = memo(ArcEdgeView);
