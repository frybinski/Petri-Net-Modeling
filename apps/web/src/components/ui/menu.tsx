import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export interface MenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  onSelect: () => void;
}

export interface MenuSection {
  title?: string;
  items: MenuItem[];
}

interface MenuProps {
  /** Text of the trigger button. */
  label: string;
  icon?: ReactNode;
  sections: MenuSection[];
  align?: 'left' | 'right';
  'data-testid'?: string;
  disabled?: boolean;
}

/** Dropdown menu with arrow-key navigation, Escape to close and focus return. */
export function Menu({
  label,
  icon,
  sections,
  align = 'left',
  'data-testid': testId,
  disabled,
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (open)
      listRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [open]);

  const close = (returnFocus: boolean): void => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const items = [
      ...(listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []),
    ];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(index + 1) % items.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1]?.focus();
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-testid={testId}
        disabled={disabled}
        onClick={() => {
          setOpen((o) => !o);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-40 aria-expanded:bg-surface-hover"
      >
        {icon}
        {label}
        <ChevronDown size={14} aria-hidden="true" className="text-muted" />
      </button>
      {open ? (
        <div
          id={menuId}
          ref={listRef}
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          className={`absolute top-full z-50 mt-1 min-w-52 rounded-lg border border-border bg-surface p-1 shadow-panel ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {sections.map((section, si) => (
            <div key={section.title ?? si} role="group" aria-label={section.title}>
              {si > 0 ? <div role="separator" className="my-1 h-px bg-border" /> : null}
              {section.title ? (
                <div className="px-2 pt-1 pb-0.5 text-[11px] font-medium tracking-wide text-muted uppercase">
                  {section.title}
                </div>
              ) : null}
              {section.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  data-testid={`menu-item-${item.id}`}
                  onClick={() => {
                    close(true);
                    item.onSelect();
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-fg hover:bg-surface-hover focus-visible:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="flex w-4 shrink-0 justify-center text-muted">{item.icon}</span>
                  <span className="flex-1">{item.label}</span>
                  {item.shortcut ? (
                    <span className="text-xs text-muted">{item.shortcut}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
