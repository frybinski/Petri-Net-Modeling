import {
  parseProperties,
  propertyMeaning,
  propertyText,
  propertyTitle,
  type CheckResult,
  type PropertyConformance,
  type PropertySpec,
} from '@pnm/analysis';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { PetriNet } from '@pnm/core';
import { en } from '../../i18n/en';
import { markingText } from '../../lib/analysis-format';
import { isStale, useAnalysisStore, type FinalMode } from '../../store/analysis-store';
import { useEditorStore } from '../../store/editor-store';
import { lastRun } from '../../store/sim-log';
import { Button, IconButton } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { SelectField } from '../ui/fields';
import { PanelSection } from '../sim/section';
import { ErrorNote } from './parts';
import { PropertyEditor } from './property-editor';
import { TraceSteps } from './trace-steps';

type Status = 'holds' | 'violated' | 'unknown' | 'error' | 'pending' | 'stale';

const STATUS_STYLE: Record<Status, string> = {
  holds: 'bg-ok-soft text-ok',
  violated: 'bg-danger-soft text-danger',
  unknown: 'bg-surface-2 text-muted',
  error: 'bg-danger-soft text-danger',
  pending: 'bg-surface-2 text-muted',
  stale: 'bg-warn-soft text-warn',
};

function statusOf(result: CheckResult | undefined, stale: boolean): Status {
  if (result === undefined) return 'pending';
  if (stale) return 'stale';
  if (result.error !== undefined && result.verdict === 'unknown') return 'error';
  return result.verdict;
}

function percent(ratio: number): string {
  return `${Math.round(ratio * 1000) / 10} %`;
}

function SpaceVerdict({
  net,
  spec,
  result,
  stale,
}: {
  net: PetriNet;
  spec: PropertySpec;
  result: CheckResult | undefined;
  stale: boolean;
}) {
  const t = en.analysis.properties;
  const status = statusOf(result, stale);
  return (
    <div className="flex flex-col gap-1.5">
      <span
        className={`inline-flex w-fit items-center rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[status]}`}
        data-testid="property-status"
        data-status={status}
      >
        {t.status[status]}
        {status === 'holds' && result?.vacuous ? ` · ${t.vacuous}` : ''}
      </span>
      {result && status !== 'pending' && !stale ? (
        <p className="m-0 text-[11px] leading-snug text-muted" data-testid="property-explanation">
          {result.explanation}
        </p>
      ) : null}
      {result && !stale
        ? result.warnings.map((warning) => (
            <p key={warning} className="m-0 text-[11px] leading-snug text-warn">
              {t.warning}: {warning}
            </p>
          ))
        : null}
      {result?.counterexample && !stale ? (
        <div className="flex flex-col gap-1" data-testid="counterexample">
          <span className="text-[11px] font-semibold text-danger">
            {t.counterexample} ({result.counterexample.steps.length})
          </span>
          <TraceSteps
            net={net}
            steps={result.counterexample.steps}
            label={`${t.counterexample}: ${propertyTitle(spec)}`}
            target={result.counterexample.marking}
          />
          <span className="text-[11px] text-muted">
            {t.endsIn}: {markingText(net, result.counterexample.marking)}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function LogVerdict({
  conformance,
  stale,
}: {
  conformance: PropertyConformance | undefined;
  stale: boolean;
}) {
  const t = en.analysis.properties;
  if (!conformance || stale) return null;
  if (conformance.error !== undefined) return null;
  const ok = conformance.violatingCount === 0;
  return (
    <div className="flex flex-col gap-1" data-testid="log-verdict">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium text-muted">{t.logTitle}</span>
        <span
          className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
            ok ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'
          }`}
          data-testid="log-ratio"
        >
          {percent(conformance.ratio)}
        </span>
        <span className="text-[11px] text-muted">
          {t.logResult(conformance.satisfied, conformance.total, percent(conformance.ratio))}
        </span>
      </div>
      {conformance.activation ? (
        <span className="text-[11px] text-muted">
          {t.activations(conformance.activation.activations, conformance.activation.fulfilled)}
        </span>
      ) : null}
      {conformance.violating.length > 0 ? (
        <details className="text-[11px]">
          <summary className="cursor-pointer text-muted select-none hover:text-fg">
            {t.violatingCases} ({conformance.violatingCount})
          </summary>
          <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0" data-testid="log-violations">
            {conformance.violating.slice(0, 10).map((v) => (
              <li key={v.caseId} className="leading-snug">
                <strong className="font-semibold">{v.caseId}</strong>: {v.activities.join(' → ')}
              </li>
            ))}
            {conformance.violatingCount > 10 ? (
              <li className="text-muted">{t.moreCases(conformance.violatingCount - 10)}</li>
            ) : null}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function Row({
  net,
  spec,
  result,
  resultStale,
  conformance,
  conformanceStale,
  onEdit,
  onRemove,
}: {
  net: PetriNet;
  spec: PropertySpec;
  result: CheckResult | undefined;
  resultStale: boolean;
  conformance: PropertyConformance | undefined;
  conformanceStale: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const t = en.analysis.properties;
  const title = propertyTitle(spec);
  const text = propertyText(spec);
  return (
    <li
      className="flex flex-col gap-1.5 rounded-md border border-border bg-surface p-2.5"
      data-testid="property-row"
      aria-label={t.propertyLabel(text)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium break-words" data-testid="property-title">
            {title}
          </span>
          {title !== text ? (
            <code className="font-mono text-[11px] break-words text-muted">{text}</code>
          ) : null}
          <span className="text-[11px] leading-snug text-muted">{propertyMeaning(spec)}</span>
        </div>
        <div className="flex shrink-0 gap-0.5">
          <IconButton label={t.edit} size="sm" onClick={onEdit} data-testid="property-edit">
            <Pencil size={13} aria-hidden="true" />
          </IconButton>
          <IconButton label={t.remove} size="sm" onClick={onRemove} data-testid="property-remove">
            <Trash2 size={13} aria-hidden="true" />
          </IconButton>
        </div>
      </div>
      <SpaceVerdict net={net} spec={spec} result={result} stale={resultStale} />
      <LogVerdict conformance={conformance} stale={conformanceStale} />
    </li>
  );
}

const FINAL_LABEL: Record<FinalMode, string> = {
  deadlock: en.analysis.properties.finalDeadlock,
  all: en.analysis.properties.finalAll,
  marking: en.analysis.properties.finalMarking,
};

export function PropertiesCard() {
  const t = en.analysis.properties;
  const net = useEditorStore((s) => s.net);
  const mode = useEditorStore((s) => s.mode);
  const logVersion = useEditorStore((s) => s.simLogVersion);
  const setProperties = useEditorStore((s) => s.setProperties);
  const check = useAnalysisStore((s) => s.check);
  const conformance = useAnalysisStore((s) => s.conformance);
  const busy = useAnalysisStore((s) => s.busy);
  const progress = useAnalysisStore((s) => s.progress);
  const errors = useAnalysisStore((s) => s.errors);
  const finalMode = useAnalysisStore((s) => s.finalMode);
  const setFinalMode = useAnalysisStore((s) => s.setFinalMode);
  const includeOpen = useAnalysisStore((s) => s.includeOpen);
  const setIncludeOpen = useAnalysisStore((s) => s.setIncludeOpen);
  const checkSpace = useAnalysisStore((s) => s.checkOnStateSpace);
  const checkLog = useAnalysisStore((s) => s.checkOnLog);
  const cancel = useAnalysisStore((s) => s.cancel);
  const [editing, setEditing] = useState<string | 'new' | null>(null);

  const parsed = useMemo(() => parseProperties(net.properties), [net.properties]);
  const properties = parsed.properties;
  const simulating = mode === 'simulate';
  // The log changes without the arrays around it changing; its version says when to look again.
  /* eslint-disable react-hooks/exhaustive-deps */
  const run = useMemo(() => lastRun(net, simulating), [net, simulating, logVersion]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const spaceStale = check !== null && isStale(check, net);
  const logStale = conformance !== null && isStale(conformance, net);

  const save = (spec: PropertySpec): void => {
    const exists = properties.some((p) => p.id === spec.id);
    setProperties(
      exists ? properties.map((p) => (p.id === spec.id ? spec : p)) : [...properties, spec],
    );
    setEditing(null);
  };
  const remove = (id: string): void => {
    const next = properties.filter((p) => p.id !== id);
    setProperties(next.length === 0 ? undefined : next);
    if (editing === id) setEditing(null);
  };

  const sameSpec = (a: PropertySpec | undefined, b: PropertySpec): boolean =>
    a !== undefined && JSON.stringify(a) === JSON.stringify(b);

  return (
    <PanelSection
      title={t.title}
      hint={t.hint}
      data-testid="properties-card"
      actions={
        <Button
          size="sm"
          variant="secondary"
          icon={<Plus size={12} aria-hidden="true" />}
          onClick={() => {
            setEditing('new');
          }}
          disabled={editing === 'new'}
          data-testid="property-add"
        >
          {t.add}
        </Button>
      }
    >
      {parsed.errors.length > 0 ? (
        <p className="m-0 text-[11px] text-warn" title={parsed.errors.join('\n')}>
          {t.invalid(parsed.errors.length)}
        </p>
      ) : null}
      {editing === 'new' ? (
        <PropertyEditor
          net={net}
          spec={null}
          onSave={save}
          onCancel={() => {
            setEditing(null);
          }}
        />
      ) : null}
      {properties.length === 0 && editing !== 'new' ? (
        <p className="m-0 text-xs text-muted" data-testid="properties-empty">
          {t.empty}
        </p>
      ) : null}
      <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="property-list">
        {properties.map((spec) =>
          editing === spec.id ? (
            <li key={spec.id}>
              <PropertyEditor
                net={net}
                spec={spec}
                onSave={save}
                onCancel={() => {
                  setEditing(null);
                }}
              />
            </li>
          ) : (
            <Row
              key={spec.id}
              net={net}
              spec={spec}
              result={check?.value.report.results.find((r) => r.id === spec.id)}
              resultStale={
                spaceStale ||
                !sameSpec(
                  check?.value.specs.find((p) => p.id === spec.id),
                  spec,
                )
              }
              conformance={conformance?.value.result.properties.find((p) => p.id === spec.id)}
              conformanceStale={
                logStale ||
                !sameSpec(
                  conformance?.value.specs.find((p) => p.id === spec.id),
                  spec,
                )
              }
              onEdit={() => {
                setEditing(spec.id);
              }}
              onRemove={() => {
                remove(spec.id);
              }}
            />
          ),
        )}
      </ul>

      {properties.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-border pt-2.5">
          <SelectField
            label={t.final}
            value={finalMode}
            hint={t.finalHint}
            options={(['deadlock', 'all', 'marking'] as const).map((value) => ({
              value,
              label: FINAL_LABEL[value],
            }))}
            onChange={(value) => {
              setFinalMode(value as FinalMode);
            }}
            data-testid="check-final"
          />
          {finalMode === 'marking' && !simulating ? (
            <p className="m-0 text-[11px] text-warn">{t.finalMarkingHint}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {busy.check ? (
              <Button size="sm" variant="secondary" onClick={cancel} data-testid="check-cancel">
                {en.analysis.cancel}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  void checkSpace();
                }}
                data-testid="check-space"
              >
                {t.checkSpace}
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              disabled={run === null || busy.conformance}
              onClick={() => {
                void checkLog();
              }}
              data-testid="check-log"
            >
              {t.checkLog}
            </Button>
          </div>
          {busy.check ? (
            <p
              className="m-0 flex items-center gap-2 text-xs text-muted"
              role="status"
              data-testid="check-progress"
            >
              <Loader2 size={13} className="animate-spin" aria-hidden="true" />
              {progress ? en.analysis.space.progress(progress.states, progress.edges) : '…'}
            </p>
          ) : null}
          {run === null ? <p className="m-0 text-[11px] text-muted">{t.noLog}</p> : null}
          <Checkbox
            label={t.includeOpen}
            hint={t.includeOpenHint}
            checked={includeOpen}
            onChange={setIncludeOpen}
            data-testid="check-include-open"
          />
          {check && !spaceStale ? (
            <p className="m-0 text-[11px] text-muted" data-testid="check-summary">
              {check.value.report.states.toLocaleString('en')}{' '}
              {en.analysis.space.states.toLowerCase()}
              {check.value.report.truncated
                ? ` (${en.analysis.space.cutOff(check.value.report.reason ?? '')})`
                : ''}
              {' · '}
              {FINAL_LABEL[check.value.final]}
            </p>
          ) : null}
          {conformance && !logStale ? (
            <p className="m-0 text-[11px] text-muted" data-testid="log-summary">
              {conformance.value.source}
              {conformance.value.result.open > 0
                ? ` · ${t.logOpen(conformance.value.result.open)}`
                : ''}
            </p>
          ) : null}
          {errors.check ? <ErrorNote message={errors.check} /> : null}
          {errors.conformance ? <ErrorNote message={errors.conformance} /> : null}
        </div>
      ) : null}
    </PanelSection>
  );
}
