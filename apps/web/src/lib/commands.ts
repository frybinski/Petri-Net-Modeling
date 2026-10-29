import { deleteSelection } from './delete';
import { chooseFile, openExportImage, saveNet } from './files';
import { freePosition } from './placement';
import { runAutoLayout } from './layout-action';
import { domainEditActive, getDomainEditApi } from './domain-edit-api';
import { getDomainViewApi } from './domain-view-api';
import { getViewApi } from './view-api';
import { useEditorStore, type Tool } from '../store/editor-store';
import { useUiStore, type ViewMode } from '../store/ui-store';

export type CommandGroup = 'tools' | 'editing' | 'view' | 'simulation';

export interface KeySpec {
  /** `KeyboardEvent.key`, compared case-insensitively. */
  key: string;
  /** Ctrl on Windows and Linux, Command on macOS. */
  mod?: boolean;
  shift?: boolean;
}

export interface Command {
  id: string;
  label: string;
  group: CommandGroup;
  keys: KeySpec[];
  /** Shown instead of the generated text, for grouped keys such as the arrows. */
  display?: string;
  run: (event?: KeyboardEvent) => void;
  /** Whether the shortcut works while a simulation is running. */
  inSimulation?: boolean;
  /** Left out of the shortcut help (variants of a command that is already listed). */
  hidden?: boolean;
  /** The key only counts as this command when this returns true; otherwise it keeps its default. */
  when?: (event: KeyboardEvent) => boolean;
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function keyLabel(spec: KeySpec): string {
  const key =
    spec.key === 'Delete' ? 'Del' : spec.key.length === 1 ? spec.key.toUpperCase() : spec.key;
  const parts: string[] = [];
  if (spec.mod) parts.push(isMac ? '⌘' : 'Ctrl');
  if (spec.shift) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

export function shortcutText(command: Command): string {
  return command.display ?? command.keys.map(keyLabel).join(' / ');
}

export function matchesKey(event: KeyboardEvent, spec: KeySpec): boolean {
  const mod = event.ctrlKey || event.metaKey;
  if (Boolean(spec.mod) !== mod) return false;
  if (event.altKey) return false;
  // Shift is only compared when the spec asks for it; characters such as "?" and "+" imply it.
  if (spec.shift !== undefined && spec.shift !== event.shiftKey) return false;
  return event.key.toLowerCase() === spec.key.toLowerCase();
}

const editor = () => useEditorStore.getState();

/**
 * True if the keyboard focus is on the page itself or on the canvas, as opposed to a button, menu
 * or panel. Keys such as Tab and Enter keep their normal meaning for those.
 */
function focusOnCanvas(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return true;
  if (target === document.body) return true;
  return (
    target.closest('.react-flow') !== null &&
    target.closest('.react-flow__panel, .react-flow__minimap') === null
  );
}

/**
 * True if the keys belong to the domain view in the mode "Edit layout": its picture has the focus,
 * or nothing has and the domain view is the only one shown.
 */
function focusOnDomainEdit(event: KeyboardEvent): boolean {
  if (!domainEditActive()) return false;
  const target = event.target;
  if (target instanceof HTMLElement && target.matches('[data-testid="domain-canvas"]')) return true;
  return (
    (target === document.body || !(target instanceof HTMLElement)) &&
    useUiStore.getState().viewMode === 'domain'
  );
}

/** The one place or transition that is selected, if exactly one element is selected. */
function selectedNodeId(): string | null {
  const { selection, net } = editor();
  const id = selection.length === 1 ? selection[0] : undefined;
  if (id === undefined) return null;
  return net.places.some((p) => p.id === id) || net.transitions.some((t) => t.id === id)
    ? id
    : null;
}

function inSimulationMode(): boolean {
  return editor().mode === 'simulate';
}

/** The one transition that is selected, if exactly one element is selected. */
function selectedTransitionId(): string | null {
  const { selection, net } = editor();
  const id = selection.length === 1 ? selection[0] : undefined;
  return id !== undefined && net.transitions.some((t) => t.id === id) ? id : null;
}

function placeAtViewCenter(): void {
  const state = editor();
  const center = getViewApi()?.center() ?? { x: 0, y: 0 };
  state.placeWithTool(freePosition(state.net, center, 80), { keepTool: false, rename: true });
}

function toolCommand(tool: Tool, label: string, key: string): Command {
  return {
    id: `tool-${tool}`,
    label,
    group: 'tools',
    keys: [{ key }],
    run: () => {
      editor().setTool(tool);
    },
    inSimulation: tool === 'select',
  };
}

function viewCommand(id: string, label: string, key: string, mode: ViewMode): Command {
  return {
    id,
    label,
    group: 'view',
    keys: [{ key }],
    inSimulation: true,
    run: () => {
      useUiStore.getState().setViewMode(mode);
    },
  };
}

const NUDGE = 10;

/** Arrow keys move the selected entry of the domain view by 1 px, with Shift by 8 px. */
function domainNudgeCommands(): Command[] {
  const make = (key: string, dx: number, dy: number, hidden: boolean): Command => ({
    id: `domain-nudge-${key}`,
    label: 'Move the selected entry in the domain view (Shift: 8 px)',
    group: 'editing',
    keys: [{ key }],
    display: 'Arrow keys',
    hidden,
    when: (event) => focusOnDomainEdit(event) && getDomainEditApi()?.selectedEntry() != null,
    run: (event) => {
      const step = event?.shiftKey ? 8 : 1;
      getDomainEditApi()?.nudgeSelected(dx * step, dy * step);
    },
  });
  return [
    make('ArrowLeft', -1, 0, false),
    make('ArrowRight', 1, 0, true),
    make('ArrowUp', 0, -1, true),
    make('ArrowDown', 0, 1, true),
  ];
}

function nudgeCommand(id: string, key: string, dx: number, dy: number, hidden = true): Command {
  return {
    id,
    label: 'Move selection',
    group: 'editing',
    keys: [{ key }],
    display: 'Arrow keys',
    hidden,
    run: () => {
      editor().nudgeSelected(dx * NUDGE, dy * NUDGE);
    },
  };
}

/** Every keyboard command of the editor. The help dialog and the tooltips are generated from it. */
export const commands: Command[] = [
  toolCommand('select', 'Select tool', 'v'),
  toolCommand('place', 'Place tool', 'p'),
  toolCommand('transition', 'Transition tool', 't'),
  toolCommand('arc', 'Arc tool', 'a'),
  toolCommand('annotation', 'Note tool', 'n'),

  {
    id: 'domain-edit',
    label: 'Edit the layout of the domain view',
    group: 'view',
    keys: [{ key: 'e', shift: false }],
    when: () => {
      const { viewMode } = useUiStore.getState();
      return viewMode !== 'net' && !inSimulationMode();
    },
    run: () => {
      useUiStore.getState().toggleDomainEdit();
    },
  },
  ...domainNudgeCommands(),
  {
    id: 'domain-delete',
    label: 'Hide the selected entry in the domain view (decor is deleted)',
    group: 'editing',
    keys: [{ key: 'Delete' }, { key: 'Backspace' }],
    display: 'Del',
    when: (event) => focusOnDomainEdit(event) && getDomainEditApi()?.selectedEntry() != null,
    run: () => {
      getDomainEditApi()?.deleteSelected();
    },
  },
  {
    id: 'undo',
    label: 'Undo',
    group: 'editing',
    keys: [{ key: 'z', mod: true, shift: false }],
    run: () => {
      editor().undo();
    },
  },
  {
    id: 'redo',
    label: 'Redo',
    group: 'editing',
    keys: [
      { key: 'z', mod: true, shift: true },
      { key: 'y', mod: true },
    ],
    run: () => {
      editor().redo();
    },
  },
  {
    id: 'copy',
    label: 'Copy',
    group: 'editing',
    keys: [{ key: 'c', mod: true }],
    run: () => {
      editor().copy();
    },
    inSimulation: true,
  },
  {
    id: 'cut',
    label: 'Cut',
    group: 'editing',
    keys: [{ key: 'x', mod: true }],
    run: () => {
      editor().cut();
    },
  },
  {
    id: 'paste',
    label: 'Paste',
    group: 'editing',
    keys: [{ key: 'v', mod: true }],
    run: () => {
      editor().paste();
    },
  },
  {
    id: 'duplicate',
    label: 'Duplicate',
    group: 'editing',
    keys: [{ key: 'd', mod: true }],
    run: () => {
      editor().duplicate();
    },
  },
  {
    id: 'delete',
    label: 'Delete selection',
    group: 'editing',
    keys: [{ key: 'Delete' }, { key: 'Backspace' }],
    run: deleteSelection,
  },
  {
    id: 'rename',
    label: 'Rename the selected element',
    group: 'editing',
    keys: [{ key: 'F2' }],
    run: () => {
      if (domainEditActive() && useUiStore.getState().viewMode === 'domain') {
        const api = getDomainEditApi();
        const entry = api?.selectedEntry();
        if (api && entry) api.startLabel(entry);
        return;
      }
      const { selection, startRename } = editor();
      if (selection.length === 1 && selection[0] !== undefined) startRename(selection[0]);
    },
  },
  {
    id: 'chain-next',
    label: 'Add the next node and connect it',
    group: 'editing',
    keys: [{ key: 'Tab', shift: false }],
    when: (event) => selectedNodeId() !== null && focusOnCanvas(event),
    run: () => {
      const id = selectedNodeId();
      if (id !== null) editor().extendFrom(id, 1);
    },
  },
  {
    id: 'chain-previous',
    label: 'Add the previous node and connect it',
    group: 'editing',
    keys: [{ key: 'Tab', shift: true }],
    when: (event) => selectedNodeId() !== null && focusOnCanvas(event),
    run: () => {
      const id = selectedNodeId();
      if (id !== null) editor().extendFrom(id, -1);
    },
  },
  {
    id: 'place-at-center',
    label: 'Add the node of the active tool in the middle of the view',
    group: 'editing',
    keys: [{ key: 'Enter', shift: false }],
    when: (event) => {
      const { tool } = editor();
      return (
        (tool === 'place' || tool === 'transition' || tool === 'annotation') && focusOnCanvas(event)
      );
    },
    run: placeAtViewCenter,
  },
  {
    id: 'select-all',
    label: 'Select all',
    group: 'editing',
    keys: [{ key: 'a', mod: true }],
    run: () => {
      editor().selectAll();
    },
    inSimulation: true,
  },
  {
    id: 'token-add',
    label: 'Add a token to the selected places',
    group: 'editing',
    keys: [{ key: '+' }, { key: '=' }],
    display: '+',
    run: () => {
      editor().adjustTokens(1);
    },
  },
  {
    id: 'token-remove',
    label: 'Remove a token from the selected places',
    group: 'editing',
    keys: [{ key: '-' }, { key: '_' }],
    display: '-',
    run: () => {
      editor().adjustTokens(-1);
    },
  },
  nudgeCommand('nudge-left', 'ArrowLeft', -1, 0, false),
  nudgeCommand('nudge-right', 'ArrowRight', 1, 0),
  nudgeCommand('nudge-up', 'ArrowUp', 0, -1),
  nudgeCommand('nudge-down', 'ArrowDown', 0, 1),
  {
    id: 'escape',
    label: 'Cancel and clear selection',
    group: 'editing',
    keys: [{ key: 'Escape' }],
    run: () => {
      const state = editor();
      if (getDomainViewApi()?.cancelDrag()) return;
      if (state.picker !== null) state.setPicker(null);
      else if (useUiStore.getState().followedCase !== null) useUiStore.getState().followCase(null);
      else if (state.arcSource !== null) state.setArcSource(null);
      else if (state.tool !== 'select') state.setTool('select');
      else state.clearSelection();
    },
    inSimulation: true,
  },

  {
    id: 'save',
    label: 'Save',
    group: 'view',
    keys: [{ key: 's', mod: true }],
    run: saveNet,
    inSimulation: true,
  },
  {
    id: 'open',
    label: 'Open',
    group: 'view',
    keys: [{ key: 'o', mod: true }],
    run: chooseFile,
    inSimulation: true,
  },
  {
    id: 'export-image',
    label: 'Export image',
    group: 'view',
    keys: [{ key: 'e', mod: true, shift: true }],
    run: openExportImage,
    inSimulation: true,
  },
  {
    id: 'layout',
    label: 'Auto layout',
    group: 'view',
    keys: [{ key: 'l' }],
    run: () => {
      void runAutoLayout('RIGHT');
    },
  },
  {
    id: 'fit',
    label: 'Fit view',
    group: 'view',
    keys: [{ key: 'f' }],
    run: () => {
      const mode = useUiStore.getState().viewMode;
      if (mode !== 'domain') getViewApi()?.fitView();
      if (mode !== 'net') getDomainViewApi()?.fitView();
    },
    inSimulation: true,
  },
  {
    id: 'zoom-reset',
    label: 'Reset zoom to 100 %',
    group: 'view',
    keys: [{ key: '0', mod: true }],
    run: () => {
      const mode = useUiStore.getState().viewMode;
      if (mode !== 'domain') getViewApi()?.resetZoom();
      if (mode !== 'net') getDomainViewApi()?.resetZoom();
    },
    inSimulation: true,
  },
  {
    id: 'grid',
    label: 'Toggle grid snapping',
    group: 'view',
    keys: [{ key: 'g' }],
    run: () => {
      useUiStore.getState().toggleSnap();
    },
    inSimulation: true,
  },
  viewCommand('view-net', 'Show the net editor', '1', 'net'),
  viewCommand('view-domain', 'Show the domain view', '2', 'domain'),
  viewCommand('view-both', 'Show the net and the domain view', '3', 'both'),
  {
    id: 'simulate',
    label: 'Toggle simulation',
    group: 'view',
    keys: [{ key: 'm' }],
    run: () => {
      const state = editor();
      if (state.mode === 'simulate') state.stopSimulation();
      else void state.startSimulation();
    },
    inSimulation: true,
  },
  {
    id: 'analyze',
    label: 'Show or hide the analysis',
    group: 'view',
    keys: [{ key: 'y' }],
    run: () => {
      const ui = useUiStore.getState();
      ui.setRightTab(ui.rightTab === 'analyze' ? 'main' : 'analyze');
    },
    inSimulation: true,
  },
  {
    id: 'sim-play',
    label: 'Play or pause',
    group: 'simulation',
    keys: [{ key: ' ' }],
    display: 'Space',
    inSimulation: true,
    when: (event) => inSimulationMode() && !event.repeat && focusOnCanvas(event),
    run: () => {
      editor().togglePlaying();
    },
  },
  {
    id: 'sim-step',
    label: 'Step to the next event',
    group: 'simulation',
    keys: [{ key: '.' }],
    inSimulation: true,
    when: inSimulationMode,
    run: () => {
      const state = editor();
      void (state.simTimed ? state.stepNext() : state.stepRandom());
    },
  },
  {
    id: 'sim-back',
    label: 'Step back',
    group: 'simulation',
    keys: [{ key: ',' }],
    inSimulation: true,
    when: inSimulationMode,
    run: () => {
      void editor().stepBack();
    },
  },
  {
    id: 'sim-reset',
    label: 'Reset the simulation',
    group: 'simulation',
    keys: [{ key: 'r' }],
    inSimulation: true,
    when: inSimulationMode,
    run: () => {
      void editor().resetSimulation();
    },
  },
  {
    id: 'breakpoint',
    label: 'Toggle breakpoint on the selected transition',
    group: 'simulation',
    keys: [{ key: 'b' }],
    inSimulation: true,
    when: () => inSimulationMode() && selectedTransitionId() !== null,
    run: () => {
      const id = selectedTransitionId();
      if (id !== null) editor().toggleTransitionBreakpoint(id);
    },
  },
  {
    id: 'help',
    label: 'Keyboard shortcuts',
    group: 'view',
    keys: [{ key: '?' }],
    run: () => {
      useUiStore.getState().setShortcutsOpen(true);
    },
    inSimulation: true,
  },
];

export function commandById(id: string): Command {
  const command = commands.find((c) => c.id === id);
  if (!command) throw new Error(`Unknown command: ${id}`);
  return command;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Handles a keydown event. Returns true if a command ran. Keys typed into text fields,
 * and events from open dialogs and menus, are left alone.
 */
export function handleShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing) return false;
  if (isTypingTarget(event.target)) return false;
  // While a node waits for its name, typed characters belong to the rename field, which may not
  // have the focus yet. Commands with Ctrl or Cmd keep working.
  if (editor().renamingId !== null && event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
    return false;
  }
  if (event.target instanceof HTMLElement && event.target.closest('dialog[open], [role="menu"]')) {
    return false;
  }
  const simulating = editor().mode === 'simulate';
  for (const command of commands) {
    if (simulating && !command.inSimulation) continue;
    if (command.keys.some((spec) => matchesKey(event, spec)) && (command.when?.(event) ?? true)) {
      event.preventDefault();
      // React Flow selects a focused node on Escape; the canvas has already handled the key.
      if (command.id === 'escape') event.stopPropagation();
      command.run(event);
      return true;
    }
  }
  return false;
}
