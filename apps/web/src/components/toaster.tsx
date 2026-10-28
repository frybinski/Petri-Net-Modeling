import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useEffect } from 'react';
import { useUiStore, type Toast } from '../store/ui-store';
import { Button, IconButton } from './ui/button';

const icons = {
  info: <Info size={16} aria-hidden="true" className="text-accent" />,
  success: <CheckCircle2 size={16} aria-hidden="true" className="text-ok" />,
  error: <AlertCircle size={16} aria-hidden="true" className="text-danger" />,
};

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useUiStore((s) => s.dismissToast);
  useEffect(() => {
    const timer = setTimeout(
      () => {
        dismiss(toast.id);
      },
      toast.kind === 'error' ? 9000 : 5000,
    );
    return () => {
      clearTimeout(timer);
    };
  }, [toast.id, toast.kind, dismiss]);

  return (
    <div
      role={toast.kind === 'error' ? 'alert' : 'status'}
      data-testid={`toast-${toast.kind}`}
      className="pointer-events-auto flex w-80 max-w-[calc(100vw-2rem)] items-start gap-2.5 rounded-lg border border-border bg-surface p-3 text-sm shadow-panel"
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
        label="Dismiss"
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

export function Toaster() {
  const toasts = useUiStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-12 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
