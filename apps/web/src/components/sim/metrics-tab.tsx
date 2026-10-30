import { formatIndicatorValue, type ReplayStats } from '@pnm/sim';
import { en } from '../../i18n/en';
import { fitnessText, formatSpan, formatWarmupClock } from '../../lib/sim-format';
import { openWarmupSetting } from '../../lib/sim-settings';
import { useEditorStore } from '../../store/editor-store';
import { useReplayStore } from '../../store/replay-store';
import { useUiStore } from '../../store/ui-store';
import { Button } from '../ui/button';
import { NumberField } from '../ui/fields';
import { Tooltip } from '../ui/tooltip';
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

/**
 * Until the warm-up is over the figures are empty. This shows how far the clock is, and leads to
 * the setting.
 */
function WarmupProgress({ time, warmup }: { time: number; warmup: number }) {
  const share = Math.min(1, Math.max(0, time / warmup));
  const label = en.metrics.warmupTitle(formatWarmupClock(time), formatWarmupClock(warmup));
  return (
    <section
      className="flex flex-col gap-1.5 border-b border-border px-4 py-3"
      data-testid="metrics-warmup"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium" data-testid="metrics-warmup-label">
          {label}
        </span>
        <Tooltip content={en.metrics.warmupChangeTip}>
          <button
            type="button"
            className="cursor-pointer text-[11px] text-accent underline-offset-2 hover:underline focus-visible:underline"
            onClick={openWarmupSetting}
            data-testid="metrics-warmup-change"
          >
            {en.metrics.warmupChange}
          </button>
        </Tooltip>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
        className="h-1.5 overflow-hidden rounded-full bg-surface-2"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-200"
          style={{ width: `${share * 100}%` }}
          data-testid="metrics-warmup-bar"
        />
      </div>
      <p className="m-0 text-[11px] text-muted">{en.metrics.warmupHint}</p>
    </section>
  );
}

const percent = (share: number): string => `${Math.round(share * 100)}%`;

/** Opens the analysis and checks the properties of the net on the log that is being replayed. */
function checkReplayLog(): void {
  useUiStore.getState().setRightTab('analyze');
  // The analysis is a part of its own; it loads when it is first needed.
  void import('../../store/analysis-store').then(({ useAnalysisStore }) => {
    void useAnalysisStore.getState().checkOnLog();
  });
}

/** Fitness of the log against the net, and what did not fit. */
function ReplayCard({ stats }: { stats: ReplayStats }) {
  const t = en.replay;
  const bad = stats.missing > 0;
  const guard = stats.guard > 0;
  const strict = useReplayStore((s) => s.log?.strict === true);
  return (
    <section
      className="flex flex-col gap-2 border-b border-border px-4 py-3"
      aria-label={t.card}
      data-testid="replay-card"
    >
      <div className="flex min-h-5 items-center justify-between gap-2">
        <h3 className="m-0 text-[11px] font-semibold tracking-wide text-muted uppercase">
          {t.card}
        </h3>
        <span className="text-[11px] text-muted tabular-nums" data-testid="replay-progress">
          {t.stepOf(stats.processed, stats.total)}
        </span>
      </div>
      <div
        className="h-1 overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-label={t.stepOf(stats.processed, stats.total)}
        aria-valuemin={0}
        aria-valuemax={stats.total}
        aria-valuenow={stats.processed}
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-200"
          style={{ width: stats.total === 0 ? '0%' : `${(stats.processed / stats.total) * 100}%` }}
        />
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Tooltip content={t.fitnessTip}>
          <div className="flex min-w-0 flex-col rounded-lg border border-border bg-surface-2/50 px-2.5 py-2">
            <span className="text-[11px] leading-4 font-medium text-muted">{t.fitness}</span>
            <span
              className={`truncate text-lg leading-6 font-semibold tabular-nums ${
                stats.fitness !== null && stats.fitness < 1 ? 'text-danger' : ''
              }`}
              data-testid="replay-fitness"
            >
              {fitnessText(stats.fitness)}
            </span>
          </div>
        </Tooltip>
        <Tooltip content={t.createdTip}>
          <div className="flex min-w-0 flex-col rounded-lg border border-border bg-surface-2/50 px-2.5 py-2">
            <span className="text-[11px] leading-4 font-medium text-muted">{t.created}</span>
            <span
              className={`truncate text-lg leading-6 font-semibold tabular-nums ${bad ? 'text-danger' : ''}`}
              data-testid="replay-created"
            >
              {stats.missing}
            </span>
          </div>
        </Tooltip>
        <Tooltip content={t.leftBehindTip}>
          <div className="flex min-w-0 flex-col rounded-lg border border-border bg-surface-2/50 px-2.5 py-2">
            <span className="text-[11px] leading-4 font-medium text-muted">{t.leftBehind}</span>
            <span
              className={`truncate text-lg leading-6 font-semibold tabular-nums ${stats.remaining > 0 ? 'text-danger' : ''}`}
              data-testid="replay-left"
            >
              {stats.remaining}
            </span>
          </div>
        </Tooltip>
        <Tooltip content={t.skippedEventsTip}>
          <div className="flex min-w-0 flex-col rounded-lg border border-border bg-surface-2/50 px-2.5 py-2">
            <span className="text-[11px] leading-4 font-medium text-muted">{t.skippedEvents}</span>
            <span
              className={`truncate text-lg leading-6 font-semibold tabular-nums ${stats.ignored > 0 ? 'text-danger' : ''}`}
              data-testid="replay-skipped"
            >
              {stats.ignored}
            </span>
          </div>
        </Tooltip>
      </div>
      <p className="m-0 text-[11px] text-muted" data-testid="replay-open">
        {t.openCases}: <span className="font-medium text-fg">{stats.openCases}</span>
        {strict || guard ? (
          <>
            {' · '}
            {t.guardsNotMet}:{' '}
            <span
              className={`font-medium ${guard ? 'text-danger' : 'text-fg'}`}
              data-testid="replay-guard"
            >
              {stats.guard}
            </span>
          </>
        ) : null}
      </p>
      <Tooltip content={t.checkLogTip}>
        <Button
          size="sm"
          onClick={checkReplayLog}
          className="self-start"
          data-testid="replay-check"
        >
          {t.checkLog}
        </Button>
      </Tooltip>
    </section>
  );
}

/** Throughput, cycle time, queues and the use of resources. */
export function MetricsTab() {
  const net = useEditorStore((s) => s.net);
  const metrics = useEditorStore((s) => s.simMetrics);
  const timed = useEditorStore((s) => s.simTimed);
  const warn = useUiStore((s) => s.bottleneckWarn);
  const critical = useUiStore((s) => s.bottleneckCritical);
  const setThresholds = useUiStore((s) => s.setBottleneckThresholds);
  const time = useEditorStore((s) => s.simTime);
  const warmup = net.simulation?.warmup ?? 0;
  const warming = warmup > 0 && time < warmup;

  if (!timed) {
    return <p className="m-0 px-4 py-3 text-sm text-muted">{en.metrics.untimed}</p>;
  }
  if (!metrics) {
    return (
      <>
        {warming ? <WarmupProgress time={time} warmup={warmup} /> : null}
        <p className="m-0 px-4 py-3 text-sm text-muted">{en.metrics.notYet}</p>
      </>
    );
  }
  const names = new Map(net.places.map((p) => [p.id, p.name]));
  // Places that hold cases, then those that count an amount (no waiting time for them).
  const queues = [
    ...metrics.places.filter((p) => p.role === 'case'),
    ...metrics.places.filter((p) => p.role === 'quantity'),
  ];
  const indicators = metrics.indicators ?? [];

  return (
    <div className="flex flex-col" data-testid="metrics-tab">
      {metrics.replay ? <ReplayCard stats={metrics.replay} /> : null}
      {warming ? <WarmupProgress time={time} warmup={warmup} /> : null}
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

      {indicators.length > 0 ? (
        <PanelSection title={en.indicators.values} hint={en.indicators.valuesHint}>
          <ul className="m-0 flex list-none flex-col p-0" data-testid="metrics-indicators">
            {indicators.map((indicator) => (
              <li
                key={indicator.id}
                className="flex items-baseline justify-between gap-3 border-t border-border py-1.5 first:border-t-0"
                data-testid="metrics-indicator-row"
                data-indicator-id={indicator.id}
              >
                <span className="min-w-0 truncate text-xs" title={indicator.label}>
                  {indicator.label}
                </span>
                <span className="flex shrink-0 items-baseline gap-1 whitespace-nowrap">
                  <span
                    className="font-mono text-sm font-semibold tabular-nums"
                    data-testid="metrics-indicator-value"
                  >
                    {formatIndicatorValue(indicator)}
                  </span>
                  {indicator.unit !== '' ? (
                    <span className="text-[11px] text-muted">{indicator.unit}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </PanelSection>
      ) : null}

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
                  data-role={p.role}
                  data-place-id={p.placeId}
                >
                  <td className="truncate px-1 py-1" title={names.get(p.placeId)}>
                    {names.get(p.placeId)}
                  </td>
                  <td
                    className={`px-1 py-1 text-right tabular-nums ${
                      p.role === 'quantity'
                        ? ''
                        : p.current >= critical
                          ? 'font-semibold text-danger'
                          : p.current >= warn
                            ? 'font-semibold text-warn'
                            : ''
                    }`}
                    data-testid="metrics-place-now"
                  >
                    {p.current}
                  </td>
                  <td className="px-1 py-1 text-right tabular-nums">{p.mean.toFixed(1)}</td>
                  <td className="px-1 py-1 text-right tabular-nums">{p.max}</td>
                  <td className="px-1 py-1 text-right tabular-nums">
                    {p.role === 'quantity' ? '–' : formatSpan(p.meanWait)}
                  </td>
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
