import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { paletteFor } from '../../lib/domain-theme';
import type { PictureOption } from '../../lib/domain-picture-options';
import { useUiStore } from '../../store/ui-store';

const PREVIEW = 28;

function Preview({ option }: { option: PictureOption }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const theme = useUiStore((s) => s.theme);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(PREVIEW * dpr);
    canvas.height = Math.round(PREVIEW * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, PREVIEW, PREVIEW);
    option.draw(ctx, PREVIEW, paletteFor(theme));
  }, [option, theme]);
  return (
    <canvas
      ref={ref}
      width={PREVIEW}
      height={PREVIEW}
      aria-hidden="true"
      style={{ width: PREVIEW, height: PREVIEW }}
    />
  );
}

/**
 * A group of pictures of which exactly one is chosen, with the name of each as its accessible
 * name and a preview drawn by the painter of the domain view, in the colors of the current theme.
 */
export function PicturePicker({
  label,
  value,
  options,
  onChange,
  disabled,
  error,
  'data-testid': testId,
}: {
  label: string;
  value: string;
  options: readonly PictureOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: string | undefined;
  'data-testid'?: string;
}) {
  const labelId = useId();
  const errorId = useId();
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0 || options.length === 0) return;
    event.preventDefault();
    const index = Math.max(
      0,
      options.findIndex((option) => option.value === value),
    );
    const next = options[(index + step + options.length) % options.length];
    if (!next) return;
    onChange(next.value);
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    buttons[(index + step + options.length) % options.length]?.focus();
  };
  return (
    <div className="flex flex-col gap-1">
      <span id={labelId} className="text-xs font-medium text-muted">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? true : undefined}
        onKeyDown={onKeyDown}
        data-testid={testId}
        className="flex flex-wrap gap-1"
      >
        {options.map((option) => {
          const checked = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={option.label}
              title={option.label}
              tabIndex={checked ? 0 : -1}
              disabled={disabled}
              data-testid={
                testId ? `${testId}-${option.value === '' ? 'none' : option.value}` : undefined
              }
              onClick={() => {
                onChange(option.value);
              }}
              className="inline-flex size-9 items-center justify-center rounded-md border border-border-strong bg-surface hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45 aria-checked:border-accent aria-checked:ring-2 aria-checked:ring-accent"
            >
              <Preview option={option} />
            </button>
          );
        })}
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-[11px] text-danger" data-field-error>
          {error}
        </p>
      ) : null}
    </div>
  );
}
