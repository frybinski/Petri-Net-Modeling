import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { IconButton } from './button';
import { Tooltip, TooltipProvider } from './tooltip';

describe('Tooltip', () => {
  it('appears after a short delay on hover, with the shortcut, and keeps the aria-label', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <IconButton label="Place" shortcut="P">
          <span>x</span>
        </IconButton>
      </TooltipProvider>,
    );
    const button = screen.getByRole('button', { name: 'Place' });
    expect(button).not.toHaveAttribute('title');
    await user.hover(button);
    expect(screen.queryByTestId('tooltip')).toBeNull();
    const tip = await screen.findByTestId('tooltip', undefined, { timeout: 1500 });
    expect(tip).toHaveTextContent('Place');
    expect(tip).toHaveTextContent('P');
    await user.unhover(button);
    await user.keyboard('{Escape}');
  });

  it('works without a shared provider and can be disabled', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Tooltip content="Alone">
          <button type="button">a</button>
        </Tooltip>
        <Tooltip content="Never" disabled>
          <button type="button">b</button>
        </Tooltip>
      </>,
    );
    await user.hover(screen.getByRole('button', { name: 'b' }));
    await user.unhover(screen.getByRole('button', { name: 'b' }));
    await user.hover(screen.getByRole('button', { name: 'a' }));
    expect(await screen.findByTestId('tooltip', undefined, { timeout: 1500 })).toHaveTextContent(
      'Alone',
    );
    expect(screen.queryByText('Never')).toBeNull();
  });
});
