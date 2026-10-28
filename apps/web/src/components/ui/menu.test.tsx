import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Menu } from './menu';

function setup() {
  const first = vi.fn();
  const second = vi.fn();
  render(
    <Menu
      label="File"
      sections={[
        {
          items: [
            { id: 'a', label: 'Alpha', onSelect: first },
            { id: 'b', label: 'Beta', onSelect: second, shortcut: 'Ctrl+B' },
            { id: 'c', label: 'Gamma', onSelect: () => undefined, disabled: true },
          ],
        },
      ]}
    />,
  );
  return { first, second };
}

describe('Menu', () => {
  it('opens, moves focus with the arrow keys and selects with Enter', async () => {
    const { second } = setup();
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: /File/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menuitem', { name: 'Alpha' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: /Beta/ })).toHaveFocus();
    await user.keyboard('{ArrowDown}'); // wraps around: Gamma is disabled
    expect(screen.getByRole('menuitem', { name: 'Alpha' })).toHaveFocus();
    await user.keyboard('{ArrowUp}{Enter}');
    expect(second).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('closes with Escape and returns focus to the trigger', async () => {
    setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /File/ }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: /File/ })).toHaveFocus();
  });

  it('closes on outside clicks and does not run disabled items', async () => {
    const { first } = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /File/ }));
    expect(screen.getByRole('menuitem', { name: 'Gamma' })).toBeDisabled();
    await user.click(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(first).not.toHaveBeenCalled();
  });
});
