import { FileUp } from 'lucide-react';
import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { en } from '../i18n/en';
import { openFileGuarded } from '../lib/files';
import { useEditorStore } from '../store/editor-store';
import { useUiStore, type SimTab } from '../store/ui-store';
import { EnabledTab } from './sim/enabled-tab';
import { MetricsTab } from './sim/metrics-tab';
import { ReplayBar } from './sim/replay-bar';
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

function hasFiles(event: DragEvent): boolean {
  return [...event.dataTransfer.types].includes('Files');
}

export function SimulationPanel() {
  const [dropActive, setDropActive] = useState(false);
  const tab = useUiStore((s) => s.simTab);
  const setTab = useUiStore((s) => s.setSimTab);
  const timed = useEditorStore((s) => s.simTimed);
  // Key figures need a clock; without one the tab would only say so.
  const active: SimTab = tab === 'metrics' && !timed ? 'enabled' : tab;

  return (
    <aside
      aria-label={en.simulation.title}
      className={`relative flex w-72 shrink-0 flex-col overflow-y-auto border-l border-border bg-surface max-md:hidden ${
        dropActive ? 'outline-2 -outline-offset-2 outline-dashed outline-accent' : ''
      }`}
      data-testid="simulation-panel"
      // An event log dropped on the panel is replayed; the rest of the page opens nets.
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        setDropActive(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDropActive(false);
      }}
      onDrop={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        setDropActive(false);
        const file = event.dataTransfer.files[0];
        if (file) openFileGuarded(file);
      }}
    >
      {dropActive ? (
        <div
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-accent-soft/80 text-accent"
          data-testid="sim-drop-overlay"
        >
          <span className="flex items-center gap-2 px-4 text-center text-sm font-medium">
            <FileUp size={18} aria-hidden="true" />
            {en.replay.dropFile}
          </span>
        </div>
      ) : null}
      <SimControls />
      <ReplayBar />
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
