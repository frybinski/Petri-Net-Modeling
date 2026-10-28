import {
  checkToken,
  exampleToken,
  isToken,
  simpleKind,
  type SimpleKind,
  type Token,
} from '@pnm/core';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { en } from '../../i18n/en';
import { formatJson, parseJson } from '../../lib/json-text';
import { useEditorStore } from '../../store/editor-store';
import { useUiStore } from '../../store/ui-store';
import { LazyCodeEditor, type EditorDiagnostic } from '../editor/lazy-code-editor';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { SelectField, inputClass } from '../ui/fields';

type Parsed = { ok: true; value: Token } | { ok: false; message: string };

/** Which editing control fits: a simple input for primitive types, a JSON editor otherwise. */
function chooseKind(schema: unknown, existing: Token | undefined): SimpleKind | 'json' {
  const kind = simpleKind(schema);
  if (kind === undefined) return 'json';
  if (existing === undefined) return kind;
  const expected = kind === 'integer' ? 'number' : kind;
  return typeof existing === expected ? kind : 'json';
}

function initialDraft(kind: SimpleKind | 'json', token: Token): string {
  if (kind === 'json') return formatJson(token);
  return typeof token === 'string' ? token : String(token);
}

function parseDraft(kind: SimpleKind | 'json', draft: string): Parsed {
  switch (kind) {
    case 'string':
      return { ok: true, value: draft };
    case 'boolean':
      return { ok: true, value: draft === 'true' };
    case 'integer':
    case 'number': {
      const trimmed = draft.trim();
      const number = Number(trimmed);
      if (trimmed === '' || !Number.isFinite(number)) {
        return { ok: false, message: en.tokens.notANumber };
      }
      return { ok: true, value: number };
    }
    case 'json': {
      const parsed = parseJson(draft);
      if (!parsed.ok) return { ok: false, message: en.tokens.notJson(parsed.message) };
      if (!isToken(parsed.value)) return { ok: false, message: en.tokens.nullNotAllowed };
      return { ok: true, value: parsed.value };
    }
  }
}

/** Dialog to add or edit an initial token of a place. */
export function TokenDialog({ placeId, index }: { placeId: string; index: number | null }) {
  const net = useEditorStore((s) => s.net);
  const addToken = useEditorStore((s) => s.addToken);
  const updateToken = useEditorStore((s) => s.updateToken);
  const close = useUiStore((s) => s.closeTokenDialog);
  const place = net.places.find((p) => p.id === placeId);
  const schema = place?.type === undefined ? undefined : net.types[place.type];
  const existing = index === null ? undefined : net.marking[placeId]?.[index];

  const [kind] = useState(() => chooseKind(schema, existing));
  const [draft, setDraft] = useState(() => initialDraft(kind, existing ?? exampleToken(schema)));
  const fieldId = useId();

  const parsed = useMemo(() => parseDraft(kind, draft), [kind, draft]);
  const verdict = useMemo(
    () => (parsed.ok ? checkToken(net, placeId, parsed.value) : null),
    [parsed, net, placeId],
  );
  const diagnostics = useMemo<EditorDiagnostic[]>(() => {
    if (kind !== 'json' || parsed.ok) return [];
    const result = parseJson(draft);
    return result.ok
      ? [{ from: 0, to: draft.length, severity: 'error', message: parsed.message }]
      : [{ ...result.range, severity: 'error', message: parsed.message }];
  }, [kind, parsed, draft]);

  const submit = (): void => {
    if (!parsed.ok) return;
    if (index === null) addToken(placeId, parsed.value);
    else updateToken(placeId, index, parsed.value);
    close();
  };

  if (!place) return null;
  return (
    <Dialog
      open
      title={index === null ? en.tokens.dialogNew : en.tokens.dialogEdit(index + 1)}
      onClose={close}
      width="max-w-lg"
      footer={
        <>
          <Button onClick={close}>{en.types.cancel}</Button>
          <Button variant="primary" onClick={submit} disabled={!parsed.ok} data-testid="token-save">
            {en.tokens.save}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <p className="m-0 text-sm text-muted">
          {place.name}
          {place.type !== undefined ? ` · ${place.type}` : ''}
        </p>
        {kind === 'json' ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">{en.tokens.json}</span>
            <LazyCodeEditor
              value={draft}
              onChange={setDraft}
              language="json"
              lineNumbers
              ariaLabel={en.tokens.json}
              minHeight="7rem"
              maxHeight="16rem"
              diagnostics={diagnostics}
              autoFocus
              data-testid="token-json"
            />
          </div>
        ) : kind === 'boolean' ? (
          <SelectField
            label={en.tokens.json}
            value={draft}
            onChange={setDraft}
            options={[
              { value: 'true', label: 'true' },
              { value: 'false', label: 'false' },
            ]}
            data-testid="token-boolean"
          />
        ) : (
          <div className="flex flex-col gap-1">
            <label htmlFor={fieldId} className="text-xs font-medium text-muted">
              {en.tokens.json}
            </label>
            <input
              id={fieldId}
              type="text"
              inputMode={kind === 'string' ? 'text' : 'decimal'}
              value={draft}
              autoFocus
              onChange={(event) => {
                setDraft(event.target.value);
              }}
              className={`${inputClass} ${kind === 'string' ? '' : 'tabular-nums'}`}
              data-testid="token-input"
            />
          </div>
        )}

        <div className="min-h-5 text-xs" aria-live="polite" data-testid="token-status">
          {!parsed.ok ? (
            <span className="text-danger" role="alert">
              {parsed.message}
            </span>
          ) : verdict?.ok === false ? (
            <div className="text-warn">
              <span className="inline-flex items-center gap-1.5 font-medium">
                <AlertTriangle size={14} aria-hidden="true" />
                {en.tokens.typeMismatch(place.type ?? '')}
              </span>
              <ul className="m-0 mt-1 list-disc pl-6">
                {verdict.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
              <p className="m-0 mt-1 text-muted">{en.tokens.saveAnyway}</p>
            </div>
          ) : place.type !== undefined ? (
            <span className="inline-flex items-center gap-1.5 text-ok">
              <CheckCircle2 size={14} aria-hidden="true" />
              {en.tokens.typeOk}
            </span>
          ) : null}
        </div>
      </form>
    </Dialog>
  );
}
