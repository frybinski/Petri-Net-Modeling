import { useEffect, useRef, type KeyboardEvent } from 'react';
import { en } from '../i18n/en';
import { useEditorStore } from '../store/editor-store';
import { useUiStore, type RightTab } from '../store/ui-store';
import { LazyAnalysisPanel, LazyDomainPanel } from './lazy-parts';
import { PropertiesPanel } from './properties-panel';
import { SimulationPanel } from './simulation-panel';

/**
 * The panel on the right. A tab strip switches between the properties or simulation panel, the
 * analysis and, with the domain view visible, the domain panel.
 */
export function RightPanel() {
  const viewMode = useUiStore((s) => s.viewMode);
  const tab = useUiStore((s) => s.rightTab);
  const setTab = useUiStore((s) => s.setRightTab);
  const mode = useEditorStore((s) => s.mode);
  const untimed = useEditorStore((s) => s.simUntimed);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const simulating = mode === 'simulate';
  const main = simulating ? <SimulationPanel /> : <PropertiesPanel />;

  // Starting the simulation brings up its controls, unless an analysis started it to replay a run.
  useEffect(() => {
    if (simulating && !untimed) useUiStore.getState().setRightTab('main');
  }, [simulating, untimed]);

  // The domain tab only exists while the domain view is shown.
  const domainShown = viewMode !== 'net';
  const active: RightTab = tab === 'domain' && !domainShown ? 'main' : tab;

  const tabs: Array<{ id: RightTab; label: string }> = [
    { id: 'main', label: simulating ? en.domain.tabSimulation : en.domain.tabMain },
    { id: 'analyze', label: en.analysis.tab },
    ...(domainShown ? [{ id: 'domain' as const, label: en.domain.panelTitle }] : []),
  ];
  const onKeyDown = (event: KeyboardEvent, index: number): void => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = tabs[(index + step + tabs.length) % tabs.length];
    if (!next) return;
    setTab(next.id);
    refs.current[next.id]?.focus();
  };

  return (
    <div
      className={`flex shrink-0 flex-col border-l border-border bg-surface max-md:hidden ${
        active === 'analyze' ? 'w-96' : 'w-72'
      } [&>aside]:min-h-0 [&>aside]:w-full [&>aside]:flex-1 [&>aside]:border-l-0`}
      data-testid="right-panel"
    >
      <div
        role="tablist"
        aria-label={en.domain.tabs}
        className="flex shrink-0 border-b border-border px-2"
      >
        {tabs.map((entry, index) => (
          <button
            key={entry.id}
            ref={(element) => {
              refs.current[entry.id] = element;
            }}
            type="button"
            role="tab"
            id={`right-tab-${entry.id}`}
            aria-selected={active === entry.id}
            tabIndex={active === entry.id ? 0 : -1}
            onClick={() => {
              setTab(entry.id);
            }}
            onKeyDown={(event) => {
              onKeyDown(event, index);
            }}
            data-testid={`right-tab-${entry.id}`}
            className="-mb-px h-9 border-b-2 border-transparent px-3 text-xs font-medium text-muted transition-colors hover:text-fg aria-selected:border-accent aria-selected:text-accent"
          >
            {entry.label}
          </button>
        ))}
      </div>
      {active === 'domain' ? (
        <LazyDomainPanel />
      ) : active === 'analyze' ? (
        <LazyAnalysisPanel />
      ) : (
        main
      )}
    </div>
  );
}
