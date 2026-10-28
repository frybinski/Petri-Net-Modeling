import { placeRoles, tokenLabel, type Binding, type Id, type PetriNet } from '@pnm/core';
import { Minus, Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { en } from '../../i18n/en';
import { nameOf } from '../../lib/flow-model';
import { useDiagnostics } from '../../lib/use-diagnostics';
import { useEditorStore, type SimStep } from '../../store/editor-store';
import { IconButton } from '../ui/button';
import { Tooltip } from '../ui/tooltip';
import { PanelSection, SectionTitle } from './section';

const MAX_MARKING_CHIPS = 6;

/** Short one-line form of a binding: `$o = {id:"A-1",…}, $c = …`. */
function bindingSummary(binding: Binding, max = 18): string {
  return Object.entries(binding)
    .map(([name, value]) => `$${name} = ${tokenLabel(value, max)}`)
    .join(', ');
}

/** The source transitions that have an arrival rate in the net, with that rate. */
function arrivalSources(net: PetriNet): Array<{ id: Id; name: string; base: number }> {
  const placeIds = new Set(net.places.map((p) => p.id));
  return net.transitions
    .filter(
      (t) =>
        (t.rate ?? 0) > 0 && !net.arcs.some((a) => a.target === t.id && placeIds.has(a.source)),
    )
    .map((t) => ({ id: t.id, name: t.name, base: t.rate! }));
}

function Summary() {
  const computing = useEditorStore((s) => s.computing);
  const enabledCount = useEditorStore((s) => s.enabled.size);
  const timed = useEditorStore((s) => s.simTimed);
  const running = useEditorStore((s) => s.simRunning.length);
  const nextEvent = useEditorStore((s) => s.simNextEvent);
  const waiting = timed && enabledCount === 0 && (running > 0 || nextEvent !== null);
  return (
    <p
      className={`m-0 rounded-md px-2.5 py-1.5 text-sm font-medium ${
        computing || waiting
          ? 'bg-surface-2 text-muted'
          : enabledCount === 0
            ? 'bg-danger-soft text-danger'
            : 'bg-ok-soft text-ok'
      }`}
      data-testid="enabled-summary"
      aria-live="polite"
    >
      {computing
        ? en.simulation.computing
        : waiting
          ? en.simulation.waiting(running)
          : enabledCount === 0
            ? en.simulation.deadlock
            : en.simulation.enabledCount(enabledCount)}
    </p>
  );
}

function EnabledList() {
  const net = useEditorStore((s) => s.net);
  const enabled = useEditorStore((s) => s.enabled);
  const fire = useEditorStore((s) => s.fireTransition);
  const json = net.profile === 'json-net';
  if (enabled.size === 0) return null;
  return (
    <PanelSection title={en.simulation.enabled}>
      <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="sim-enabled">
        {[...enabled].map(([id, result]) => {
          const count = result.bindings.length;
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => {
                  fire(id);
                }}
                className="flex w-full items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5 text-left text-sm hover:border-ok hover:bg-ok-soft"
                data-testid="sim-enabled-item"
              >
                <span className="truncate">{nameOf(net, id)}</span>
                <span className="shrink-0 text-xs text-ok">
                  {(json && count > 1) || result.truncated
                    ? en.simulation.bindingCount(count, result.truncated)
                    : en.simulation.fire}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </PanelSection>
  );
}

/** One slider per source transition with a rate: from off to twice the rate of the net. */
function Arrivals() {
  const net = useEditorStore((s) => s.net);
  const rates = useEditorStore((s) => s.simRates);
  const setRate = useEditorStore((s) => s.setArrivalRate);
  const sources = useMemo(() => arrivalSources(net), [net]);
  if (sources.length === 0) return null;
  return (
    <PanelSection title={en.simulation.arrivals} hint={en.simulation.arrivalHint}>
      <ul className="m-0 flex list-none flex-col gap-3 p-0" data-testid="sim-arrivals">
        {sources.map(({ id, name, base }) => {
          const rate = rates[id] ?? 0;
          return (
            <li key={id} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate">{name}</span>
                <span className="shrink-0 tabular-nums text-muted" data-testid="arrival-value">
                  {rate > 0 ? en.simulation.arrivalRate(rate) : en.simulation.arrivalOff}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={base * 2}
                step={Math.max(1, Math.round(base / 50))}
                value={Math.min(rate, base * 2)}
                aria-label={en.simulation.arrivalSlider(name)}
                onChange={(event) => {
                  setRate(id, Number(event.target.value));
                }}
                className="w-full accent-[var(--accent)]"
                data-testid="arrival-slider"
              />
            </li>
          );
        })}
      </ul>
    </PanelSection>
  );
}

/** Free tokens of the resource places (workers, machines, rooms) with plus and minus. */
function Resources() {
  const net = useEditorStore((s) => s.net);
  const marking = useEditorStore((s) => s.simMarking);
  const metrics = useEditorStore((s) => s.simMetrics);
  const adjust = useEditorStore((s) => s.adjustPlaceTokens);
  const resources = useMemo(() => {
    const roles = placeRoles(net);
    return net.places.filter((p) => roles.get(p.id) === 'resource');
  }, [net]);
  if (resources.length === 0) return null;
  return (
    <PanelSection title={en.simulation.resources} hint={en.simulation.resourcesHint}>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0" data-testid="sim-resources">
        {resources.map((place) => {
          const free = marking?.[place.id]?.length ?? 0;
          const busy = metrics?.resources.find((r) => r.placeId === place.id)?.inUse ?? 0;
          return (
            <li key={place.id} className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm">{place.name}</span>
                <span className="text-[11px] text-muted tabular-nums" data-testid="resource-state">
                  {en.simulation.resourceState(free, busy)}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <IconButton
                  size="sm"
                  label={en.simulation.removeResource(place.name)}
                  disabled={free === 0}
                  onClick={() => {
                    adjust(place.id, -1);
                  }}
                  className="border border-border"
                  data-testid="resource-minus"
                >
                  <Minus size={14} aria-hidden="true" />
                </IconButton>
                <IconButton
                  size="sm"
                  label={en.simulation.addResource(place.name)}
                  onClick={() => {
                    adjust(place.id, 1);
                  }}
                  className="border border-border"
                  data-testid="resource-plus"
                >
                  <Plus size={14} aria-hidden="true" />
                </IconButton>
              </div>
            </li>
          );
        })}
      </ul>
    </PanelSection>
  );
}

function Breakpoints() {
  const net = useEditorStore((s) => s.net);
  const breakpoints = useEditorStore((s) => s.simBreakpoints);
  const toggle = useEditorStore((s) => s.toggleTransitionBreakpoint);
  const setPlaceBreakpoint = useEditorStore((s) => s.setPlaceBreakpoint);
  const [placeId, setPlaceId] = useState('');
  const [count, setCount] = useState('5');
  const places = useMemo(() => {
    const roles = placeRoles(net);
    return net.places.filter((p) => roles.get(p.id) !== 'resource');
  }, [net]);
  const chosen = placeId !== '' ? placeId : (places[0]?.id ?? '');
  const parsed = Number(count);
  const valid = Number.isInteger(parsed) && parsed >= 1;
  const entries = [
    ...breakpoints.transitions.map((id) => ({
      key: `t:${id}`,
      label: nameOf(net, id),
      remove: () => {
        toggle(id);
      },
    })),
    ...Object.entries(breakpoints.places).map(([id, n]) => ({
      key: `p:${id}`,
      label: `${nameOf(net, id)} ≥ ${n}`,
      remove: () => {
        setPlaceBreakpoint(id, null);
      },
    })),
  ];
  return (
    <PanelSection title={en.simulation.breakpoints} hint={en.simulation.breakpointsHint}>
      {entries.length > 0 ? (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" data-testid="sim-breakpoints">
          {entries.map((entry) => (
            <li
              key={entry.key}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 py-0.5 pr-1 pl-2.5 text-xs"
            >
              <span className="truncate">{entry.label}</span>
              <IconButton
                size="sm"
                label={`${en.simulation.removeBreakpoint}: ${entry.label}`}
                onClick={entry.remove}
                className="h-5 w-5"
              >
                <X size={12} aria-hidden="true" />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : null}
      {places.length > 0 ? (
        <div className="flex items-center gap-1.5" data-testid="place-breakpoint-form">
          <select
            aria-label={en.simulation.placeBreakpointPlace}
            value={chosen}
            onChange={(event) => {
              setPlaceId(event.target.value);
            }}
            className="h-7 min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-1.5 text-xs"
            data-testid="place-breakpoint-place"
          >
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted" aria-hidden="true">
            ≥
          </span>
          <input
            type="text"
            inputMode="numeric"
            aria-label={en.simulation.placeBreakpointCount}
            value={count}
            onChange={(event) => {
              setCount(event.target.value);
            }}
            className="h-7 w-12 rounded-md border border-border-strong bg-surface px-1.5 text-center text-xs tabular-nums"
            data-testid="place-breakpoint-count"
          />
          <Tooltip content={en.simulation.addPlaceBreakpoint}>
            <button
              type="button"
              aria-label={en.simulation.addPlaceBreakpoint}
              disabled={!valid || chosen === ''}
              onClick={() => {
                setPlaceBreakpoint(chosen, parsed);
              }}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border-strong hover:bg-surface-hover disabled:opacity-40"
              data-testid="place-breakpoint-add"
            >
              <Plus size={14} aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      ) : null}
    </PanelSection>
  );
}

function Marking() {
  const net = useEditorStore((s) => s.net);
  const marking = useEditorStore((s) => s.simMarking);
  const json = net.profile === 'json-net';
  const markedPlaces = net.places.filter((p) => (marking?.[p.id]?.length ?? 0) > 0);
  return (
    <PanelSection title={en.simulation.marking}>
      {markedPlaces.length === 0 ? (
        <p className="m-0 text-sm text-muted">{en.simulation.markingEmpty}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm" data-testid="sim-marking">
          {markedPlaces.map((p) => {
            const tokens = marking?.[p.id] ?? [];
            return (
              <li key={p.id} className="flex flex-col gap-0.5">
                <div className="flex justify-between gap-2">
                  <span className="truncate">{p.name}</span>
                  <span className="tabular-nums text-muted">{tokens.length}</span>
                </div>
                {json ? (
                  <div className="flex flex-wrap gap-1">
                    {tokens.slice(0, MAX_MARKING_CHIPS).map((token, index) => (
                      <code
                        key={index}
                        className="max-w-full truncate rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px]"
                        title={JSON.stringify(token)}
                      >
                        {tokenLabel(token, 22)}
                      </code>
                    ))}
                    {tokens.length > MAX_MARKING_CHIPS ? (
                      <span className="text-[11px] text-muted">
                        {en.simulation.more(tokens.length - MAX_MARKING_CHIPS)}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </PanelSection>
  );
}

/** One fired step. With a binding, a click shows the complete binding. */
function HistoryEntry({ step }: { step: SimStep }) {
  const [open, setOpen] = useState(false);
  const names = Object.keys(step.binding);
  const hasBinding = names.length > 0;
  return (
    <li className="rounded px-1.5 py-0.5 odd:bg-surface-2" data-testid="sim-step">
      {hasBinding ? (
        <Tooltip content={open ? en.simulation.hideBinding : en.simulation.showBinding} side="left">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => {
              setOpen(!open);
            }}
            className="flex w-full flex-col text-left"
            data-testid="sim-step-toggle"
          >
            <span>{en.simulation.stepLabel(step.index, step.transitionName)}</span>
            <span className="truncate font-mono text-[11px] text-muted">
              {bindingSummary(step.binding)}
            </span>
          </button>
        </Tooltip>
      ) : (
        <span>{en.simulation.stepLabel(step.index, step.transitionName)}</span>
      )}
      {open ? (
        <pre
          className="m-0 mt-1 max-h-40 overflow-auto rounded bg-surface p-1.5 font-mono text-[11px] whitespace-pre-wrap"
          data-testid="sim-step-binding"
        >
          {JSON.stringify(step.binding, null, 2)}
        </pre>
      ) : null}
    </li>
  );
}

function History() {
  const history = useEditorStore((s) => s.simHistory);
  return (
    <section className="flex flex-col gap-2 px-4 py-3">
      <SectionTitle>{en.simulation.history}</SectionTitle>
      {history.length === 0 ? (
        <p className="m-0 text-sm text-muted">{en.simulation.historyEmpty}</p>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-0.5 p-0 text-sm" data-testid="sim-history">
          {[...history].reverse().map((step) => (
            <HistoryEntry key={step.index} step={step} />
          ))}
        </ol>
      )}
    </section>
  );
}

function Problems() {
  const problems = useDiagnostics().filter(
    (d) =>
      d.code === 'GUARD_ERROR' ||
      d.code === 'INSCRIPTION_ERROR' ||
      d.code === 'TOKEN_TYPE_MISMATCH' ||
      d.code === 'GUARD_SYNTAX' ||
      d.code === 'INSCRIPTION_SYNTAX',
  );
  if (problems.length === 0) return null;
  return (
    <PanelSection title={en.simulation.problems} data-testid="sim-problems">
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs text-danger">
        {problems.map((d, index) => (
          <li key={`${d.code}-${d.elementId ?? ''}-${index}`}>{d.message}</li>
        ))}
      </ul>
    </PanelSection>
  );
}

/** What can be fired now, and the controls that change a running simulation. */
export function EnabledTab() {
  const timed = useEditorStore((s) => s.simTimed);
  return (
    <>
      <section className="flex flex-col gap-2 border-b border-border px-4 py-3">
        <Summary />
        {timed ? <p className="m-0 text-[11px] text-muted">{en.simulation.timedHint}</p> : null}
      </section>
      <Problems />
      <EnabledList />
      {timed ? <Arrivals /> : null}
      <Resources />
      <Breakpoints />
      <Marking />
      <History />
    </>
  );
}
