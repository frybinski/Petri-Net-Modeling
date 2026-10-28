import { en } from '../../i18n/en';
import { formatSpan } from '../../lib/sim-format';
import { useEditorStore } from '../../store/editor-store';
import { useUiStore } from '../../store/ui-store';
import { NumberField } from '../ui/fields';
import { PanelSection } from './section';

function Card({
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
    <div className="flex min-w-0 flex-col rounded-lg border border-border bg-surface-2/50 px-2.5 py-2">
      <span className="min-h-8 text-[11px] leading-4 font-medium text-muted">{label}</span>
      <span className="truncate text-lg leading-6 font-semibold tabular-nums" data-testid={testId}>
        {value}
      </span>
      {unit ? <span className="truncate text-[11px] text-muted">{unit}</span> : null}
    </div>
  );
}

const percent = (share: number): string => `${Math.round(share * 100)}%`;

/** Throughput, cycle time, queues and the use of resources. */
export function MetricsTab() {
  const net = useEditorStore((s) => s.net);
  const metrics = useEditorStore((s) => s.simMetrics);
  const timed = useEditorStore((s) => s.simTimed);
  const warn = useUiStore((s) => s.bottleneckWarn);
  const critical = useUiStore((s) => s.bottleneckCritical);
  const setThresholds = useUiStore((s) => s.setBottleneckThresholds);

  if (!timed) {
    return <p className="m-0 px-4 py-3 text-sm text-muted">{en.metrics.untimed}</p>;
  }
  if (!metrics) {
    return <p className="m-0 px-4 py-3 text-sm text-muted">{en.metrics.notYet}</p>;
  }
  const names = new Map(net.places.map((p) => [p.id, p.name]));
  const queues = metrics.places.filter((p) => p.role === 'case');
  const warmup = net.simulation?.warmup ?? 0;

  return (
    <div className="flex flex-col" data-testid="metrics-tab">
      <section className="flex flex-col gap-2 border-b border-border px-4 py-3">
        <div className="grid grid-cols-3 gap-1.5">
          <Card
            label={en.metrics.throughput}
            value={
              metrics.throughputPerHour === null
                ? '–'
                : String(Math.round(metrics.throughputPerHour))
            }
            unit={en.metrics.perHour}
            testId="metric-throughput"
          />
          <Card
            label={en.metrics.cycleTime}
            value={formatSpan(metrics.meanCycleTime)}
            testId="metric-cycle"
          />
          <Card
            label={en.metrics.casesInSystem}
            value={String(metrics.casesInSystem)}
            testId="metric-cases"
          />
        </div>
        <p className="m-0 text-[11px] text-muted">
          {en.metrics.completed(metrics.completedCases)} ·{' '}
          {en.metrics.observed(formatSpan(metrics.observed))}
          {warmup > 0 ? ` · ${en.metrics.warmupNote(formatSpan(warmup))}` : ''}
        </p>
      </section>

      {queues.length > 0 ? (
        <PanelSection title={en.metrics.places}>
          <table
            className="w-full table-fixed border-collapse text-xs"
            data-testid="metrics-places"
          >
            <thead>
              <tr className="text-left text-[11px] tracking-wide text-muted uppercase">
                <th className="px-1 py-1 font-semibold">{en.metrics.place}</th>
                <th className="w-9 px-1 py-1 text-right font-semibold">{en.metrics.now}</th>
                <th className="w-10 px-1 py-1 text-right font-semibold">{en.metrics.mean}</th>
                <th className="w-9 px-1 py-1 text-right font-semibold">{en.metrics.max}</th>
                <th className="w-14 px-1 py-1 text-right font-semibold">{en.metrics.wait}</th>
              </tr>
            </thead>
            <tbody>
              {queues.map((p) => (
                <tr
                  key={p.placeId}
                  className="border-t border-border"
                  data-testid="metrics-place-row"
                >
                  <td className="truncate px-1 py-1" title={names.get(p.placeId)}>
                    {names.get(p.placeId)}
                  </td>
                  <td
                    className={`px-1 py-1 text-right tabular-nums ${
                      p.current >= critical
                        ? 'font-semibold text-danger'
                        : p.current >= warn
                          ? 'font-semibold text-warn'
                          : ''
                    }`}
                  >
                    {p.current}
                  </td>
                  <td className="px-1 py-1 text-right tabular-nums">{p.mean.toFixed(1)}</td>
                  <td className="px-1 py-1 text-right tabular-nums">{p.max}</td>
                  <td className="px-1 py-1 text-right tabular-nums">{formatSpan(p.meanWait)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </PanelSection>
      ) : null}

      {metrics.resources.length > 0 ? (
        <PanelSection title={en.metrics.resources}>
          <table
            className="w-full table-fixed border-collapse text-xs"
            data-testid="metrics-resources"
          >
            <thead>
              <tr className="text-left text-[11px] tracking-wide text-muted uppercase">
                <th className="px-1 py-1 font-semibold">{en.metrics.resource}</th>
                <th className="w-9 px-1 py-1 text-right font-semibold">{en.metrics.free}</th>
                <th className="w-9 px-1 py-1 text-right font-semibold">{en.metrics.busy}</th>
                <th className="w-12 px-1 py-1 text-right font-semibold">
                  {en.metrics.utilization}
                </th>
              </tr>
            </thead>
            <tbody>
              {metrics.resources.map((r) => (
                <tr
                  key={r.placeId}
                  className="border-t border-border"
                  data-testid="metrics-resource-row"
                >
                  <td className="truncate px-1 py-1" title={names.get(r.placeId)}>
                    {names.get(r.placeId)}
                  </td>
                  <td className="px-1 py-1 text-right tabular-nums">{r.free}</td>
                  <td className="px-1 py-1 text-right tabular-nums">{r.inUse}</td>
                  <td className="px-1 py-1 text-right">
                    <span className="tabular-nums">{percent(r.utilization)}</span>
                    <span
                      className="mt-0.5 block h-1 overflow-hidden rounded-full bg-surface-2"
                      aria-hidden="true"
                    >
                      <span
                        className="block h-full rounded-full bg-accent"
                        style={{ width: percent(r.utilization) }}
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </PanelSection>
      ) : null}

      <section className="flex flex-col gap-2 px-4 py-3" data-testid="bottleneck-settings">
        <h3 className="m-0 text-[11px] font-semibold tracking-wide text-muted uppercase">
          {en.metrics.thresholds}
        </h3>
        <p className="m-0 text-[11px] text-muted">{en.metrics.thresholdsHint}</p>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label={en.metrics.warn}
            value={warn}
            min={1}
            onCommit={(value) => {
              if (value !== undefined) setThresholds(value, Math.max(critical, value));
            }}
            data-testid="bottleneck-warn"
          />
          <NumberField
            label={en.metrics.critical}
            value={critical}
            min={1}
            onCommit={(value) => {
              if (value !== undefined) setThresholds(Math.min(warn, value), value);
            }}
            data-testid="bottleneck-critical"
          />
        </div>
      </section>
    </div>
  );
}
