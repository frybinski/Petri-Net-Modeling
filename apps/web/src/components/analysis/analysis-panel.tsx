import { Loader2, Microscope } from 'lucide-react';
import { en } from '../../i18n/en';
import { commandById, shortcutText } from '../../lib/commands';
import { useAnalysisStore } from '../../store/analysis-store';
import { useEditorStore } from '../../store/editor-store';
import { Button } from '../ui/button';
import { Tooltip } from '../ui/tooltip';
import { ReplayBar } from '../sim/replay-bar';
import { InvariantsCard } from './invariants-card';
import { PropertiesCard } from './properties-card';
import { StateSpaceCard } from './state-space-card';
import { StateSpaceDialog } from './state-space-dialog';
import { StructureCard } from './structure-card';

/**
 * The analysis of the net: structure, invariants, state space and properties. Results are computed
 * on request and marked as out of date when the net changes.
 */
export function AnalysisPanel() {
  const empty = useEditorStore((s) => s.net.places.length + s.net.transitions.length === 0);
  const busy = useAnalysisStore((s) => Object.values(s.busy).some(Boolean));
  const runAll = useAnalysisStore((s) => s.runAll);
  const cancel = useAnalysisStore((s) => s.cancel);

  return (
    <>
      <aside
        aria-label={en.analysis.title}
        className="flex w-96 shrink-0 flex-col overflow-y-auto border-l border-border bg-surface max-md:hidden"
        data-testid="analysis-panel"
      >
        <ReplayBar />
        <section className="flex flex-col gap-2 border-b border-border px-4 py-3">
          <p className="m-0 text-[11px] leading-snug text-muted">{en.analysis.intro}</p>
          {empty ? (
            <p className="m-0 text-xs text-muted" data-testid="analysis-empty">
              {en.analysis.emptyNet}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Tooltip
              content={en.analysis.runAllTip}
              shortcut={shortcutText(commandById('analyze'))}
            >
              <Button
                variant="primary"
                size="md"
                disabled={empty || busy}
                icon={
                  busy ? (
                    <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Microscope size={14} aria-hidden="true" />
                  )
                }
                onClick={() => {
                  void runAll();
                }}
                data-testid="analyze-all"
              >
                {en.analysis.runAll}
              </Button>
            </Tooltip>
            {busy ? (
              <Button size="md" variant="secondary" onClick={cancel} data-testid="analysis-cancel">
                {en.analysis.cancel}
              </Button>
            ) : null}
          </div>
        </section>
        <StructureCard />
        <InvariantsCard />
        <StateSpaceCard />
        <PropertiesCard />
      </aside>
      <StateSpaceDialog />
    </>
  );
}
