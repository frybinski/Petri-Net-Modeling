import type { ReactNode } from 'react';

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="m-0 text-[11px] font-semibold tracking-wide text-muted uppercase">{children}</h3>
  );
}

/** A block of the simulation panel, separated from the next by a line. */
export function PanelSection({
  title,
  hint,
  actions,
  children,
  'data-testid': testId,
}: {
  title: string;
  hint?: string;
  actions?: ReactNode;
  children: ReactNode;
  'data-testid'?: string;
}) {
  return (
    <section className="flex flex-col gap-2 border-b border-border px-4 py-3" data-testid={testId}>
      <div className="flex min-h-5 items-center justify-between gap-2">
        <SectionTitle>{title}</SectionTitle>
        {actions}
      </div>
      {hint ? <p className="m-0 text-[11px] text-muted">{hint}</p> : null}
      {children}
    </section>
  );
}
