import { Copy, Pencil, Plus, TextCursorInput, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { validateTypeName } from '@pnm/core';
import { en } from '../../i18n/en';
import { useEditorStore } from '../../store/editor-store';
import { useUiStore } from '../../store/ui-store';
import { Button, IconButton } from '../ui/button';

/** List of the net's types with usage counts and the actions to manage them. */
export function TypesSection() {
  const types = useEditorStore((s) => s.net.types);
  const places = useEditorStore((s) => s.net.places);
  const locked = useEditorStore((s) => s.mode === 'simulate');
  const duplicateType = useEditorStore((s) => s.duplicateType);
  const removeType = useEditorStore((s) => s.removeType);
  const openTypeDialog = useUiStore((s) => s.openTypeDialog);
  const askConfirm = useUiStore((s) => s.askConfirm);

  const [renaming, setRenaming] = useState<string | null>(null);
  const saveType = useEditorStore((s) => s.saveType);
  const names = Object.keys(types);
  const usage = (name: string): number => places.filter((p) => p.type === name).length;

  const requestDelete = (name: string): void => {
    const used = usage(name);
    if (used === 0) {
      removeType(name);
      return;
    }
    askConfirm({
      title: en.types.deleteTitle(name),
      message: en.types.deleteMessage(used),
      confirmLabel: en.types.deleteConfirm,
      danger: true,
      onConfirm: () => {
        removeType(name);
      },
    });
  };

  return (
    <div className="flex flex-col gap-2" data-testid="types-section">
      {names.length === 0 ? (
        <p className="m-0 text-sm text-muted">{en.types.empty}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="type-list">
          {names.map((name) => (
            <li
              key={name}
              className="flex items-center gap-1 rounded-md border border-border py-1 pr-1 pl-2.5"
              data-testid="type-item"
              data-type-name={name}
            >
              {renaming === name ? (
                <RenameField
                  name={name}
                  taken={names.filter((n) => n !== name)}
                  onDone={(next) => {
                    setRenaming(null);
                    if (next !== null && next !== name) saveType(name, next, types[name]);
                  }}
                />
              ) : (
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    openTypeDialog(name);
                  }}
                  className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline disabled:no-underline"
                  title={en.types.edit}
                >
                  {name}
                  <span className="ml-2 text-xs font-normal text-muted">
                    {en.types.usedBy(usage(name))}
                  </span>
                </button>
              )}
              <IconButton
                size="sm"
                label={`${en.types.rename} ${name}`}
                disabled={locked}
                onClick={() => {
                  setRenaming(name);
                }}
              >
                <TextCursorInput size={14} aria-hidden="true" />
              </IconButton>
              <IconButton
                size="sm"
                label={`${en.types.edit} ${name}`}
                disabled={locked}
                onClick={() => {
                  openTypeDialog(name);
                }}
              >
                <Pencil size={14} aria-hidden="true" />
              </IconButton>
              <IconButton
                size="sm"
                label={`${en.types.duplicate} ${name}`}
                disabled={locked}
                onClick={() => {
                  duplicateType(name);
                }}
              >
                <Copy size={14} aria-hidden="true" />
              </IconButton>
              <IconButton
                size="sm"
                label={`${en.types.delete} ${name}`}
                disabled={locked}
                onClick={() => {
                  requestDelete(name);
                }}
              >
                <Trash2 size={14} aria-hidden="true" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <Button
        icon={<Plus size={14} aria-hidden="true" />}
        disabled={locked}
        onClick={() => {
          openTypeDialog(null);
        }}
        className="self-start"
        data-testid="type-new"
      >
        {en.types.new}
      </Button>
    </div>
  );
}

/** Inline name field of a type being renamed. Enter or leaving the field commits, Escape cancels. */
function RenameField({
  name,
  taken,
  onDone,
}: {
  name: string;
  taken: string[];
  onDone: (next: string | null) => void;
}) {
  const [draft, setDraft] = useState(name);
  const [finished, setFinished] = useState(false);
  const valid = validateTypeName(draft.trim()) && !taken.includes(draft.trim());
  const finish = (commit: boolean): void => {
    if (finished) return;
    setFinished(true);
    onDone(commit && valid ? draft.trim() : null);
  };
  return (
    <input
      aria-label={`${en.types.rename} ${name}`}
      aria-invalid={!valid}
      value={draft}
      autoFocus
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onBlur={() => {
        finish(true);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') finish(true);
        else if (event.key === 'Escape') finish(false);
      }}
      className={`h-7 min-w-0 flex-1 rounded border bg-surface px-1.5 text-sm ${valid ? 'border-accent' : 'border-danger'}`}
      data-testid="type-rename-input"
    />
  );
}
