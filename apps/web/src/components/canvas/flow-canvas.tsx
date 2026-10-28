import { canConnect, type Id, type Position } from '@pnm/core';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type NodeTypes,
  type OnNodeDrag,
  type EdgeTypes,
} from '@xyflow/react';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { en } from '../../i18n/en';
import { buildFlowEdges, buildFlowNodes } from '../../lib/flow-model';
import { GRID_SIZE, snap } from '../../lib/geometry';
import { registerViewApi } from '../../lib/view-api';
import { currentMarking, useEditorStore } from '../../store/editor-store';
import { useUiStore } from '../../store/ui-store';
import { AnnotationNode } from './annotation-node';
import { ArcEdge } from './arc-edge';
import { ArcPreview } from './arc-preview';
import { ConnectionLine } from './connection-line';
import { PlaceNode } from './place-node';
import { TransitionNode } from './transition-node';
import type { ArcFlowEdge, FlowNode } from './types';

const nodeTypes: NodeTypes = {
  place: PlaceNode,
  transition: TransitionNode,
  annotation: AnnotationNode,
};
const edgeTypes: EdgeTypes = { arc: ArcEdge };

const SNAP_GRID: [number, number] = [GRID_SIZE, GRID_SIZE];

export function FlowCanvas() {
  const net = useEditorStore((s) => s.net);
  const selection = useEditorStore((s) => s.selection);
  const tool = useEditorStore((s) => s.tool);
  const mode = useEditorStore((s) => s.mode);
  const arcSource = useEditorStore((s) => s.arcSource);
  const dragPositions = useEditorStore((s) => s.dragPositions);
  const renamingId = useEditorStore((s) => s.renamingId);
  const diagnostics = useEditorStore((s) => s.diagnostics);
  const simMarking = useEditorStore((s) => s.simMarking);
  const docVersion = useEditorStore((s) => s.docVersion);
  const theme = useUiStore((s) => s.theme);
  const snapToGrid = useUiStore((s) => s.snapToGrid);
  const showMinimap = useUiStore((s) => s.showMinimap);

  const { screenToFlowPosition, fitView, setCenter, getZoom } = useReactFlow();
  const [measured, setMeasured] = useState<ReadonlyMap<Id, { width: number; height: number }>>(
    () => new Map(),
  );
  const [cursor, setCursor] = useState<Position | null>(null);
  const [hoverId, setHoverId] = useState<Id | null>(null);

  const simulating = mode === 'simulate';
  const marking = currentMarking({ net, mode, simMarking });
  const enabledResults = useEditorStore((s) => s.enabled);
  const picking = useEditorStore((s) => s.picker);
  const showInscriptions = useUiStore((s) => s.showInscriptions);
  const enabled = useMemo(() => {
    const counts = new Map<Id, number>();
    if (simulating) {
      for (const [id, result] of enabledResults) counts.set(id, result.bindings.length);
    }
    return counts;
  }, [simulating, enabledResults]);

  const context = useMemo(
    () => ({
      net,
      marking,
      selection,
      enabled,
      picking,
      showInscriptions,
      simulating,
      diagnostics,
      dragPositions,
      renamingId,
      arcSource,
      editable: !simulating,
      connectable: !simulating && tool === 'select',
      measured,
    }),
    [
      net,
      marking,
      selection,
      enabled,
      picking,
      showInscriptions,
      simulating,
      diagnostics,
      dragPositions,
      renamingId,
      arcSource,
      tool,
      measured,
    ],
  );
  const nodes = useMemo(() => buildFlowNodes(context), [context]);
  const edges = useMemo(() => buildFlowEdges(context), [context]);

  // Expose viewport operations to the header, status bar and shortcuts.
  useEffect(() => {
    registerViewApi({
      fitView: () => {
        void fitView({ padding: 0.25, maxZoom: 1.25, duration: 250 });
      },
      focus: (ids) => {
        const targets = nodes.filter((n) => ids.includes(n.id));
        if (targets.length === 0) return;
        const x = targets.reduce((sum, n) => sum + n.position.x, 0) / targets.length;
        const y = targets.reduce((sum, n) => sum + n.position.y, 0) / targets.length;
        void setCenter(x, y, { zoom: Math.max(getZoom(), 1), duration: 250 });
      },
    });
    return () => {
      registerViewApi(null);
    };
  }, [fitView, setCenter, getZoom, nodes]);

  // Show the whole net after a different document was loaded.
  useEffect(() => {
    if (docVersion === 0) return;
    const frame = requestAnimationFrame(() => {
      void fitView({ padding: 0.25, maxZoom: 1.25, duration: 0 });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [docVersion, fitView]);

  const applySelection = useCallback((changes: Array<NodeChange<FlowNode> | EdgeChange>) => {
    const store = useEditorStore.getState();
    let next: Set<Id> | null = null;
    for (const change of changes) {
      if (change.type !== 'select') continue;
      next ??= new Set(store.selection);
      if (change.selected) next.add(change.id);
      else next.delete(change.id);
    }
    if (next) store.select([...next]);
  }, []);

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      applySelection(changes);
      let positions: Record<Id, Position> | null = null;
      let sizes: Map<Id, { width: number; height: number }> | null = null;
      for (const change of changes) {
        if (change.type === 'position' && change.dragging && change.position) {
          positions ??= { ...(useEditorStore.getState().dragPositions ?? {}) };
          positions[change.id] = change.position;
        } else if (change.type === 'dimensions' && change.dimensions) {
          const { width, height } = change.dimensions;
          sizes ??= new Map();
          sizes.set(change.id, { width, height });
        }
      }
      if (positions) useEditorStore.getState().setDragPositions(positions);
      if (sizes) {
        const updates = sizes;
        setMeasured((previous) => {
          let changed = false;
          const next = new Map(previous);
          for (const [id, size] of updates) {
            const old = previous.get(id);
            if (!old || old.width !== size.width || old.height !== size.height) {
              next.set(id, size);
              changed = true;
            }
          }
          return changed ? next : previous;
        });
      }
    },
    [applySelection],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      applySelection(changes);
    },
    [applySelection],
  );

  const onNodeDragStop = useCallback<OnNodeDrag<FlowNode>>((_event, _node, dragged) => {
    const store = useEditorStore.getState();
    const moves: Record<Id, Position> = {};
    for (const node of dragged) moves[node.id] = { x: node.position.x, y: node.position.y };
    // One undo step per drag, however many nodes moved.
    store.moveNodes(moves);
    store.setDragPositions(null);
  }, []);

  const flowPosition = useCallback(
    (event: { clientX: number; clientY: number }): Position => {
      const raw = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      if (!useUiStore.getState().snapToGrid) return { x: Math.round(raw.x), y: Math.round(raw.y) };
      return { x: snap(raw.x, GRID_SIZE), y: snap(raw.y, GRID_SIZE) };
    },
    [screenToFlowPosition],
  );

  const onPaneClick = useCallback(
    (event: ReactMouseEvent) => {
      const store = useEditorStore.getState();
      if (store.mode === 'simulate') return;
      const { tool: activeTool } = store;
      if (activeTool === 'arc') {
        store.setArcSource(null);
        return;
      }
      if (activeTool === 'select') return;
      const position = flowPosition(event);
      if (activeTool === 'place') store.addPlace(position);
      else if (activeTool === 'transition') store.addTransition(position);
      else {
        const id = store.addAnnotation(position);
        if (id) store.startRename(id);
      }
      // Shift keeps the tool active to add several places or transitions in a row.
      if (!(event.shiftKey && activeTool !== 'annotation')) store.setTool('select');
    },
    [flowPosition],
  );

  const onNodeClick = useCallback((_event: ReactMouseEvent, node: FlowNode) => {
    const store = useEditorStore.getState();
    if (store.mode === 'simulate') {
      if (node.type === 'transition') store.fireTransition(node.id);
      return;
    }
    if (store.tool !== 'arc' || node.type === 'annotation') return;
    if (store.arcSource === null) {
      store.setArcSource(node.id);
    } else if (store.arcSource === node.id) {
      store.setArcSource(null);
    } else {
      const created = store.addArc(store.arcSource, node.id);
      if (created) store.setArcSource(null);
    }
  }, []);

  const onNodeDoubleClick = useCallback((_event: ReactMouseEvent, node: FlowNode) => {
    const store = useEditorStore.getState();
    if (store.mode === 'simulate' || store.tool !== 'select') return;
    store.startRename(node.id);
  }, []);

  const onConnect = useCallback((connection: Connection) => {
    useEditorStore.getState().addArc(connection.source, connection.target);
  }, []);

  const isValidConnection = useCallback(
    (connection: { source: string; target: string }) =>
      canConnect(useEditorStore.getState().net, connection.source, connection.target).ok,
    [],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (useEditorStore.getState().arcSource === null) {
        if (cursor !== null) setCursor(null);
        return;
      }
      const raw = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      setCursor({ x: raw.x, y: raw.y });
    },
    [screenToFlowPosition, cursor],
  );

  const hint =
    tool === 'arc' && arcSource !== null
      ? en.tools.hintArcTarget
      : {
          select: en.tools.hintSelect,
          place: en.tools.hintPlace,
          transition: en.tools.hintTransition,
          arc: en.tools.hintArc,
          annotation: en.tools.hintAnnotation,
        }[tool];

  return (
    <div
      className="relative h-full w-full"
      data-testid="canvas"
      data-tool={tool}
      data-mode={mode}
      onPointerMove={onPointerMove}
    >
      <ReactFlow<FlowNode, ArcFlowEdge>
        className={`tool-${tool} mode-${mode}`}
        aria-label={en.canvas.label}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodeOrigin={[0.5, 0.5]}
        colorMode={theme}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onPaneClick={onPaneClick}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeMouseEnter={(_event, node) => {
          setHoverId(node.id);
        }}
        onNodeMouseLeave={() => {
          setHoverId(null);
        }}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={36}
        connectionLineComponent={ConnectionLine}
        snapToGrid={snapToGrid}
        snapGrid={SNAP_GRID}
        nodesDraggable={!simulating}
        nodesConnectable={!simulating && tool === 'select'}
        elementsSelectable={tool === 'select'}
        selectionOnDrag={tool === 'select' && !simulating}
        panOnDrag={tool === 'select' ? [1, 2] : [0, 1, 2]}
        panActivationKeyCode="Space"
        multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
        deleteKeyCode={null}
        selectionKeyCode={null}
        zoomOnDoubleClick={false}
        minZoom={0.15}
        maxZoom={3}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        proOptions={{ hideAttribution: false }}
        disableKeyboardA11y={false}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={GRID_SIZE}
          size={snapToGrid ? 1.6 : 0}
          color="var(--grid)"
        />
        <Controls showInteractive={false} position="bottom-left" aria-label="Zoom controls" />
        {showMinimap ? (
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            ariaLabel={en.canvas.minimap}
            nodeColor="var(--border-strong)"
            nodeStrokeColor="var(--node-stroke)"
            style={{ marginBottom: 26 }}
          />
        ) : null}
        <ArcPreview cursor={cursor} hoverId={hoverId} />
      </ReactFlow>
      <div
        className="pointer-events-none absolute top-3 left-1/2 w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-full border border-border bg-surface/90 px-3 py-1 text-xs text-muted shadow-panel backdrop-blur"
        role="status"
        data-testid="tool-hint"
      >
        {simulating ? en.simulation.hint : hint}
      </div>
    </div>
  );
}
