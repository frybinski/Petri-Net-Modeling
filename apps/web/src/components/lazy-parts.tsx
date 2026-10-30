import { lazy, Suspense, useState } from 'react';
import { en } from '../i18n/en';
import { useExportStore } from '../store/export-store';
import { useGenerationStore } from '../store/generation-store';
import { useLlmStore } from '../store/llm-store';
import { useReplayStore } from '../store/replay-store';
import { useServerStore } from '../store/server-store';

// The parts of the app that most sessions never open are separate chunks: the analysis, the
// domain view, the export formats, the LLM dialogs and the dialog for event logs. Their code and the packages behind them
// (`@pnm/analysis`, `@pnm/domain`, `@pnm/io`, `@pnm/llm`) load when the part is first shown.

const DomainCanvas = lazy(() =>
  import('./domain/domain-canvas').then((m) => ({ default: m.DomainCanvas })),
);
const DomainPanel = lazy(() =>
  import('./domain/domain-panel').then((m) => ({ default: m.DomainPanel })),
);
const DomainOverflowStatus = lazy(() =>
  import('./domain/domain-overflow-status').then((m) => ({ default: m.DomainOverflowStatus })),
);
const AnalysisPanel = lazy(() =>
  import('./analysis/analysis-panel').then((m) => ({ default: m.AnalysisPanel })),
);
const ExportDialog = lazy(() =>
  import('./export/export-dialog').then((m) => ({ default: m.ExportDialog })),
);
const GenerateDialog = lazy(() =>
  import('./llm/generate-dialog').then((m) => ({ default: m.GenerateDialog })),
);
const GenerationLogDialog = lazy(() =>
  import('./llm/generation-log-dialog').then((m) => ({ default: m.GenerationLogDialog })),
);
const LogDialog = lazy(() => import('./sim/log-dialog').then((m) => ({ default: m.LogDialog })));
const ServerDialogs = lazy(() =>
  import('./server/server-dialogs').then((m) => ({ default: m.ServerDialogs })),
);
const LlmSettingsDialog = lazy(() =>
  import('./llm/llm-settings-dialog').then((m) => ({ default: m.LlmSettingsDialog })),
);

/** What a pane shows for the moment that its chunk takes to arrive. */
function Loading({ testId }: { testId: string }) {
  return (
    <div
      className="flex h-full min-h-16 w-full items-center justify-center text-xs text-muted"
      role="status"
      data-testid={testId}
    >
      {en.app.loading}
    </div>
  );
}

export function LazyDomainCanvas() {
  return (
    <Suspense fallback={<Loading testId="domain-loading" />}>
      <DomainCanvas />
    </Suspense>
  );
}

export function LazyDomainPanel() {
  return (
    <Suspense fallback={<Loading testId="domain-panel-loading" />}>
      <DomainPanel />
    </Suspense>
  );
}

/** The note of the status bar about fill levels over their limit; nothing while it loads. */
export function LazyDomainOverflowStatus() {
  return (
    <Suspense fallback={null}>
      <DomainOverflowStatus />
    </Suspense>
  );
}

export function LazyAnalysisPanel() {
  return (
    <Suspense fallback={<Loading testId="analysis-loading" />}>
      <AnalysisPanel />
    </Suspense>
  );
}

/** True from the first time `open` is true on: a dialog keeps its closing behavior once it exists. */
function useOpenedOnce(open: boolean): boolean {
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  return opened;
}

/** The dialogs that load on demand: nothing is fetched before the first one is opened. */
export function LazyDialogs() {
  const exporting = useOpenedOnce(useExportStore((s) => s.open !== null));
  const generating = useOpenedOnce(useGenerationStore((s) => s.open));
  const log = useOpenedOnce(useGenerationStore((s) => s.logOpen));
  const settings = useOpenedOnce(useLlmStore((s) => s.settingsOpen));
  const replaying = useOpenedOnce(useReplayStore((s) => s.open));
  const serving = useOpenedOnce(useServerStore((s) => s.dialog !== null || s.conflict !== null));
  return (
    <Suspense fallback={null}>
      {exporting ? <ExportDialog /> : null}
      {generating ? <GenerateDialog /> : null}
      {log ? <GenerationLogDialog /> : null}
      {settings ? <LlmSettingsDialog /> : null}
      {replaying ? <LogDialog /> : null}
      {serving ? <ServerDialogs /> : null}
    </Suspense>
  );
}
