import * as Primitive from '@radix-ui/react-context-menu';
import { Check, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

export const ContextMenuRoot = Primitive.Root;
export const ContextMenuTrigger = Primitive.Trigger;

const surface =
  'pn-menu z-[75] min-w-52 rounded-lg border border-border bg-surface p-1 text-sm text-fg shadow-panel outline-none';

const item =
  'flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-fg outline-none select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[highlighted]:bg-surface-hover';

interface ContentProps {
  children: ReactNode;
  label: string;
}

/** The popup of the context menu. Closing it does not move the focus back to the canvas. */
export function ContextMenuContent({ children, label }: ContentProps) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        className={surface}
        aria-label={label}
        collisionPadding={8}
        onCloseAutoFocus={(event) => {
          // An action such as "Rename" puts the focus into a new field; do not take it away.
          event.preventDefault();
        }}
        data-testid="context-menu"
      >
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  );
}

interface ItemProps {
  label: string;
  icon?: ReactNode;
  shortcut?: string | undefined;
  disabled?: boolean;
  danger?: boolean;
  onSelect: () => void;
  'data-testid'?: string;
}

export function ContextMenuItem({
  label,
  icon,
  shortcut,
  disabled,
  danger,
  onSelect,
  'data-testid': testId,
}: ItemProps) {
  return (
    <Primitive.Item
      className={`${item} ${danger ? 'text-danger data-[highlighted]:bg-danger-soft' : ''}`}
      disabled={disabled}
      onSelect={onSelect}
      data-testid={testId}
    >
      <span className="flex w-4 shrink-0 justify-center text-muted">{icon}</span>
      <span className="flex-1">{label}</span>
      {shortcut ? <span className="ml-4 text-xs text-muted">{shortcut}</span> : null}
    </Primitive.Item>
  );
}

interface SubProps {
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  children: ReactNode;
}

export function ContextMenuSub({ label, icon, disabled, children }: SubProps) {
  return (
    <Primitive.Sub>
      <Primitive.SubTrigger
        className={`${item} data-[state=open]:bg-surface-hover`}
        disabled={disabled}
      >
        <span className="flex w-4 shrink-0 justify-center text-muted">{icon}</span>
        <span className="flex-1">{label}</span>
        <ChevronRight size={14} aria-hidden="true" className="text-muted" />
      </Primitive.SubTrigger>
      <Primitive.Portal>
        <Primitive.SubContent className={surface} sideOffset={4} collisionPadding={8}>
          {children}
        </Primitive.SubContent>
      </Primitive.Portal>
    </Primitive.Sub>
  );
}

export const ContextMenuRadioGroup = Primitive.RadioGroup;

export function ContextMenuRadioItem({
  value,
  label,
  'data-testid': testId,
}: {
  value: string;
  label: string;
  'data-testid'?: string;
}) {
  return (
    <Primitive.RadioItem value={value} className={item} data-testid={testId}>
      <span className="flex w-4 shrink-0 justify-center text-accent">
        <Primitive.ItemIndicator>
          <Check size={14} aria-hidden="true" />
        </Primitive.ItemIndicator>
      </span>
      <span className="flex-1">{label}</span>
    </Primitive.RadioItem>
  );
}

export function ContextMenuSeparator() {
  return <Primitive.Separator className="my-1 h-px bg-border" />;
}

export function ContextMenuLabel({ children }: { children: ReactNode }) {
  return (
    <Primitive.Label className="px-2 pt-1 pb-0.5 text-[11px] font-medium tracking-wide text-muted uppercase">
      {children}
    </Primitive.Label>
  );
}
