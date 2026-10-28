import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../../store/editor-store';
import { NodeLabel } from './node-label';

const store = () => useEditorStore.getState();

function setup() {
  store().newNet();
  const id = store().addPlace({ x: 0, y: 0 }) as string;
  store().startRename(id);
  const view = () => {
    const place = store().net.places[0]!;
    return (
      <NodeLabel id={id} name={place.name} renaming={store().renamingId === id} kind="place" />
    );
  };
  const result = render(view());
  const rerender = () => {
    result.rerender(view());
  };
  return { id, rerender };
}

beforeEach(() => {
  store().newNet();
});

describe('renaming a node in place', () => {
  it('confirms the new name with Enter', async () => {
    const { id } = setup();
    const user = userEvent.setup();
    const input = await screen.findByRole('textbox', { name: 'Rename place' });
    await user.clear(input);
    await user.type(input, 'Buffer{Enter}');
    expect(store().net.places.find((p) => p.id === id)?.name).toBe('Buffer');
    expect(store().renamingId).toBeNull();
  });

  it('discards the draft with Escape', async () => {
    const { id } = setup();
    const user = userEvent.setup();
    const input = await screen.findByRole('textbox', { name: 'Rename place' });
    await user.clear(input);
    await user.type(input, 'Dropped{Escape}');
    expect(store().net.places.find((p) => p.id === id)?.name).toBe('P1');
    expect(store().renamingId).toBeNull();
  });

  it('confirms when the focus leaves the field', async () => {
    const { id } = setup();
    const user = userEvent.setup();
    const input = await screen.findByRole('textbox', { name: 'Rename place' });
    await user.clear(input);
    await user.type(input, 'Clicked away');
    await user.click(document.body);
    expect(store().net.places.find((p) => p.id === id)?.name).toBe('Clicked away');
  });

  it('is one undo step', async () => {
    const { id } = setup();
    const user = userEvent.setup();
    const input = await screen.findByRole('textbox', { name: 'Rename place' });
    const steps = store().past.length;
    await user.clear(input);
    await user.type(input, 'Once{Enter}');
    expect(store().past.length).toBe(steps + 1);
    store().undo();
    expect(store().net.places.find((p) => p.id === id)?.name).toBe('P1');
  });

  it('Tab confirms the name and continues the chain with a new node', async () => {
    const { id, rerender } = setup();
    const user = userEvent.setup();
    const input = await screen.findByRole('textbox', { name: 'Rename place' });
    await user.clear(input);
    await user.type(input, 'Ready{Tab}');
    expect(store().net.places.find((p) => p.id === id)?.name).toBe('Ready');
    expect(store().net.transitions).toHaveLength(1);
    expect(store().net.arcs).toHaveLength(1);
    expect(store().renamingId).toBe(store().net.transitions[0]?.id);
    rerender();
  });

  it('Shift+Tab continues the chain backwards', async () => {
    const { id } = setup();
    const user = userEvent.setup();
    const input = await screen.findByRole('textbox', { name: 'Rename place' });
    await user.type(input, '{Shift>}{Tab}{/Shift}');
    expect(store().net.transitions).toHaveLength(1);
    expect(store().net.arcs[0]).toMatchObject({ target: id });
  });
});
