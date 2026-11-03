import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../App';
import { buildDomainCard } from '../../lib/domain-hover';
import { getDomainView } from '../../lib/domain-view';
import { loadExample } from '../../test/domain-fixtures';
import { useDomainEditStore } from '../../store/domain-edit-store';
import { useEditorStore } from '../../store/editor-store';
import { SPLIT_DEFAULT, useUiStore } from '../../store/ui-store';

const store = () => useEditorStore.getState();

beforeEach(() => {
  store().newNet();
  useUiStore.setState({
    toasts: [],
    confirm: null,
    shortcutsOpen: false,
    diagnosticsOpen: false,
    viewMode: 'net',
    rightTab: 'main',
    splitRatio: SPLIT_DEFAULT,
    hover: { id: null, source: null },
    domainEdit: false,
    jsonReveal: null,
  });
  useDomainEditStore.setState({ decor: null, renaming: null, menu: null, readout: null });
  store().loadNet(loadExample('bike-frames'), 'bike-frames.pn.json');
});

async function open() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByTestId('view-domain'));
  await screen.findByTestId('domain-canvas');
  return user;
}

const placeView = (id: string) => getDomainView()?.places[id] as unknown as Record<string, unknown>;

describe('emoji in the inspector (N4)', () => {
  it('sets an emoji as the look of a stage, takes the picture and the color away, and undoes it', async () => {
    const user = await open();
    store().select(['p_welded']);
    const field = await screen.findByTestId('domain-field-appearance-emoji');
    await user.type(field, '🔥{Enter}');
    expect(placeView('p_welded')['appearance']).toEqual({ emoji: '🔥' });
    expect(getDomainView()?.provenance['places.p_welded']?.source).toBe('user');
    // The picture picker shows the emoji as chosen; the color is not offered for an emoji.
    expect(screen.getByRole('radio', { name: 'Emoji' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('domain-field-appearance-tint-accent')).toBeDisabled();
    store().undo();
    await waitFor(() => {
      expect(placeView('p_welded')['appearance']).toEqual({ sprite: 'frame', tint: 'neutral' });
    });
    expect(screen.getByTestId('domain-field-appearance-emoji')).toHaveValue('');
  });

  it('choosing a picture takes the emoji away again, and an empty field does too', async () => {
    const user = await open();
    store().select(['p_welded']);
    const field = await screen.findByTestId('domain-field-appearance-emoji');
    await user.type(field, '🔥{Enter}');
    await user.click(screen.getByTestId('domain-field-appearance-sprite-bars'));
    expect(placeView('p_welded')['appearance']).toEqual({ sprite: 'bars' });
    await user.type(screen.getByTestId('domain-field-appearance-emoji'), '🍞{Enter}');
    expect(placeView('p_welded')['appearance']).toEqual({ emoji: '🍞' });
    await user.clear(screen.getByTestId('domain-field-appearance-emoji'));
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(placeView('p_welded')).not.toHaveProperty('appearance');
    });
  });

  it('shows the error of rule V12 at the field and writes nothing', async () => {
    const user = await open();
    store().select(['p_welded']);
    const field = await screen.findByTestId('domain-field-appearance-emoji');
    await user.type(field, 'ab{Enter}');
    expect(await screen.findByText(/exactly one emoji/)).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(placeView('p_welded')['appearance']).toEqual({ sprite: 'frame', tint: 'neutral' });
    // A valid emoji replaces the error.
    await user.clear(field);
    await user.type(field, '🦄{Enter}');
    await waitFor(() => {
      expect(placeView('p_welded')['appearance']).toEqual({ emoji: '🦄' });
    });
    expect(screen.queryByText(/exactly one emoji/)).toBeNull();
  });

  it('lists the finding of rule V12 when a stored view has a wrong emoji', async () => {
    await open();
    const view = structuredClone(getDomainView())!;
    (view.places['p_welded'] as { appearance?: unknown }).appearance = { emoji: '🦄🦄' };
    // The schema refuses such a view, so the editors are off and the finding is in the list.
    store().setDomainView(view);
    store().select(['p_welded']);
    const finding = await screen.findByTestId('domain-diagnostic');
    expect(finding).toHaveAttribute('data-rule', 'V12');
    expect(finding).toHaveTextContent(/exactly one emoji/);
    expect(finding).toHaveTextContent('places.p_welded.appearance.emoji');
  });

  it('sets an emoji as the symbol of a counter and replaces the built-in one', async () => {
    const user = await open();
    store().select(['p_co2']);
    const field = await screen.findByTestId('domain-field-display-emoji');
    await user.type(field, '🌳{Enter}');
    expect(placeView('p_co2')['display']).toMatchObject({
      style: 'pictogram',
      per: 50,
      emoji: '🌳',
      history: true,
    });
    expect(placeView('p_co2')['display']).not.toHaveProperty('icon');
    // A built-in symbol takes the emoji away.
    await user.click(screen.getByTestId('domain-field-display-icon-water'));
    expect(placeView('p_co2')['display']).toMatchObject({ icon: 'water' });
    expect(placeView('p_co2')['display']).not.toHaveProperty('emoji');
    store().undo();
    await waitFor(() => {
      expect(placeView('p_co2')['display']).toMatchObject({ emoji: '🌳' });
    });
  });

  it('sets an emoji as the entity of the view', async () => {
    const user = await open();
    const field = await screen.findByTestId('domain-emoji');
    await user.type(field, '🦄{Enter}');
    const entity = getDomainView()?.meta.entity as unknown as Record<string, unknown>;
    expect(entity['emoji']).toBe('🦄');
    expect(entity).not.toHaveProperty('sprite');
    await user.selectOptions(screen.getByTestId('domain-sprite'), 'parcel');
    const next = getDomainView()?.meta.entity as unknown as Record<string, unknown>;
    expect(next['sprite']).toBe('parcel');
    expect(next).not.toHaveProperty('emoji');
    // The singular and the plural keep their emoji-free form.
    expect(next['singular']).toBeDefined();
  });

  it('shows the emoji in the hover card of a stage', async () => {
    await open();
    const view = structuredClone(getDomainView())!;
    (view.places['p_welded'] as { appearance?: unknown }).appearance = { emoji: '🔥' };
    const card = buildDomainCard({
      net: store().net,
      view,
      marking: store().net.marking,
      id: 'p_welded',
    });
    expect(card?.look).toEqual({ emoji: '🔥' });
  });
});
