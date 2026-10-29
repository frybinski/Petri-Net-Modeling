import { useId, type KeyboardEvent } from 'react';

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface SegmentedProps<T extends string | number> {
  label: string;
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
  hint?: string;
  'data-testid'?: string;
}

/** A group of buttons of which exactly one is chosen: a radio group in the style of the header. */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled,
  hint,
  'data-testid': testId,
}: SegmentedProps<T>) {
  const labelId = useId();
  const hintId = useId();
  const enabled = options.filter((option) => !option.disabled);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0 || enabled.length === 0) return;
    event.preventDefault();
    const index = enabled.findIndex((option) => option.value === value);
    const next = enabled[(index + step + enabled.length) % enabled.length];
    if (!next) return;
    onChange(next.value);
    // Focus follows the choice, as in a native radio group.
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    const at = options.findIndex((option) => option.value === next.value);
    buttons[at]?.focus();
  };

  return (
    <div className="flex flex-col gap-1">
      <span id={labelId} className="text-xs font-medium text-muted">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={hint ? hintId : undefined}
        onKeyDown={onKeyDown}
        data-testid={testId}
        className="flex rounded-md border border-border-strong p-0.5"
      >
        {options.map((option) => {
          const checked = option.value === value;
          return (
            <button
              key={String(option.value)}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              disabled={disabled || option.disabled}
              data-testid={testId ? `${testId}-${String(option.value)}` : undefined}
              onClick={() => {
                onChange(option.value);
              }}
              className="inline-flex h-7 min-w-0 flex-1 items-center justify-center rounded px-2 text-xs font-medium text-muted transition-colors hover:text-fg disabled:cursor-not-allowed disabled:opacity-45 aria-checked:bg-accent aria-checked:text-accent-contrast"
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {hint ? (
        <p id={hintId} className="m-0 text-[11px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
