import { Check, CircleHelp, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { en } from '../../i18n/en';
import { useEditorStore } from '../../store/editor-store';

/** A small yes/no mark with a text label for screen readers. */
export function YesNo({ value }: { value: boolean | null }) {
  if (value === null) {
    return (
      <span
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted"
        role="img"
        aria-label={en.analysis.unknown}
      >
        <CircleHelp size={12} aria-hidden="true" />
      </span>
    );
  }
  return value ? (
    <span
      className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-ok-soft text-ok"
      role="img"
      aria-label={en.analysis.yes}
    >
      <Check size={12} strokeWidth={3} aria-hidden="true" />
    </span>
  ) : (
    <span
      className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger"
      role="img"
      aria-label={en.analysis.no}
    >
      <X size={12} strokeWidth={3} aria-hidden="true" />
    </span>
  );
}

/** A named element of the net that selects itself in the editor when clicked. */
export function ElementChip({ ids, children }: { ids: string[]; children: ReactNode }) {
  const select = useEditorStore((s) => s.select);
  return (
    <button
      type="button"
      title={en.analysis.structure.select}
      onClick={() => {
        select(ids);
      }}
      className="inline-flex max-w-full items-center rounded bg-surface-2 px-1.5 py-0.5 text-left text-[11px] leading-snug text-fg transition-colors hover:bg-surface-hover"
    >
      <span className="truncate">{children}</span>
    </button>
  );
}

/** The note that a result belongs to an earlier version of the net. */
export function StaleNote({ onRefresh, disabled }: { onRefresh: () => void; disabled?: boolean }) {
  return (
    <p
      className="m-0 flex items-center justify-between gap-2 rounded-md bg-warn-soft px-2.5 py-1.5 text-xs text-warn"
      data-testid="stale-note"
    >
      <span>
        <strong className="font-semibold">{en.analysis.stale}.</strong> {en.analysis.staleHint}
      </span>
      <button
        type="button"
        onClick={onRefresh}
        disabled={disabled}
        className="shrink-0 rounded border border-current px-1.5 py-0.5 font-medium hover:bg-warn-soft disabled:opacity-50"
      >
        {en.analysis.refresh}
      </button>
    </p>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p
      className="m-0 rounded-md bg-danger-soft px-2.5 py-1.5 text-xs text-danger"
      role="alert"
      data-testid="analysis-error"
    >
      {en.analysis.failed(message)}
    </p>
  );
}

/** A row of a result table: label, value and an optional explanation below. */
export function Fact({
  label,
  value,
  children,
  testId,
}: {
  label: string;
  value: ReactNode;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5" data-testid={testId}>
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-xs font-medium text-muted">{label}</dt>
        <dd className="m-0 text-right text-sm font-medium">{value}</dd>
      </div>
      {children ? <p className="m-0 text-[11px] leading-snug text-muted">{children}</p> : null}
    </div>
  );
}
