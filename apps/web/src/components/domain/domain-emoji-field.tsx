import { emojiProblem } from '@pnm/domain';
import { useState } from 'react';
import { en } from '../../i18n/en';
import { TextField } from '../ui/fields';

/**
 * An input for one emoji (N4), next to the picture picker of an entity, a stage or a counter.
 * What is typed is checked at once (rule V12) and the error stands at the field; only a valid
 * emoji is handed on. An empty field takes the emoji away again.
 */
export function EmojiField({
  value,
  onCommit,
  disabled,
  error,
  hint,
  'data-testid': testId,
}: {
  /** The emoji in use; `undefined` if the symbol is a built-in one. */
  value: string | undefined;
  onCommit: (emoji: string | undefined) => void;
  disabled?: boolean;
  /** An error of the stored view (rule V12) for this field. */
  error?: string | undefined;
  hint?: string;
  'data-testid'?: string;
}) {
  const [typed, setTyped] = useState<{ value: string | undefined; message: string } | null>(null);
  // A typed error only holds while the stored value is the one it was typed against.
  const message = typed !== null && typed.value === value ? typed.message : undefined;
  return (
    <div className="flex flex-col gap-1">
      <TextField
        label={en.domain.emojiLabel}
        value={value ?? ''}
        disabled={disabled}
        placeholder={en.domain.emojiPlaceholder}
        error={message ?? error}
        onCommit={(raw) => {
          const text = raw.trim();
          if (text === '') {
            setTyped(null);
            onCommit(undefined);
            return;
          }
          const problem = emojiProblem(text);
          if (problem !== null) {
            setTyped({ value, message: problem });
            return;
          }
          setTyped(null);
          onCommit(text);
        }}
        {...(testId !== undefined && { 'data-testid': testId })}
      />
      {hint ? <p className="m-0 text-[11px] text-muted">{hint}</p> : null}
    </div>
  );
}
