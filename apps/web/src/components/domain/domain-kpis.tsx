import { en } from '../../i18n/en';
import { formatSpan } from '../../lib/sim-format';
import { useEditorStore } from '../../store/editor-store';
import { useUiStore } from '../../store/ui-store';

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
    <div className="flex min-w-0 flex-col px-2.5 py-1">
      <span className="text-[10px] leading-3 font-medium tracking-wide text-muted uppercase">
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

/** Throughput, cycle time and cases in the system, small, at the bottom right of the domain view. */
export function DomainKpis() {
  const visible = useUiStore((s) => s.domainControls);
  const mode = useEditorStore((s) => s.mode);
  const timed = useEditorStore((s) => s.simTimed);
  const metrics = useEditorStore((s) => s.simMetrics);
  const time = useEditorStore((s) => s.simTime);
  const warmup = useEditorStore((s) => s.net.simulation?.warmup ?? 0);
  if (!visible || mode !== 'simulate' || !timed || !metrics) return null;
  const warming = warmup > 0 && time < warmup;
  return (
    <div
      className="absolute right-3 bottom-3 z-10 flex flex-col rounded-lg border border-border bg-surface shadow-panel"
      role="group"
      aria-label={en.domain.kpiTitle}
      data-testid="domain-kpis"
      data-domain-overlay="bottom"
    >
      <div className="flex divide-x divide-border">
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
      </div>
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
