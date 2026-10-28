import type { PetriNet } from '@pnm/core';
import { caseActivities } from '@pnm/domain';
import { X } from 'lucide-react';
import { useMemo } from 'react';
import { en } from '../../i18n/en';
import { formatClock, formatSpan } from '../../lib/sim-format';
import { useCaseTrail } from '../../lib/use-case-trail';
import { Button } from '../ui/button';

/** The steps of the followed case, at the bottom left of the domain view. */
export function DomainCaseCard({
  net,
  caseId,
  onStop,
}: {
  net: PetriNet;
  caseId: string;
  onStop: () => void;
}) {
  const trail = useCaseTrail(caseId);
  const names = useMemo(() => new Map(net.transitions.map((t) => [t.id, t.name])), [net]);
  const activities = useMemo(() => caseActivities(trail), [trail]);
  const arrival = trail.find((entry) => entry.type === 'spawn');
  return (
    <section
      className="absolute bottom-3 left-14 z-10 flex h-[min(9rem,45%)] w-56 flex-col rounded-lg border border-border bg-surface shadow-panel"
      data-domain-overlay="bottom"
      aria-label={en.domain.followCases}
      data-testid="domain-case-card"
      data-case={caseId}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border py-1 pr-1 pl-3">
        <h2 className="m-0 truncate text-xs font-semibold" data-testid="domain-case-title">
          {en.domain.followTitle(caseId)}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          icon={<X size={13} aria-hidden="true" />}
          onClick={onStop}
          aria-label={en.domain.followStopTip}
          data-testid="domain-case-stop"
        >
          {en.domain.followStop}
        </Button>
      </header>
      <ol
        className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-0 text-[11px]"
        data-testid="domain-case-steps"
      >
        {arrival ? (
          <li className="flex justify-between gap-2 px-3 py-1">
            <span className="text-muted">{en.domain.followArrived}</span>
            <span className="font-mono tabular-nums">{formatClock(arrival.t)}</span>
          </li>
        ) : null}
        {activities.map((activity) => (
          <li
            key={activity.firingId}
            className="flex items-baseline justify-between gap-2 border-t border-border px-3 py-1"
            data-testid="domain-case-step"
          >
            <span className="min-w-0 truncate font-medium">
              {names.get(activity.transitionId) ?? activity.transitionId}
            </span>
            <span className="shrink-0 font-mono text-muted tabular-nums">
              {formatClock(activity.start)}
              {activity.end !== undefined
                ? ` · ${formatSpan(activity.end - activity.start)}`
                : ` · ${en.domain.followUnder}`}
            </span>
          </li>
        ))}
        {!arrival && activities.length === 0 ? (
          <li className="px-3 py-2 text-muted">{en.domain.followEmpty}</li>
        ) : null}
      </ol>
    </section>
  );
}
