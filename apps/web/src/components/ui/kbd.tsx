import type { ReactNode } from 'react';

interface KbdProps {
  children: ReactNode;
  /** `tip` is for the inverted background of tooltips. */
  tone?: 'default' | 'tip';
}

export function Kbd({ children, tone = 'default' }: KbdProps) {
  const colors =
    tone === 'tip'
      ? 'border-transparent bg-tip-fg/15 text-tip-fg'
      : 'border-border-strong bg-surface-2 text-muted';
  return (
    <kbd
      className={`inline-flex min-w-5 items-center justify-center rounded border px-1 font-sans text-[11px] leading-[18px] ${colors}`}
    >
      {children}
    </kbd>
  );
}
