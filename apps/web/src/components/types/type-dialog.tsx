import {
  TYPE_TEMPLATES,
  compileType,
  isToken,
  uniqueName,
  validateTypeName,
  type Token,
} from '@pnm/core';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { en } from '../../i18n/en';
import { parseJson } from '../../lib/json-text';
import { useEditorStore } from '../../store/editor-store';
import { useUiStore } from '../../store/ui-store';
import { LazyCodeEditor, type EditorDiagnostic } from '../editor/lazy-code-editor';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { SelectField, inputClass } from '../ui/fields';

const TEMPLATE_KEEP = '';

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** Dialog to create a type or edit an existing one: name, template, JSON Schema, and a value tester. */
export function TypeDialog({ original }: { original: string | null }) {
  const types = useEditorStore((s) => s.net.types);
  const saveType = useEditorStore((s) => s.saveType);
  const close = useUiStore((s) => s.closeTypeDialog);

  const [name, setName] = useState(() => original ?? uniqueName(Object.keys(types), 'Type1'));
  const [text, setText] = useState(() =>
    pretty(original === null ? TYPE_TEMPLATES['object'] : types[original]),
  );
  const [template, setTemplate] = useState(TEMPLATE_KEEP);
  const [sample, setSample] = useState('');
  const nameId = useId();

  const trimmed = name.trim();
  const nameError =
    trimmed === '' || !validateTypeName(trimmed)
      ? en.types.nameInvalid
      : trimmed !== original && Object.hasOwn(types, trimmed)
        ? en.types.nameTaken
        : null;

  const parsed = useMemo(() => parseJson(text), [text]);
  const compiled = useMemo(() => (parsed.ok ? compileType(parsed.value) : null), [parsed]);

  const diagnostics = useMemo<EditorDiagnostic[]>(() => {
    if (!parsed.ok) {
      return [{ ...parsed.range, severity: 'error', message: en.types.jsonError(parsed.message) }];
    }
    if (compiled && !compiled.ok) {
      return [
        {
          from: 0,
          to: text.length,
          severity: 'error',
          message: en.types.schemaError(compiled.error),
        },
      ];
    }
    return [];
  }, [parsed, compiled, text.length]);

  const sampleResult = useMemo(() => {
    if (sample.trim() === '') return { state: 'empty' as const };
    const value = parseJson(sample);
    if (!value.ok) return { state: 'notJson' as const };
    if (!isToken(value.value)) return { state: 'null' as const };
    if (!compiled?.ok) return { state: 'schema' as const };
    const verdict = compiled.check(value.value as Token);
    return verdict.ok
      ? { state: 'valid' as const }
      : { state: 'invalid' as const, errors: verdict.errors };
  }, [sample, compiled]);

  const valid = nameError === null && parsed.ok && compiled?.ok === true;

  const applyTemplate = (key: string): void => {
    setTemplate(key);
    if (key !== TEMPLATE_KEEP) setText(pretty(TYPE_TEMPLATES[key]));
  };

  const submit = (): void => {
    if (!valid || !parsed.ok) return;
    if (saveType(original, trimmed, parsed.value)) close();
  };

  const schemaMessage = !parsed.ok
    ? en.types.jsonError(parsed.message)
    : compiled && !compiled.ok
      ? en.types.schemaError(compiled.error)
      : null;

  return (
    <Dialog
      open
      title={original === null ? en.types.dialogNew : en.types.dialogEdit(original)}
      onClose={close}
      width="max-w-2xl"
      footer={
        <>
          <Button onClick={close}>{en.types.cancel}</Button>
          <Button variant="primary" onClick={submit} disabled={!valid} data-testid="type-save">
            {original === null ? en.types.create : en.types.save}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={nameId} className="text-xs font-medium text-muted">
              {en.types.name}
            </label>
            <input
              id={nameId}
              type="text"
              value={name}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={nameError !== null}
              onChange={(event) => {
                setName(event.target.value);
              }}
              className={inputClass}
              data-testid="type-name"
            />
            {nameError ? (
              <p className="text-xs text-danger" role="alert" data-testid="type-name-error">
                {nameError}
              </p>
            ) : null}
          </div>
          <SelectField
            label={en.types.template}
            value={template}
            onChange={applyTemplate}
            options={[
              { value: TEMPLATE_KEEP, label: en.types.templateNone },
              ...Object.keys(TYPE_TEMPLATES).map((key) => ({
                value: key,
                label: en.types.templates[key] ?? key,
              })),
            ]}
            data-testid="type-template"
          />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted" id="type-schema-label">
            {en.types.schema}
          </span>
          <LazyCodeEditor
            value={text}
            onChange={setText}
            language="json"
            lineNumbers
            ariaLabel={en.types.schema}
            minHeight="9rem"
            maxHeight="16rem"
            diagnostics={diagnostics}
            data-testid="type-schema"
          />
          <p
            className={`text-xs ${schemaMessage ? 'text-danger' : 'text-muted'}`}
            role={schemaMessage ? 'alert' : undefined}
            data-testid="type-schema-status"
          >
            {schemaMessage ?? (compiled?.ok ? en.types.schemaOk : en.types.schemaHint)}
          </p>
        </div>

        <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface-2 p-3">
          <span className="text-xs font-semibold text-fg">{en.types.test}</span>
          <LazyCodeEditor
            value={sample}
            onChange={setSample}
            language="json"
            placeholder={en.types.testPlaceholder}
            ariaLabel={en.types.test}
            minHeight="2.2rem"
            maxHeight="8rem"
            data-testid="type-test"
          />
          <div className="min-h-5 text-xs" aria-live="polite" data-testid="type-test-result">
            {sampleResult.state === 'empty' ? (
              <span className="text-muted">{en.types.testHint}</span>
            ) : sampleResult.state === 'valid' ? (
              <span className="inline-flex items-center gap-1.5 text-ok">
                <CheckCircle2 size={14} aria-hidden="true" />
                {en.types.testValid}
              </span>
            ) : sampleResult.state === 'invalid' ? (
              <div className="text-danger">
                <span className="inline-flex items-center gap-1.5">
                  <XCircle size={14} aria-hidden="true" />
                  {en.types.testInvalid}
                </span>
                <ul className="m-0 mt-1 list-disc pl-6">
                  {sampleResult.errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </div>
            ) : sampleResult.state === 'null' ? (
              <span className="text-danger">{en.types.testNull}</span>
            ) : sampleResult.state === 'notJson' ? (
              <span className="text-muted">{en.types.testNotJson}</span>
            ) : null}
          </div>
        </div>
      </form>
    </Dialog>
  );
}
