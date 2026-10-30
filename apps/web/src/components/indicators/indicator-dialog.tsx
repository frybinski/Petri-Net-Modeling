import {
  DEFAULT_INDICATOR_DIGITS,
  MAX_INDICATOR_DIGITS,
  indicatorProblems,
  type Indicator,
  type IndicatorMeasure,
  type IndicatorMeasureKind,
  type PetriNet,
} from '@pnm/core';
import { useMemo, useState } from 'react';
import { en } from '../../i18n/en';
import { describeIndicator, newIndicatorId } from '../../lib/indicator-format';
import { useEditorStore } from '../../store/editor-store';
import { useUiStore } from '../../store/ui-store';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { NumberField, SelectField, TextField } from '../ui/fields';

const KINDS: IndicatorMeasureKind[] = ['inflow', 'outflow', 'tokens', 'firings'];

/** The form values of one measure; `via` is empty for "any transition". */
interface MeasureDraft {
  kind: IndicatorMeasureKind;
  of: string;
  via: string;
}

type PerDraft = 'none' | 'case' | 'hour' | 'measure';

interface Draft {
  label: string;
  unit: string;
  measure: MeasureDraft;
  per: PerDraft;
  perMeasure: MeasureDraft;
  factor: number | undefined;
  digits: number | undefined;
}

function measureDraft(measure: IndicatorMeasure | undefined): MeasureDraft {
  if (!measure) return { kind: 'inflow', of: '', via: '' };
  return {
    kind: measure.kind,
    of: measure.of,
    via: 'via' in measure && measure.via !== undefined ? measure.via : '',
  };
}

function toMeasure(draft: MeasureDraft): IndicatorMeasure {
  switch (draft.kind) {
    case 'tokens':
    case 'firings':
      return { kind: draft.kind, of: draft.of };
    case 'inflow':
    case 'outflow':
      return {
        kind: draft.kind,
        of: draft.of,
        ...(draft.via !== '' && { via: draft.via }),
      };
  }
}

function toDraft(indicator: Indicator | undefined, net: PetriNet): Draft {
  const first = net.places[0]?.id ?? '';
  const per = indicator?.per;
  return {
    label: indicator?.label ?? '',
    unit: indicator?.unit ?? '',
    measure: indicator ? measureDraft(indicator.measure) : { kind: 'inflow', of: first, via: '' },
    per: per === undefined ? 'none' : typeof per === 'string' ? per : 'measure',
    perMeasure:
      typeof per === 'object'
        ? measureDraft(per)
        : { kind: 'inflow', of: net.places[0]?.id ?? '', via: '' },
    factor: indicator?.factor,
    digits: indicator?.digits,
  };
}

function toIndicator(id: string, draft: Draft): Indicator {
  return {
    id,
    label: draft.label.trim(),
    ...(draft.unit.trim() !== '' && { unit: draft.unit.trim() }),
    measure: toMeasure(draft.measure),
    ...(draft.per === 'case' && { per: 'case' as const }),
    ...(draft.per === 'hour' && { per: 'hour' as const }),
    ...(draft.per === 'measure' && { per: toMeasure(draft.perMeasure) }),
    ...(draft.factor !== undefined && { factor: draft.factor }),
    ...(draft.digits !== undefined && { digits: draft.digits }),
  };
}

/** The transitions that have an arc to (inflow) or from (outflow) the place: those `via` can name. */
function viaCandidates(net: PetriNet, measure: MeasureDraft): Array<{ id: string; name: string }> {
  if (measure.kind !== 'inflow' && measure.kind !== 'outflow') return [];
  return net.transitions
    .filter((t) =>
      net.arcs.some((a) =>
        measure.kind === 'inflow'
          ? a.source === t.id && a.target === measure.of
          : a.source === measure.of && a.target === t.id,
      ),
    )
    .map((t) => ({ id: t.id, name: t.name }));
}

/** The fields of one measure: what it counts, of which element, and over which transition. */
function MeasureFields({
  net,
  value,
  onChange,
  errors,
  testPrefix,
}: {
  net: PetriNet;
  value: MeasureDraft;
  onChange: (next: MeasureDraft) => void;
  errors: { of?: string | undefined; via?: string | undefined };
  testPrefix: string;
}) {
  const t = en.indicators;
  const forTransitions = value.kind === 'firings';
  const elements = forTransitions ? net.transitions : net.places;
  const known = elements.some((e) => e.id === value.of);
  const via = viaCandidates(net, value);
  const viaKnown = value.via === '' || via.some((v) => v.id === value.via);
  const withKind = (kind: IndicatorMeasureKind): void => {
    const toTransitions = kind === 'firings';
    const same = toTransitions === forTransitions;
    const first = (toTransitions ? net.transitions : net.places)[0]?.id ?? '';
    // Changing between places and transitions starts the choice again; otherwise it is kept.
    onChange({ kind, of: same ? value.of : first, via: same ? value.via : '' });
  };
  return (
    <div className="flex flex-col gap-2">
      <SelectField
        label={t.measure}
        value={value.kind}
        options={KINDS.map((kind) => ({ value: kind, label: t.kinds[kind] }))}
        onChange={(kind) => {
          withKind(kind as IndicatorMeasureKind);
        }}
        data-testid={`${testPrefix}-kind`}
      />
      <SelectField
        label={forTransitions ? t.transition : t.place}
        value={value.of}
        options={[
          ...(value.of === '' ? [{ value: '', label: t.choose }] : []),
          ...(value.of !== '' && !known ? [{ value: value.of, label: t.missing(value.of) }] : []),
          ...elements.map((e) => ({ value: e.id, label: e.name === '' ? e.id : e.name })),
        ]}
        error={errors.of}
        onChange={(of) => {
          onChange({ ...value, of, via: '' });
        }}
        data-testid={`${testPrefix}-of`}
      />
      {value.kind === 'inflow' || value.kind === 'outflow' ? (
        <SelectField
          label={t.via}
          value={value.via}
          options={[
            { value: '', label: t.viaAny },
            ...(viaKnown ? [] : [{ value: value.via, label: t.missing(value.via) }]),
            ...via.map((v) => ({ value: v.id, label: v.name === '' ? v.id : v.name })),
          ]}
          error={errors.via}
          onChange={(next) => {
            onChange({ ...value, via: next });
          }}
          data-testid={`${testPrefix}-via`}
        />
      ) : null}
    </div>
  );
}

/** Dialog to add or edit an indicator. Errors stand at the field they are about. */
export function IndicatorDialog({ index }: { index: number | null }) {
  const net = useEditorStore((s) => s.net);
  const setIndicators = useEditorStore((s) => s.setIndicators);
  const close = useUiStore((s) => s.closeIndicatorDialog);
  const stored = net.simulation?.indicators;
  const indicators = useMemo(() => stored ?? [], [stored]);
  const existing = index === null ? undefined : indicators[index];
  const [draft, setDraft] = useState<Draft>(() => toDraft(existing, net));
  const t = en.indicators;

  // The id of a new indicator comes from its name; an existing one keeps its id.
  const id =
    existing?.id ??
    newIndicatorId(
      draft.label,
      indicators.map((i) => i.id),
    );
  const indicator = useMemo(() => toIndicator(id, draft), [id, draft]);
  const problems = useMemo(
    () =>
      indicatorProblems(
        net,
        indicator,
        indicators.filter((_, i) => i !== index),
      ),
    [net, indicator, indicators, index],
  );
  const at = (path: string): string | undefined => problems.find((p) => p.path === path)?.message;
  const labelError = draft.label.trim() === '' ? t.labelMissing : undefined;
  const valid = problems.length === 0 && labelError === undefined;

  const change = (patch: Partial<Draft>): void => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  const submit = (): void => {
    if (!valid) return;
    const next = [...indicators];
    if (index === null) next.push(indicator);
    else next[index] = indicator;
    setIndicators(next);
    close();
  };

  return (
    <Dialog
      open
      title={existing ? t.dialogEdit(existing.label) : t.dialogNew}
      onClose={close}
      width="max-w-lg"
      footer={
        <>
          <Button onClick={close} data-testid="indicator-cancel">
            {t.cancel}
          </Button>
          <Button variant="primary" onClick={submit} disabled={!valid} data-testid="indicator-save">
            {t.save}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        data-testid="indicator-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <TextField
            label={t.label}
            value={draft.label}
            placeholder={t.labelPlaceholder}
            error={draft.label === '' && existing === undefined ? undefined : labelError}
            onCommit={(label) => {
              change({ label });
            }}
            data-testid="indicator-label"
          />
          <TextField
            label={t.unit}
            value={draft.unit}
            placeholder={t.unitPlaceholder}
            onCommit={(unit) => {
              change({ unit });
            }}
            data-testid="indicator-unit"
          />
        </div>
        <MeasureFields
          net={net}
          value={draft.measure}
          onChange={(measure) => {
            change({ measure });
          }}
          errors={{ of: at('measure.of'), via: at('measure.via') }}
          testPrefix="indicator-measure"
        />
        <SelectField
          label={t.per}
          value={draft.per}
          options={[
            { value: 'none', label: t.perNone },
            { value: 'case', label: t.perCase },
            { value: 'hour', label: t.perHour },
            { value: 'measure', label: t.perMeasure },
          ]}
          onChange={(per) => {
            change({ per: per as PerDraft });
          }}
          data-testid="indicator-per"
        />
        {draft.per === 'measure' ? (
          <fieldset className="m-0 flex flex-col gap-2 rounded-md border border-border p-2">
            <legend className="px-1 text-xs font-medium text-muted">{t.perMeasureTitle}</legend>
            <MeasureFields
              net={net}
              value={draft.perMeasure}
              onChange={(perMeasure) => {
                change({ perMeasure });
              }}
              errors={{ of: at('per.of'), via: at('per.via') }}
              testPrefix="indicator-per-measure"
            />
          </fieldset>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label={t.factor}
            value={draft.factor}
            min={-1e12}
            decimals={6}
            allowEmpty
            placeholder="1"
            hint={t.factorHint}
            error={at('factor')}
            onCommit={(factor) => {
              change({ factor });
            }}
            data-testid="indicator-factor"
          />
          <NumberField
            label={t.digits}
            value={draft.digits}
            min={0}
            max={MAX_INDICATOR_DIGITS}
            allowEmpty
            placeholder={String(DEFAULT_INDICATOR_DIGITS)}
            error={at('digits')}
            onCommit={(digits) => {
              change({ digits });
            }}
            data-testid="indicator-digits"
          />
        </div>
        <p className="m-0 text-xs text-muted" data-testid="indicator-summary">
          {describeIndicator(net, indicator)}
        </p>
      </form>
    </Dialog>
  );
}
