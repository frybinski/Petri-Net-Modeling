import {
  useRef,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { en } from '../i18n/en';
import { SPLIT_MAX, SPLIT_MIN, useUiStore } from '../store/ui-store';
import { FlowCanvas } from './canvas/flow-canvas';
import { DiagnosticsPanel } from './diagnostics-panel';
import { EmptyHint } from './empty-hint';
import { LazyDomainCanvas } from './lazy-parts';

const KEY_STEP = 0.02;

/** The draggable bar between the net and the domain view in the split view. */
function Splitter({ container }: { container: React.RefObject<HTMLElement | null> }) {
  const ratio = useUiStore((s) => s.splitRatio);
  const setRatio = useUiStore((s) => s.setSplitRatio);
  const dragging = useRef(false);

  const move = (clientY: number): void => {
    const box = container.current?.getBoundingClientRect();
    if (!box || box.height <= 0) return;
    setRatio((clientY - box.top) / box.height);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowUp') setRatio(ratio - KEY_STEP);
    else if (event.key === 'ArrowDown') setRatio(ratio + KEY_STEP);
    else if (event.key === 'Home') setRatio(SPLIT_MIN);
    else if (event.key === 'End') setRatio(SPLIT_MAX);
    else return;
    event.preventDefault();
  };

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={en.domain.splitter}
      aria-valuemin={Math.round(SPLIT_MIN * 100)}
      aria-valuemax={Math.round(SPLIT_MAX * 100)}
      aria-valuenow={Math.round(ratio * 100)}
      tabIndex={0}
      className="group relative z-10 h-2 shrink-0 cursor-row-resize touch-none border-y border-border bg-surface transition-colors hover:bg-accent-soft focus-visible:bg-accent-soft"
      data-testid="splitter"
      onKeyDown={onKeyDown}
      onPointerDown={(event: ReactPointerEvent) => {
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (dragging.current) move(event.clientY);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
    >
      <span
        aria-hidden="true"
        className="absolute top-1/2 left-1/2 h-0.5 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border-strong group-hover:bg-accent"
      />
    </div>
  );
}

/**
 * The area next to the panels: the net editor, the domain view, or both one above the other. The
 * editor stays mounted while it is hidden, so that its viewport and selection survive.
 */
export function Workspace({ children }: { children?: ReactNode }) {
  const viewMode = useUiStore((s) => s.viewMode);
  const ratio = useUiStore((s) => s.splitRatio);
  const container = useRef<HTMLElement>(null);
  const netHidden = viewMode === 'domain';

  return (
    <main
      ref={container}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      aria-label={en.canvas.label}
    >
      <div
        className={netHidden ? 'invisible absolute inset-0' : 'relative min-h-0 flex-1'}
        style={viewMode === 'both' ? { flex: `0 0 ${ratio * 100}%` } : undefined}
        inert={netHidden}
        data-testid="net-pane"
      >
        <FlowCanvas />
        <EmptyHint />
        <DiagnosticsPanel />
      </div>
      {viewMode === 'both' ? <Splitter container={container} /> : null}
      {viewMode !== 'net' ? (
        <div className="relative min-h-0 flex-1" data-testid="domain-pane">
          <LazyDomainCanvas />
        </div>
      ) : null}
      {children}
    </main>
  );
}
