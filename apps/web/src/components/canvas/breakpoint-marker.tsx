import { en } from '../../i18n/en';

/** Red triangle in the upper left corner of a node that has a breakpoint. */
export function BreakpointMarker({ title }: { title?: string }) {
  return (
    <svg
      className="pn-breakpoint pointer-events-none absolute -top-2 -left-2 overflow-visible"
      width="13"
      height="13"
      viewBox="0 0 13 13"
      role="img"
      aria-label={title ?? en.simulation.breakpointOn}
      data-testid="breakpoint-marker"
    >
      <polygon points="0,0 13,0 0,13" />
    </svg>
  );
}
