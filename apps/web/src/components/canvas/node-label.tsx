import { useRef, useState, type ReactNode } from 'react';
import { refocusNode } from '../../lib/focus';
import { useAutoFocus } from '../../lib/use-auto-focus';
import { useEditorStore } from '../../store/editor-store';

interface NodeLabelProps {
  id: string;
  name: string;
  renaming: boolean;
  kind: 'place' | 'transition';
  /** Extra content below the name. */
  children?: ReactNode;
}

/** Name below a node. Turns into a text input while the node is renamed in place. */
export function NodeLabel({ id, name, renaming, kind, children }: NodeLabelProps) {
  return (
    <div className="pointer-events-none absolute top-full left-1/2 mt-1.5 -translate-x-1/2">
      {renaming ? (
        <RenameInput id={id} name={name} kind={kind} />
      ) : (
        <span
          className="pn-name block text-sm leading-4 font-medium whitespace-nowrap text-fg select-none"
          data-testid="node-name"
        >
          {name === '' ? ' ' : name}
        </span>
      )}
      {children}
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

  useAutoFocus(ref);

  /** Leaves the editor; returns false when it had already been left. */
  const finish = (commit: boolean): boolean => {
    if (done.current) return false;
    done.current = true;
    const { renameElement, startRename } = useEditorStore.getState();
    if (commit) renameElement(id, draft);
    startRename(null);
    return true;
  };

  return (
    <input
      ref={ref}
      aria-label={`Rename ${kind}`}
      data-testid="rename-input"
      value={draft}
      size={Math.max(6, draft.length + 1)}
      spellCheck={false}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onBlur={() => {
        finish(true);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(true);
          refocusNode(id);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          finish(false);
          refocusNode(id);
        } else if (event.key === 'Tab') {
          // Keeps the chain going: confirm the name, then add the next node.
          event.preventDefault();
          if (finish(true)) useEditorStore.getState().extendFrom(id, event.shiftKey ? -1 : 1);
        }
      }}
      className="nodrag nopan pointer-events-auto rounded-md border border-accent bg-surface px-1.5 py-0.5 text-center text-sm text-fg shadow-panel outline-none"
    />
  );
}
