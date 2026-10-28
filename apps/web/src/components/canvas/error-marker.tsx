import { TriangleAlert } from 'lucide-react';
import { Tooltip } from '../ui/tooltip';

/** Small warning sign on a corner of a node that has an error diagnostic. */
export function ErrorMarker({
  text,
  corner,
}: {
  text?: string | undefined;
  corner: 'left' | 'right';
}) {
  return (
    <Tooltip content={text ?? 'Error'}>
      <span
        className={`pn-error-marker absolute -top-2.5 flex size-5 items-center justify-center rounded-full border border-danger bg-canvas text-danger ${corner === 'right' ? '-right-2.5' : '-left-2.5'}`}
        data-testid="error-marker"
        data-no-hovercard
      >
        <TriangleAlert size={11} aria-hidden="true" strokeWidth={2.4} />
      </span>
    </Tooltip>
  );
}
