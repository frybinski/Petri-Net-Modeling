import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../../store/editor-store';

interface NodeLabelProps {
  id: string;
  name: string;
  renaming: boolean;
  kind: 'place' | 'transition';
}

/** Name below a node. Turns into a text input on double click. */
export function NodeLabel({ id, name, renaming, kind }: NodeLabelProps) {
  return (
    <div className="pointer-events-none absolute top-full left-1/2 mt-1 -translate-x-1/2">
      {renaming ? (
        <RenameInput id={id} name={name} kind={kind} />
      ) : (
        <span className="block text-xs leading-4 font-medium whitespace-nowrap text-fg select-none">
          {name === '' ? ' ' : name}
        </span>
      )}
    </div>
  );
}

function RenameInput({
  id,
  name,
  kind,
}: {
  id: string;
  name: string;
  kind: 'place' | 'transition';
}) {
  const [draft, setDraft] = useState(name);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = (commit: boolean): void => {
    if (done.current) return;
    done.current = true;
    const { updatePlace, updateTransition, startRename } = useEditorStore.getState();
    if (commit) {
      if (kind === 'place') updatePlace(id, { name: draft });
      else updateTransition(id, { name: draft });
    }
    startRename(null);
  };

  return (
    <input
      ref={ref}
      aria-label={`Rename ${kind}`}
      value={draft}
      size={Math.max(6, draft.length + 1)}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onBlur={() => {
        finish(true);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') finish(true);
        else if (event.key === 'Escape') finish(false);
      }}
      className="nodrag nopan pointer-events-auto rounded border border-accent bg-surface px-1 text-center text-xs text-fg shadow-panel outline-none"
    />
  );
}
