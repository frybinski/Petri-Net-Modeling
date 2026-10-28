import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { en } from '../../i18n/en';
import { IconButton } from './button';

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}

/** Modal dialog on top of the native `<dialog>` element: focus trap, Escape and backdrop included. */
export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
  width = 'max-w-md',
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className={`m-auto w-[calc(100%-2rem)] ${width} rounded-xl border border-border bg-surface p-0 text-fg shadow-panel backdrop:bg-black/40`}
    >
      {open ? (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 id={titleId} className="text-sm font-semibold">
              {title}
            </h2>
            <IconButton label={en.dialog.close} size="sm" onClick={onClose}>
              <X size={16} aria-hidden="true" />
            </IconButton>
          </div>
          <div className="overflow-auto px-4 py-3">{children}</div>
          {footer ? (
            <div className="flex justify-end gap-2 border-t border-border px-4 py-3">{footer}</div>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}
