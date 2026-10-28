import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-contrast hover:bg-accent-hover border-transparent',
  secondary: 'bg-surface text-fg hover:bg-surface-hover border-border-strong',
  ghost: 'bg-transparent text-fg hover:bg-surface-hover border-transparent',
  danger: 'bg-transparent text-danger hover:bg-danger-soft border-border-strong',
};

const sizes: Record<Size, string> = {
  sm: 'h-7 px-2 text-xs gap-1.5',
  md: 'h-8 px-3 text-sm gap-2',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  className = '',
  children,
  type = 'button',
  ref,
  ...rest
}: ButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      className={`inline-flex shrink-0 items-center justify-center rounded-md border font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${variants[variant]} ${sizes[size]} ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** Accessible name; also used as tooltip. */
  label: string;
  /** Keyboard shortcut shown in the tooltip. */
  shortcut?: string;
  pressed?: boolean;
  size?: Size;
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({
  label,
  shortcut,
  pressed,
  size = 'md',
  className = '',
  children,
  type = 'button',
  ref,
  ...rest
}: IconButtonProps) {
  const dimension = size === 'sm' ? 'h-7 w-7' : 'h-8 w-8';
  const state =
    pressed === undefined
      ? 'text-fg hover:bg-surface-hover'
      : pressed
        ? 'bg-accent-soft text-accent'
        : 'text-fg hover:bg-surface-hover';
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={`inline-flex shrink-0 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${dimension} ${state} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
