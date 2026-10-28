import { canConnect, type Id, type Position } from '@pnm/core';
import { ViewportPortal } from '@xyflow/react';
import { useEditorStore } from '../../store/editor-store';
import { PLACE_SHAPE, TRANSITION_SHAPE, boundaryPoint } from '../../lib/geometry';

interface ArcPreviewProps {
  cursor: Position | null;
  hoverId: Id | null;
}

/** Rubber-band line of the arc tool: from the chosen source to the cursor, red over invalid targets. */
export function ArcPreview({ cursor, hoverId }: ArcPreviewProps) {
  const sourceId = useEditorStore((s) => s.arcSource);
  const net = useEditorStore((s) => s.net);
  const dragPositions = useEditorStore((s) => s.dragPositions);
  if (sourceId === null || cursor === null) return null;

  const place = net.places.find((p) => p.id === sourceId);
  const transition = net.transitions.find((t) => t.id === sourceId);
  const node = place ?? transition;
  if (!node) return null;
  const center = dragPositions?.[sourceId] ?? node.position;
  const shape = place ? PLACE_SHAPE : TRANSITION_SHAPE;
  const start = boundaryPoint(center, shape, cursor, 1.5);

  const invalid =
    hoverId !== null && hoverId !== sourceId && !canConnect(net, sourceId, hoverId).ok;
  const sameNode = hoverId === sourceId;
  const color = invalid || sameNode ? 'var(--danger)' : 'var(--accent)';

  return (
    <ViewportPortal>
      <svg
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          overflow: 'visible',
          pointerEvents: 'none',
        }}
        width={1}
        height={1}
        aria-hidden="true"
        data-testid="arc-preview"
        data-invalid={invalid || sameNode ? 'true' : 'false'}
      >
        <line
          x1={start.x}
          y1={start.y}
          x2={cursor.x}
          y2={cursor.y}
          stroke={color}
          strokeWidth={2}
          strokeDasharray="6 4"
        />
        <circle cx={cursor.x} cy={cursor.y} r={4} fill={color} />
      </svg>
    </ViewportPortal>
  );
}
