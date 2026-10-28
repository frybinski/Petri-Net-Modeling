import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import { Kbd } from './kbd';

/** Delay before a tooltip opens. Moving on to a neighbouring control shows its tooltip at once. */
export const TOOLTIP_DELAY = 400;

const ProviderPresent = createContext(false);

/** Shared provider: tooltips of neighbouring controls skip the delay once one is open. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <ProviderPresent.Provider value={true}>
      <TooltipPrimitive.Provider delayDuration={TOOLTIP_DELAY} skipDelayDuration={250}>
        {children}
      </TooltipPrimitive.Provider>
    </ProviderPresent.Provider>
  );
}

interface TooltipProps {
  /** Text of the tooltip. */
  content: ReactNode;
  /** Keyboard shortcut shown as a key pill after the text. */
  shortcut?: string | undefined;
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** The element that shows the tooltip; it must accept a ref and pointer events. */
  children: ReactElement;
  /** Turns the tooltip off without changing the markup. */
  disabled?: boolean;
}

/**
 * Tooltip with a short delay and an arrow. The trigger keeps its own `aria-label`; the tooltip is
 * an addition for pointer users and shows the keyboard shortcut.
 */
export function Tooltip({ content, shortcut, side = 'bottom', children, disabled }: TooltipProps) {
  const hasProvider = useContext(ProviderPresent);
  if (disabled || content === '' || content === undefined) return children;
  const tip = (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={7}
          collisionPadding={8}
          className="pn-tip z-[80] flex max-w-72 items-center gap-2 rounded-md bg-tip px-2 py-1 text-xs leading-4 font-medium text-tip-fg shadow-panel"
          data-testid="tooltip"
        >
          <span className="break-words whitespace-pre-wrap">{content}</span>
          {shortcut ? <Kbd tone="tip">{shortcut}</Kbd> : null}
          <TooltipPrimitive.Arrow className="fill-tip" width={10} height={5} />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
  if (hasProvider) return tip;
  return <TooltipPrimitive.Provider delayDuration={TOOLTIP_DELAY}>{tip}</TooltipPrimitive.Provider>;
}
