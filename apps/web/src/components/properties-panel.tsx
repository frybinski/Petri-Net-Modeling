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
import { deleteSelection } from '../lib/delete';
import { nameOf } from '../lib/flow-model';
import { useEditorStore } from '../store/editor-store';
import { IconButton } from './ui/button';
import { NumberField, SelectField, TextField } from './ui/fields';
import { TokensSection } from './tokens/tokens-section';
import { TypesSection } from './types/types-section';
import { useUiStore } from '../store/ui-store';
import { IndicatorsSection } from './indicators/indicators-section';
import { InscriptionField } from './inscription-field';
import { arcDirection, boundVariables } from '../lib/inscriptions';
import {
  computedPlaceRole,
  isSourceTransition,
  type AlignMode,
  type DistributeAxis,
  type PlaceRole,
  type Profile,
  type Timing,
} from '@pnm/core';
import { timingOfKind } from '../lib/sim-format';

function Section({
  title,
  actions,
  children,
}: {
  title: string;
  /** Icon buttons right of the heading. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <div className="-my-1 flex min-h-7 items-center justify-between gap-2">
        <h3 className="m-0 text-[11px] font-semibold tracking-wide text-muted uppercase">
          {title}
        </h3>
        {actions}
      </div>
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
    else if (net.transitions.some((t) => t.id === id)) {
      body = (
        <>
          <TransitionProperties id={id} />
          <TimingSection id={id} />
        </>
      );
    } else if (net.arcs.some((a) => a.id === id)) body = <ArcProperties id={id} />;
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
        <ProfileSwitch />
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted">{en.properties.counts}</span>
          <span className="text-sm" data-testid="net-counts">
            {en.properties.countsValue(net.places.length, net.transitions.length, net.arcs.length)}
          </span>
        </div>
      </Section>
      {net.profile === 'json-net' ? (
        <Section title={en.types.title}>
          <TypesSection />
        </Section>
      ) : null}
      <SimulationSettingsSection />
      <Section title={en.indicators.title}>
        <IndicatorsSection />
      </Section>
      <Section title={en.properties.nothingSelected}>
        <p className="m-0 text-sm text-muted">{en.properties.nothingSelectedHint}</p>
      </Section>
    </>
  );
}

/** Seed, warm-up, start time and case id prefix, stored with the net. */
function SimulationSettingsSection() {
  const settings = useEditorStore((s) => s.net.simulation);
  const update = useEditorStore((s) => s.updateSimulationSettings);
  return (
    <Section title={en.timing.simulation}>
      <NumberField
        label={en.timing.seed}
        value={settings?.seed}
        min={0}
        allowEmpty
        placeholder="1"
        hint={en.timing.seedHint}
        onCommit={(seed) => {
          update({ seed });
        }}
        data-testid="prop-seed"
      />
      <NumberField
        label={en.timing.warmup}
        value={settings?.warmup}
        min={0}
        decimals={1}
        allowEmpty
        placeholder="0"
        hint={en.timing.warmupHint}
        onCommit={(warmup) => {
          update({ warmup });
        }}
        data-testid="prop-warmup"
      />
      <TextField
        label={en.timing.startTime}
        value={settings?.startTime ?? ''}
        placeholder="2026-01-05T08:00:00Z"
        onCommit={(startTime) => {
          update({ startTime: startTime.trim() === '' ? undefined : startTime.trim() });
        }}
        data-testid="prop-start-time"
      />
      <TextField
        label={en.timing.caseIdPrefix}
        value={settings?.caseIdPrefix ?? ''}
        placeholder="C-"
        onCommit={(prefix) => {
          update({ caseIdPrefix: prefix === '' ? undefined : prefix });
        }}
        data-testid="prop-case-prefix"
      />
    </Section>
  );
}

const PROFILES: Array<{ profile: Profile; label: string; testId: string }> = [
  { profile: 'pt-net', label: en.properties.profilePt, testId: 'profile-pt' },
  { profile: 'json-net', label: en.properties.profileJson, testId: 'profile-json' },
];

/** Switch between the two net classes. Switching is an undoable edit and loses no data. */
function ProfileSwitch() {
  const profile = useEditorStore((s) => s.net.profile);
  const hasHigherFields = useEditorStore(
    (s) =>
      Object.keys(s.net.types).length > 0 ||
      s.net.places.some((p) => p.type !== undefined) ||
      s.net.transitions.some((t) => t.guard !== undefined) ||
      s.net.arcs.some((a) => a.inscription !== undefined),
  );
  const locked = useEditorStore((s) => s.mode === 'simulate');
  const setProfile = useEditorStore((s) => s.setProfile);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted" id="profile-label">
        {en.properties.profile}
      </span>
      <div
        role="group"
        aria-labelledby="profile-label"
        className="flex rounded-md border border-border-strong p-0.5"
      >
        {PROFILES.map((item) => (
          <button
            key={item.profile}
            type="button"
            aria-pressed={profile === item.profile}
            disabled={locked}
            onClick={() => {
              setProfile(item.profile);
            }}
            data-testid={item.testId}
            className="inline-flex h-7 flex-1 items-center justify-center rounded px-2 text-xs font-medium text-muted transition-colors hover:text-fg disabled:cursor-not-allowed disabled:opacity-50 aria-pressed:bg-accent aria-pressed:text-accent-contrast"
          >
            {item.label}
          </button>
        ))}
      </div>
      <p className="m-0 text-[11px] text-muted">
        {profile === 'pt-net' ? en.properties.profilePtHint : en.properties.profileJsonHint}
      </p>
      {profile === 'pt-net' && hasHigherFields ? (
        <p className="m-0 text-[11px] text-warn" data-testid="profile-ignored-note">
          {en.properties.profileIgnoredNote}
        </p>
      ) : null}
    </div>
  );
}

/** Trash icon in the heading of a section. Deleting is also on the Del key and in the context menu. */
function DeleteAction({ label = en.properties.deleteTip }: { label?: string }) {
  const locked = useEditorStore((s) => s.mode === 'simulate');
  return (
    <IconButton
      label={label}
      shortcut="Del"
      size="sm"
      disabled={locked}
      onClick={deleteSelection}
      className="text-muted hover:bg-danger-soft hover:text-danger"
      data-testid="delete-selection"
    >
      <Trash2 size={15} aria-hidden="true" />
    </IconButton>
  );
}

function PlaceProperties({ id }: { id: string }) {
  const place = useEditorStore((s) => s.net.places.find((p) => p.id === id));
  const tokens = useEditorStore((s) => s.net.marking[id]?.length ?? 0);
  const locked = useEditorStore((s) => s.mode === 'simulate');
  const higher = useEditorStore((s) => s.net.profile === 'json-net');
  const updatePlace = useEditorStore((s) => s.updatePlace);
  const setTokens = useEditorStore((s) => s.setTokens);
  if (!place) return null;
  return (
    <Section title={en.elements.place} actions={<DeleteAction />}>
      <TextField
        label={en.properties.name}
        value={place.name}
        onCommit={(name) => {
          updatePlace(id, { name });
        }}
        disabled={locked}
        data-testid="prop-name"
      />
      {higher ? <PlaceTypeField placeId={id} /> : null}
      {higher ? (
        <TokensSection placeId={id} />
      ) : (
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
      )}
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
      <PlaceRoleField placeId={id} />
      {locked ? <p className="m-0 text-xs text-muted">{en.properties.lockedHint}</p> : null}
    </Section>
  );
}

/**
 * The role of a place in the timed simulation: computed from the arcs; resource or case can be
 * forced, and so can quantity (tokens that count an amount and belong to no case), which is the
 * only choice for a place that is a source or a sink by its arcs.
 */
function PlaceRoleField({ placeId }: { placeId: string }) {
  const net = useEditorStore((s) => s.net);
  const role = useEditorStore((s) => s.net.places.find((p) => p.id === placeId)?.role);
  const locked = useEditorStore((s) => s.mode === 'simulate');
  const updatePlace = useEditorStore((s) => s.updatePlace);
  const computed: PlaceRole = computedPlaceRole(net, placeId);
  const structural = computed === 'source' || computed === 'sink';
  const options = structural
    ? [
        { value: '', label: en.timing.roleAuto(en.timing.roles[computed]) },
        { value: 'quantity', label: en.timing.roles.quantity },
      ]
    : [
        { value: '', label: en.timing.roleAuto(en.timing.roles[computed]) },
        { value: 'resource', label: en.timing.roles.resource },
        { value: 'case', label: en.timing.roles.case },
        { value: 'quantity', label: en.timing.roles.quantity },
      ];
  return (
    <>
      {structural && role !== 'quantity' ? (
        <div className="flex flex-col gap-1" data-testid="prop-role-fixed">
          <span className="text-xs font-medium text-muted">{en.timing.role}</span>
          <span className="text-sm">{en.timing.roles[computed]}</span>
          <p className="m-0 text-[11px] text-muted">{en.timing.roleFixed}</p>
        </div>
      ) : null}
      <SelectField
        label={structural && role !== 'quantity' ? en.timing.roleOrQuantity : en.timing.role}
        value={role ?? ''}
        options={options}
        disabled={locked}
        hint={
          role === 'quantity'
            ? en.timing.roleQuantityHint
            : structural
              ? en.timing.roleQuantityOffer
              : en.timing.roleHint
        }
        onChange={(value) => {
          updatePlace(placeId, {
            role: value === '' ? undefined : (value as 'resource' | 'case' | 'quantity'),
          });
        }}
        data-testid={structural ? 'prop-role-quantity' : 'prop-role'}
      />
    </>
  );
}

function PlaceTypeField({ placeId }: { placeId: string }) {
  const type = useEditorStore((s) => s.net.places.find((p) => p.id === placeId)?.type);
  const types = useEditorStore((s) => s.net.types);
  const locked = useEditorStore((s) => s.mode === 'simulate');
  const setPlaceType = useEditorStore((s) => s.setPlaceType);
  const openTypeDialog = useUiStore((s) => s.openTypeDialog);
  const known = type !== undefined && Object.hasOwn(types, type);
  const options = [
    { value: '', label: en.types.untyped },
    ...Object.keys(types).map((name) => ({ value: name, label: name })),
    ...(type !== undefined && !known ? [{ value: type, label: en.types.unknownType(type) }] : []),
  ];
  return (
    <div className="flex flex-col gap-1" id="place-type-section">
      <SelectField
        label={en.types.placeType}
        value={type ?? ''}
        options={options}
        disabled={locked}
        onChange={(value) => {
          setPlaceType(placeId, value === '' ? undefined : value);
        }}
        data-testid="prop-type"
      />
      {known ? (
        <button
          type="button"
          onClick={() => {
            openTypeDialog(type);
          }}
          className="self-start text-xs font-medium text-accent hover:underline"
          data-testid="edit-type-link"
        >
          {en.types.edit}
        </button>
      ) : null}
    </div>
  );
}

function TransitionProperties({ id }: { id: string }) {
  const transition = useEditorStore((s) => s.net.transitions.find((t) => t.id === id));
  const net = useEditorStore((s) => s.net);
  const locked = useEditorStore((s) => s.mode === 'simulate');
  const updateTransition = useEditorStore((s) => s.updateTransition);
  if (!transition) return null;
  const higher = net.profile === 'json-net';
  const bound = higher ? boundVariables(net, id) : [];
  return (
    <Section title={en.elements.transition} actions={<DeleteAction />}>
      <TextField
        label={en.properties.name}
        value={transition.name}
        onCommit={(name) => {
          updateTransition(id, { name });
        }}
        disabled={locked}
        data-testid="prop-name"
      />
      {higher ? (
        <>
          <InscriptionField
            label={en.inscriptions.guard}
            kind="guard"
            value={transition.guard ?? ''}
            bound={bound.map((v) => v.name)}
            placeholder={en.inscriptions.guardPlaceholder}
            hint={en.inscriptions.guardHint}
            disabled={locked}
            onCommit={(guard) => {
              updateTransition(id, { guard: guard.trim() === '' ? undefined : guard });
            }}
            data-testid="prop-guard"
          />
          <BoundVariables variables={bound} />
        </>
      ) : null}
      {locked ? <p className="m-0 text-xs text-muted">{en.properties.lockedHint}</p> : null}
    </Section>
  );
}

const TIMING_KINDS: Array<{ value: Timing['kind'] | ''; label: string }> = [
  { value: '', label: en.timing.none },
  { value: 'fixed', label: en.timing.fixed },
  { value: 'uniform', label: en.timing.uniform },
  { value: 'exponential', label: en.timing.exponential },
];

/** Duration, priority and, for transitions without input places, the arrival rate. */
function TimingSection({ id }: { id: string }) {
  const transition = useEditorStore((s) => s.net.transitions.find((t) => t.id === id));
  const source = useEditorStore((s) => isSourceTransition(s.net, id));
  const locked = useEditorStore((s) => s.mode === 'simulate');
  const updateTransition = useEditorStore((s) => s.updateTransition);
  if (!transition) return null;
  const timing = transition.timing;
  const setTiming = (next: Timing | undefined): void => {
    updateTransition(id, { timing: next });
  };
  return (
    <Section title={en.timing.title}>
      <SelectField
        label={en.timing.duration}
        value={timing?.kind ?? ''}
        options={TIMING_KINDS}
        disabled={locked}
        hint={en.timing.durationHint}
        onChange={(kind) => {
          setTiming(kind === '' ? undefined : timingOfKind(kind as Timing['kind'], timing));
        }}
        data-testid="prop-timing-kind"
      />
      {timing?.kind === 'fixed' ? (
        <NumberField
          label={en.timing.fixedValue}
          value={timing.value}
          min={0}
          decimals={2}
          disabled={locked}
          onCommit={(value) => {
            setTiming({ kind: 'fixed', value: value ?? 0 });
          }}
          data-testid="prop-timing-value"
        />
      ) : null}
      {timing?.kind === 'uniform' ? (
        <>
          <NumberField
            label={en.timing.min}
            value={timing.min}
            min={0}
            decimals={2}
            disabled={locked}
            onCommit={(min) => {
              const low = min ?? 0;
              setTiming({ kind: 'uniform', min: low, max: Math.max(low, timing.max) });
            }}
            data-testid="prop-timing-min"
          />
          <NumberField
            label={en.timing.max}
            value={timing.max}
            min={0}
            decimals={2}
            disabled={locked}
            onCommit={(max) => {
              const high = max ?? 0;
              setTiming({ kind: 'uniform', min: Math.min(timing.min, high), max: high });
            }}
            data-testid="prop-timing-max"
          />
        </>
      ) : null}
      {timing?.kind === 'exponential' ? (
        <NumberField
          label={en.timing.mean}
          value={timing.mean}
          min={0.01}
          decimals={2}
          disabled={locked}
          onCommit={(mean) => {
            setTiming({ kind: 'exponential', mean: mean ?? 1 });
          }}
          data-testid="prop-timing-mean"
        />
      ) : null}
      <NumberField
        label={en.timing.priority}
        value={transition.priority}
        min={0.01}
        decimals={2}
        allowEmpty
        placeholder="1"
        hint={en.timing.priorityHint}
        disabled={locked}
        onCommit={(priority) => {
          updateTransition(id, { priority });
        }}
        data-testid="prop-priority"
      />
      {source ? (
        <NumberField
          label={en.timing.rate}
          value={transition.rate}
          min={0}
          decimals={1}
          allowEmpty
          hint={en.timing.rateHint}
          disabled={locked}
          onCommit={(rate) => {
            updateTransition(id, { rate });
          }}
          data-testid="prop-rate"
        />
      ) : null}
    </Section>
  );
}

function BoundVariables({ variables }: { variables: ReturnType<typeof boundVariables> }) {
  return (
    <div className="flex flex-col gap-1" data-testid="bound-variables">
      <span className="text-xs font-medium text-muted">{en.inscriptions.boundVariables}</span>
      {variables.length === 0 ? (
        <p className="m-0 text-[11px] text-muted">{en.inscriptions.noBoundVariables}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {variables.map((v) => (
            <li key={v.name} className="flex items-baseline gap-2 text-xs">
              <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono font-semibold text-accent">
                ${v.name}
              </code>
              <span className="truncate text-muted" title={v.placeName}>
                {v.placeName}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ArcProperties({ id }: { id: string }) {
  const arc = useEditorStore((s) => s.net.arcs.find((a) => a.id === id));
  const net = useEditorStore((s) => s.net);
  const locked = useEditorStore((s) => s.mode === 'simulate');
  const updateArc = useEditorStore((s) => s.updateArc);
  const reverseArc = useEditorStore((s) => s.reverseArc);
  if (!arc) return null;
  const direction = net.profile === 'json-net' ? arcDirection(net, id) : null;
  const hasInscription = (arc.inscription ?? '').trim() !== '';
  const transitionId = direction === 'input' ? arc.target : arc.source;
  const bound = direction === 'output' ? boundVariables(net, transitionId).map((v) => v.name) : [];
  return (
    <Section title={en.elements.arc} actions={<DeleteAction />}>
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
      {direction ? (
        <InscriptionField
          label={en.inscriptions.inscription}
          kind={direction}
          value={arc.inscription ?? ''}
          bound={bound}
          placeholder={
            direction === 'input'
              ? en.inscriptions.inputPlaceholder
              : en.inscriptions.outputPlaceholder
          }
          hint={direction === 'input' ? en.inscriptions.inputHint : en.inscriptions.outputHint}
          disabled={locked}
          onCommit={(inscription) => {
            updateArc(id, { inscription: inscription.trim() === '' ? undefined : inscription });
          }}
          data-testid="prop-inscription"
        />
      ) : null}
      <NumberField
        label={en.properties.weight}
        value={arc.weight}
        min={1}
        hint={hasInscription ? en.inscriptions.weightIgnored : en.properties.weightHint}
        disabled={locked}
        onCommit={(weight) => {
          if (weight !== undefined) updateArc(id, { weight });
        }}
        data-testid="prop-weight"
      />
      {locked ? <p className="m-0 text-xs text-muted">{en.properties.lockedHint}</p> : null}
    </Section>
  );
}

function AnnotationProperties({ id }: { id: string }) {
  const note = useEditorStore((s) => s.net.annotations?.find((a) => a.id === id));
  const locked = useEditorStore((s) => s.mode === 'simulate');
  const updateAnnotation = useEditorStore((s) => s.updateAnnotation);
  if (!note) return null;
  return (
    <Section title={en.elements.annotation} actions={<DeleteAction />}>
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
      <Section
        title={en.properties.multi(count)}
        actions={<DeleteAction label={en.properties.deleteSelection} />}
      >
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
      </Section>
    </>
  );
}
