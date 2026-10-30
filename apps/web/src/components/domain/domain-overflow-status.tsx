import { AlertTriangle } from 'lucide-react';
import { overflowMessages, useFillOverflows } from '../../lib/use-overflows';

/**
 * The status bar names the fill levels of the domain view that are over their limit (rule K3: an
 * overflow is reported, not left out). The first one is shown, the rest are counted, and all of
 * them are in the tooltip.
 */
export function DomainOverflowStatus() {
  const overflows = useFillOverflows();
  if (overflows.length === 0) return null;
  const messages = overflowMessages(overflows);
  return (
    <span
      className="inline-flex min-w-0 items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 font-medium text-danger"
      role="status"
      title={messages.join('\n')}
      data-testid="domain-overflow"
    >
      <AlertTriangle size={12} aria-hidden="true" className="shrink-0" />
      <span className="truncate">
        {messages[0]}
        {messages.length > 1 ? ` (+${messages.length - 1})` : ''}
      </span>
    </span>
  );
}
