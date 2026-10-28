import { chooseFile, exportSvg, saveNet } from './files';
import { runAutoLayout } from './layout-action';
import { getViewApi } from './view-api';
import { useEditorStore, type Tool } from '../store/editor-store';
import { useUiStore } from '../store/ui-store';

export type CommandGroup = 'tools' | 'editing' | 'view';

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
  run: () => void;
  /** Whether the shortcut works while a simulation is running. */
  inSimulation?: boolean;
  /** Left out of the shortcut help (variants of a command that is already listed). */
  hidden?: boolean;
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

const NUDGE = 10;

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
    run: () => {
      editor().removeSelected();
    },
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
      if (state.arcSource !== null) state.setArcSource(null);
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
    id: 'export-svg',
    label: 'Export SVG',
    group: 'view',
    keys: [{ key: 'e', mod: true, shift: true }],
    run: exportSvg,
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
      getViewApi()?.fitView();
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
  {
    id: 'simulate',
    label: 'Toggle simulation',
    group: 'view',
    keys: [{ key: 'm' }],
    run: () => {
      const state = editor();
      if (state.mode === 'simulate') state.stopSimulation();
      else state.startSimulation();
    },
    inSimulation: true,
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
  if (event.target instanceof HTMLElement && event.target.closest('dialog[open], [role="menu"]')) {
    return false;
  }
  const simulating = editor().mode === 'simulate';
  for (const command of commands) {
    if (simulating && !command.inSimulation) continue;
    if (command.keys.some((spec) => matchesKey(event, spec))) {
      event.preventDefault();
      command.run();
      return true;
    }
  }
  return false;
}
