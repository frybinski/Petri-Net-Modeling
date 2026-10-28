import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { en } from '../i18n/en';
import { toastDuration, useUiStore, type Toast } from '../store/ui-store';
import { Button, IconButton } from './ui/button';

const icons = {
  info: <Info size={16} aria-hidden="true" className="text-accent" />,
  success: <CheckCircle2 size={16} aria-hidden="true" className="text-ok" />,
  error: <AlertCircle size={16} aria-hidden="true" className="text-danger" />,
};

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useUiStore((s) => s.dismissToast);
  const [paused, setPaused] = useState(false);
  const remaining = useRef(toastDuration(toast));

  // The timer stops while the pointer or the keyboard focus is on the toast.
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = setTimeout(() => {
      dismiss(toast.id);
    }, remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(600, remaining.current - (Date.now() - started));
    };
  }, [toast.id, paused, dismiss]);

  return (
    <div
      role={toast.kind === 'error' ? 'alert' : 'status'}
      data-testid={`toast-${toast.kind}`}
      onMouseEnter={() => {
        setPaused(true);
      }}
      onMouseLeave={() => {
        setPaused(false);
      }}
      onFocus={() => {
        setPaused(true);
      }}
      onBlur={() => {
        setPaused(false);
      }}
      className="pn-toast pointer-events-auto flex w-80 max-w-[calc(100vw-2rem)] items-start gap-2.5 rounded-lg border border-border bg-surface p-3 text-sm shadow-panel"
    >
      <span className="mt-0.5 shrink-0">{icons[toast.kind]}</span>
      <div className="min-w-0 flex-1">
        <p className="m-0 font-medium text-fg">{toast.message}</p>
        {toast.details && toast.details.length > 0 ? (
          <ul className="mt-1.5 mb-0 list-disc pl-4 text-xs text-muted">
            {toast.details.map((detail) => (
              <li key={detail} className="break-words">
                {detail}
              </li>
            ))}
          </ul>
        ) : null}
        {toast.action ? (
          <Button
            size="sm"
            variant="secondary"
            className="mt-2"
            onClick={() => {
              toast.action?.run();
              dismiss(toast.id);
            }}
          >
            {toast.action.label}
          </Button>
        ) : null}
      </div>
      <IconButton
        label={en.toast.dismiss}
        size="sm"
        onClick={() => {
          dismiss(toast.id);
        }}
      >
        <X size={14} aria-hidden="true" />
      </IconButton>
    </div>
  );
}

/** Shows the latest toast in the lower right corner, above the status bar. */
export function Toaster() {
  const toasts = useUiStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed right-4 bottom-12 z-[60] flex flex-col items-end gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
