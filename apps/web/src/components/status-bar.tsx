import { useStore } from '@xyflow/react';
import { AlertCircle, AlertTriangle, CheckCircle2, Grid3x3, Map as MapIcon } from 'lucide-react';
import { en } from '../i18n/en';
import { commandById, shortcutText } from '../lib/commands';
import { useDiagnostics } from '../lib/use-diagnostics';
import { getViewApi } from '../lib/view-api';
import { useEditorStore, type Tool } from '../store/editor-store';
import { useUiStore } from '../store/ui-store';
import { IconButton } from './ui/button';
import { Tooltip } from './ui/tooltip';

/** Hint for the active tool; nothing for the select tool unless an arc is being drawn. */
function toolHint(tool: Tool, drawingArc: boolean, sticky: boolean): string | null {
  if (tool === 'arc') return drawingArc ? en.tools.hintArcTarget : en.tools.hintArc;
  if (tool === 'select') return null;
  const hint = {
    place: en.tools.hintPlace,
    transition: en.tools.hintTransition,
    annotation: en.tools.hintAnnotation,
  }[tool];
  return sticky ? `${hint} ${en.tools.hintSticky}` : hint;
}

export function StatusBar() {
  const diagnostics = useDiagnostics();
  const selectionCount = useEditorStore((s) => s.selection.length);
  const mode = useEditorStore((s) => s.mode);
  const tool = useEditorStore((s) => s.tool);
  const sticky = useEditorStore((s) => s.toolSticky);
  const arcSource = useEditorStore((s) => s.arcSource);
  const zoom = useStore((s) => s.transform[2]);
  const snapToGrid = useUiStore((s) => s.snapToGrid);
  const toggleSnap = useUiStore((s) => s.toggleSnap);
  const showMinimap = useUiStore((s) => s.showMinimap);
  const toggleMinimap = useUiStore((s) => s.toggleMinimap);
  const diagnosticsOpen = useUiStore((s) => s.diagnosticsOpen);
  const setDiagnosticsOpen = useUiStore((s) => s.setDiagnosticsOpen);

  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = diagnostics.length - errors;
  const hint = toolHint(tool, arcSource !== null, sticky);

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
      {hint && mode === 'edit' ? (
        <span className="truncate text-fg" data-testid="tool-hint" role="status">
          {hint}
        </span>
      ) : null}
      {selectionCount > 0 ? <span>{en.status.selected(selectionCount)}</span> : null}

      <div className="ml-auto flex items-center gap-1">
        <Tooltip
          content={en.canvas.resetZoom}
          shortcut={shortcutText(commandById('zoom-reset'))}
          side="top"
        >
          <button
            type="button"
            aria-label={`${en.status.zoom} ${Math.round(zoom * 100)}%. ${en.canvas.resetZoom}`}
            onClick={() => {
              getViewApi()?.resetZoom();
            }}
            className="inline-flex h-6 min-w-12 items-center justify-center rounded px-1.5 tabular-nums transition-colors hover:bg-surface-hover"
            data-testid="zoom-level"
          >
            {Math.round(zoom * 100)}%
          </button>
        </Tooltip>
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
