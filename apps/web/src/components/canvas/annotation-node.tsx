import type { NodeProps } from '@xyflow/react';
import { memo, useRef, useState } from 'react';
import { useAutoFocus } from '../../lib/use-auto-focus';
import { useEditorStore } from '../../store/editor-store';
import type { AnnotationFlowNode } from './types';

function AnnotationNodeView({ id, data, selected }: NodeProps<AnnotationFlowNode>) {
  const { text, renaming } = data;
  return (
    <div
      className={`min-h-12 w-full rounded-md border bg-[var(--note-bg)] px-2.5 py-2 text-xs leading-4 text-[var(--note-text)] shadow-sm ${selected ? 'border-accent shadow-[0_0_0_3px_var(--accent-soft)]' : 'border-[var(--note-border)]'}`}
      data-testid="annotation"
    >
      {renaming ? (
        <NoteEditor id={id} text={text} />
      ) : (
        <p className="m-0 min-h-4 break-words whitespace-pre-wrap select-none">{text}</p>
      )}
    </div>
  );
}

function NoteEditor({ id, text }: { id: string; text: string }) {
  const [draft, setDraft] = useState(text);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);

  useAutoFocus(ref);

  const finish = (commit: boolean): void => {
    if (done.current) return;
    done.current = true;
    const { updateAnnotation, startRename } = useEditorStore.getState();
    if (commit) updateAnnotation(id, { text: draft });
    startRename(null);
  };

  return (
    <textarea
      ref={ref}
      aria-label="Note text"
      value={draft}
      rows={Math.max(2, draft.split('\n').length)}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onBlur={() => {
        finish(true);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') finish(false);
      }}
      className="nodrag nopan nowheel block w-full resize-none bg-transparent text-xs leading-4 outline-none"
    />
  );
}

export const AnnotationNode = memo(AnnotationNodeView);
