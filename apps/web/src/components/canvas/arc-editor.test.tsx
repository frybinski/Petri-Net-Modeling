import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../../store/editor-store';
import { ArcEditor } from './arc-editor';

const store = () => useEditorStore.getState();

function setup() {
  store().newNet();
  const p = store().addPlace({ x: 0, y: 0 }) as string;
  const t = store().addTransition({ x: 200, y: 0 }) as string;
  const arc = store().addArc(p, t) as string;
  store().startRename(arc);
  render(<ArcEditor arcId={arc} />);
  return arc;
}

beforeEach(() => {
  store().newNet();
});

describe('editing the weight of an arc in place', () => {
  it('shows a number field with the current weight and confirms with Enter', async () => {
    const arc = setup();
    const user = userEvent.setup();
    const input = await screen.findByRole('spinbutton', { name: 'Weight' });
    expect(input).toHaveValue(1);
    await user.clear(input);
    await user.type(input, '3{Enter}');
    expect(store().net.arcs.find((a) => a.id === arc)?.weight).toBe(3);
    expect(store().renamingId).toBeNull();
  });

  it('discards with Escape and ignores invalid weights', async () => {
    const arc = setup();
    const user = userEvent.setup();
    const input = await screen.findByRole('spinbutton', { name: 'Weight' });
    await user.clear(input);
    await user.type(input, '5{Escape}');
    expect(store().net.arcs.find((a) => a.id === arc)?.weight).toBe(1);
    expect(store().renamingId).toBeNull();
  });

  it('rejects zero by leaving the weight unchanged', async () => {
    const arc = setup();
    const user = userEvent.setup();
    const input = await screen.findByRole('spinbutton', { name: 'Weight' });
    await user.clear(input);
    await user.type(input, '0{Enter}');
    expect(store().net.arcs.find((a) => a.id === arc)?.weight).toBe(1);
  });
});
