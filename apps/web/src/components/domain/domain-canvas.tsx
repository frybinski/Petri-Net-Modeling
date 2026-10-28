import {
  elementBounds,
  hitSprite,
  hitTest,
  paintBackdrop,
  paintLayers,
  SpriteCache,
  spriteSize,
  staticLayoutState,
  visitedTransitions,
  type SpriteSample,
} from '@pnm/domain';
import { Bot, Factory, Maximize, Minus, Plus } from 'lucide-react';
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
import { DomainAnimator } from '../../lib/domain-animator';
import { buildDomainCard } from '../../lib/domain-hover';
import { currentSimState } from '../../lib/domain-state';
import { paletteFor } from '../../lib/domain-theme';
import { openGenerateDialog } from '../../lib/domain-generation';
import { analyseDomainView, generateGenericView } from '../../lib/domain-view';
import { registerDomainViewApi } from '../../lib/domain-view-api';
import { StaticLayer } from '../../lib/static-layer';
import { useCaseTrail } from '../../lib/use-case-trail';
import {
  clampZoom,
  fitAround,
  toSheet,
  zoomAround,
  type ViewRect,
  type Viewport,
} from '../../lib/viewport';
import { useEditorStore } from '../../store/editor-store';
import { onSimEvents, onSimJump } from '../../store/sim-log';
import { useUiStore } from '../../store/ui-store';
import type { AnchorRect } from '../canvas/hover-card';
import { Button, IconButton } from '../ui/button';
import { DomainBindingPicker } from './domain-binding-picker';
import { DomainCaseCard } from './domain-case-card';
import { DomainControls } from './domain-controls';
import { DomainHoverCard } from './domain-hover-card';
import { DomainKpis } from './domain-kpis';

/** The pointer rests this long on an element before its card appears. */
export const DOMAIN_CARD_DELAY = 300;

/** A press that moves less than this many pixels is a click, not a drag. */
const CLICK_SLOP = 4;

/** Wheel and zoom button steps. */
const ZOOM_STEP = 1.25;

/** The static layer is rendered anew this long after the last change of the zoom. */
export const STATIC_RERENDER_DELAY = 80;

interface Drag {
  startX: number;
  startY: number;
  origin: Viewport;
  moved: boolean;
  button: number;
}

/** True if the user asks the system for less motion. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Canvas 2D view of the net as a hall, floor plan or generic process picture. In simulation it
 * shows the events as they come: tokens move along the belts, stations show their state, queues
 * turn yellow and red when they grow, counters count up.
 */
export function DomainCanvas() {
  const net = useEditorStore((s) => s.net);
  const mode = useEditorStore((s) => s.mode);
  const selection = useEditorStore((s) => s.selection);
  const docVersion = useEditorStore((s) => s.docVersion);
  const simSpeed = useEditorStore((s) => s.simSpeed);
  const hover = useUiStore((s) => s.hover);
  const theme = useUiStore((s) => s.theme);
  const scrollToZoom = useUiStore((s) => s.scrollToZoom);
  const warn = useUiStore((s) => s.bottleneckWarn);
  const critical = useUiStore((s) => s.bottleneckCritical);
  const followedCase = useUiStore((s) => s.followedCase);
  const controlsShown = useUiStore((s) => s.domainControls);
  const viewMode = useUiStore((s) => s.viewMode);
  const setDomainZoom = useUiStore((s) => s.setDomainZoom);
  const setViewMode = useUiStore((s) => s.setViewMode);

  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewport = useRef<Viewport>({ x: 0, y: 0, zoom: 1 });
  const size = useRef({ width: 0, height: 0 });
  const overlays = useRef<ViewRect[]>([]);
  const userZoomed = useRef(false);
  const frame = useRef(0);
  const frames = useRef(0);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<Drag | null>(null);
  const pinch = useRef<{ distance: number; origin: Viewport } | null>(null);
  const scrollToZoomRef = useRef(scrollToZoom);
  const cardTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rerenderTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingSync = useRef(false);
  const [animator] = useState(() => new DomainAnimator());
  const [staticLayer] = useState(() => new StaticLayer());
  const [spriteCache] = useState(
    () =>
      new SpriteCache((width, height) => {
        const surface = document.createElement('canvas');
        surface.width = width;
        surface.height = height;
        return surface;
      }),
  );
  const [card, setCard] = useState<{ id: string; anchor: AnchorRect } | null>(null);
  const [cursor, setCursor] = useState<'default' | 'pointer' | 'grabbing'>('default');
  const [pickerAnchor, setPickerAnchor] = useState<{ id: string; anchor: AnchorRect } | null>(null);
  const picker = useEditorStore((s) => s.picker);

  const simulating = mode === 'simulate';
  const analysis = useMemo(() => analyseDomainView(net), [net]);
  const view = analysis.validation?.view ?? null;
  const palette = paletteFor(theme);
  const trail = useCaseTrail(simulating ? followedCase : null);
  const visited = useMemo(() => visitedTransitions(trail), [trail]);

  // What the painter reads each frame. Kept in refs so that a frame never waits for React.
  const options = useRef({
    hover: hover.id,
    selection,
    thresholds: { warn, critical },
    followCase: followedCase,
    visited,
  });
  const paletteRef = useRef({ palette, key: theme });

  const schedulePaintRef = useRef<() => void>(() => undefined);

  const paint = useCallback((): void => {
    frame.current = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const now = performance.now();
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
    const { palette: current, key } = paletteRef.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    paintBackdrop(ctx, pixelWidth, pixelHeight, current);
    const staticScene = animator.staticScene;
    if (staticScene) {
      const { x, y, zoom } = viewport.current;
      const wanted = dpr * zoom;
      // The sheet is rendered once and scaled while the zoom changes; sharp again 80 ms later.
      if (!staticLayer.isCurrent(staticScene, key)) {
        clearTimeout(rerenderTimer.current);
        staticLayer.render(staticScene, current, key, wanted);
      } else if (!staticLayer.hasScale(staticScene, wanted)) {
        clearTimeout(rerenderTimer.current);
        rerenderTimer.current = setTimeout(() => {
          rerenderTimer.current = undefined;
          const scene = animator.staticScene;
          if (!scene) return;
          const zoomNow = viewport.current.zoom;
          staticLayer.render(
            scene,
            paletteRef.current.palette,
            paletteRef.current.key,
            (window.devicePixelRatio || 1) * zoomNow,
          );
          schedulePaintRef.current();
        }, STATIC_RERENDER_DELAY);
      }
      ctx.setTransform(wanted, 0, 0, wanted, dpr * x, dpr * y);
      staticLayer.draw(ctx, staticScene);
      const state = useEditorStore.getState();
      const dynamic = animator.frame(now, {
        ...options.current,
        simTime: animator.simTimeAt(now, {
          playing: state.simPlaying && state.simTimed,
          speed: state.simTimed ? state.simSpeed : null,
          nextEvent: state.simNextEvent,
        }),
      });
      if (dynamic) {
        paintLayers(ctx, dynamic.layers, current, { scale: wanted, sprites: spriteCache });
        canvas.dataset['sprites'] = String(dynamic.sprites.length);
        canvas.dataset['moving'] = String(dynamic.sprites.filter((s) => s.moving).length);
        // Where some resting cases are (sheet pixels), so that tests can click on one.
        const cases = dynamic.sprites
          .filter((s) => s.caseId !== undefined && !s.moving)
          .slice(0, 12)
          .map((s) => `${s.caseId}@${Math.round(s.point[0])},${Math.round(s.point[1])}`)
          .join(';');
        if (canvas.dataset['cases'] !== cases) canvas.dataset['cases'] = cases;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      canvas.dataset['zoom'] = String(Math.round(zoom * 1000) / 1000);
      canvas.dataset['panX'] = String(Math.round(x * 10) / 10);
      canvas.dataset['panY'] = String(Math.round(y * 10) / 10);
    }
    frames.current += 1;
    canvas.dataset['frames'] = String(frames.current);
    canvas.dataset['bundles'] = String(animator.bundles);
    // The loop runs while the simulation plays or something moves, otherwise it rests.
    if (useEditorStore.getState().simPlaying || animator.isAnimating(now)) {
      schedulePaintRef.current();
    }
  }, [animator, staticLayer, spriteCache]);

  const schedulePaint = useCallback((): void => {
    if (frame.current !== 0) return;
    frame.current = requestAnimationFrame(paint);
  }, [paint]);
  useEffect(() => {
    schedulePaintRef.current = schedulePaint;
  }, [schedulePaint]);

  const setViewport = useCallback(
    (next: Viewport): void => {
      viewport.current = next;
      setDomainZoom(Math.round(next.zoom * 100) / 100);
      schedulePaint();
    },
    [schedulePaint, setDomainZoom],
  );

  const fit = useCallback((): void => {
    const scene = animator.staticScene;
    if (!scene) return;
    userZoomed.current = false;
    setViewport(fitAround(scene, size.current, overlays.current));
  }, [animator, setViewport]);

  // The model: the net, its view and the state to start from. A change of the net or the mode
  // snaps the picture; from then on the bundles of events move it.
  useEffect(() => {
    animator.setModel(net, view, currentSimState() ?? staticLayoutState(net));
    schedulePaint();
  }, [animator, net, view, mode, schedulePaint]);

  // The bundles of events, in the order in which they arrive. The simulator never waits for this.
  useEffect(() => {
    const sync = (): void => {
      // A state that changed without events or a jump (it is rare) is shown by a snap, after the
      // events of the same change had their chance.
      if (!pendingSync.current) return;
      pendingSync.current = false;
      const state = currentSimState();
      if (state) animator.snap(state);
      schedulePaint();
    };
    const offEvents = onSimEvents((events) => {
      pendingSync.current = false;
      const state = currentSimState();
      if (state) animator.ingest(events, state, performance.now());
      schedulePaint();
    });
    const offJump = onSimJump(() => {
      pendingSync.current = false;
      const state = currentSimState();
      if (state) {
        animator.snap(state);
        if (state.time === 0) useUiStore.getState().followCase(null);
      }
      schedulePaint();
    });
    const offStore = useEditorStore.subscribe((state, previous) => {
      if (
        state.mode === 'simulate' &&
        (state.simMarking !== previous.simMarking ||
          state.simRunning !== previous.simRunning ||
          state.simMeta !== previous.simMeta)
      ) {
        pendingSync.current = true;
        queueMicrotask(sync);
      }
    });
    return () => {
      offEvents();
      offJump();
      offStore();
    };
  }, [animator, schedulePaint]);

  // Tokens jump at the top speed and when the system asks for less motion.
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = (): void => {
      animator.setInstant(simSpeed === 'max' || prefersReducedMotion());
    };
    apply();
    query.addEventListener('change', apply);
    return () => {
      query.removeEventListener('change', apply);
    };
  }, [animator, simSpeed]);

  // The options and the palette for the next frame.
  useEffect(() => {
    options.current = {
      hover: hover.id,
      selection,
      thresholds: { warn, critical },
      followCase: simulating ? followedCase : null,
      visited: simulating ? visited : [],
    };
    paletteRef.current = { palette, key: theme };
    schedulePaint();
  }, [
    hover.id,
    selection,
    warn,
    critical,
    followedCase,
    visited,
    simulating,
    palette,
    theme,
    schedulePaint,
  ]);

  // Following a case ends with the simulation.
  useEffect(() => {
    if (!simulating) useUiStore.getState().followCase(null);
  }, [simulating]);

  // Fit when the first scene appears, when another document is loaded or its sheet size changes.
  const sheetWidth = view?.meta.canvas.width ?? 0;
  const sheetHeight = view?.meta.canvas.height ?? 0;
  const hasScene = view !== null;
  useEffect(() => {
    if (!hasScene) return;
    fit();
  }, [hasScene, sheetWidth, sheetHeight, docVersion, fit]);

  // Size of the canvas follows its container; the view is refitted unless the user zoomed. The
  // floating controls at the top and bottom are kept clear of the fitted sheet.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = (): void => {
      const rect = host.getBoundingClientRect();
      size.current = { width: Math.floor(rect.width), height: Math.floor(rect.height) };
      const found: ViewRect[] = [];
      for (const overlay of host.querySelectorAll<HTMLElement>('[data-domain-overlay]')) {
        const box = overlay.getBoundingClientRect();
        found.push({
          left: box.left - rect.left,
          top: box.top - rect.top,
          right: box.right - rect.left,
          bottom: box.bottom - rect.top,
        });
      }
      overlays.current = found;
      if (!userZoomed.current) fit();
      else schedulePaint();
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(host);
    // Overlays come and go (the key figures appear with the first result).
    const watched = new Set<Element>();
    const watch = (): void => {
      for (const overlay of host.querySelectorAll('[data-domain-overlay]')) {
        if (!watched.has(overlay)) {
          watched.add(overlay);
          resize.observe(overlay);
        }
      }
      measure();
    };
    watch();
    const mutations = new MutationObserver(watch);
    mutations.observe(host, { childList: true });
    return () => {
      resize.disconnect();
      mutations.disconnect();
    };
  }, [fit, schedulePaint, controlsShown, simulating]);

  // Repaint when the browser zoom or the screen (pixel ratio) changes, and when fonts arrive.
  useEffect(() => {
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    const refresh = (): void => {
      staticLayer.dispose();
      schedulePaint();
    };
    query.addEventListener('change', refresh);
    void document.fonts
      ?.load("600 12px 'Inter Variable'")
      .then(() => document.fonts.load("500 12px 'Inter Variable'"))
      .then(() => document.fonts.load("600 11px 'JetBrains Mono Variable'"))
      .then(refresh, () => undefined);
    return () => {
      query.removeEventListener('change', refresh);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      clearTimeout(rerenderTimer.current);
    };
  }, [schedulePaint, staticLayer]);

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

  const hitAt = (px: number, py: number): { elementId: string; kind: string } | null => {
    const current = animator.staticScene;
    if (!current) return null;
    const point = toSheet(viewport.current, px, py);
    // Thin things (connectors) get a few pixels of slack on screen.
    return hitTest(current, point, 4 / viewport.current.zoom);
  };

  /** The case under the pointer while simulating. */
  const caseAt = (px: number, py: number): SpriteSample | null => {
    if (!simulating || !view) return null;
    const point = toSheet(viewport.current, px, py);
    const found = hitSprite(
      animator.sprites,
      point,
      spriteSize(view.meta.entity.sprite),
      3 / viewport.current.zoom,
    );
    return found?.caseId !== undefined ? found : null;
  };

  /** Where an element is on the screen, for cards and lists next to it. */
  const screenBounds = (id: string): AnchorRect | null => {
    const current = animator.staticScene;
    const canvas = canvasRef.current;
    if (!current || !canvas) return null;
    const bounds = elementBounds(current, id);
    if (!bounds) return null;
    const rect = canvas.getBoundingClientRect();
    const { x, y, zoom } = viewport.current;
    return {
      left: rect.left + x + bounds[0] * zoom,
      top: rect.top + y + bounds[1] * zoom,
      right: rect.left + x + (bounds[0] + bounds[2]) * zoom,
      bottom: rect.top + y + (bounds[1] + bounds[3]) * zoom,
    };
  };

  const showCardFor = (id: string): void => {
    clearTimeout(cardTimer.current);
    cardTimer.current = setTimeout(() => {
      cardTimer.current = undefined;
      const anchor = screenBounds(id);
      if (anchor) setCard({ id, anchor });
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
    setCursor(id || caseAt(px, py) ? 'pointer' : 'default');
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
      const store = useEditorStore.getState();
      // A click on a case follows it; a click on the same case again lets it go.
      const found = caseAt(px, py);
      if (found?.caseId !== undefined && !event.shiftKey) {
        const ui = useUiStore.getState();
        ui.followCase(ui.followedCase === found.caseId ? null : found.caseId);
        return;
      }
      const hit = hitAt(px, py);
      if (hit) {
        if (event.shiftKey) {
          const next = store.selection.includes(hit.elementId)
            ? store.selection.filter((id) => id !== hit.elementId)
            : [...store.selection, hit.elementId];
          store.select(next);
        } else {
          store.select([hit.elementId]);
          // While simulating, a click on an enabled transition fires it, as in the net.
          if (simulating && hit.kind === 'transition') {
            store.fireTransition(hit.elementId);
            // Several bindings: the list opens next to the transition.
            if (useEditorStore.getState().picker === hit.elementId) {
              const anchor = screenBounds(hit.elementId);
              if (anchor) setPickerAnchor({ id: hit.elementId, anchor });
            }
          }
        }
      } else if (!event.shiftKey) store.clearSelection();
    }
  };

  const onPointerLeave = (): void => {
    if (drag.current === null) useUiStore.getState().setHover(null, 'domain');
    hideCard();
  };

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
        data-hover={hover.id ?? ''}
        className="absolute inset-0 h-full w-full touch-none"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
        onDoubleClick={fit}
      />
      {view ? <DomainControls /> : null}
      {view ? <DomainKpis /> : null}
      {view ? <DomainZoomControls onZoom={zoomBy} onFit={fit} /> : null}
      {view && simulating && followedCase ? (
        <DomainCaseCard
          net={net}
          caseId={followedCase}
          onStop={() => {
            useUiStore.getState().followCase(null);
          }}
        />
      ) : null}
      {view &&
      simulating &&
      viewMode === 'domain' &&
      picker !== null &&
      pickerAnchor?.id === picker ? (
        <DomainBindingPicker key={picker} transitionId={picker} anchor={pickerAnchor.anchor} />
      ) : null}
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
            <Button
              icon={<Bot size={14} aria-hidden="true" />}
              onClick={openGenerateDialog}
              disabled={simulating}
              title={simulating ? en.llm.lockedTip : en.llm.generateTip}
              data-testid="domain-generate-llm-empty"
            >
              {en.llm.generateAction}
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
      {card && view ? (
        <DomainCardHost id={card.id} anchor={card.anchor} animator={animator} />
      ) : null}
    </div>
  );
}

/** The hover card with the numbers of the moment: the store changes while it is open. */
function DomainCardHost({
  id,
  anchor,
  animator,
}: {
  id: string;
  anchor: AnchorRect;
  animator: DomainAnimator;
}) {
  const net = useEditorStore((s) => s.net);
  const mode = useEditorStore((s) => s.mode);
  const simMarking = useEditorStore((s) => s.simMarking);
  const simRunning = useEditorStore((s) => s.simRunning);
  const metrics = useEditorStore((s) => s.simMetrics);
  const warn = useUiStore((s) => s.bottleneckWarn);
  const critical = useUiStore((s) => s.bottleneckCritical);
  const view = animator.view;
  if (!view) return null;
  const marking = mode === 'simulate' && simMarking ? simMarking : net.marking;
  const layout = animator.layout;
  const running = new Map<string, number>();
  if (mode === 'simulate') {
    for (const firing of simRunning) {
      running.set(firing.transitionId, (running.get(firing.transitionId) ?? 0) + 1);
    }
  }
  const model = buildDomainCard({
    net,
    view,
    marking,
    running,
    id,
    ...(mode === 'simulate' &&
      layout && {
        live: {
          layout,
          stations: animator.stations,
          metrics,
          thresholds: { warn, critical },
        },
      }),
  });
  return model ? <DomainHoverCard model={model} anchor={anchor} /> : null;
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
      data-domain-overlay="bottom"
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
