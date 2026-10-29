import { ReactFlowProvider } from '@xyflow/react';
import { FileUp } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { ConfirmDialog } from './components/confirm-dialog';
import { ImportReportDialog } from './components/export/import-report-dialog';
import { Header } from './components/header';
import { LazyDialogs } from './components/lazy-parts';
import { RightPanel } from './components/right-panel';
import { ShortcutsDialog } from './components/shortcuts-dialog';
import { TokenDialog } from './components/tokens/token-dialog';
import { TypeDialog } from './components/types/type-dialog';
import { StatusBar } from './components/status-bar';
import { Toaster } from './components/toaster';
import { ToolPalette } from './components/tool-palette';
import { Workspace } from './components/workspace';
import { TooltipProvider } from './components/ui/tooltip';
import { en } from './i18n/en';
import { restoreAutosave, startAutosave } from './lib/autosave';
import { handleShortcut } from './lib/commands';
import {
  chooseLogFile,
  openFileGuarded,
  openLogFile,
  registerFileInput,
  registerLogFileInput,
} from './lib/files';
import { registerLogFileRequest, selectIsDirty, useEditorStore } from './store/editor-store';
import { useUiStore } from './store/ui-store';

let restoreStarted = false;

function hasFiles(event: DragEvent): boolean {
  return [...event.dataTransfer.types].includes('Files');
}

export function App() {
  const viewMode = useUiStore((s) => s.viewMode);
  const netName = useEditorStore((s) => s.net.name);
  const dirty = useEditorStore(selectIsDirty);
  const typeDialog = useUiStore((s) => s.typeDialog);
  const tokenDialog = useUiStore((s) => s.tokenDialog);
  const [dropActive, setDropActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = `${dirty ? '• ' : ''}${netName.trim() || en.app.untitled} · ${en.app.name}`;
  }, [netName, dirty]);

  useEffect(() => {
    registerFileInput(fileInputRef.current);
    return () => {
      registerFileInput(null);
    };
  }, []);

  useEffect(() => {
    registerLogFileInput(logInputRef.current);
    registerLogFileRequest(chooseLogFile);
    return () => {
      registerLogFileInput(null);
      registerLogFileRequest(null);
    };
  }, []);

  // Keyboard shortcuts.
  useEffect(() => {
    // Capture phase: React Flow handles arrow keys on focused nodes itself and would otherwise
    // mark the event as handled before it reaches the document.
    document.addEventListener('keydown', handleShortcut, true);
    return () => {
      document.removeEventListener('keydown', handleShortcut, true);
    };
  }, []);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (selectIsDirty(useEditorStore.getState())) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

  // Restore the last session, then keep saving changes.
  useEffect(() => {
    if (!restoreStarted) {
      restoreStarted = true;
      void restoreAutosave();
    }
    return startAutosave();
  }, []);

  const onDragOver = (event: DragEvent): void => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    setDropActive(true);
  };

  const onDragLeave = (event: DragEvent): void => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDropActive(false);
  };

  const onDrop = (event: DragEvent): void => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    setDropActive(false);
    const file = event.dataTransfer.files[0];
    if (file) openFileGuarded(file);
  };

  return (
    <ReactFlowProvider>
      <TooltipProvider>
        <div
          className="flex h-full flex-col"
          onDragOver={onDragOver}
          onDragEnter={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <Header />
          <div className="flex min-h-0 flex-1">
            {viewMode !== 'domain' ? <ToolPalette /> : null}
            <Workspace>
              {dropActive ? (
                <div
                  className="pointer-events-none absolute inset-3 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-accent-soft/80 text-accent"
                  data-testid="drop-overlay"
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <FileUp size={18} aria-hidden="true" />
                    {en.canvas.dropFile}
                  </span>
                </div>
              ) : null}
            </Workspace>
            <RightPanel />
          </div>
          <StatusBar />
        </div>
        <Toaster />
        <ConfirmDialog />
        <ShortcutsDialog />
        <ImportReportDialog />
        <LazyDialogs />
        {tokenDialog ? (
          <TokenDialog
            key={`${tokenDialog.placeId}:${tokenDialog.index ?? 'new'}`}
            placeId={tokenDialog.placeId}
            index={tokenDialog.index}
          />
        ) : null}
        {typeDialog ? (
          <TypeDialog key={typeDialog.name ?? '(new)'} original={typeDialog.name} />
        ) : null}
        <input
          ref={logInputRef}
          type="file"
          accept=".csv,.tsv,.txt,.xes,text/csv,text/plain,application/xml,text/xml"
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          data-testid="open-log-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void openLogFile(file);
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.pnml,.xml,application/json,application/xml,text/xml"
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          data-testid="open-file-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) openFileGuarded(file);
          }}
        />
      </TooltipProvider>
    </ReactFlowProvider>
  );
}
