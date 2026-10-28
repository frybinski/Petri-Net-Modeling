import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  ArrowLeftRight,
  Trash2,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { en } from '../i18n/en';
import { nameOf } from '../lib/flow-model';
import { useEditorStore } from '../store/editor-store';
import { Button, IconButton } from './ui/button';
import { NumberField, TextField } from './ui/fields';
import type { AlignMode, DistributeAxis } from '@pnm/core';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <h3 className="m-0 text-[11px] font-semibold tracking-wide text-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}

export function PropertiesPanel() {
  const selection = useEditorStore((s) => s.selection);
  const net = useEditorStore((s) => s.net);

  let body: ReactNode;
  if (selection.length === 0) body = <NetProperties />;
  else if (selection.length === 1 && selection[0] !== undefined) {
    const id = selection[0];
    if (net.places.some((p) => p.id === id)) body = <PlaceProperties id={id} />;
    else if (net.transitions.some((t) => t.id === id)) body = <TransitionProperties id={id} />;
    else if (net.arcs.some((a) => a.id === id)) body = <ArcProperties id={id} />;
    else if (net.annotations?.some((a) => a.id === id)) body = <AnnotationProperties id={id} />;
    else body = <NetProperties />;
  } else body = <MultiProperties />;

  return (
    <aside
      aria-label={en.properties.title}
      className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-border bg-surface max-md:hidden"
      data-testid="properties-panel"
    >
      {body}
    </aside>
  );
}

function NetProperties() {
  const net = useEditorStore((s) => s.net);
  const renameNet = useEditorStore((s) => s.renameNet);
  return (
    <>
      <Section title={en.properties.net}>
        <TextField label={en.properties.name} value={net.name} onCommit={renameNet} />
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted">{en.properties.profile}</span>
          <span className="text-sm">{en.properties.profilePt}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted">{en.properties.counts}</span>
          <span className="text-sm" data-testid="net-counts">
            {en.properties.countsValue(net.places.length, net.transitions.length, net.arcs.length)}
          </span>
        </div>
      </Section>
      <Section title={en.properties.nothingSelected}>
        <p className="m-0 text-sm text-muted">{en.properties.nothingSelectedHint}</p>
      </Section>
    </>
  );
}

function DeleteButton({ label = en.properties.delete }: { label?: string }) {
  const removeSelected = useEditorStore((s) => s.removeSelected);
  const locked = useEditorStore((s) => s.mode === 'simulate');
  return (
    <Button
      variant="danger"
      icon={<Trash2 size={14} aria-hidden="true" />}
      onClick={removeSelected}
      disabled={locked}
      data-testid="delete-selection"
    >
      {label}
    </Button>
  );
}

function PlaceProperties({ id }: { id: string }) {
  const place = useEditorStore((s) => s.net.places.find((p) => p.id === id));
  const tokens = useEditorStore((s) => s.net.marking[id]?.length ?? 0);
  const locked = useEditorStore((s) => s.mode === 'simulate');
  const updatePlace = useEditorStore((s) => s.updatePlace);
  const setTokens = useEditorStore((s) => s.setTokens);
  if (!place) return null;
  return (
    <Section title={en.elements.place}>
      <TextField
        label={en.properties.name}
        value={place.name}
        onCommit={(name) => {
          updatePlace(id, { name });
        }}
        disabled={locked}
        data-testid="prop-name"
      />
      <NumberField
        label={en.properties.initialTokens}
        value={tokens}
        min={0}
        max={place.capacity}
        disabled={locked}
        onCommit={(n) => {
          setTokens(id, n ?? 0);
        }}
        data-testid="prop-tokens"
      />
      <NumberField
        label={en.properties.capacity}
        value={place.capacity}
        min={1}
        allowEmpty
        placeholder={en.properties.unbounded}
        hint={en.properties.capacityHint}
        disabled={locked}
        onCommit={(capacity) => {
          updatePlace(id, { capacity });
        }}
        data-testid="prop-capacity"
      />
      {locked ? <p className="m-0 text-xs text-muted">{en.properties.lockedHint}</p> : null}
      <DeleteButton />
    </Section>
  );
}

function TransitionProperties({ id }: { id: string }) {
  const transition = useEditorStore((s) => s.net.transitions.find((t) => t.id === id));
  const locked = useEditorStore((s) => s.mode === 'simulate');
  const updateTransition = useEditorStore((s) => s.updateTransition);
  if (!transition) return null;
  return (
    <Section title={en.elements.transition}>
      <TextField
        label={en.properties.name}
        value={transition.name}
        onCommit={(name) => {
          updateTransition(id, { name });
        }}
        disabled={locked}
        data-testid="prop-name"
      />
      {locked ? <p className="m-0 text-xs text-muted">{en.properties.lockedHint}</p> : null}
      <DeleteButton />
    </Section>
  );
}

function ArcProperties({ id }: { id: string }) {
  const arc = useEditorStore((s) => s.net.arcs.find((a) => a.id === id));
  const net = useEditorStore((s) => s.net);
  const locked = useEditorStore((s) => s.mode === 'simulate');
  const updateArc = useEditorStore((s) => s.updateArc);
  const reverseArc = useEditorStore((s) => s.reverseArc);
  if (!arc) return null;
  return (
    <Section title={en.elements.arc}>
      <div className="flex items-center gap-2 text-sm">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-muted">{en.properties.from}</div>
          <div className="truncate">{nameOf(net, arc.source)}</div>
        </div>
        <IconButton
          label={en.properties.reverse}
          disabled={locked}
          onClick={() => {
            reverseArc(id);
          }}
          data-testid="reverse-arc"
        >
          <ArrowLeftRight size={16} aria-hidden="true" />
        </IconButton>
        <div className="min-w-0 flex-1 text-right">
          <div className="text-xs font-medium text-muted">{en.properties.to}</div>
          <div className="truncate">{nameOf(net, arc.target)}</div>
        </div>
      </div>
      <NumberField
        label={en.properties.weight}
        value={arc.weight}
        min={1}
        hint={en.properties.weightHint}
        disabled={locked}
        onCommit={(weight) => {
          if (weight !== undefined) updateArc(id, { weight });
        }}
        data-testid="prop-weight"
      />
      {locked ? <p className="m-0 text-xs text-muted">{en.properties.lockedHint}</p> : null}
      <DeleteButton />
    </Section>
  );
}

function AnnotationProperties({ id }: { id: string }) {
  const note = useEditorStore((s) => s.net.annotations?.find((a) => a.id === id));
  const locked = useEditorStore((s) => s.mode === 'simulate');
  const updateAnnotation = useEditorStore((s) => s.updateAnnotation);
  if (!note) return null;
  return (
    <Section title={en.elements.annotation}>
      <TextField
        label={en.properties.text}
        value={note.text}
        multiline
        disabled={locked}
        onCommit={(text) => {
          updateAnnotation(id, { text });
        }}
        data-testid="prop-text"
      />
      <DeleteButton />
    </Section>
  );
}

const ALIGN: Array<{ mode: AlignMode; label: string; icon: ReactNode }> = [
  { mode: 'left', label: en.properties.alignLeft, icon: <AlignStartVertical size={16} /> },
  { mode: 'center', label: en.properties.alignCenter, icon: <AlignCenterVertical size={16} /> },
  { mode: 'right', label: en.properties.alignRight, icon: <AlignEndVertical size={16} /> },
  { mode: 'top', label: en.properties.alignTop, icon: <AlignStartHorizontal size={16} /> },
  { mode: 'middle', label: en.properties.alignMiddle, icon: <AlignCenterHorizontal size={16} /> },
  { mode: 'bottom', label: en.properties.alignBottom, icon: <AlignEndHorizontal size={16} /> },
];

const DISTRIBUTE: Array<{ axis: DistributeAxis; label: string; icon: ReactNode }> = [
  {
    axis: 'horizontal',
    label: en.properties.distributeH,
    icon: <AlignHorizontalSpaceAround size={16} />,
  },
  {
    axis: 'vertical',
    label: en.properties.distributeV,
    icon: <AlignVerticalSpaceAround size={16} />,
  },
];

function MultiProperties() {
  const count = useEditorStore((s) => s.selection.length);
  const locked = useEditorStore((s) => s.mode === 'simulate');
  const align = useEditorStore((s) => s.align);
  const distribute = useEditorStore((s) => s.distribute);
  return (
    <>
      <Section title={en.properties.multi(count)}>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">{en.properties.align}</span>
          <div className="flex flex-wrap gap-1" role="group" aria-label={en.properties.align}>
            {ALIGN.map((item) => (
              <IconButton
                key={item.mode}
                label={item.label}
                disabled={locked}
                onClick={() => {
                  align(item.mode);
                }}
                className="border border-border"
              >
                <span aria-hidden="true">{item.icon}</span>
              </IconButton>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">{en.properties.distribute}</span>
          <div className="flex gap-1" role="group" aria-label={en.properties.distribute}>
            {DISTRIBUTE.map((item) => (
              <IconButton
                key={item.axis}
                label={item.label}
                disabled={locked || count < 3}
                onClick={() => {
                  distribute(item.axis);
                }}
                className="border border-border"
              >
                <span aria-hidden="true">{item.icon}</span>
              </IconButton>
            ))}
          </div>
        </div>
        <DeleteButton label={en.properties.deleteSelection} />
      </Section>
    </>
  );
}
