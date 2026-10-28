import { Minus, Plus } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

/**
 * Local edit buffer for a field. It follows `external` whenever that changes
 * (for example after undo), and otherwise holds what the user is typing.
 */
function useDraft(external: string): [string, (value: string) => void] {
  const [draft, setDraft] = useState(external);
  const [seen, setSeen] = useState(external);
  if (external !== seen) {
    setSeen(external);
    setDraft(external);
  }
  return [draft, setDraft];
}

interface FieldShellProps {
  label: string;
  htmlFor: string;
  hint?: string;
  hintId?: string;
  children: ReactNode;
}

function FieldShell({ label, htmlFor, hint, hintId, children }: FieldShellProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={hintId} className="text-[11px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const inputClass =
  'h-8 w-full rounded-md border border-border-strong bg-surface px-2 text-sm text-fg placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50';

interface TextFieldProps {
  label: string;
  value: string;
  /** Called on blur or Enter with the new value. Escape reverts the edit. */
  onCommit: (value: string) => void;
  disabled?: boolean;
  multiline?: boolean;
  placeholder?: string;
  hideLabel?: boolean;
  className?: string;
  'data-testid'?: string;
}

export function TextField({
  label,
  value,
  onCommit,
  disabled,
  multiline,
  placeholder,
  hideLabel,
  className = '',
  'data-testid': testId,
}: TextFieldProps) {
  const id = useId();
  const [draft, setDraft] = useDraft(value);

  const commit = (): void => {
    if (draft !== value) onCommit(draft);
  };

  const common = {
    id,
    value: draft,
    disabled,
    placeholder,
    'data-testid': testId,
    onChange: (event: { target: { value: string } }) => {
      setDraft(event.target.value);
    },
    onBlur: commit,
  };

  const field = multiline ? (
    <textarea
      {...common}
      rows={4}
      className={`${inputClass} h-auto resize-y py-1.5 ${className}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
    />
  ) : (
    <input
      {...common}
      type="text"
      className={`${inputClass} ${className}`}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit();
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
    />
  );

  if (hideLabel) {
    return (
      <>
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
        {field}
      </>
    );
  }
  return (
    <FieldShell label={label} htmlFor={id}>
      {field}
    </FieldShell>
  );
}

interface NumberFieldProps {
  label: string;
  /** Current value; `undefined` means empty (only allowed with `allowEmpty`). */
  value: number | undefined;
  onCommit: (value: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  allowEmpty?: boolean;
  disabled?: boolean;
  hint?: string;
  placeholder?: string;
  'data-testid'?: string;
}

export function NumberField({
  label,
  value,
  onCommit,
  min = 0,
  max,
  step = 1,
  allowEmpty,
  disabled,
  hint,
  placeholder,
  'data-testid': testId,
}: NumberFieldProps) {
  const id = useId();
  const hintId = useId();
  const [draft, setDraft] = useDraft(value === undefined ? '' : String(value));

  const clamp = (n: number): number => {
    let result = Math.max(min, n);
    if (max !== undefined) result = Math.min(max, result);
    return Math.round(result / step) * step;
  };

  const commitText = (text: string): void => {
    const trimmed = text.trim();
    if (trimmed === '') {
      if (allowEmpty) onCommit(undefined);
      else setDraft(value === undefined ? '' : String(value));
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setDraft(value === undefined ? '' : String(value));
      return;
    }
    const next = clamp(parsed);
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };

  const bump = (direction: 1 | -1): void => {
    const base = value ?? (allowEmpty ? min - step : min);
    const next = clamp(base + direction * step);
    if (next !== value) onCommit(next);
  };

  return (
    <FieldShell label={label} htmlFor={id} hint={hint} hintId={hintId}>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={`Decrease ${label.toLowerCase()}`}
          disabled={disabled || (value !== undefined && value <= min)}
          onClick={() => {
            bump(-1);
          }}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border-strong bg-surface text-fg hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Minus size={14} aria-hidden="true" />
        </button>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          value={draft}
          disabled={disabled}
          placeholder={placeholder}
          aria-describedby={hint ? hintId : undefined}
          data-testid={testId}
          className={`${inputClass} text-center tabular-nums`}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onBlur={() => {
            commitText(draft);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commitText(draft);
              event.currentTarget.blur();
            } else if (event.key === 'Escape') {
              setDraft(value === undefined ? '' : String(value));
              event.currentTarget.blur();
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              bump(1);
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              bump(-1);
            }
          }}
        />
        <button
          type="button"
          aria-label={`Increase ${label.toLowerCase()}`}
          disabled={disabled || (value !== undefined && max !== undefined && value >= max)}
          onClick={() => {
            bump(1);
          }}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border-strong bg-surface text-fg hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>
    </FieldShell>
  );
}
