import { createId, type PetriNet } from '@pnm/core';
import {
  DECLARE_TEMPLATES,
  LtlfSyntaxError,
  TEMPLATE_INFO,
  activityLabels,
  defaultCount,
  describeDeclare,
  declareFormulaText,
  ltlfAtoms,
  parseLtlf,
  validateDeclare,
  type DeclareSpec,
  type DeclareTemplate,
  type PropertySpec,
} from '@pnm/analysis';
import { useMemo, useState } from 'react';
import { en } from '../../i18n/en';
import { Button } from '../ui/button';
import { NumberField, SelectField, TextField } from '../ui/fields';
import { LazyCodeEditor, type EditorDiagnostic } from '../editor/lazy-code-editor';

const t = en.analysis.properties.editor;

type Draft =
  | { kind: 'declare'; template: DeclareTemplate; activities: string[]; n: number; name: string }
  | { kind: 'ltlf'; formula: string; name: string };

function draftOf(spec: PropertySpec | null, firstActivities: string[]): Draft {
  if (spec?.kind === 'ltlf') return { kind: 'ltlf', formula: spec.formula, name: spec.name ?? '' };
  if (spec?.kind === 'declare') {
    return {
      kind: 'declare',
      template: spec.template,
      activities: spec.activities,
      n: spec.n ?? defaultCount(spec.template),
      name: spec.name ?? '',
    };
  }
  return {
    kind: 'declare',
    template: 'response',
    activities: firstActivities.slice(0, 2),
    n: 1,
    name: '',
  };
}

/** Problems with a draft: a message for the form and, for formulas, a marker in the text. */
function check(
  draft: Draft,
  labels: readonly string[],
): { problem: string | null; diagnostics: EditorDiagnostic[]; meaning: string | null } {
  if (draft.kind === 'declare') {
    const info = TEMPLATE_INFO[draft.template];
    const spec: DeclareSpec = {
      template: draft.template,
      activities: draft.activities.slice(0, info.arity),
      ...(info.counted && { n: draft.n }),
    };
    const problem = validateDeclare(spec);
    if (problem) {
      return {
        problem:
          info.arity === 2 && draft.activities[0] === draft.activities[1] && draft.activities[0]
            ? t.differentActivities
            : problem,
        diagnostics: [],
        meaning: null,
      };
    }
    return { problem: null, diagnostics: [], meaning: describeDeclare(spec) };
  }
  try {
    const formula = parseLtlf(draft.formula);
    const unknown = ltlfAtoms(formula).find((a) => !labels.includes(a));
    if (unknown !== undefined) {
      const at = draft.formula.indexOf(unknown);
      return {
        problem: t.unknownActivity(unknown),
        diagnostics: [
          {
            from: Math.max(0, at),
            to: Math.max(0, at) + unknown.length,
            message: t.unknownActivity(unknown),
            severity: 'error',
          },
        ],
        meaning: null,
      };
    }
    return { problem: null, diagnostics: [], meaning: null };
  } catch (error) {
    if (error instanceof LtlfSyntaxError) {
      return {
        problem: error.message,
        diagnostics: [
          {
            from: error.position,
            to: Math.min(draft.formula.length, error.position + 1),
            message: error.message,
            severity: 'error',
          },
        ],
        meaning: null,
      };
    }
    throw error;
  }
}

function toSpec(draft: Draft, id: string): PropertySpec {
  const name = draft.name.trim() === '' ? {} : { name: draft.name.trim() };
  if (draft.kind === 'ltlf') return { id, kind: 'ltlf', ...name, formula: draft.formula.trim() };
  const info = TEMPLATE_INFO[draft.template];
  return {
    id,
    kind: 'declare',
    ...name,
    template: draft.template,
    activities: draft.activities.slice(0, info.arity),
    ...(info.counted && { n: draft.n }),
  };
}

const GROUPS = ['existence', 'relation', 'negative', 'choice'] as const;

/** Form for one property: a DECLARE template with its activities, or an LTLf formula. */
export function PropertyEditor({
  net,
  spec,
  onSave,
  onCancel,
}: {
  net: PetriNet;
  spec: PropertySpec | null;
  onSave: (spec: PropertySpec) => void;
  onCancel: () => void;
}) {
  const labels = useMemo(() => [...new Set(activityLabels(net).labels)], [net]);
  const [draft, setDraft] = useState<Draft>(() => draftOf(spec, labels));
  const result = check(draft, labels);
  const info = draft.kind === 'declare' ? TEMPLATE_INFO[draft.template] : null;

  const setActivity = (index: number, value: string): void => {
    if (draft.kind !== 'declare') return;
    const activities = [...draft.activities];
    activities[index] = value;
    setDraft({ ...draft, activities });
  };
  const activityOptions = [
    { value: '', label: '–' },
    ...labels.map((label) => ({ value: label, label })),
  ];

  return (
    <form
      className="flex flex-col gap-2.5 rounded-md border border-border-strong bg-surface-2 p-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (result.problem === null) onSave(toSpec(draft, spec?.id ?? createId()));
      }}
      aria-label={spec ? t.title : t.newTitle}
      data-testid="property-editor"
    >
      <SelectField
        label={t.kind}
        value={draft.kind}
        options={[
          { value: 'declare', label: t.kindDeclare },
          { value: 'ltlf', label: t.kindLtlf },
        ]}
        onChange={(value) => {
          setDraft(
            value === 'ltlf'
              ? { kind: 'ltlf', formula: '', name: draft.name }
              : { ...draftOf(null, labels), name: draft.name },
          );
        }}
        data-testid="property-kind"
      />
      {draft.kind === 'declare' && info ? (
        <>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            {t.template}
            <select
              value={draft.template}
              onChange={(event) => {
                const template = event.target.value as DeclareTemplate;
                setDraft({
                  ...draft,
                  template,
                  n: defaultCount(template),
                });
              }}
              className="h-8 w-full rounded-md border border-border-strong bg-surface px-2 text-sm font-normal text-fg"
              data-testid="property-template"
            >
              {GROUPS.map((group) => (
                <optgroup key={group} label={t.groups[group]}>
                  {DECLARE_TEMPLATES.filter((x) => TEMPLATE_INFO[x].group === group).map((x) => (
                    <option key={x} value={x}>
                      {TEMPLATE_INFO[x].label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <SelectField
            label={info.arity === 1 ? t.activity : t.activityA}
            value={draft.activities[0] ?? ''}
            options={activityOptions}
            onChange={(value) => {
              setActivity(0, value);
            }}
            data-testid="property-activity-a"
          />
          {info.arity === 2 ? (
            <SelectField
              label={t.activityB}
              value={draft.activities[1] ?? ''}
              options={activityOptions}
              onChange={(value) => {
                setActivity(1, value);
              }}
              data-testid="property-activity-b"
            />
          ) : null}
          {info.counted ? (
            <NumberField
              label={t.count}
              value={draft.n}
              min={draft.template === 'existence' ? 1 : 0}
              max={50}
              onCommit={(value) => {
                setDraft({ ...draft, n: value ?? defaultCount(draft.template) });
              }}
              data-testid="property-count"
            />
          ) : null}
        </>
      ) : null}
      {draft.kind === 'ltlf' ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted">{t.formula}</span>
          <LazyCodeEditor
            value={draft.formula}
            language="ltlf"
            singleLine
            ariaLabel={t.formulaLabel}
            minHeight="2.5rem"
            activities={labels}
            diagnostics={result.diagnostics}
            placeholder='G("Approve" -> F "Create invoice")'
            onChange={(formula) => {
              setDraft({ ...draft, formula });
            }}
            data-testid="property-formula"
          />
          <p className="m-0 text-[11px] text-muted">{t.formulaHint}</p>
        </div>
      ) : null}
      <TextField
        label={t.name}
        value={draft.name}
        onCommit={(name) => {
          setDraft({ ...draft, name });
        }}
        data-testid="property-name"
      />
      {result.meaning ? (
        <p className="m-0 text-[11px] leading-snug text-muted" data-testid="property-meaning">
          <strong className="font-semibold text-fg">{t.meaning}:</strong> {result.meaning}
          {draft.kind === 'declare' ? (
            <code className="mt-1 block font-mono text-[11px] text-fg">
              {declareFormulaText({
                template: draft.template,
                activities: draft.activities,
                n: draft.n,
              })}
            </code>
          ) : null}
        </p>
      ) : null}
      {result.problem ? (
        <p className="m-0 text-xs text-danger" role="alert" data-testid="property-problem">
          {result.problem}
        </p>
      ) : null}
      {labels.length === 0 ? <p className="m-0 text-xs text-warn">{t.noActivities}</p> : null}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} data-testid="property-cancel">
          {t.cancel}
        </Button>
        <Button
          size="sm"
          variant="primary"
          type="submit"
          disabled={result.problem !== null}
          data-testid="property-save"
        >
          {t.save}
        </Button>
      </div>
    </form>
  );
}
