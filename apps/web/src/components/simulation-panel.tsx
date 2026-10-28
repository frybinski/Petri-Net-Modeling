import { useRef, type KeyboardEvent } from 'react';
import { en } from '../i18n/en';
import { useEditorStore } from '../store/editor-store';
import { useUiStore, type SimTab } from '../store/ui-store';
import { EnabledTab } from './sim/enabled-tab';
import { MetricsTab } from './sim/metrics-tab';
import { SimControls } from './sim/sim-controls';
import { TraceTab } from './sim/trace-tab';

const TABS: Array<{ id: SimTab; label: string }> = [
  { id: 'enabled', label: en.simulation.tabEnabled },
  { id: 'trace', label: en.simulation.tabTrace },
  { id: 'metrics', label: en.simulation.tabMetrics },
];

/** Tab strip with the arrow-key behaviour of the ARIA tabs pattern. */
function Tabs({ active, onSelect }: { active: SimTab; onSelect: (tab: SimTab) => void }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const move = (event: KeyboardEvent, index: number): void => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = TABS[(index + step + TABS.length) % TABS.length];
    if (!next) return;
    onSelect(next.id);
    refs.current[next.id]?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={en.simulation.tabs}
      className="flex shrink-0 border-b border-border px-2"
    >
      {TABS.map((tab, index) => (
        <button
          key={tab.id}
          ref={(element) => {
            refs.current[tab.id] = element;
          }}
          type="button"
          role="tab"
          id={`sim-tab-${tab.id}`}
          aria-selected={active === tab.id}
          aria-controls={`sim-tabpanel-${tab.id}`}
          tabIndex={active === tab.id ? 0 : -1}
          onClick={() => {
            onSelect(tab.id);
          }}
          onKeyDown={(event) => {
            move(event, index);
          }}
          data-testid={`sim-tab-${tab.id}`}
          className="-mb-px h-9 border-b-2 border-transparent px-3 text-xs font-medium text-muted transition-colors hover:text-fg aria-selected:border-accent aria-selected:text-accent"
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function SimulationPanel() {
  const tab = useUiStore((s) => s.simTab);
  const setTab = useUiStore((s) => s.setSimTab);
  const timed = useEditorStore((s) => s.simTimed);
  const notice = useEditorStore((s) => s.simNotice);
  // Key figures need a clock; without one the tab would only say so.
  const active: SimTab = tab === 'metrics' && !timed ? 'enabled' : tab;

  return (
    <aside
      aria-label={en.simulation.title}
      className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-border bg-surface max-md:hidden"
      data-testid="simulation-panel"
    >
      <SimControls />
      {notice ? (
        <p
          className="m-0 border-b border-border bg-warn-soft px-4 py-2 text-xs text-warn"
          role="status"
          data-testid="sim-notice"
        >
          {notice}
        </p>
      ) : null}
      <Tabs active={active} onSelect={setTab} />
      <div
        role="tabpanel"
        id={`sim-tabpanel-${active}`}
        aria-labelledby={`sim-tab-${active}`}
        className="flex min-h-0 flex-col"
      >
        {active === 'enabled' ? <EnabledTab /> : null}
        {active === 'trace' ? <TraceTab /> : null}
        {active === 'metrics' ? <MetricsTab /> : null}
      </div>
    </aside>
  );
}
