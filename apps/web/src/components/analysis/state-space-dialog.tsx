import {
  BaseEdge,
  Background,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position as HandlePosition,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import { traceTo, type StateSpace } from '@pnm/analysis';
import { useEffect, useMemo, useState } from 'react';
import type { PetriNet } from '@pnm/core';
import { en } from '../../i18n/en';
import { elementName, markingText, stepText } from '../../lib/analysis-format';
import { pathOfSteps, pathTo } from '../../lib/space-paths';
import { useAnalysisStore } from '../../store/analysis-store';
import { useEditorStore } from '../../store/editor-store';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Dialog } from '../ui/dialog';

/** At most this many states are drawn; beyond that a path or the first states are shown. */
export const GRAPH_LIMIT = 500;

const NODE_WIDTH = 168;
const NODE_HEIGHT = 58;

interface StateData extends Record<string, unknown> {
  id: number;
  text: string;
  initial: boolean;
  deadlock: boolean;
  final: boolean;
  onPath: boolean;
}

type StateNode = Node<StateData, 'state'>;

function StateNodeView({ data, selected }: NodeProps<StateNode>) {
  const t = en.analysis.graph;
  const ring = data.initial ? 'ring-2 ring-accent ring-offset-1 ring-offset-surface' : '';
  const tone = data.deadlock
    ? 'border-danger bg-danger-soft'
    : data.onPath
      ? 'border-accent bg-accent-soft'
      : 'border-border-strong bg-surface';
  return (
    <div
      className={`relative flex flex-col justify-center rounded-lg border px-2 py-1 text-[11px] leading-tight shadow-sm ${tone} ${ring} ${
        selected ? 'outline-2 outline-offset-2 outline-accent' : ''
      } ${data.final ? 'outline-1 outline-offset-2 outline-fg' : ''}`}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
      role="button"
      aria-label={t.nodeLabel(data.id, data.text)}
      aria-pressed={selected}
      data-testid="space-node"
      data-state={data.id}
      data-deadlock={data.deadlock}
    >
      <Handle type="target" position={HandlePosition.Left} className="!size-1.5 !opacity-0" />
      <div className="flex items-center justify-between gap-1">
        <span className="font-semibold tabular-nums">#{data.id}</span>
        <span className="text-[10px] text-muted">
          {[
            data.initial ? t.start : null,
            data.deadlock ? t.deadlock : null,
            data.final && !data.deadlock ? t.final : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>
      <div className="line-clamp-2 break-words" title={data.text}>
        {data.text}
      </div>
      <Handle type="source" position={HandlePosition.Right} className="!size-1.5 !opacity-0" />
    </div>
  );
}

const nodeTypes: NodeTypes = { state: StateNodeView };

interface Point {
  x: number;
  y: number;
}

interface RouteData extends Record<string, unknown> {
  points: Point[];
  label: string | null;
  tip: string;
}

type RoutedEdge = Edge<RouteData, 'routed'>;

/** An SVG path through the points with rounded corners, and the point halfway along it. */
function routePath(points: readonly Point[]): { path: string; middle: Point } {
  const first = points[0];
  if (first === undefined) return { path: '', middle: { x: 0, y: 0 } };
  const radius = 9;
  let path = `M ${first.x} ${first.y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const before = points[i - 1]!;
    const corner = points[i]!;
    const after = points[i + 1]!;
    const lengthIn = Math.hypot(corner.x - before.x, corner.y - before.y);
    const lengthOut = Math.hypot(after.x - corner.x, after.y - corner.y);
    const r = Math.min(radius, lengthIn / 2, lengthOut / 2);
    if (r < 0.5) {
      path += ` L ${corner.x} ${corner.y}`;
      continue;
    }
    const start = {
      x: corner.x + ((before.x - corner.x) / lengthIn) * r,
      y: corner.y + ((before.y - corner.y) / lengthIn) * r,
    };
    const end = {
      x: corner.x + ((after.x - corner.x) / lengthOut) * r,
      y: corner.y + ((after.y - corner.y) / lengthOut) * r,
    };
    path += ` L ${start.x} ${start.y} Q ${corner.x} ${corner.y} ${end.x} ${end.y}`;
  }
  const last = points[points.length - 1]!;
  path += ` L ${last.x} ${last.y}`;
  // Halfway along the polyline.
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  }
  let rest = total / 2;
  let middle = first;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (rest <= length || i === points.length - 1) {
      const f = length === 0 ? 0 : Math.min(1, rest / length);
      middle = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      break;
    }
    rest -= length;
  }
  return { path, middle };
}

function RoutedEdgeView({ id, data, markerEnd }: EdgeProps<RoutedEdge>) {
  const { path, middle } = routePath(data?.points ?? []);
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{ stroke: 'var(--edge)', strokeWidth: 1.25 }}
      />
      <title>{data?.tip}</title>
      {data?.label ? (
        <EdgeLabelRenderer>
          <span
            className="nodrag nopan pointer-events-none absolute rounded bg-surface/90 px-1 text-[10px] leading-4 text-fg"
            style={{ transform: `translate(-50%, -50%) translate(${middle.x}px, ${middle.y}px)` }}
            data-testid="space-edge-label"
          >
            {data.label}
          </span>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const edgeTypes: EdgeTypes = { routed: RoutedEdgeView };

type Focus = 'all' | `deadlock:${number}` | `counter:${string}`;

interface View {
  ids: number[];
  edgeIndexes: number[];
  pathIds: Set<number>;
  limited: boolean;
}

function viewOf(space: StateSpace, paths: number[][] | null): View {
  if (paths !== null) {
    const ids = [...new Set(paths.flat())].sort((a, b) => a - b);
    const shown = new Set(ids);
    const edgeIndexes: number[] = [];
    space.edges.forEach((edge, index) => {
      if (shown.has(edge.from) && shown.has(edge.to) && edge.from !== edge.to) {
        // On a path view only the edges between consecutive states of a path are drawn.
        if (paths.some((p) => p.some((id, i) => id === edge.from && p[i + 1] === edge.to))) {
          edgeIndexes.push(index);
        }
      }
    });
    return { ids, edgeIndexes, pathIds: new Set(ids), limited: false };
  }
  const count = Math.min(space.states.length, GRAPH_LIMIT);
  const ids = Array.from({ length: count }, (_, i) => i);
  const edgeIndexes: number[] = [];
  space.edges.forEach((edge, index) => {
    if (edge.from < count && edge.to < count && edge.from !== edge.to) edgeIndexes.push(index);
  });
  return { ids, edgeIndexes, pathIds: new Set(), limited: space.states.length > count };
}

function GraphBody({ net, space }: { net: PetriNet; space: StateSpace }) {
  const t = en.analysis.graph;
  const check = useAnalysisStore((s) => s.check);
  const close = useAnalysisStore((s) => s.closeGraph);
  const [focus, setFocus] = useState<Focus>('all');
  const [labels, setLabels] = useState(space.edges.length <= 150);
  const [selected, setSelected] = useState<number | null>(null);
  // The layout belongs to the view it was computed for; a different view starts without one.
  const [layout, setLayout] = useState<{
    view: View;
    positions: Record<string, Point> | null;
    routes: Record<string, Point[]>;
    failure: string | null;
  } | null>(null);

  const behaviourDeadlocks = useMemo(
    () => space.states.filter((s) => s.deadlock).slice(0, 20),
    [space],
  );
  const counterexamples = useMemo(
    () =>
      (check?.value.report.results ?? []).flatMap((result) =>
        result.counterexample ? [{ id: result.id, steps: result.counterexample.steps }] : [],
      ),
    [check],
  );

  const paths = useMemo<number[][] | null>(() => {
    if (focus === 'all') return null;
    if (focus.startsWith('deadlock:')) return [pathTo(space, Number(focus.slice(9)))];
    const found = counterexamples.find((c) => c.id === focus.slice(8));
    const path = found ? pathOfSteps(space, found.steps) : null;
    return path ? [path] : null;
  }, [focus, space, counterexamples]);
  const view = useMemo(() => viewOf(space, paths), [space, paths]);

  // ELK is loaded on demand; the layout of 500 states takes a moment.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { layoutGraph } = await import('@pnm/layout');
        const result = await layoutGraph(
          view.ids.map((id) => ({
            id: String(id),
            width: NODE_WIDTH,
            height: NODE_HEIGHT,
            first: id === space.initial,
          })),
          view.edgeIndexes.map((index) => ({
            id: String(index),
            source: String(space.edges[index]!.from),
            target: String(space.edges[index]!.to),
          })),
          { direction: 'RIGHT', spacing: 28, layerSpacing: 90 },
        );
        if (!cancelled) setLayout({ view, ...result, failure: null });
      } catch (error) {
        if (!cancelled) {
          setLayout({
            view,
            positions: null,
            routes: {},
            failure: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view, space]);

  const positions = layout !== null && layout.view === view ? layout.positions : null;
  const routes = layout !== null && layout.view === view ? layout.routes : null;
  const failure = layout !== null && layout.view === view ? layout.failure : null;

  const nodes = useMemo<StateNode[]>(
    () =>
      positions === null
        ? []
        : view.ids.map((id) => {
            const state = space.states[id]!;
            return {
              id: String(id),
              type: 'state' as const,
              position: positions[String(id)] ?? { x: 0, y: 0 },
              draggable: false,
              connectable: false,
              selected: id === selected,
              data: {
                id,
                text: markingText(net, state.marking, 4),
                initial: id === space.initial,
                deadlock: state.deadlock,
                final: state.final,
                onPath: view.pathIds.has(id),
              },
            };
          }),
    [positions, view, space, net, selected],
  );
  const edges = useMemo<RoutedEdge[]>(
    () =>
      routes === null
        ? []
        : view.edgeIndexes.map((index) => {
            const edge = space.edges[index]!;
            const step = {
              transitionId: edge.transitionId,
              ...(edge.binding !== undefined && { binding: edge.binding }),
            };
            return {
              id: String(index),
              type: 'routed' as const,
              source: String(edge.from),
              target: String(edge.to),
              markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
              data: {
                points: routes[String(index)] ?? [],
                label: labels ? elementName(net, edge.transitionId) : null,
                tip: stepText(net, step, 24),
              },
            };
          }),
    [view, space, net, labels, routes],
  );

  const state = selected === null ? null : (space.states[selected] ?? null);
  const showInNet = (id: number): void => {
    const target = space.states[id];
    if (!target) return;
    close();
    void useEditorStore.getState().startReplay({
      label: t.state(id),
      steps: traceTo(space, id),
      target: target.marking,
      immediate: true,
    });
  };

  return (
    <div className="flex flex-col gap-3" data-testid="space-graph">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          {t.focus}
          <select
            value={focus}
            onChange={(event) => {
              setSelected(null);
              setFocus(event.target.value as Focus);
            }}
            className="h-8 rounded-md border border-border-strong bg-surface px-2 text-sm font-normal text-fg"
            data-testid="space-focus"
          >
            <option value="all">{t.focusAll}</option>
            {behaviourDeadlocks.map((s, i) => (
              <option key={s.id} value={`deadlock:${s.id}`}>
                {t.focusPath(en.analysis.space.deadlockItem(i + 1, traceTo(space, s.id).length))}
              </option>
            ))}
            {counterexamples.map((c) => (
              <option key={c.id} value={`counter:${c.id}`}>
                {t.focusPath(`${en.analysis.properties.counterexample} (${c.steps.length})`)}
              </option>
            ))}
          </select>
        </label>
        <Checkbox
          label={t.edgeLabels}
          checked={labels}
          onChange={setLabels}
          data-testid="space-labels"
        />
        <p className="m-0 text-[11px] text-muted">{t.legend}</p>
      </div>
      {view.limited ? (
        <p
          className="m-0 rounded-md bg-warn-soft px-2.5 py-1.5 text-xs text-warn"
          data-testid="space-limited"
        >
          {t.limited(view.ids.length, space.states.length)}
        </p>
      ) : null}
      <div
        className="relative h-[58vh] overflow-hidden rounded-md border border-border bg-canvas"
        data-testid="space-canvas"
      >
        {positions === null && failure === null ? (
          <p
            className="absolute inset-0 m-0 flex items-center justify-center text-sm text-muted"
            role="status"
          >
            {t.loading}
          </p>
        ) : null}
        {failure !== null ? (
          <p
            className="absolute inset-0 m-0 flex items-center justify-center text-sm text-danger"
            role="alert"
          >
            {en.analysis.failed(failure)}
          </p>
        ) : null}
        {positions !== null ? (
          <ReactFlow<StateNode, RoutedEdge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            minZoom={0.05}
            maxZoom={1.5}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            proOptions={{ hideAttribution: true }}
            aria-label={t.graphLabel}
            onNodeClick={(_, node) => {
              setSelected(Number(node.id));
            }}
            onNodeDoubleClick={(_, node) => {
              showInNet(Number(node.id));
            }}
            onPaneClick={() => {
              setSelected(null);
            }}
          >
            <Background gap={24} />
            <Controls showInteractive={false} />
          </ReactFlow>
        ) : null}
      </div>
      <div
        className="flex min-h-16 flex-col gap-1.5 rounded-md border border-border bg-surface-2 p-2.5 text-xs"
        data-testid="space-detail"
        aria-live="polite"
      >
        {state ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <strong className="text-sm">
                {t.selected}: {t.state(state.id)}
              </strong>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  showInNet(state.id);
                }}
                data-testid="space-show-in-net"
              >
                {en.analysis.space.showInNet}
              </Button>
            </div>
            <span data-testid="space-detail-marking">
              {en.analysis.space.marking}: {markingText(net, state.marking, 12)}
            </span>
            <span>
              {t.enabledHere}:{' '}
              {state.enabled.length === 0
                ? t.none
                : state.enabled.map((id) => elementName(net, id)).join(', ')}
            </span>
            <span>
              {t.reachedBy}:{' '}
              {traceTo(space, state.id).length === 0
                ? t.none
                : traceTo(space, state.id)
                    .map((s) => stepText(net, s))
                    .join(' → ')}
            </span>
          </>
        ) : (
          <span className="text-muted">{t.noSelection}</span>
        )}
      </div>
    </div>
  );
}

/** The state space as a graph: states as nodes, firings as labelled edges, laid out with ELK. */
export function StateSpaceDialog() {
  const open = useAnalysisStore((s) => s.graphOpen);
  const close = useAnalysisStore((s) => s.closeGraph);
  const space = useAnalysisStore((s) => s.space);
  const net = useEditorStore((s) => s.net);
  return (
    <Dialog
      open={open}
      title={en.analysis.graph.title}
      onClose={close}
      width="max-w-[min(96vw,1500px)]"
    >
      {open && space ? (
        <ReactFlowProvider>
          <GraphBody net={net} space={space.value.report.space} />
        </ReactFlowProvider>
      ) : null}
    </Dialog>
  );
}
