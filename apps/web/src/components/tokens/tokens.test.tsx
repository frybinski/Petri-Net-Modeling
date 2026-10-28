import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../../store/editor-store';
import { useUiStore } from '../../store/ui-store';
import { TokenDialog } from './token-dialog';
import { TokensSection } from './tokens-section';

const store = () => useEditorStore.getState();

function setup(): string {
  store().newNet();
  useUiStore.setState({ toasts: [], tokenDialog: null });
  store().setProfile('json-net');
  const p = store().addPlace({ x: 0, y: 0 }) as string;
  store().saveType(null, 'Count', { type: 'integer', minimum: 0 });
  store().setPlaceType(p, 'Count');
  store().setPlaceTokens(p, [1, 2]);
  return p;
}

let place = '';
beforeEach(() => {
  place = setup();
});

describe('TokensSection', () => {
  it('lists the tokens and removes and duplicates them', async () => {
    const user = userEvent.setup();
    render(<TokensSection placeId={place} />);
    expect(screen.getAllByTestId('token-item')).toHaveLength(2);
    expect(screen.getByTestId('token-total')).toHaveTextContent('2 tokens');

    await user.click(screen.getByRole('button', { name: 'Duplicate token 1' }));
    expect(store().net.marking[place]).toEqual([1, 2, 1]);
    await user.click(screen.getByRole('button', { name: 'Delete token 2' }));
    expect(store().net.marking[place]).toEqual([1, 1]);
  });

  it('marks tokens that violate the type', () => {
    store().addToken(place, -5);
    render(<TokensSection placeId={place} />);
    const items = screen.getAllByTestId('token-item');
    expect(within(items[2] as HTMLElement).getByTestId('token-mismatch')).toBeInTheDocument();
    expect(within(items[0] as HTMLElement).queryByTestId('token-mismatch')).toBeNull();
  });

  it('opens the token dialog for a new token', async () => {
    const user = userEvent.setup();
    render(<TokensSection placeId={place} />);
    await user.click(screen.getByTestId('token-add'));
    expect(useUiStore.getState().tokenDialog).toEqual({ placeId: place, index: null });
  });
});

describe('TokenDialog', () => {
  it('uses a number field for integer types and saves a new token', async () => {
    const user = userEvent.setup();
    useUiStore.setState({ tokenDialog: { placeId: place, index: null } });
    render(<TokenDialog placeId={place} index={null} />);
    const input = screen.getByTestId('token-input');
    expect(input).toHaveValue('0');
    await user.clear(input);
    await user.type(input, '42');
    await user.click(screen.getByTestId('token-save'));
    expect(store().net.marking[place]).toEqual([1, 2, 42]);
    expect(useUiStore.getState().tokenDialog).toBeNull();
  });

  it('edits an existing token', async () => {
    const user = userEvent.setup();
    render(<TokenDialog placeId={place} index={1} />);
    const input = screen.getByTestId('token-input');
    expect(input).toHaveValue('2');
    await user.clear(input);
    await user.type(input, '9');
    await user.click(screen.getByTestId('token-save'));
    expect(store().net.marking[place]).toEqual([1, 9]);
  });

  it('refuses text that is not a number, but warns about type mismatches without blocking', async () => {
    const user = userEvent.setup();
    render(<TokenDialog placeId={place} index={0} />);
    const input = screen.getByTestId('token-input');
    await user.clear(input);
    await user.type(input, 'abc');
    expect(screen.getByTestId('token-save')).toBeDisabled();
    expect(screen.getByTestId('token-status')).toHaveTextContent('Enter a number');
    await user.clear(input);
    await user.type(input, '-3');
    expect(screen.getByTestId('token-save')).toBeEnabled();
    expect(screen.getByTestId('token-status')).toHaveTextContent(/Does not match type Count/);
    await user.click(screen.getByTestId('token-save'));
    expect(store().net.marking[place]?.[0]).toBe(-3);
  });
});
