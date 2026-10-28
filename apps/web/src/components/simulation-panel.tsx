import { tokenLabel, type Binding } from '@pnm/core';
import { Dices, Pencil, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { en } from '../i18n/en';
import { nameOf } from '../lib/flow-model';
import { useDiagnostics } from '../lib/use-diagnostics';
import { useEditorStore, type SimStep } from '../store/editor-store';
import { Button } from './ui/button';

const MAX_MARKING_CHIPS = 6;

function SectionTitle({ children }: { children: string }) {
  return (
    <h3 className="m-0 text-[11px] font-semibold tracking-wide text-muted uppercase">{children}</h3>
  );
}

/** Short one-line form of a binding: `$o = {id:"A-1",…}, $c = …`. */
function bindingSummary(binding: Binding, max = 18): string {
  return Object.entries(binding)
    .map(([name, value]) => `$${name} = ${tokenLabel(value, max)}`)
    .join(', ');
}

export function SimulationPanel() {
  const net = useEditorStore((s) => s.net);
  const marking = useEditorStore((s) => s.simMarking);
  const history = useEditorStore((s) => s.simHistory);
  const enabled = useEditorStore((s) => s.enabled);
  const computing = useEditorStore((s) => s.computing);
  const stepRandom = useEditorStore((s) => s.stepRandom);
  const reset = useEditorStore((s) => s.resetSimulation);
  const stop = useEditorStore((s) => s.stopSimulation);
  const fire = useEditorStore((s) => s.fireTransition);
  const problems = useDiagnostics().filter(
    (d) =>
      d.code === 'GUARD_ERROR' ||
      d.code === 'INSCRIPTION_ERROR' ||
      d.code === 'TOKEN_TYPE_MISMATCH' ||
      d.code === 'GUARD_SYNTAX' ||
      d.code === 'INSCRIPTION_SYNTAX',
  );
  const json = net.profile === 'json-net';

  const enabledIds = [...enabled.keys()];
  const enabledCount = enabledIds.length;
  const markedPlaces = net.places.filter((p) => (marking?.[p.id]?.length ?? 0) > 0);

  return (
    <aside
      aria-label={en.simulation.title}
      className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-border bg-surface max-md:hidden"
      data-testid="simulation-panel"
    >
      <section className="flex flex-col gap-3 border-b border-border px-4 py-3">
        <SectionTitle>{en.simulation.title}</SectionTitle>
        <p
          className={`m-0 rounded-md px-2.5 py-1.5 text-sm font-medium ${
            computing
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
            : enabledCount === 0
              ? en.simulation.deadlock
              : en.simulation.enabledCount(enabledCount)}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            icon={<Dices size={14} aria-hidden="true" />}
            onClick={() => {
              stepRandom();
            }}
            disabled={enabledCount === 0 || computing}
            data-testid="step-random"
          >
            {en.simulation.stepRandom}
          </Button>
          <Button
            icon={<RotateCcw size={14} aria-hidden="true" />}
            onClick={reset}
            data-testid="sim-reset"
          >
            {en.simulation.reset}
          </Button>
        </div>
        <Button
          variant="ghost"
          icon={<Pencil size={14} aria-hidden="true" />}
          onClick={stop}
          className="self-start"
        >
          {en.simulation.exit}
        </Button>
      </section>

      {problems.length > 0 ? (
        <section
          className="flex flex-col gap-1.5 border-b border-border px-4 py-3"
          data-testid="sim-problems"
        >
          <SectionTitle>{en.simulation.problems}</SectionTitle>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs text-danger">
            {problems.map((d, index) => (
              <li key={`${d.code}-${d.elementId ?? ''}-${index}`}>{d.message}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {enabledCount > 0 ? (
        <section className="flex flex-col gap-2 border-b border-border px-4 py-3">
          <SectionTitle>{en.simulation.enabled}</SectionTitle>
          <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="sim-enabled">
            {enabledIds.map((id) => {
              const result = enabled.get(id);
              const count = result?.bindings.length ?? 0;
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
                      {(json && count > 1) || result?.truncated
                        ? en.simulation.bindingCount(count, result?.truncated ?? false)
                        : en.simulation.fire}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-2 border-b border-border px-4 py-3">
        <SectionTitle>{en.simulation.marking}</SectionTitle>
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
      </section>

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
    </aside>
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
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
          }}
          title={open ? en.simulation.hideBinding : en.simulation.showBinding}
          className="flex w-full flex-col text-left"
          data-testid="sim-step-toggle"
        >
          <span>{en.simulation.stepLabel(step.index, step.transitionName)}</span>
          <span className="truncate font-mono text-[11px] text-muted">
            {bindingSummary(step.binding)}
          </span>
        </button>
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
