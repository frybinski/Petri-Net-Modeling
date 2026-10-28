import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { en } from '../../i18n/en';
import { formatOrigin, type DomainCardModel } from '../../lib/domain-hover';
import type { AnchorRect } from '../canvas/hover-card';

const GAP = 10;
const MARGIN = 8;

const KIND_LABEL = {
  place: en.elements.place,
  transition: en.elements.transition,
  arc: en.elements.arc,
} as const;

/** Card with the name, id, picture kind, role, tokens and origin of an element of the domain view. */
export function DomainHoverCard({ model, anchor }: { model: DomainCardModel; anchor: AnchorRect }) {
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
      data-testid="domain-hover-card"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-fg">{model.name || '—'}</span>
        <span className="text-[11px] font-medium tracking-wide text-muted uppercase">
          {KIND_LABEL[model.kind]}
        </span>
      </div>
      <dl className="m-0 mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        <dt className="text-muted">{en.domain.netId}</dt>
        <dd className="m-0 font-mono text-[11px] text-fg">{model.id}</dd>
        <dt className="text-muted">{en.domain.shownAs}</dt>
        <dd className="m-0 font-medium text-fg">{model.shownAs ?? en.domain.notDrawn}</dd>
        {model.role !== undefined ? (
          <>
            <dt className="text-muted">{en.domain.role}</dt>
            <dd className="m-0 font-medium text-fg">{model.role}</dd>
          </>
        ) : null}
        {model.tokens !== undefined ? (
          <>
            <dt className="text-muted">{en.domain.tokens}</dt>
            <dd className="m-0 font-medium text-fg" data-testid="domain-card-tokens">
              {model.tokens}
            </dd>
          </>
        ) : null}
        {model.running !== undefined ? (
          <>
            <dt className="text-muted">{en.domain.runningLabel}</dt>
            <dd className="m-0 font-medium text-fg">{model.running}</dd>
          </>
        ) : null}
        {model.sensor !== undefined ? (
          <>
            <dt className="text-muted">{en.domain.sensor}</dt>
            <dd className="m-0 font-medium text-fg">{model.sensor}</dd>
          </>
        ) : null}
        {model.origin ? (
          <>
            <dt className="text-muted">{en.domain.origin1}</dt>
            <dd className="m-0 font-medium text-fg">{formatOrigin(model.origin)}</dd>
          </>
        ) : null}
      </dl>
    </div>,
    document.body,
  );
}
