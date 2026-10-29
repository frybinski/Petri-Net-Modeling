import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { en } from '../../i18n/en';
import type { HoverCardModel } from '../../lib/hover-card';

/** Screen rectangle of the node the card belongs to. */
export interface AnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const GAP = 10;
const MARGIN = 8;

/**
 * Card with everything about a node, independent of the zoom: name, type, all tokens (up to 10),
 * guard and bound variables, in simulation the number of bindings. It appears above the node, or
 * below when there is no room, and never takes the pointer.
 */
export function HoverCard({ model, anchor }: { model: HoverCardModel; anchor: AnchorRect }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    const centerX = (anchor.left + anchor.right) / 2;
    const left = Math.min(
      Math.max(MARGIN, centerX - width / 2),
      Math.max(MARGIN, window.innerWidth - width - MARGIN),
    );
    const above = anchor.top - GAP - height;
    const top =
      above >= MARGIN ? above : Math.min(anchor.bottom + GAP, window.innerHeight - height - MARGIN);
    setPosition({ left, top });
  }, [anchor, model]);

  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      className="pn-hovercard pointer-events-none fixed z-[70] w-max max-w-72 rounded-lg border border-border bg-surface p-3 text-xs shadow-panel"
      style={{
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        visibility: position ? 'visible' : 'hidden',
      }}
      data-testid="hover-card"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-fg">{model.name || '—'}</span>
        <span className="text-[11px] font-medium tracking-wide text-muted uppercase">
          {model.kind === 'place' ? en.elements.place : en.elements.transition}
        </span>
      </div>
      {model.typeName ? (
        <div className="mt-1 text-muted">
          {en.types.placeType}: <span className="font-medium text-fg">{model.typeName}</span>
        </div>
      ) : null}
      {model.kind === 'place' ? (
        <div className="mt-2">
          <div className="text-muted" data-testid="hover-tokens-count">
            {en.elements.tokens(model.tokenCount ?? 0)}
            {model.capacity !== undefined ? ` · ${en.properties.capacity} ${model.capacity}` : ''}
          </div>
          {model.created !== undefined ? (
            <div className="mt-1 font-medium text-danger" data-testid="hover-created">
              {en.replay.createdAt(model.created)}
            </div>
          ) : null}
          {model.tokens.length > 0 ? (
            <ul className="m-0 mt-1.5 flex list-none flex-col gap-1 p-0" data-testid="hover-tokens">
              {model.tokens.map((token, i) => (
                <li
                  key={`${i}:${token}`}
                  className="truncate rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-fg"
                >
                  {token}
                </li>
              ))}
              {model.moreTokens > 0 ? (
                <li className="px-1.5 text-muted">{en.tokens.more(model.moreTokens)}</li>
              ) : null}
            </ul>
          ) : null}
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-1.5">
          {model.guard ? (
            <div>
              <div className="text-muted">{en.inscriptions.guard}</div>
              <code
                className="mt-0.5 block rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] break-words whitespace-pre-wrap text-fg"
                data-testid="hover-guard"
              >
                {model.guard}
              </code>
            </div>
          ) : null}
          {model.variables.length > 0 ? (
            <div>
              <div className="text-muted">{en.inscriptions.boundVariables}</div>
              <ul className="m-0 mt-0.5 flex list-none flex-col gap-0.5 p-0">
                {model.variables.map((v) => (
                  <li key={v.name} className="flex items-baseline gap-2">
                    <code className="font-mono text-[11px] font-semibold text-accent">
                      ${v.name}
                    </code>
                    <span className="truncate text-muted">{v.place}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {model.timing || model.priority !== undefined || model.rate !== undefined ? (
            <dl
              className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5"
              data-testid="hover-timing"
            >
              {model.timing ? (
                <>
                  <dt className="text-muted">{en.timing.durationLine}</dt>
                  <dd className="m-0 font-medium text-fg">{model.timing}</dd>
                </>
              ) : null}
              {model.priority !== undefined ? (
                <>
                  <dt className="text-muted">{en.timing.priorityLine}</dt>
                  <dd className="m-0 font-medium text-fg">{model.priority}</dd>
                </>
              ) : null}
              {model.rate !== undefined ? (
                <>
                  <dt className="text-muted">{en.timing.rate}</dt>
                  <dd className="m-0 font-medium text-fg">{model.rate}</dd>
                </>
              ) : null}
            </dl>
          ) : null}
          {model.running !== undefined ? (
            <div className="text-muted" data-testid="hover-running">
              {en.simulation.running(model.running)}
            </div>
          ) : null}
          {model.bindings !== undefined ? (
            <div className="text-muted" data-testid="hover-bindings">
              {model.bindings === 0
                ? en.properties.notEnabled
                : en.simulation.bindingCount(model.bindings, false)}
            </div>
          ) : null}
        </div>
      )}
      {model.errors.length > 0 ? (
        <ul className="m-0 mt-2 flex list-none flex-col gap-0.5 p-0 text-danger">
          {model.errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}
    </div>,
    document.body,
  );
}
