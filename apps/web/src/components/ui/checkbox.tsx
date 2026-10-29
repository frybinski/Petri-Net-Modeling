import { useId } from 'react';

interface CheckboxProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  hint?: string;
  'data-testid'?: string;
}

/** A labelled checkbox in the style of the other fields. */
export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
  hint,
  'data-testid': testId,
}: CheckboxProps) {
  const id = useId();
  const hintId = useId();
  return (
    <div className="flex flex-col gap-0.5">
      <label
        htmlFor={id}
        className={`flex items-start gap-2 text-sm ${disabled ? 'opacity-50' : ''}`}
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-describedby={hint ? hintId : undefined}
          data-testid={testId}
          className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
          onChange={(event) => {
            onChange(event.target.checked);
          }}
        />
        <span>{label}</span>
      </label>
      {hint ? (
        <p id={hintId} className="m-0 pl-6 text-[11px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
