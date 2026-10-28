import { enabledTransitions } from '@pnm/core';
import { Dices, Pencil, RotateCcw } from 'lucide-react';
import { useMemo } from 'react';
import { en } from '../i18n/en';
import { nameOf } from '../lib/flow-model';
import { useEditorStore } from '../store/editor-store';
import { Button } from './ui/button';

export function SimulationPanel() {
  const net = useEditorStore((s) => s.net);
  const marking = useEditorStore((s) => s.simMarking);
  const history = useEditorStore((s) => s.simHistory);
  const stepRandom = useEditorStore((s) => s.stepRandom);
  const reset = useEditorStore((s) => s.resetSimulation);
  const stop = useEditorStore((s) => s.stopSimulation);

  const enabledIds = useMemo(
    () => (marking ? enabledTransitions(net, marking) : []),
    [net, marking],
  );
  const enabledCount = enabledIds.length;
  const fire = useEditorStore((s) => s.fireTransition);
  const markedPlaces = net.places.filter((p) => (marking?.[p.id]?.length ?? 0) > 0);

  return (
    <aside
      aria-label={en.simulation.title}
      className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-border bg-surface max-md:hidden"
      data-testid="simulation-panel"
    >
      <section className="flex flex-col gap-3 border-b border-border px-4 py-3">
        <h3 className="m-0 text-[11px] font-semibold tracking-wide text-muted uppercase">
          {en.simulation.title}
        </h3>
        <p
          className={`m-0 rounded-md px-2.5 py-1.5 text-sm font-medium ${enabledCount === 0 ? 'bg-danger-soft text-danger' : 'bg-ok-soft text-ok'}`}
          data-testid="enabled-summary"
        >
          {enabledCount === 0 ? en.simulation.deadlock : en.simulation.enabledCount(enabledCount)}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            icon={<Dices size={14} aria-hidden="true" />}
            onClick={() => {
              stepRandom();
            }}
            disabled={enabledCount === 0}
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

      {enabledCount > 0 ? (
        <section className="flex flex-col gap-2 border-b border-border px-4 py-3">
          <h3 className="m-0 text-[11px] font-semibold tracking-wide text-muted uppercase">
            {en.simulation.enabled}
          </h3>
          <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="sim-enabled">
            {enabledIds.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => {
                    fire(id);
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5 text-left text-sm hover:border-ok hover:bg-ok-soft"
                >
                  <span className="truncate">{nameOf(net, id)}</span>
                  <span className="text-xs text-ok">{en.simulation.fire}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-2 border-b border-border px-4 py-3">
        <h3 className="m-0 text-[11px] font-semibold tracking-wide text-muted uppercase">
          {en.simulation.marking}
        </h3>
        {markedPlaces.length === 0 ? (
          <p className="m-0 text-sm text-muted">{en.simulation.markingEmpty}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm" data-testid="sim-marking">
            {markedPlaces.map((p) => (
              <li key={p.id} className="flex justify-between gap-2">
                <span className="truncate">{p.name}</span>
                <span className="tabular-nums text-muted">{marking?.[p.id]?.length ?? 0}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2 px-4 py-3">
        <h3 className="m-0 text-[11px] font-semibold tracking-wide text-muted uppercase">
          {en.simulation.history}
        </h3>
        {history.length === 0 ? (
          <p className="m-0 text-sm text-muted">{en.simulation.historyEmpty}</p>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-0.5 p-0 text-sm" data-testid="sim-history">
            {[...history].reverse().map((step) => (
              <li
                key={step.index}
                className="rounded px-1.5 py-0.5 odd:bg-surface-2"
                data-testid="sim-step"
              >
                {en.simulation.stepLabel(step.index, step.transitionName)}
              </li>
            ))}
          </ol>
        )}
      </section>
    </aside>
  );
}
