import { useId, useState } from 'react';
import { en } from '../i18n/en';
import { checkInscription, type InscriptionKind } from '../lib/inscriptions';
import { LazyCodeEditor } from './editor/lazy-code-editor';

interface InscriptionFieldProps {
  label: string;
  kind: InscriptionKind;
  /** The committed text. */
  value: string;
  /** Called when the editor is left (or Ctrl+Enter) with a changed text. */
  onCommit: (value: string) => void;
  /** Variables the transition binds; offered by completion and used for the unbound check. */
  bound: readonly string[];
  placeholder: string;
  hint?: string;
  disabled?: boolean;
  'data-testid'?: string;
}

/** Code field for an arc inscription or a guard, with live syntax check and completion. */
export function InscriptionField({
  label,
  kind,
  value,
  onCommit,
  bound,
  placeholder,
  hint,
  disabled,
  'data-testid': testId,
}: InscriptionFieldProps) {
  const labelId = useId();
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }
  const check = checkInscription(kind, draft, bound);
  const shownHint =
    kind === 'input' && check.variables.length > 0 ? en.inscriptions.binds(check.variables) : hint;

  return (
    <div className="flex flex-col gap-1">
      <span id={labelId} className="text-xs font-medium text-muted">
        {label}
      </span>
      <LazyCodeEditor
        value={value}
        language="jsonata"
        singleLine
        completion={kind !== 'input'}
        variables={bound}
        placeholder={placeholder}
        ariaLabel={label}
        readOnly={disabled}
        minHeight="1.9rem"
        maxHeight="9rem"
        diagnostics={check.diagnostics}
        onChange={setDraft}
        onCommit={(text) => {
          if (text !== value) onCommit(text);
        }}
        data-testid={testId}
      />
      {check.error ? (
        <p
          className="m-0 text-[11px] text-danger"
          role="alert"
          data-testid={`${testId ?? 'inscription'}-error`}
        >
          {check.error}
        </p>
      ) : check.warning ? (
        <p className="m-0 text-[11px] text-warn" data-testid={`${testId ?? 'inscription'}-warning`}>
          {check.warning}
        </p>
      ) : shownHint ? (
        <p className="m-0 text-[11px] text-muted">{shownHint}</p>
      ) : null}
    </div>
  );
}
