import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../../store/editor-store';
import { useUiStore } from '../../store/ui-store';
import { TypesSection } from './types-section';

const store = () => useEditorStore.getState();

let place = '';
beforeEach(() => {
  store().newNet();
  useUiStore.setState({ toasts: [], confirm: null, typeDialog: null });
  store().setProfile('json-net');
  place = store().addPlace({ x: 0, y: 0 }) as string;
  store().saveType(null, 'Count', { type: 'integer' });
  store().saveType(null, 'Name', { type: 'string' });
  store().setPlaceType(place, 'Count');
});

describe('TypesSection', () => {
  it('lists the types with their usage', () => {
    render(<TypesSection />);
    const items = screen.getAllByTestId('type-item');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Count');
    expect(items[0]).toHaveTextContent('1 place');
    expect(items[1]).toHaveTextContent('unused');
  });

  it('renames a type inline and updates the places', async () => {
    const user = userEvent.setup();
    render(<TypesSection />);
    await user.click(screen.getByRole('button', { name: 'Rename type Count' }));
    const input = screen.getByTestId('type-rename-input');
    await user.clear(input);
    await user.type(input, 'Total{Enter}');
    expect(Object.keys(store().net.types)).toEqual(['Total', 'Name']);
    expect(store().net.places[0]?.type).toBe('Total');
    expect(store().past.length).toBeGreaterThan(0);
  });

  it('refuses a taken name and cancels with Escape', async () => {
    const user = userEvent.setup();
    render(<TypesSection />);
    await user.click(screen.getByRole('button', { name: 'Rename type Count' }));
    await user.clear(screen.getByTestId('type-rename-input'));
    await user.type(screen.getByTestId('type-rename-input'), 'Name{Enter}');
    expect(Object.keys(store().net.types)).toEqual(['Count', 'Name']);
    await user.click(screen.getByRole('button', { name: 'Rename type Count' }));
    await user.type(screen.getByTestId('type-rename-input'), 'X{Escape}');
    expect(Object.keys(store().net.types)).toEqual(['Count', 'Name']);
  });

  it('duplicates a type and deletes an unused one at once', async () => {
    const user = userEvent.setup();
    render(<TypesSection />);
    await user.click(screen.getByRole('button', { name: 'Duplicate type Name' }));
    expect(Object.keys(store().net.types)).toEqual(['Count', 'Name', 'NameCopy']);
    await user.click(screen.getByRole('button', { name: 'Delete type NameCopy' }));
    expect(Object.keys(store().net.types)).toEqual(['Count', 'Name']);
    expect(useUiStore.getState().confirm).toBeNull();
  });

  it('asks for confirmation before deleting a type that is in use', async () => {
    const user = userEvent.setup();
    render(<TypesSection />);
    await user.click(screen.getByRole('button', { name: 'Delete type Count' }));
    const request = useUiStore.getState().confirm;
    expect(request?.message).toMatch(/1 place uses/);
    expect(Object.keys(store().net.types)).toContain('Count');
    request?.onConfirm();
    expect(Object.keys(store().net.types)).toEqual(['Name']);
    expect(store().net.places[0]?.type).toBeUndefined();
  });

  it('opens the type dialog to edit or create', async () => {
    const user = userEvent.setup();
    render(<TypesSection />);
    await user.click(screen.getByRole('button', { name: 'Edit type Count' }));
    expect(useUiStore.getState().typeDialog).toEqual({ name: 'Count' });
    await user.click(screen.getByTestId('type-new'));
    expect(useUiStore.getState().typeDialog).toEqual({ name: null });
  });
});
