import { tokenLabel } from '@pnm/core';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { en } from '../../i18n/en';
import { useEditorStore } from '../../store/editor-store';
import type { AnchorRect } from '../canvas/hover-card';

const MARGIN = 8;
const WIDTH = 256;

/** Binding list of a transition with several bindings, next to the transition in the domain view. */
export function DomainBindingPicker({
  transitionId,
  anchor,
}: {
  transitionId: string;
  anchor: AnchorRect;
}) {
  const result = useEditorStore((s) => s.enabled.get(transitionId));
  const fireBindingAt = useEditorStore((s) => s.fireBindingAt);
  const setPicker = useEditorStore((s) => s.setPicker);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>('button')?.focus();
  }, []);

  useLayoutEffect(() => {
    const height = root.current?.getBoundingClientRect().height ?? 0;
    const left = Math.min(
      Math.max(MARGIN, (anchor.left + anchor.right) / 2 - WIDTH / 2),
      Math.max(MARGIN, window.innerWidth - WIDTH - MARGIN),
    );
    const below = anchor.bottom + 8;
    const top =
      below + height + MARGIN <= window.innerHeight
        ? below
        : Math.max(MARGIN, anchor.top - 8 - height);
    setPosition({ left, top });
  }, [anchor, result]);

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

  return createPortal(
    <div
      ref={root}
      role="dialog"
      aria-label={en.domain.pickBinding}
      className="fixed z-[70] rounded-lg border border-border bg-surface p-1 shadow-panel"
      style={{
        width: WIDTH,
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        visibility: position ? 'visible' : 'hidden',
      }}
      data-testid="domain-binding-picker"
    >
      <div className="px-2 pt-1 pb-1 text-[11px] font-medium tracking-wide text-muted uppercase">
        {en.domain.pickBinding}
      </div>
      <ul
        ref={list}
        aria-label={en.domain.pickBinding}
        onKeyDown={onKeyDown}
        className="m-0 max-h-60 list-none overflow-y-auto p-0"
      >
        {result.bindings.map((entry, index) => {
          const names = Object.keys(entry.binding);
          return (
            <li key={index}>
              <button
                type="button"
                onClick={() => {
                  fireBindingAt(transitionId, index);
                }}
                className="flex w-full flex-col rounded-md px-2 py-1 text-left font-mono text-[11px] leading-4 hover:bg-ok-soft focus-visible:bg-ok-soft"
                data-testid="domain-binding-option"
              >
                {names.length === 0 ? (
                  <span className="text-muted">{en.domain.noVariables}</span>
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
    </div>,
    document.body,
  );
}
