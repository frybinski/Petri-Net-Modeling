import { useStore } from '@xyflow/react';
import { AlertCircle, AlertTriangle, CheckCircle2, Grid3x3, Map as MapIcon } from 'lucide-react';
import { en } from '../i18n/en';
import { useDiagnostics } from '../lib/use-diagnostics';
import { useEditorStore } from '../store/editor-store';
import { useUiStore } from '../store/ui-store';
import { IconButton } from './ui/button';

export function StatusBar() {
  const diagnostics = useDiagnostics();
  const selectionCount = useEditorStore((s) => s.selection.length);
  const mode = useEditorStore((s) => s.mode);
  const zoom = useStore((s) => s.transform[2]);
  const snapToGrid = useUiStore((s) => s.snapToGrid);
  const toggleSnap = useUiStore((s) => s.toggleSnap);
  const showMinimap = useUiStore((s) => s.showMinimap);
  const toggleMinimap = useUiStore((s) => s.toggleMinimap);
  const diagnosticsOpen = useUiStore((s) => s.diagnosticsOpen);
  const setDiagnosticsOpen = useUiStore((s) => s.setDiagnosticsOpen);

  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = diagnostics.length - errors;

  return (
    <footer className="flex h-8 shrink-0 items-center gap-3 border-t border-border bg-surface px-3 text-xs text-muted">
      <button
        type="button"
        aria-expanded={diagnosticsOpen}
        aria-controls="diagnostics-panel"
        aria-label={en.status.diagnostics}
        onClick={() => {
          setDiagnosticsOpen(!diagnosticsOpen);
        }}
        data-testid="status-diagnostics"
        className="inline-flex h-6 items-center gap-1.5 rounded px-1.5 transition-colors hover:bg-surface-hover"
      >
        {errors > 0 ? (
          <AlertCircle size={14} aria-hidden="true" className="text-danger" />
        ) : warnings > 0 ? (
          <AlertTriangle size={14} aria-hidden="true" className="text-warn" />
        ) : (
          <CheckCircle2 size={14} aria-hidden="true" className="text-ok" />
        )}
        <span className={errors > 0 ? 'text-danger' : warnings > 0 ? 'text-warn' : ''}>
          {errors + warnings === 0 ? en.status.noProblems : en.status.problems(errors, warnings)}
        </span>
      </button>

      {mode === 'simulate' ? (
        <span className="rounded-full bg-ok-soft px-2 py-0.5 font-medium text-ok">
          {en.status.simulating}
        </span>
      ) : null}
      {selectionCount > 0 ? <span>{en.status.selected(selectionCount)}</span> : null}

      <div className="ml-auto flex items-center gap-1">
        <span className="tabular-nums" aria-label={en.status.zoom} data-testid="zoom-level">
          {Math.round(zoom * 100)}%
        </span>
        <IconButton
          size="sm"
          label={en.status.grid}
          shortcut="G"
          pressed={snapToGrid}
          onClick={toggleSnap}
          data-testid="toggle-grid"
        >
          <Grid3x3 size={14} aria-hidden="true" />
        </IconButton>
        <IconButton
          size="sm"
          label={en.canvas.minimap}
          pressed={showMinimap}
          onClick={toggleMinimap}
          data-testid="toggle-minimap"
        >
          <MapIcon size={14} aria-hidden="true" />
        </IconButton>
      </div>
    </footer>
  );
}
