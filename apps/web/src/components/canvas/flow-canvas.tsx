import { canConnect, type Id, type Position } from '@pnm/core';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  MiniMap,
  ReactFlow,
  useReactFlow,
  useStore,
  useStoreApi,
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
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { en } from '../../i18n/en';
import { targetElement } from '../../lib/context-target';
import { buildHoverCard } from '../../lib/hover-card';
import { buildFlowEdges, buildFlowNodes } from '../../lib/flow-model';
import { findBottlenecks, runningByTransition } from '../../lib/sim-view';
import { GRID_SIZE, snap, snapDragged } from '@pnm/layout/geometry';
import { registerViewApi } from '../../lib/view-api';
import { FIT_MAX_ZOOM, zoomLevel } from '../../lib/zoom';
import { currentMarking, useEditorStore } from '../../store/editor-store';
import { useUiStore } from '../../store/ui-store';
import { AnnotationNode } from './annotation-node';
import { CanvasContextMenu } from './canvas-menu';
import { ArcEdge } from './arc-edge';
import { ArcPreview } from './arc-preview';
import { ConnectionLine } from './connection-line';
import { HoverCard, type AnchorRect } from './hover-card';
import { PlaceNode } from './place-node';
import { TokenFlights } from './token-flights';
import { TransitionNode } from './transition-node';
import { ZoomControls } from './zoom-controls';
import type { ArcFlowEdge, FlowNode } from './types';

const nodeTypes: NodeTypes = {
  place: PlaceNode,
  transition: TransitionNode,
  annotation: AnnotationNode,
};
const edgeTypes: EdgeTypes = { arc: ArcEdge };

/** True while every node lies inside the visible part of the canvas. */
function useNetFitsView(): boolean {
  return useStore((s) => {
    if (s.nodeLookup.size === 0) return true;
    const zoom = s.transform[2];
    const left = -s.transform[0] / zoom;
    const top = -s.transform[1] / zoom;
    const right = left + s.width / zoom;
    const bottom = top + s.height / zoom;
    for (const node of s.nodeLookup.values()) {
      const { x, y } = node.internals.positionAbsolute;
      const width = node.measured.width ?? 0;
      const height = node.measured.height ?? 0;
      if (x < left || y < top || x + width > right || y + height > bottom) return false;
    }
    return true;
  });
}

/**
 * Minimap in the lower right corner. It only appears while part of the net is out of view: when the
 * whole net is visible it would only cover the canvas.
 */
function AutoMiniMap() {
  const fits = useNetFitsView();
  return (
    <MiniMap
      pannable
      zoomable
      position="bottom-right"
      ariaLabel={en.canvas.minimap}
      nodeColor="var(--border-strong)"
      nodeStrokeColor="var(--node-stroke)"
      style={{
        width: 160,
        height: 100,
        marginBottom: 26,
        opacity: fits ? 0 : 1,
        // Hidden for the pointer and for assistive technology once the fade-out is over.
        visibility: fits ? 'hidden' : 'visible',
        transition: fits ? 'opacity 150ms, visibility 0s 150ms' : 'opacity 150ms',
      }}
    />
  );
}

/** The pointer rests this long on a node before its hover card appears. */
export const HOVER_CARD_DELAY = 300;

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
  const simRunning = useEditorStore((s) => s.simRunning);
  const simTime = useEditorStore((s) => s.simTime);
  const simTimed = useEditorStore((s) => s.simTimed);
  const simBreakpoints = useEditorStore((s) => s.simBreakpoints);
  const deviationRing = useEditorStore((s) => s.simDeviationRing);
  const createdTokens = useEditorStore((s) => s.simMetrics?.replay?.missingByPlace);
  const bottleneckWarn = useUiStore((s) => s.bottleneckWarn);
  const bottleneckCritical = useUiStore((s) => s.bottleneckCritical);
  const docVersion = useEditorStore((s) => s.docVersion);
  const theme = useUiStore((s) => s.theme);
  // Behind the domain view the editor is hidden: its token flights would run for nobody.
  const viewMode = useUiStore((s) => s.viewMode);
  const snapToGrid = useUiStore((s) => s.snapToGrid);
  const showMinimap = useUiStore((s) => s.showMinimap);
  const scrollToZoom = useUiStore((s) => s.scrollToZoom);
  const level = useStore((s) => zoomLevel(s.transform[2]));

  const {
    screenToFlowPosition,
    fitView,
    setCenter,
    getZoom,
    getNode,
    getViewport,
    setViewport,
    zoomTo,
  } = useReactFlow();
  const rfStore = useStoreApi();
  const wrapper = useRef<HTMLDivElement>(null);
  /** The user zoomed since the view was last fitted: a resize of the window keeps the zoom. */
  const userZoomed = useRef(false);
  const lastZoom = useRef(1);
  const [measured, setMeasured] = useState<ReadonlyMap<Id, { width: number; height: number }>>(
    () => new Map(),
  );
  const [cursor, setCursor] = useState<Position | null>(null);
  const [hoverId, setHoverId] = useState<Id | null>(null);
  const [card, setCard] = useState<{ id: Id; anchor: AnchorRect } | null>(null);
  const cardTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The element the pointer is on in the domain view, if that is where the pointer is.
  const linkedId = useUiStore((s) => (s.hover.source === 'domain' ? s.hover.id : null));

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

  const running = useMemo(
    () => (simulating ? runningByTransition(simRunning, simTime) : undefined),
    [simulating, simRunning, simTime],
  );
  const breakpointTransitions = useMemo(
    () => (simulating ? new Set(simBreakpoints.transitions) : undefined),
    [simulating, simBreakpoints.transitions],
  );
  const ringed = useMemo(
    () => (simulating ? new Set(Object.keys(deviationRing)) : undefined),
    [simulating, deviationRing],
  );
  const bottlenecks = useMemo(
    () =>
      simulating && simTimed
        ? findBottlenecks(net, marking, bottleneckWarn, bottleneckCritical)
        : undefined,
    [simulating, simTimed, net, marking, bottleneckWarn, bottleneckCritical],
  );

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
      ...(running && { running }),
      ...(breakpointTransitions && { breakpointTransitions }),
      ...(simulating && { breakpointPlaces: simBreakpoints.places }),
      ...(bottlenecks && { bottlenecks }),
      ...(ringed && ringed.size > 0 && { deviationRing: ringed }),
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
      running,
      breakpointTransitions,
      simBreakpoints.places,
      bottlenecks,
      ringed,
    ],
  );
  const nodes = useMemo(() => buildFlowNodes(context), [context]);
  const edges = useMemo(() => buildFlowEdges(context), [context]);

  // Light up the node that the domain view is pointing at. Set on the element directly: a hover
  // must not rebuild all nodes.
  useEffect(() => {
    const host = wrapper.current;
    if (!host || linkedId === null) return;
    const node = host.querySelector(`.react-flow__node[data-id="${CSS.escape(linkedId)}"]`);
    node?.setAttribute('data-linked', 'true');
    return () => {
      node?.removeAttribute('data-linked');
    };
  }, [linkedId]);

  const hideCard = useCallback(() => {
    clearTimeout(cardTimer.current);
    cardTimer.current = undefined;
    setCard(null);
  }, []);

  /** Shows the hover card of a node after a short pause of the pointer on it. */
  const scheduleCard = useCallback((element: HTMLElement, id: Id) => {
    clearTimeout(cardTimer.current);
    cardTimer.current = setTimeout(() => {
      cardTimer.current = undefined;
      const state = useEditorStore.getState();
      if (state.renamingId === id || state.picker === id || state.dragPositions !== null) return;
      // The details of a selected node are in the properties panel and its chip card.
      if (state.selection.includes(id)) return;
      const rect = element.getBoundingClientRect();
      setCard({
        id,
        anchor: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      });
    }, HOVER_CARD_DELAY);
  }, []);

  useEffect(
    () => () => {
      clearTimeout(cardTimer.current);
    },
    [],
  );

  const fit = useCallback(
    (duration = 250) => {
      userZoomed.current = false;
      // Room for labels above (guards) and below (names) the nodes.
      void fitView({
        padding: { top: '84px', right: '96px', bottom: '80px', left: '96px' },
        maxZoom: FIT_MAX_ZOOM,
        duration,
      });
    },
    [fitView],
  );

  // Expose viewport operations to the header, status bar and shortcuts.
  useEffect(() => {
    registerViewApi({
      fitView: () => {
        fit();
      },
      focus: (ids) => {
        const targets = nodes.filter((n) => ids.includes(n.id));
        if (targets.length === 0) return;
        const x = targets.reduce((sum, n) => sum + n.position.x, 0) / targets.length;
        const y = targets.reduce((sum, n) => sum + n.position.y, 0) / targets.length;
        void setCenter(x, y, { zoom: Math.max(getZoom(), 1), duration: 250 });
      },
      reveal: (ids) => {
        // The nodes may not be measured yet: wait for the next frames.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const host = wrapper.current;
            if (!host) return;
            const { x, y, zoom } = getViewport();
            const margin = 70;
            let dx = 0;
            let dy = 0;
            for (const id of ids) {
              const node = getNode(id);
              if (!node) continue;
              const sx = node.position.x * zoom + x;
              const sy = node.position.y * zoom + y;
              if (sx < margin) dx = Math.max(dx, margin - sx);
              else if (sx > host.clientWidth - margin)
                dx = Math.min(dx, host.clientWidth - margin - sx);
              if (sy < margin) dy = Math.max(dy, margin - sy);
              else if (sy > host.clientHeight - margin)
                dy = Math.min(dy, host.clientHeight - margin - sy);
            }
            if (dx !== 0 || dy !== 0)
              void setViewport({ x: x + dx, y: y + dy, zoom }, { duration: 150 });
          });
        });
      },
      resetZoom: () => {
        userZoomed.current = true;
        void zoomTo(1, { duration: 150 });
      },
      center: () => {
        const host = wrapper.current;
        if (!host) return null;
        const box = host.getBoundingClientRect();
        const raw = screenToFlowPosition({
          x: box.left + box.width / 2,
          y: box.top + box.height / 2,
        });
        return { x: snap(raw.x, GRID_SIZE), y: snap(raw.y, GRID_SIZE) };
      },
    });
    return () => {
      registerViewApi(null);
    };
  }, [
    fit,
    setCenter,
    getZoom,
    getNode,
    getViewport,
    setViewport,
    zoomTo,
    screenToFlowPosition,
    nodes,
  ]);

  // Show the whole net after a different document was loaded.
  useEffect(() => {
    if (docVersion === 0) return;
    const frame = requestAnimationFrame(() => {
      fit(0);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [docVersion, fit]);

  // Refit when the window or the panels change the size of the canvas, unless the user zoomed.
  useEffect(() => {
    const host = wrapper.current;
    if (!host) return;
    let size = { width: host.clientWidth, height: host.clientHeight };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      const next = { width: host.clientWidth, height: host.clientHeight };
      if (Math.abs(next.width - size.width) < 2 && Math.abs(next.height - size.height) < 2) return;
      size = next;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const state = useEditorStore.getState();
        const hasNodes = state.net.places.length + state.net.transitions.length > 0;
        if (!userZoomed.current && hasNodes) fit(150);
      }, 200);
    });
    observer.observe(host);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [fit]);

  // The zoom as a CSS variable: names keep a readable size on screen while zoomed out. Set directly
  // on the element, so that zooming does not re-render the canvas.
  useEffect(() => {
    const host = wrapper.current;
    if (!host) return;
    let last = 0;
    const apply = (zoom: number): void => {
      if (zoom === last) return;
      last = zoom;
      host.style.setProperty('--zoom', String(Math.round(zoom * 1000) / 1000));
    };
    apply(rfStore.getState().transform[2]);
    return rfStore.subscribe((state) => {
      apply(state.transform[2]);
    });
  }, [rfStore]);

  // Holding Alt turns every node into a source for arcs.
  useEffect(() => {
    const host = wrapper.current;
    if (!host) return;
    const update = (event: KeyboardEvent): void => {
      host.classList.toggle('alt-held', event.altKey);
    };
    const clear = (): void => {
      host.classList.remove('alt-held');
    };
    window.addEventListener('keydown', update);
    window.addEventListener('keyup', update);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', update);
      window.removeEventListener('keyup', update);
      window.removeEventListener('blur', clear);
    };
  }, []);

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
      let sizes: Map<Id, { width: number; height: number }> | null = null;
      const dragged: Array<{ id: Id; position: Position }> = [];
      for (const change of changes) {
        if (change.type === 'position' && change.dragging && change.position) {
          dragged.push({ id: change.id, position: change.position });
        } else if (change.type === 'dimensions' && change.dimensions) {
          const { width, height } = change.dimensions;
          sizes ??= new Map();
          sizes.set(change.id, { width, height });
        }
      }
      if (dragged.length > 0) {
        const positions: Record<Id, Position> = {
          ...(useEditorStore.getState().dragPositions ?? {}),
        };
        const grid = useUiStore.getState().snapToGrid ? GRID_SIZE : null;
        for (const move of snapDragged(dragged, grid)) positions[move.id] = move.position;
        useEditorStore.getState().setDragPositions(positions);
      }
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
    // The snapped positions of the last drag step; the nodes of React Flow itself are not snapped.
    for (const node of dragged) {
      moves[node.id] = store.dragPositions?.[node.id] ?? {
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
      };
    }
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
      if (store.mode === 'simulate') {
        store.setPicker(null);
        return;
      }
      const { tool: activeTool } = store;
      if (activeTool === 'arc') {
        store.setArcSource(null);
        return;
      }
      if (activeTool === 'select') return;
      // Shift keeps the tool active to add several places or transitions in a row; a sticky tool
      // stays active anyway.
      store.placeWithTool(flowPosition(event), {
        keepTool: event.shiftKey && activeTool !== 'annotation',
        rename: false,
      });
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

  const onPaneDoubleClick = useCallback(
    (event: ReactMouseEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.classList.contains('react-flow__pane')
      ) {
        return;
      }
      if (useEditorStore.getState().tool === 'select') fit();
    },
    [fit],
  );

  const onEdgeDoubleClick = useCallback((_event: ReactMouseEvent, edge: ArcFlowEdge) => {
    const store = useEditorStore.getState();
    if (store.mode === 'simulate' || store.tool !== 'select') return;
    store.startRename(edge.id);
  }, []);

  const onNodeDoubleClick = useCallback((_event: ReactMouseEvent, node: FlowNode) => {
    const store = useEditorStore.getState();
    if (store.mode === 'simulate' || store.tool !== 'select') return;
    store.startRename(node.id);
  }, []);

  // Context menu: the handlers of React Flow say what was clicked, the menu itself is in
  // `CanvasContextMenu`.
  const onPaneContextMenu = useCallback(
    (event: MouseEvent | ReactMouseEvent) => {
      useUiStore.getState().setMenuTarget({ kind: 'pane', position: flowPosition(event) });
    },
    [flowPosition],
  );
  const onNodeContextMenu = useCallback((_event: ReactMouseEvent, node: FlowNode) => {
    targetElement(node.id, 'node');
  }, []);
  const onEdgeContextMenu = useCallback((_event: ReactMouseEvent, edge: ArcFlowEdge) => {
    targetElement(edge.id, 'edge');
  }, []);
  const onSelectionContextMenu = useCallback(() => {
    useUiStore.getState().setMenuTarget({ kind: 'selection' });
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

  const cardModel =
    card && !selection.includes(card.id)
      ? buildHoverCard({
          net,
          marking,
          id: card.id,
          diagnostics,
          enabled: simulating ? enabledResults : undefined,
          running: simulating ? running?.get(card.id)?.count : undefined,
          createdTokens: simulating ? createdTokens : undefined,
        })
      : null;

  return (
    <CanvasContextMenu>
      <div
        ref={wrapper}
        className="relative h-full w-full"
        onContextMenuCapture={(event) => {
          hideCard();
          // Anything that React Flow does not report (overlays, margins) counts as the empty canvas.
          useUiStore.getState().setMenuTarget({ kind: 'pane', position: flowPosition(event) });
        }}
        data-testid="canvas"
        data-tool={tool}
        data-mode={mode}
        data-zoom-level={level}
        onPointerMove={onPointerMove}
        onDoubleClick={onPaneDoubleClick}
      >
        <ReactFlow<FlowNode, ArcFlowEdge>
          className={`tool-${tool} mode-${mode} zoom-${level}`}
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
          onEdgeDoubleClick={onEdgeDoubleClick}
          onPaneContextMenu={onPaneContextMenu}
          onNodeContextMenu={onNodeContextMenu}
          onEdgeContextMenu={onEdgeContextMenu}
          onSelectionContextMenu={onSelectionContextMenu}
          onMoveEnd={(event, viewport) => {
            // A move that comes from the user (not from fit or zoom buttons) and changes the zoom.
            if (event && Math.abs(viewport.zoom - lastZoom.current) > 0.0005) {
              userZoomed.current = true;
            }
            lastZoom.current = viewport.zoom;
          }}
          onNodeMouseEnter={(event, node) => {
            setHoverId(node.id);
            useUiStore.getState().setHover(node.id, 'net');
            if (node.type !== 'annotation' && event.buttons === 0) {
              scheduleCard(event.currentTarget as HTMLElement, node.id);
            }
          }}
          onNodeMouseMove={(event, node) => {
            // Pills and markers on a node have tooltips of their own.
            const over = (event.target as Element).closest('[data-no-hovercard]') !== null;
            if (over) hideCard();
            else if (
              node.type !== 'annotation' &&
              event.buttons === 0 &&
              cardTimer.current === undefined &&
              card?.id !== node.id
            ) {
              scheduleCard(event.currentTarget as HTMLElement, node.id);
            }
          }}
          onNodeMouseLeave={() => {
            setHoverId(null);
            useUiStore.getState().setHover(null, 'net');
            hideCard();
          }}
          onNodeDragStart={hideCard}
          onConnectStart={hideCard}
          onMoveStart={hideCard}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          connectionMode={ConnectionMode.Loose}
          connectionRadius={36}
          connectionLineComponent={ConnectionLine}
          nodesDraggable={!simulating}
          nodesConnectable={!simulating && tool === 'select'}
          elementsSelectable={tool === 'select'}
          selectionOnDrag={tool === 'select' && !simulating}
          // The right button is for the context menu.
          panOnDrag={tool === 'select' ? [1] : [0, 1]}
          // Space plays and pauses the simulation, so it cannot also start panning there.
          panActivationKeyCode={simulating ? null : 'Space'}
          multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
          deleteKeyCode={null}
          selectionKeyCode={null}
          zoomOnDoubleClick={false}
          panOnScroll={!scrollToZoom}
          zoomOnScroll={scrollToZoom}
          zoomActivationKeyCode={['Control', 'Meta']}
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
          <ZoomControls />
          {showMinimap ? <AutoMiniMap /> : null}
          <ArcPreview cursor={cursor} hoverId={hoverId} />
          {simulating && viewMode !== 'domain' ? <TokenFlights edges={edges} /> : null}
        </ReactFlow>
        {card && cardModel ? <HoverCard model={cardModel} anchor={card.anchor} /> : null}
      </div>
    </CanvasContextMenu>
  );
}
