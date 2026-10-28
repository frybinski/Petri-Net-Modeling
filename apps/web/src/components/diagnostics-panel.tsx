import type { Diagnostic } from '@pnm/core';
import { AlertCircle, AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { en } from '../i18n/en';
import { getViewApi } from '../lib/view-api';
import { useDiagnostics } from '../lib/use-diagnostics';
import { useEditorStore } from '../store/editor-store';
import { useUiStore } from '../store/ui-store';
import { IconButton } from './ui/button';

/** List of validation results above the status bar. Clicking an entry selects the element. */
export function DiagnosticsPanel() {
  const open = useUiStore((s) => s.diagnosticsOpen);
  const setOpen = useUiStore((s) => s.setDiagnosticsOpen);
  const diagnostics = useDiagnostics();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  if (!open) return null;

  const jumpTo = (diagnostic: Diagnostic): void => {
    const state = useEditorStore.getState();
    const { elementId, typeName } = diagnostic;
    if (elementId === undefined) {
      // A problem of a type itself: open the type editor.
      if (
        typeName !== undefined &&
        state.mode === 'edit' &&
        Object.hasOwn(state.net.types, typeName)
      ) {
        useUiStore.getState().openTypeDialog(typeName);
      }
      return;
    }
    const exists =
      state.net.places.some((p) => p.id === elementId) ||
      state.net.transitions.some((t) => t.id === elementId) ||
      state.net.arcs.some((a) => a.id === elementId);
    if (!exists) return;
    if (state.mode === 'edit') state.select([elementId]);
    getViewApi()?.focus([elementId]);
    if (typeName !== undefined) {
      // Type problems of a place: bring the type and token section of its panel into view.
      requestAnimationFrame(() => {
        document.getElementById('place-type-section')?.scrollIntoView({ block: 'nearest' });
      });
    }
  };

  return (
    <div
      ref={ref}
      id="diagnostics-panel"
      role="region"
      aria-label={en.status.diagnostics}
      data-testid="diagnostics-panel"
      className="absolute right-3 bottom-3 left-3 z-40 max-h-64 overflow-hidden rounded-lg border border-border bg-surface shadow-panel sm:left-auto sm:w-[28rem]"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <h2 className="m-0 text-xs font-semibold">{en.status.diagnostics}</h2>
        <IconButton
          label={en.dialog.close}
          size="sm"
          onClick={() => {
            setOpen(false);
          }}
        >
          <X size={14} aria-hidden="true" />
        </IconButton>
      </div>
      {diagnostics.length === 0 ? (
        <p className="m-0 flex items-center gap-2 px-3 py-3 text-sm text-muted">
          <CheckCircle2 size={16} aria-hidden="true" className="text-ok" />
          {en.status.noProblems}
        </p>
      ) : (
        <ul className="m-0 max-h-52 list-none overflow-auto p-1">
          {diagnostics.map((d, index) => (
            <li key={`${d.code}-${d.elementId ?? d.typeName ?? ''}-${index}`}>
              <button
                type="button"
                onClick={() => {
                  jumpTo(d);
                }}
                data-testid="diagnostic-item"
                data-code={d.code}
                className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-hover"
              >
                {d.severity === 'error' ? (
                  <AlertCircle
                    size={15}
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 text-danger"
                  />
                ) : (
                  <AlertTriangle
                    size={15}
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 text-warn"
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="sr-only">{d.severity}: </span>
                  {d.message}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
