import { formatIndicatorValue } from '@pnm/sim';
import { en } from '../../i18n/en';
import { formatSpan } from '../../lib/sim-format';
import { useEditorStore } from '../../store/editor-store';
import { useUiStore } from '../../store/ui-store';

/** At most this many indicators of the net are shown next to the fixed figures. */
export const MAX_SHOWN_INDICATORS = 4;

function Figure({
  label,
  value,
  unit,
  testId,
}: {
  label: string;
  value: string;
  unit?: string;
  testId: string;
}) {
  return (
    <div className="flex min-w-0 flex-col bg-surface px-2.5 py-1">
      <span
        className="max-w-44 truncate text-[10px] leading-3 font-medium tracking-wide text-muted uppercase"
        title={label}
      >
        {label}
      </span>
      <span className="flex items-baseline gap-1 whitespace-nowrap">
        <span className="font-mono text-sm font-semibold tabular-nums" data-testid={testId}>
          {value}
        </span>
        {unit ? <span className="text-[10px] text-muted">{unit}</span> : null}
      </span>
    </div>
  );
}

/**
 * Throughput, cycle time and cases in the system, then the first four indicators of the net, small,
 * at the bottom right of the domain view. The figures wrap into further rows when the view is
 * narrow, so the strip never grows beyond it.
 */
export function DomainKpis() {
  const visible = useUiStore((s) => s.domainControls);
  const mode = useEditorStore((s) => s.mode);
  const timed = useEditorStore((s) => s.simTimed);
  const metrics = useEditorStore((s) => s.simMetrics);
  const time = useEditorStore((s) => s.simTime);
  const warmup = useEditorStore((s) => s.net.simulation?.warmup ?? 0);
  if (!visible || mode !== 'simulate' || !timed || !metrics) return null;
  const warming = warmup > 0 && time < warmup;
  const indicators = metrics.indicators ?? [];
  const hidden = indicators.length - MAX_SHOWN_INDICATORS;
  return (
    <div
      className="absolute right-3 bottom-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-panel"
      role="group"
      aria-label={en.domain.kpiTitle}
      data-testid="domain-kpis"
      data-domain-overlay="bottom"
    >
      <div className="flex flex-wrap justify-end gap-px bg-border">
        <Figure
          label={en.domain.kpiThroughput}
          value={
            metrics.throughputPerHour === null ? '–' : String(Math.round(metrics.throughputPerHour))
          }
          unit={en.domain.kpiPerHour}
          testId="domain-kpi-throughput"
        />
        <Figure
          label={en.domain.kpiCycle}
          value={formatSpan(metrics.meanCycleTime)}
          testId="domain-kpi-cycle"
        />
        <Figure
          label={en.domain.kpiInSystem}
          value={String(metrics.casesInSystem)}
          testId="domain-kpi-cases"
        />
        {indicators.slice(0, MAX_SHOWN_INDICATORS).map((indicator) => (
          <Figure
            key={indicator.id}
            label={indicator.label}
            value={formatIndicatorValue(indicator)}
            {...(indicator.unit !== '' && { unit: indicator.unit })}
            testId={`domain-kpi-indicator-${indicator.id}`}
          />
        ))}
      </div>
      {hidden > 0 ? (
        <p
          className="m-0 border-t border-border px-2.5 py-1 text-[10px] text-muted"
          data-testid="domain-kpi-more"
        >
          {en.domain.kpiMore(hidden)}
        </p>
      ) : null}
      {warming ? (
        <p
          className="m-0 border-t border-border px-2.5 py-1 text-[10px] text-muted"
          data-testid="domain-kpi-warmup"
        >
          {en.domain.kpiWarmup(formatSpan(warmup))}
        </p>
      ) : null}
    </div>
  );
}
