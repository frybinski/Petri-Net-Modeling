import {
  Download,
  FileCode,
  FileInput,
  FileJson,
  FilePlus2,
  FileText,
  FolderOpen,
  HelpCircle,
  ImageDown,
  LayoutGrid,
  Moon,
  Play,
  Redo2,
  Server,
  Share2,
  ShieldCheck,
  Sigma,
  Sun,
  Undo2,
  Workflow,
  History,
  CloudUpload,
  Pencil,
  Settings,
  ArrowRight,
  ArrowDown,
} from 'lucide-react';
import { en } from '../i18n/en';
import { commandById, shortcutText } from '../lib/commands';
import {
  chooseFile,
  chooseLogFile,
  exportJson,
  newNetGuarded,
  openExampleGuarded,
  openExportImage,
  openExportPnml,
  openExportTikz,
  saveNet,
} from '../lib/files';
import { listExamples } from '../lib/examples';
import { saveToServer, useCurrentLink } from '../lib/server-actions';
import { runAutoLayout } from '../lib/layout-action';
import { selectCanRedo, selectCanUndo, selectIsDirty, useEditorStore } from '../store/editor-store';
import { useLlmStore } from '../store/llm-store';
import { serverHasProjects, useServerStore } from '../store/server-store';
import { useUiStore } from '../store/ui-store';
import { IconButton } from './ui/button';
import { ViewSwitch } from './domain/view-switch';
import { Menu, type MenuSection } from './ui/menu';
import { Tooltip } from './ui/tooltip';
import { TextField } from './ui/fields';

function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="var(--accent)" />
      <circle cx="9" cy="16" r="4.5" fill="none" stroke="var(--accent-contrast)" strokeWidth="2" />
      <rect x="21" y="10" width="4.5" height="12" fill="var(--accent-contrast)" />
      <path d="M14 16h6" stroke="var(--accent-contrast)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="9" cy="16" r="1.6" fill="var(--accent-contrast)" />
    </svg>
  );
}

function shortcutOf(id: string): string {
  return shortcutText(commandById(id));
}

export function Header() {
  const netName = useEditorStore((s) => s.net.name);
  const renameNet = useEditorStore((s) => s.renameNet);
  const dirty = useEditorStore(selectIsDirty);
  const canUndo = useEditorStore(selectCanUndo);
  const canRedo = useEditorStore(selectCanRedo);
  const mode = useEditorStore((s) => s.mode);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const startSimulation = useEditorStore((s) => s.startSimulation);
  const stopSimulation = useEditorStore((s) => s.stopSimulation);
  const errorCount = useEditorStore(
    (s) => s.diagnostics.filter((d) => d.severity === 'error').length,
  );
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const diagnosticsOpen = useUiStore((s) => s.diagnosticsOpen);
  const setDiagnosticsOpen = useUiStore((s) => s.setDiagnosticsOpen);
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);
  const openLlmSettings = useLlmStore((s) => s.openSettings);
  const simulating = mode === 'simulate';
  const serverOn = useServerStore(serverHasProjects);
  const openServerDialog = useServerStore((s) => s.openDialog);
  const link = useCurrentLink();
  const readOnlyLink = link?.kind === 'shared' && link.mode === 'read';

  // With a server, Ctrl+S saves there and the file gets Ctrl+Shift+S.
  const serverSections: MenuSection[] = serverOn
    ? [
        {
          title: en.server.menuTitle,
          items: [
            {
              id: 'server-open',
              label: en.server.open,
              icon: <Server size={14} />,
              onSelect: () => {
                openServerDialog('open');
              },
            },
            {
              id: 'server-save',
              label: readOnlyLink ? en.server.saveCopy : link ? en.server.save : en.server.saveNew,
              icon: <CloudUpload size={14} />,
              shortcut: shortcutOf('save'),
              onSelect: () => {
                void saveToServer();
              },
            },
            {
              id: 'server-versions',
              label: en.server.versions,
              icon: <History size={14} />,
              disabled: link?.kind !== 'project',
              onSelect: () => {
                openServerDialog('versions');
              },
            },
            {
              id: 'server-share',
              label: en.server.share,
              icon: <Share2 size={14} />,
              disabled: link?.kind !== 'project',
              onSelect: () => {
                openServerDialog('share');
              },
            },
          ],
        },
      ]
    : [];

  const fileSections: MenuSection[] = [
    {
      items: [
        { id: 'new', label: en.menu.new, icon: <FilePlus2 size={14} />, onSelect: newNetGuarded },
        {
          id: 'open',
          label: en.menu.open,
          icon: <FolderOpen size={14} />,
          shortcut: shortcutOf('open'),
          onSelect: chooseFile,
        },
        {
          id: 'save',
          label: serverOn ? en.server.saveFile : en.menu.save,
          icon: <Download size={14} />,
          shortcut: shortcutOf(serverOn ? 'save-file' : 'save'),
          onSelect: saveNet,
        },
        {
          id: 'import',
          label: en.menu.import,
          icon: <FileInput size={14} />,
          onSelect: chooseFile,
        },
        {
          id: 'replay-log',
          label: en.menu.replayLog,
          icon: <FileText size={14} />,
          onSelect: chooseLogFile,
        },
      ],
    },
    ...serverSections,
    {
      title: en.menu.exportTitle,
      items: [
        {
          id: 'export-image',
          label: en.menu.exportImage,
          icon: <ImageDown size={14} />,
          shortcut: shortcutOf('export-image'),
          onSelect: openExportImage,
        },
        {
          id: 'export-pnml',
          label: en.menu.exportPnml,
          icon: <FileCode size={14} />,
          onSelect: openExportPnml,
        },
        {
          id: 'export-tikz',
          label: en.menu.exportTikz,
          icon: <Sigma size={14} />,
          onSelect: openExportTikz,
        },
        {
          id: 'export-json',
          label: en.menu.exportJson,
          icon: <FileJson size={14} />,
          onSelect: exportJson,
        },
      ],
    },
    {
      title: en.menu.examples,
      items: listExamples().map((example) => ({
        id: `example-${example.id}`,
        label: example.name,
        icon: <Workflow size={14} />,
        onSelect: () => {
          openExampleGuarded(example.net);
        },
      })),
    },
  ];

  const showInscriptions = useUiStore((s) => s.showInscriptions);
  const toggleInscriptions = useUiStore((s) => s.toggleInscriptions);
  const scrollToZoom = useUiStore((s) => s.scrollToZoom);
  const toggleScrollToZoom = useUiStore((s) => s.toggleScrollToZoom);
  const viewSections: MenuSection[] = [
    {
      items: [
        {
          id: 'show-inscriptions',
          label: en.menu.showInscriptions,
          checked: showInscriptions,
          onSelect: toggleInscriptions,
        },
        {
          id: 'scroll-to-zoom',
          label: en.menu.scrollToZoom,
          checked: scrollToZoom,
          onSelect: toggleScrollToZoom,
        },
      ],
    },
  ];

  const layoutSections: MenuSection[] = [
    {
      items: [
        {
          id: 'layout-right',
          label: en.menu.layoutRight,
          icon: <ArrowRight size={14} />,
          shortcut: shortcutOf('layout'),
          onSelect: () => {
            void runAutoLayout('RIGHT');
          },
        },
        {
          id: 'layout-down',
          label: en.menu.layoutDown,
          icon: <ArrowDown size={14} />,
          onSelect: () => {
            void runAutoLayout('DOWN');
          },
        },
      ],
    },
  ];

  return (
    <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-surface px-3 py-1.5">
      <div className="flex items-center gap-2 pr-1">
        <Logo />
        <span className="hidden text-sm font-semibold tracking-tight lg:inline">{en.app.name}</span>
      </div>

      <Menu label={en.menu.file} sections={fileSections} data-testid="menu-file" />

      <div className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden="true" />

      <div className="flex items-center gap-0.5" role="group" aria-label={en.menu.edit}>
        <IconButton
          label={en.menu.undo}
          shortcut={shortcutOf('undo')}
          disabled={!canUndo}
          onClick={undo}
          data-testid="undo"
        >
          <Undo2 size={17} aria-hidden="true" />
        </IconButton>
        <IconButton
          label={en.menu.redo}
          shortcut={shortcutOf('redo').split(' / ')[0]}
          disabled={!canRedo}
          onClick={redo}
          data-testid="redo"
        >
          <Redo2 size={17} aria-hidden="true" />
        </IconButton>
      </div>

      <Menu
        label={en.menu.autoLayout}
        icon={<LayoutGrid size={15} aria-hidden="true" />}
        sections={layoutSections}
        tooltip={en.menu.autoLayoutTip}
        shortcut={shortcutOf('layout')}
        disabled={simulating}
        data-testid="menu-layout"
      />

      <Menu label={en.menu.view} sections={viewSections} data-testid="menu-view" />

      <Tooltip content={en.menu.validateTip}>
        <button
          type="button"
          aria-pressed={diagnosticsOpen}
          onClick={() => {
            setDiagnosticsOpen(!diagnosticsOpen);
          }}
          data-testid="validate"
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-fg transition-colors hover:bg-surface-hover aria-pressed:bg-surface-hover"
        >
          <ShieldCheck
            size={15}
            aria-hidden="true"
            className={errorCount > 0 ? 'text-danger' : 'text-ok'}
          />
          {en.menu.validate}
        </button>
      </Tooltip>

      <div className="mx-auto flex min-w-40 max-w-md flex-1 items-center justify-center gap-2 px-2">
        <div className="w-full max-w-72">
          <TextField
            label={en.app.netName}
            hideLabel
            value={netName}
            onCommit={renameNet}
            disabled={simulating}
            className="text-center font-medium"
            data-testid="net-name"
          />
        </div>
        {dirty ? (
          <Tooltip content={en.app.unsaved}>
            <span
              className="size-2.5 shrink-0 rounded-full bg-accent"
              role="img"
              aria-label={en.app.unsaved}
              data-testid="dirty-indicator"
            />
          </Tooltip>
        ) : null}
      </div>

      <ViewSwitch />

      <div
        role="group"
        aria-label={en.menu.mode}
        className="flex rounded-md border border-border-strong p-0.5"
      >
        <Tooltip content={en.menu.editTip} shortcut={shortcutOf('simulate')}>
          <button
            type="button"
            aria-pressed={!simulating}
            onClick={stopSimulation}
            data-testid="mode-edit"
            className="inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium text-muted transition-colors hover:text-fg aria-pressed:bg-accent aria-pressed:text-accent-contrast"
          >
            <Pencil size={13} aria-hidden="true" />
            {en.menu.edit}
          </button>
        </Tooltip>
        <Tooltip content={en.menu.simulateTip} shortcut={shortcutOf('simulate')}>
          <button
            type="button"
            aria-pressed={simulating}
            onClick={() => {
              void startSimulation();
            }}
            data-testid="mode-simulate"
            className="inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium text-muted transition-colors hover:text-fg aria-pressed:bg-accent aria-pressed:text-accent-contrast"
          >
            <Play size={13} aria-hidden="true" />
            {en.menu.simulate}
          </button>
        </Tooltip>
      </div>

      <div className="flex items-center gap-0.5">
        <IconButton
          label={theme === 'dark' ? en.menu.lightTheme : en.menu.darkTheme}
          onClick={toggleTheme}
          data-testid="theme-toggle"
        >
          {theme === 'dark' ? (
            <Sun size={17} aria-hidden="true" />
          ) : (
            <Moon size={17} aria-hidden="true" />
          )}
        </IconButton>
        <IconButton
          label={en.llm.settingsHeader}
          tooltip={en.llm.settingsTip}
          onClick={openLlmSettings}
          data-testid="llm-settings-open"
        >
          <Settings size={17} aria-hidden="true" />
        </IconButton>
        <IconButton
          label={en.menu.shortcuts}
          shortcut="?"
          onClick={() => {
            setShortcutsOpen(true);
          }}
          data-testid="help"
        >
          <HelpCircle size={17} aria-hidden="true" />
        </IconButton>
      </div>
    </header>
  );
}
