import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../store/editor-store';
import { commandById, commands, handleShortcut, matchesKey, shortcutText } from './commands';

function key(init: KeyboardEventInit & { key: string }, target?: EventTarget): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  if (target) Object.defineProperty(event, 'target', { value: target });
  return event;
}

beforeEach(() => {
  useEditorStore.getState().newNet();
});

describe('matchesKey', () => {
  it('compares modifiers strictly', () => {
    expect(
      matchesKey(key({ key: 'z', ctrlKey: true }), { key: 'z', mod: true, shift: false }),
    ).toBe(true);
    expect(
      matchesKey(key({ key: 'Z', ctrlKey: true, shiftKey: true }), {
        key: 'z',
        mod: true,
        shift: true,
      }),
    ).toBe(true);
    expect(
      matchesKey(key({ key: 'z', ctrlKey: true, shiftKey: true }), {
        key: 'z',
        mod: true,
        shift: false,
      }),
    ).toBe(false);
    expect(matchesKey(key({ key: 'z' }), { key: 'z', mod: true })).toBe(false);
    expect(matchesKey(key({ key: 'v', ctrlKey: true }), { key: 'v' })).toBe(false);
    expect(matchesKey(key({ key: 'v', metaKey: true }), { key: 'v', mod: true })).toBe(true);
    expect(matchesKey(key({ key: 'v', altKey: true }), { key: 'v' })).toBe(false);
  });
});

describe('command registry', () => {
  it('has unique ids and a shortcut for every command', () => {
    const ids = commands.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const command of commands) expect(shortcutText(command).length).toBeGreaterThan(0);
  });

  it('formats shortcuts', () => {
    expect(shortcutText(commandById('tool-place'))).toBe('P');
    expect(shortcutText(commandById('undo'))).toMatch(/Z$/);
    expect(shortcutText(commandById('delete'))).toBe('Del / Backspace');
    expect(() => commandById('nope')).toThrow();
  });
});

describe('handleShortcut', () => {
  it('switches tools with letter keys', () => {
    expect(handleShortcut(key({ key: 'p' }))).toBe(true);
    expect(useEditorStore.getState().tool).toBe('place');
    expect(handleShortcut(key({ key: 'Escape' }))).toBe(true);
    expect(useEditorStore.getState().tool).toBe('select');
  });

  it('undoes with Ctrl+Z and redoes with Ctrl+Shift+Z or Ctrl+Y', () => {
    useEditorStore.getState().addPlace({ x: 0, y: 0 });
    handleShortcut(key({ key: 'z', ctrlKey: true }));
    expect(useEditorStore.getState().net.places).toHaveLength(0);
    handleShortcut(key({ key: 'Z', ctrlKey: true, shiftKey: true }));
    expect(useEditorStore.getState().net.places).toHaveLength(1);
    handleShortcut(key({ key: 'z', ctrlKey: true }));
    handleShortcut(key({ key: 'y', ctrlKey: true }));
    expect(useEditorStore.getState().net.places).toHaveLength(1);
  });

  it('ignores typing in text fields and open dialogs', () => {
    const input = document.createElement('input');
    document.body.append(input);
    expect(handleShortcut(key({ key: 'p' }, input))).toBe(false);
    expect(useEditorStore.getState().tool).toBe('select');
    input.remove();
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    const button = document.createElement('button');
    dialog.append(button);
    document.body.append(dialog);
    expect(handleShortcut(key({ key: 'p' }, button))).toBe(false);
    dialog.remove();
  });

  it('ignores already handled events and unknown keys', () => {
    const event = key({ key: 'p' });
    event.preventDefault();
    expect(handleShortcut(event)).toBe(false);
    expect(handleShortcut(key({ key: 'q' }))).toBe(false);
  });

  it('only allows a few commands while simulating', () => {
    useEditorStore.getState().startSimulation();
    expect(handleShortcut(key({ key: 'p' }))).toBe(false);
    expect(handleShortcut(key({ key: 'Delete' }))).toBe(false);
    expect(handleShortcut(key({ key: 'm' }))).toBe(true);
    expect(useEditorStore.getState().mode).toBe('edit');
  });

  it('adds and removes tokens with + and -', () => {
    const p = useEditorStore.getState().addPlace({ x: 0, y: 0 }) as string;
    handleShortcut(key({ key: '+', shiftKey: true }));
    handleShortcut(key({ key: '=' }));
    expect(useEditorStore.getState().net.marking[p]).toHaveLength(2);
    handleShortcut(key({ key: '-' }));
    expect(useEditorStore.getState().net.marking[p]).toHaveLength(1);
  });

  it('nudges the selection with the arrow keys', () => {
    const p = useEditorStore.getState().addPlace({ x: 0, y: 0 }) as string;
    handleShortcut(key({ key: 'ArrowRight' }));
    handleShortcut(key({ key: 'ArrowDown', shiftKey: true }));
    expect(useEditorStore.getState().net.places.find((x) => x.id === p)?.position).toEqual({
      x: 10,
      y: 10,
    });
  });
});
