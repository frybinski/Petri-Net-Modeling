import type { PetriNet } from '@pnm/core';
import { entryBounds, type DomainView, type EntryRef } from '@pnm/domain';
import { useLayoutEffect, useRef, useState } from 'react';
import { en } from '../../i18n/en';
import { changeLabel, labelText } from '../../lib/domain-edit';
import { useAutoFocus } from '../../lib/use-auto-focus';
import type { Viewport } from '../../lib/viewport';
import { useDomainEditStore } from '../../store/domain-edit-store';

interface LabelEditorProps {
  entry: EntryRef;
  view: DomainView;
  net: PetriNet;
  getViewport: () => Viewport;
}

/**
 * The label of an entry as a text field on top of the picture, like renaming a node in the net.
 * Enter or leaving the field keeps the text, Escape drops it. An empty text brings the name of
 * the element back.
 */
export function DomainLabelEditor({ entry, view, net, getViewport }: LabelEditorProps) {
  const initial = labelText(net, view, entry);
  const [draft, setDraft] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useAutoFocus(ref);

  // Stands on the middle of the entry; positioned in an effect because the viewport is a ref.
  const bounds = entryBounds(view, entry);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !bounds) return;
    const viewport = getViewport();
    element.style.left = `${viewport.x + (bounds[0] + bounds[2] / 2) * viewport.zoom}px`;
    element.style.top = `${viewport.y + (bounds[1] + bounds[3] / 2) * viewport.zoom}px`;
  });
  if (!bounds) return null;

  const finish = (keep: boolean): void => {
    if (done.current) return;
    done.current = true;
    useDomainEditStore.getState().startRename(null);
    if (keep && draft !== initial) changeLabel(entry, draft);
    // Hand the keyboard back to the picture.
    document.querySelector<HTMLElement>('[data-testid="domain-canvas"]')?.focus({
      preventScroll: true,
    });
  };

  return (
    <input
      ref={ref}
      aria-label={en.domain.labelField}
      data-testid="domain-label-input"
      value={draft}
      size={Math.max(10, draft.length + 2)}
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
        } else if (event.key === 'Escape') {
          event.preventDefault();
          finish(false);
        }
      }}
      className="absolute z-20 -translate-x-1/2 -translate-y-1/2 rounded-md border border-accent bg-surface px-1.5 py-0.5 text-center text-sm text-fg shadow-panel outline-none"
    />
  );
}

/** The numbers of the drag that is going on, next to the pointer. */
export function DomainReadout() {
  const readout = useDomainEditStore((s) => s.readout);
  if (!readout) return null;
  return (
    <div
      className="pointer-events-none absolute z-20 rounded-md border border-border bg-surface px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap text-fg tabular-nums shadow-panel"
      style={{ left: readout.x + 16, top: readout.y + 16 }}
      role="status"
      data-testid="domain-readout"
    >
      {readout.text}
    </div>
  );
}
