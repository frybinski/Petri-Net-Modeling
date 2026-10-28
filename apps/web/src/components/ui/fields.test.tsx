import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NumberField, TextField } from './fields';

describe('TextField', () => {
  it('commits on Enter and on blur, and reverts on Escape', async () => {
    const onCommit = vi.fn();
    const user = userEvent.setup();
    render(<TextField label="Name" value="P1" onCommit={onCommit} />);
    const input = screen.getByLabelText('Name');
    await user.clear(input);
    await user.type(input, 'Buffer{Enter}');
    expect(onCommit).toHaveBeenLastCalledWith('Buffer');

    await user.clear(input);
    await user.type(input, 'X');
    await user.tab();
    expect(onCommit).toHaveBeenLastCalledWith('X');

    onCommit.mockClear();
    await user.clear(input);
    await user.type(input, 'dropped{Escape}');
    expect(onCommit).not.toHaveBeenCalled();
    expect(input).toHaveValue('P1');
  });

  it('follows external changes of the value', () => {
    const { rerender } = render(<TextField label="Name" value="A" onCommit={() => undefined} />);
    rerender(<TextField label="Name" value="B" onCommit={() => undefined} />);
    expect(screen.getByLabelText('Name')).toHaveValue('B');
  });
});

describe('NumberField', () => {
  it('commits clamped integers', async () => {
    const onCommit = vi.fn();
    const user = userEvent.setup();
    render(<NumberField label="Weight" value={2} min={1} max={9} onCommit={onCommit} />);
    const input = screen.getByLabelText('Weight');
    await user.clear(input);
    await user.type(input, '42{Enter}');
    expect(onCommit).toHaveBeenLastCalledWith(9);
    await user.clear(input);
    await user.type(input, '0{Enter}');
    expect(onCommit).toHaveBeenLastCalledWith(1);
  });

  it('restores the old value for non-numeric input and for empty input without allowEmpty', async () => {
    const onCommit = vi.fn();
    const user = userEvent.setup();
    render(<NumberField label="Weight" value={3} min={1} onCommit={onCommit} />);
    const input = screen.getByLabelText('Weight');
    await user.clear(input);
    await user.type(input, 'abc{Enter}');
    expect(input).toHaveValue('3');
    await user.clear(input);
    await user.tab();
    expect(input).toHaveValue('3');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('supports empty values, stepper buttons and arrow keys', async () => {
    const onCommit = vi.fn();
    const user = userEvent.setup();
    render(<NumberField label="Capacity" value={2} min={1} allowEmpty onCommit={onCommit} />);
    await user.click(screen.getByRole('button', { name: 'Increase capacity' }));
    expect(onCommit).toHaveBeenLastCalledWith(3);
    await user.click(screen.getByRole('button', { name: 'Decrease capacity' }));
    expect(onCommit).toHaveBeenLastCalledWith(1);
    const input = screen.getByLabelText('Capacity');
    await user.clear(input);
    await user.tab();
    expect(onCommit).toHaveBeenLastCalledWith(undefined);
    await user.click(input);
    await user.keyboard('{ArrowUp}');
    expect(onCommit).toHaveBeenLastCalledWith(3);
  });

  it('disables the stepper at the limits', () => {
    render(<NumberField label="Tokens" value={0} min={0} max={0} onCommit={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Decrease tokens' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Increase tokens' })).toBeDisabled();
  });
});
