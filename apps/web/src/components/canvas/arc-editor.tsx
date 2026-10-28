import { useRef, useState } from 'react';
import { en } from '../../i18n/en';
import { arcDirection, boundVariables, checkInscription } from '../../lib/inscriptions';
import { refocusEdge } from '../../lib/focus';
import { useAutoFocus } from '../../lib/use-auto-focus';
import { useEditorStore } from '../../store/editor-store';
import { LazyCodeEditor } from '../editor/lazy-code-editor';

interface ArcEditorProps {
  arcId: string;
}

/**
 * Editor that opens in place of the label of an arc: the weight in P/T nets, the inscription in
 * JSON nets. Enter confirms, Escape discards, leaving the field confirms.
 */
export function ArcEditor({ arcId }: ArcEditorProps) {
  const arc = useEditorStore((s) => s.net.arcs.find((a) => a.id === arcId));
  const json = useEditorStore((s) => s.net.profile === 'json-net');
  if (!arc) return null;
  return json ? <InscriptionEditor arcId={arcId} /> : <WeightEditor arcId={arcId} />;
}

function close(arcId: string): void {
  useEditorStore.getState().startRename(null);
  refocusEdge(arcId);
}

function WeightEditor({ arcId }: ArcEditorProps) {
  const weight = useEditorStore((s) => s.net.arcs.find((a) => a.id === arcId)?.weight ?? 1);
  const [draft, setDraft] = useState(String(weight));
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useAutoFocus(ref);

  const finish = (commit: boolean): void => {
    if (done.current) return;
    done.current = true;
    const value = Number(draft);
    if (commit && Number.isInteger(value) && value >= 1) {
      useEditorStore.getState().updateArc(arcId, { weight: value });
    }
    close(arcId);
  };

  return (
    <input
      ref={ref}
      type="number"
      min={1}
      step={1}
      inputMode="numeric"
      aria-label={en.properties.weight}
      data-testid="arc-weight-input"
      value={draft}
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
        } else if (event.key === 'Escape') {
          event.preventDefault();
          finish(false);
        }
      }}
      className="nodrag nopan pointer-events-auto h-7 w-16 rounded-md border border-accent bg-surface px-1.5 text-center text-sm text-fg tabular-nums shadow-panel outline-none"
    />
  );
}

function InscriptionEditor({ arcId }: ArcEditorProps) {
  const net = useEditorStore((s) => s.net);
  const arc = net.arcs.find((a) => a.id === arcId);
  const direction = arcDirection(net, arcId);
  const value = arc?.inscription ?? '';
  const [draft, setDraft] = useState(value);
  if (!arc || !direction) return null;
  const transitionId = direction === 'input' ? arc.target : arc.source;
  const bound = direction === 'output' ? boundVariables(net, transitionId).map((v) => v.name) : [];
  const check = checkInscription(direction, draft, bound);
  return (
    <div
      className="nodrag nopan nowheel pointer-events-auto w-64 rounded-lg border border-accent bg-surface p-1 shadow-panel"
      data-testid="arc-inscription-editor"
      onKeyDown={(event) => {
        event.stopPropagation();
      }}
    >
      <LazyCodeEditor
        value={value}
        language="jsonata"
        singleLine
        autoFocus
        completion={direction !== 'input'}
        variables={bound}
        placeholder={
          direction === 'input'
            ? en.inscriptions.inputPlaceholder
            : en.inscriptions.outputPlaceholder
        }
        ariaLabel={en.inscriptions.inscription}
        minHeight="1.9rem"
        maxHeight="6rem"
        diagnostics={check.diagnostics}
        onChange={setDraft}
        onCommit={(text) => {
          const trimmed = text.trim();
          if (trimmed !== value.trim()) {
            useEditorStore.getState().updateArc(arcId, {
              inscription: trimmed === '' ? undefined : text,
            });
          }
          close(arcId);
        }}
        data-testid="arc-inscription-input"
      />
      {check.error ? (
        <p className="m-0 px-1 pt-1 text-[11px] text-danger" role="alert">
          {check.error}
        </p>
      ) : null}
    </div>
  );
}
