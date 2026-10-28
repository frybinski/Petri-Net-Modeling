import { tokenLabel } from '@pnm/core';
import { NodeToolbar, Position } from '@xyflow/react';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { en } from '../../i18n/en';
import { useEditorStore } from '../../store/editor-store';

/** Binding list of a transition with several bindings, anchored below the transition. */
export function BindingPicker({ transitionId }: { transitionId: string }) {
  const result = useEditorStore((s) => s.enabled.get(transitionId));
  const fireBindingAt = useEditorStore((s) => s.fireBindingAt);
  const setPicker = useEditorStore((s) => s.setPicker);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>('button')?.focus();
  }, []);

  if (!result) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    const items = [...(list.current?.querySelectorAll<HTMLElement>('button') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(index + 1) % items.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setPicker(null);
    }
  };

  return (
    <NodeToolbar isVisible position={Position.Bottom} offset={34} align="center">
      <div
        // Keep clicks inside the list from reaching the node, which would toggle the list again.
        onClick={(event) => {
          event.stopPropagation();
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
        }}
        className="nodrag nopan w-64 rounded-lg border border-border bg-surface p-1 shadow-panel"
        role="dialog"
        aria-label={en.simulation.chooseBinding}
        data-testid="binding-picker"
      >
        <div className="px-2 pt-1 pb-1 text-[11px] font-medium tracking-wide text-muted uppercase">
          {en.simulation.chooseBinding}
        </div>
        <ul
          ref={list}
          role="listbox"
          aria-label={en.simulation.chooseBinding}
          onKeyDown={onKeyDown}
          className="m-0 max-h-60 list-none overflow-y-auto p-0"
        >
          {result.bindings.map((entry, index) => {
            const names = Object.keys(entry.binding);
            return (
              <li key={index} role="option" aria-selected="false">
                <button
                  type="button"
                  onClick={() => {
                    fireBindingAt(transitionId, index);
                  }}
                  className="flex w-full flex-col rounded-md px-2 py-1 text-left font-mono text-[11px] leading-4 hover:bg-ok-soft focus-visible:bg-ok-soft"
                  data-testid="binding-option"
                >
                  {names.length === 0 ? (
                    <span className="text-muted">{en.simulation.noVariables}</span>
                  ) : (
                    names.map((name) => (
                      <span key={name} className="truncate">
                        <span className="font-semibold text-accent">${name}</span>
                        {' = '}
                        {tokenLabel(entry.binding[name]!, 44)}
                      </span>
                    ))
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        {result.truncated ? (
          <p className="m-0 px-2 py-1 text-[11px] text-warn">{en.simulation.truncated}</p>
        ) : null}
      </div>
    </NodeToolbar>
  );
}
