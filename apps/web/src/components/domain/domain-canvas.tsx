import {
  buildScene,
  elementBounds,
  hitTest,
  paintBackdrop,
  paintScene,
  withHighlight,
  type Scene,
} from '@pnm/domain';
import { Factory, Maximize, Minus, Plus } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { en } from '../../i18n/en';
import { commandById, shortcutText } from '../../lib/commands';
import { analyseDomainView, generateGenericView } from '../../lib/domain-view';
import { buildDomainCard } from '../../lib/domain-hover';
import { paletteFor } from '../../lib/domain-theme';
import { registerDomainViewApi } from '../../lib/domain-view-api';
import { runningByTransition } from '../../lib/sim-view';
import { clampZoom, fitViewport, toSheet, zoomAround, type Viewport } from '../../lib/viewport';
import { currentMarking, useEditorStore } from '../../store/editor-store';
import { useUiStore } from '../../store/ui-store';
import type { AnchorRect } from '../canvas/hover-card';
import { Button, IconButton } from '../ui/button';
import { DomainHoverCard } from './domain-hover-card';

/** The pointer rests this long on an element before its card appears. */
export const DOMAIN_CARD_DELAY = 300;

/** A press that moves less than this many pixels is a click, not a drag. */
const CLICK_SLOP = 4;

/** Wheel and zoom button steps. */
const ZOOM_STEP = 1.25;

interface Drag {
  startX: number;
  startY: number;
  origin: Viewport;
  moved: boolean;
  button: number;
}

/** Canvas 2D view of the net as a hall, floor plan or generic process picture. */
export function DomainCanvas() {
  const net = useEditorStore((s) => s.net);
  const mode = useEditorStore((s) => s.mode);
  const simMarking = useEditorStore((s) => s.simMarking);
  const simRunning = useEditorStore((s) => s.simRunning);
  const simTime = useEditorStore((s) => s.simTime);
  const selection = useEditorStore((s) => s.selection);
  const docVersion = useEditorStore((s) => s.docVersion);
  const hover = useUiStore((s) => s.hover);
  const theme = useUiStore((s) => s.theme);
  const scrollToZoom = useUiStore((s) => s.scrollToZoom);
  const setDomainZoom = useUiStore((s) => s.setDomainZoom);
  const setViewMode = useUiStore((s) => s.setViewMode);

  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewport = useRef<Viewport>({ x: 0, y: 0, zoom: 1 });
  const size = useRef({ width: 0, height: 0 });
  const userZoomed = useRef(false);
  const sceneRef = useRef<Scene | null>(null);
  const paletteRef = useRef(paletteFor(theme));
  const frame = useRef(0);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<Drag | null>(null);
  const pinch = useRef<{ distance: number; origin: Viewport } | null>(null);
  const scrollToZoomRef = useRef(scrollToZoom);
  const cardTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [card, setCard] = useState<{ id: string; anchor: AnchorRect } | null>(null);
  const [cursor, setCursor] = useState<'default' | 'pointer' | 'grabbing'>('default');

  const simulating = mode === 'simulate';
  const analysis = useMemo(() => analyseDomainView(net), [net]);
  const view = analysis.validation?.view ?? null;
  const marking = currentMarking({ net, mode, simMarking });
  const palette = paletteFor(theme);

  const running = useMemo(
    () =>
      simulating ? simRunning.map((r) => ({ transitionId: r.transitionId, slot: r.slot })) : [],
    [simulating, simRunning],
  );
  const runningCounts = useMemo(
    () =>
      new Map(
        [...runningByTransition(simulating ? simRunning : [], simTime)].map(([id, info]) => [
          id,
          info.count,
        ]),
      ),
    [simulating, simRunning, simTime],
  );

  const baseScene = useMemo(
    () => (view ? buildScene(net, view, marking, { running }) : null),
    [net, view, marking, running],
  );
  const scene = useMemo(
    () => (baseScene ? withHighlight(baseScene, { hover: hover.id, selection }) : null),
    [baseScene, hover.id, selection],
  );

  const paint = useCallback((): void => {
    frame.current = 0;
    const canvas = canvasRef.current;
    const current = sceneRef.current;
    if (!canvas) return;
    const { width, height } = size.current;
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const palette = paletteRef.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    paintBackdrop(ctx, pixelWidth, pixelHeight, palette);
    if (!current) return;
    const { x, y, zoom } = viewport.current;
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * x, dpr * y);
    paintScene(ctx, current, palette, { scale: dpr * zoom });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    canvas.dataset['zoom'] = String(Math.round(zoom * 1000) / 1000);
    canvas.dataset['panX'] = String(Math.round(x * 10) / 10);
    canvas.dataset['panY'] = String(Math.round(y * 10) / 10);
  }, []);

  const schedulePaint = useCallback((): void => {
    if (frame.current !== 0) return;
    frame.current = requestAnimationFrame(paint);
  }, [paint]);

  const setViewport = useCallback(
    (next: Viewport): void => {
      viewport.current = next;
      setDomainZoom(Math.round(next.zoom * 100) / 100);
      schedulePaint();
    },
    [schedulePaint, setDomainZoom],
  );

  const fit = useCallback((): void => {
    const current = sceneRef.current;
    if (!current) return;
    userZoomed.current = false;
    setViewport(fitViewport(current, size.current));
  }, [setViewport]);

  // The scene and the palette that the painter reads.
  useEffect(() => {
    sceneRef.current = scene;
    paletteRef.current = palette;
    const canvas = canvasRef.current;
    if (canvas && scene) {
      const sprites = scene.layers.tokens.filter((c) => c.op === 'sprite').length;
      canvas.dataset['sprites'] = String(sprites);
    }
    schedulePaint();
  }, [scene, palette, schedulePaint]);

  // Fit when the first scene appears, when another document is loaded or its sheet size changes.
  const sheetWidth = scene?.width ?? 0;
  const sheetHeight = scene?.height ?? 0;
  const hasScene = scene !== null;
  useEffect(() => {
    if (!hasScene) return;
    fit();
  }, [hasScene, sheetWidth, sheetHeight, docVersion, fit]);

  // Size of the canvas follows its container; the view is refitted unless the user zoomed.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = (): void => {
      const rect = host.getBoundingClientRect();
      size.current = { width: Math.floor(rect.width), height: Math.floor(rect.height) };
      if (!userZoomed.current) fit();
      else schedulePaint();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => {
      observer.disconnect();
    };
  }, [fit, schedulePaint]);

  // Repaint when the browser zoom or the screen (pixel ratio) changes, and when fonts arrive.
  useEffect(() => {
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    query.addEventListener('change', schedulePaint);
    void document.fonts
      ?.load("600 12px 'Inter Variable'")
      .then(() => document.fonts.load("500 12px 'Inter Variable'"))
      .then(() => document.fonts.load("600 11px 'JetBrains Mono Variable'"))
      .then(schedulePaint, () => undefined);
    return () => {
      query.removeEventListener('change', schedulePaint);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [schedulePaint]);

  // Zoom and fit for the buttons, the status bar and the keyboard shortcuts.
  const zoomBy = useCallback(
    (factor: number): void => {
      userZoomed.current = true;
      const { width, height } = size.current;
      setViewport(zoomAround(viewport.current, factor, width / 2, height / 2));
    },
    [setViewport],
  );
  useEffect(() => {
    registerDomainViewApi({
      fitView: fit,
      resetZoom: () => {
        userZoomed.current = true;
        const { width, height } = size.current;
        const current = viewport.current;
        setViewport(zoomAround(current, 1 / current.zoom, width / 2, height / 2));
      },
    });
    return () => {
      registerDomainViewApi(null);
    };
  }, [fit, setViewport]);

  // The wheel pans, Ctrl/Cmd+wheel (and a pinch on a trackpad) zooms, like in the net editor.
  useEffect(() => {
    scrollToZoomRef.current = scrollToZoom;
  }, [scrollToZoom]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const scale = event.deltaMode === 1 ? 16 : 1;
      const dx = event.deltaX * scale;
      const dy = event.deltaY * scale;
      if (event.ctrlKey || event.metaKey || scrollToZoomRef.current) {
        userZoomed.current = true;
        const factor = Math.exp(-dy * (event.ctrlKey ? 0.01 : 0.0015));
        setViewport(
          zoomAround(viewport.current, factor, event.clientX - rect.left, event.clientY - rect.top),
        );
      } else {
        const current = viewport.current;
        setViewport({ ...current, x: current.x - dx, y: current.y - dy });
      }
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [setViewport]);

  const hideCard = useCallback((): void => {
    clearTimeout(cardTimer.current);
    cardTimer.current = undefined;
    setCard(null);
  }, []);

  useEffect(
    () => () => {
      clearTimeout(cardTimer.current);
    },
    [],
  );

  const pointerPosition = (event: { clientX: number; clientY: number }): [number, number] => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return [event.clientX - (rect?.left ?? 0), event.clientY - (rect?.top ?? 0)];
  };

  const hitAt = (px: number, py: number): { elementId: string } | null => {
    const current = sceneRef.current;
    if (!current) return null;
    const point = toSheet(viewport.current, px, py);
    // Thin things (connectors) get a few pixels of slack on screen.
    return hitTest(current, point, 4 / viewport.current.zoom);
  };

  const showCardFor = (id: string): void => {
    clearTimeout(cardTimer.current);
    cardTimer.current = setTimeout(() => {
      cardTimer.current = undefined;
      const current = sceneRef.current;
      const canvas = canvasRef.current;
      if (!current || !canvas) return;
      const bounds = elementBounds(current, id);
      if (!bounds) return;
      const rect = canvas.getBoundingClientRect();
      const { x, y, zoom } = viewport.current;
      setCard({
        id,
        anchor: {
          left: rect.left + x + bounds[0] * zoom,
          top: rect.top + y + bounds[1] * zoom,
          right: rect.left + x + (bounds[0] + bounds[2]) * zoom,
          bottom: rect.top + y + (bounds[1] + bounds[3]) * zoom,
        },
      });
    }, DOMAIN_CARD_DELAY);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (event.button !== 0 && event.button !== 1) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const [px, py] = pointerPosition(event);
    pointers.current.set(event.pointerId, { x: px, y: py });
    hideCard();
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (a && b) {
        pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), origin: viewport.current };
      }
      drag.current = null;
      return;
    }
    drag.current = {
      startX: px,
      startY: py,
      origin: viewport.current,
      moved: false,
      button: event.button,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const [px, py] = pointerPosition(event);
    if (pointers.current.has(event.pointerId)) {
      pointers.current.set(event.pointerId, { x: px, y: py });
    }
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (a && b) {
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch.current.distance > 0) {
          userZoomed.current = true;
          setViewport(
            zoomAround(
              pinch.current.origin,
              clampZoom(pinch.current.origin.zoom * (distance / pinch.current.distance)) /
                pinch.current.origin.zoom,
              (a.x + b.x) / 2,
              (a.y + b.y) / 2,
            ),
          );
        }
      }
      return;
    }
    const active = drag.current;
    if (active && event.buttons !== 0) {
      const dx = px - active.startX;
      const dy = py - active.startY;
      if (!active.moved && Math.hypot(dx, dy) > CLICK_SLOP) {
        active.moved = true;
        setCursor('grabbing');
        useUiStore.getState().setHover(null, 'domain');
      }
      if (active.moved) {
        setViewport({ ...active.origin, x: active.origin.x + dx, y: active.origin.y + dy });
      }
      return;
    }
    if (event.pointerType === 'touch') return;
    const hit = hitAt(px, py);
    const id = hit?.elementId ?? null;
    setCursor(id ? 'pointer' : 'default');
    useUiStore.getState().setHover(id, 'domain');
    if (id === null) hideCard();
    else if (cardTimer.current === undefined && card?.id !== id) showCardFor(id);
    else if (card && card.id !== id) {
      setCard(null);
      showCardFor(id);
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const [px, py] = pointerPosition(event);
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const active = drag.current;
    drag.current = null;
    setCursor('default');
    if (active && !active.moved && active.button === 0) {
      const hit = hitAt(px, py);
      const store = useEditorStore.getState();
      if (hit) {
        if (event.shiftKey) {
          const next = store.selection.includes(hit.elementId)
            ? store.selection.filter((id) => id !== hit.elementId)
            : [...store.selection, hit.elementId];
          store.select(next);
        } else store.select([hit.elementId]);
      } else if (!event.shiftKey) store.clearSelection();
    }
  };

  const onPointerLeave = (): void => {
    if (drag.current === null) useUiStore.getState().setHover(null, 'domain');
    hideCard();
  };

  const cardModel =
    card && view
      ? buildDomainCard({ net, view, marking, running: runningCounts, id: card.id })
      : null;

  const summary = view
    ? en.domain.canvasSummary(Object.keys(view.places).length, Object.keys(view.transitions).length)
    : en.domain.canvas;

  return (
    <div
      ref={hostRef}
      className="relative h-full w-full overflow-hidden bg-canvas"
      data-testid="domain-view"
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={summary}
        data-testid="domain-canvas"
        className="absolute inset-0 h-full w-full touch-none"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
      />
      {scene ? <DomainZoomControls onZoom={zoomBy} onFit={fit} /> : null}
      {!analysis.present ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
          <div
            className="pointer-events-auto flex max-w-sm flex-col items-center gap-3 rounded-xl border border-border bg-surface p-6 text-center shadow-panel"
            data-testid="domain-empty"
          >
            <Factory size={28} className="text-accent" aria-hidden="true" />
            <h2 className="m-0 text-sm font-semibold">{en.domain.emptyTitle}</h2>
            <p className="m-0 text-xs text-muted">{en.domain.emptyBody}</p>
            <Button
              variant="primary"
              onClick={generateGenericView}
              disabled={simulating}
              data-testid="domain-generate"
            >
              {en.domain.generate}
            </Button>
          </div>
        </div>
      ) : null}
      {analysis.present && !view ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
          <div
            className="pointer-events-auto flex max-w-sm flex-col items-center gap-3 rounded-xl border border-border bg-surface p-6 text-center shadow-panel"
            role="alert"
            data-testid="domain-invalid"
          >
            <h2 className="m-0 text-sm font-semibold text-danger">{en.domain.invalidTitle}</h2>
            <p className="m-0 text-xs text-muted">{en.domain.invalidBody}</p>
            {analysis.validation?.diagnostics[0] ? (
              <code className="rounded bg-surface-2 px-2 py-1 text-left font-mono text-[11px] break-words">
                {analysis.validation.diagnostics[0].path}:{' '}
                {analysis.validation.diagnostics[0].message}
              </code>
            ) : null}
            <Button
              onClick={() => {
                setViewMode('domain');
              }}
            >
              {en.domain.openPanel}
            </Button>
          </div>
        </div>
      ) : null}
      {card && cardModel ? <DomainHoverCard model={cardModel} anchor={card.anchor} /> : null}
    </div>
  );
}

function DomainZoomControls({
  onZoom,
  onFit,
}: {
  onZoom: (factor: number) => void;
  onFit: () => void;
}) {
  return (
    <div
      role="group"
      aria-label={en.canvas.zoomControls}
      className="absolute bottom-3 left-3 flex flex-col rounded-lg border border-border bg-surface p-0.5 shadow-panel"
    >
      <IconButton
        label={en.domain.zoomIn}
        side="right"
        onClick={() => {
          onZoom(ZOOM_STEP);
        }}
        data-testid="domain-zoom-in"
      >
        <Plus size={16} aria-hidden="true" />
      </IconButton>
      <IconButton
        label={en.domain.zoomOut}
        side="right"
        onClick={() => {
          onZoom(1 / ZOOM_STEP);
        }}
        data-testid="domain-zoom-out"
      >
        <Minus size={16} aria-hidden="true" />
      </IconButton>
      <IconButton
        label={en.domain.fit}
        shortcut={shortcutText(commandById('fit'))}
        side="right"
        onClick={onFit}
        data-testid="domain-fit-view"
      >
        <Maximize size={15} aria-hidden="true" />
      </IconButton>
    </div>
  );
}
