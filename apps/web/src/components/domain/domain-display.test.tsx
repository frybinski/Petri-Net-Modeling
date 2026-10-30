import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../App';
import { buildDomainCard } from '../../lib/domain-hover';
import { getDomainView } from '../../lib/domain-view';
import { loadExample } from '../../test/domain-fixtures';
import { useDomainEditStore } from '../../store/domain-edit-store';
import { useEditorStore } from '../../store/editor-store';
import { SPLIT_DEFAULT, useUiStore } from '../../store/ui-store';
import type { DomainView } from '@pnm/domain';

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

describe('the display of a counter in the inspector (N2)', () => {
  it('shows the display of the tube store and offers only the symbols of amounts', async () => {
    await open();
    store().select(['p_tubes']);
    const group = await screen.findByTestId('domain-field-display-style');
    expect(within(group).getByTestId('domain-field-display-style-fill')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByTestId('domain-field-display-max')).toHaveValue('200');
    expect(screen.getByTestId('domain-field-display-low')).toHaveValue('40');
    const icons = within(screen.getByTestId('domain-field-display-icon'));
    expect(icons.getByTestId('domain-field-display-icon-material')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(icons.getByTestId('domain-field-display-icon-co2')).toBeInTheDocument();
    // A quantity shows no parcels.
    expect(icons.queryByTestId('domain-field-display-icon-parcel')).toBeNull();
    // A quantity holds no cases: no appearance.
    expect(screen.queryByTestId('domain-appearance')).toBeNull();
  });

  it('changes the style, keeps the symbol and takes one undo step each', async () => {
    const user = await open();
    store().select(['p_tubes']);
    await screen.findByTestId('domain-field-display-style');
    await user.click(screen.getByTestId('domain-field-display-style-pictogram'));
    expect(placeView('p_tubes')['display']).toMatchObject({
      style: 'pictogram',
      icon: 'material',
    });
    expect(screen.getByTestId('domain-field-display-per')).toBeInTheDocument();
    expect(screen.queryByTestId('domain-field-display-max')).toBeNull();
    // The entry is made by hand now.
    expect(getDomainView()?.provenance['places.p_tubes']?.source).toBe('user');
    store().undo();
    await waitFor(() => {
      expect(placeView('p_tubes')['display']).toMatchObject({ style: 'fill', max: 200 });
    });
    // Back to the number removes the field altogether (and the symbol with it).
    await user.click(screen.getByTestId('domain-field-display-style-number'));
    await waitFor(() => {
      expect(placeView('p_tubes')['display']).toMatchObject({ style: 'number', icon: 'material' });
    });
  });

  it('edits max, low and the scale of a pictogram', async () => {
    const user = await open();
    store().select(['p_tubes']);
    const max = await screen.findByTestId('domain-field-display-max');
    await user.clear(max);
    await user.type(max, '250{Enter}');
    expect(placeView('p_tubes')['display']).toMatchObject({ style: 'fill', max: 250, low: 40 });
    const low = screen.getByTestId('domain-field-display-low');
    await user.clear(low);
    await user.type(low, '{Enter}');
    await waitFor(() => {
      expect(placeView('p_tubes')['display']).not.toHaveProperty('low');
    });
    store().select(['p_co2']);
    const per = await screen.findByTestId('domain-field-display-per');
    expect(per).toHaveValue('50');
    await user.clear(per);
    await user.type(per, '25{Enter}');
    expect(placeView('p_co2')['display']).toMatchObject({
      style: 'pictogram',
      per: 25,
      history: true,
    });
  });

  it('puts the error of a rule at the field and does not write the display', async () => {
    const user = await open();
    store().select(['p_tubes']);
    const low = await screen.findByTestId('domain-field-display-low');
    await user.clear(low);
    await user.type(low, '300{Enter}');
    // low above max (200): rule V10, shown under the field.
    const error = await screen.findByText(/"low" \(300\) must not be larger than "max" \(200\)/);
    expect(low.parentElement?.parentElement).toContainElement(error);
    expect(low).toHaveAttribute('aria-invalid', 'true');
    expect(placeView('p_tubes')['display']).toMatchObject({ low: 40 });
    // Fixing it removes the error.
    await user.clear(low);
    await user.type(low, '60{Enter}');
    await waitFor(() => {
      expect(placeView('p_tubes')['display']).toMatchObject({ low: 60 });
    });
    expect(screen.queryByText(/must not be larger than/)).toBeNull();
  });

  it('sets the symbol and the curve', async () => {
    const user = await open();
    store().select(['p_waste']);
    await screen.findByTestId('domain-field-display-style');
    await user.click(screen.getByTestId('domain-field-display-icon-water'));
    expect(placeView('p_waste')['display']).toMatchObject({ icon: 'water' });
    await user.click(screen.getByTestId('domain-field-display-history'));
    expect(placeView('p_waste')['display']).toMatchObject({ history: true });
    await user.click(screen.getByTestId('domain-field-display-history'));
    expect(placeView('p_waste')['display']).not.toHaveProperty('history');
    await user.click(screen.getByTestId('domain-field-display-icon-none'));
    expect(placeView('p_waste')['display']).not.toHaveProperty('icon');
  });

  it('shows an error that the stored view already has, at its field', async () => {
    await open();
    const view = structuredClone(getDomainView()) as DomainView;
    (view.places['p_tubes'] as { display: { low: number } }).display.low = 999;
    store().setDomainView(view);
    store().select(['p_tubes']);
    // The list of problems in the panel has it, and so has the field it is about.
    const fieldError = (await screen.findByTestId('domain-field-display-low')).closest('div')!
      .parentElement!.parentElement!;
    await waitFor(() => {
      expect(within(fieldError).getByRole('alert')).toHaveTextContent(
        /must not be larger than "max"/,
      );
    });
    expect(screen.getByTestId('domain-field-display-low')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('domain-diagnostic')).toHaveAttribute('data-rule', 'V10');
  });

  it('is locked while simulating', async () => {
    await open();
    store().select(['p_tubes']);
    await screen.findByTestId('domain-field-display-max');
    useEditorStore.setState({ mode: 'simulate' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Domain view' }));
    await waitFor(() => {
      expect(screen.getByTestId('domain-field-display-max')).toBeDisabled();
    });
    expect(screen.getByTestId('domain-field-display-history')).toBeDisabled();
  });

  it('a plain counter can get a display, and the number again removes it', async () => {
    const user = await open();
    const view = structuredClone(getDomainView()) as DomainView;
    delete (view.places['p_scrap'] as { display?: unknown }).display;
    store().setDomainView(view);
    store().select(['p_scrap']);
    await screen.findByTestId('domain-field-display-style');
    expect(screen.getByTestId('domain-field-display-style-number')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await user.click(screen.getByTestId('domain-field-display-style-fill'));
    // A limit that suits the marking of the place.
    expect(placeView('p_scrap')['display']).toMatchObject({ style: 'fill', max: 10 });
    await user.click(screen.getByTestId('domain-field-display-style-number'));
    expect(placeView('p_scrap')).not.toHaveProperty('display');
  });
});

describe('the appearance of cases in the inspector (N2)', () => {
  it('shows the look of the welded frames and offers pictures with a color', async () => {
    await open();
    store().select(['p_welded']);
    const sprite = await screen.findByTestId('domain-field-appearance-sprite');
    expect(within(sprite).getByTestId('domain-field-appearance-sprite-frame')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    const tint = screen.getByTestId('domain-field-appearance-tint');
    expect(within(tint).getByTestId('domain-field-appearance-tint-neutral')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    // Every sprite, each with its name.
    for (const name of ['Bicycle frame', 'Bicycle', 'Bars', 'Parcel', 'Document']) {
      expect(within(sprite).getByRole('radio', { name })).toBeInTheDocument();
    }
    // A counter is no place for cases here: no display fields on a belt.
    expect(screen.queryByTestId('domain-display')).toBeNull();
  });

  it('changes the picture and the color, each one undo step, and the default takes the field away', async () => {
    const user = await open();
    store().select(['p_welded']);
    await screen.findByTestId('domain-field-appearance-sprite');
    await user.click(screen.getByTestId('domain-field-appearance-tint-accent'));
    expect(placeView('p_welded')['appearance']).toEqual({ sprite: 'frame', tint: 'accent' });
    expect(getDomainView()?.provenance['places.p_welded']?.source).toBe('user');
    await user.click(screen.getByTestId('domain-field-appearance-sprite-bicycle'));
    expect(placeView('p_welded')['appearance']).toEqual({ sprite: 'bicycle', tint: 'accent' });
    store().undo();
    await waitFor(() => {
      expect(placeView('p_welded')['appearance']).toEqual({ sprite: 'frame', tint: 'accent' });
    });
    await user.click(screen.getByTestId('domain-field-appearance-tint-none'));
    expect(placeView('p_welded')['appearance']).toEqual({ sprite: 'frame' });
    await user.click(screen.getByTestId('domain-field-appearance-sprite-none'));
    expect(placeView('p_welded')).not.toHaveProperty('appearance');
    store().undo();
    await waitFor(() => {
      expect(placeView('p_welded')['appearance']).toEqual({ sprite: 'frame' });
    });
  });

  it('a color alone takes the picture of the entity of the view', async () => {
    const user = await open();
    const view = structuredClone(getDomainView()) as DomainView;
    delete (view.places['p_ready'] as { appearance?: unknown }).appearance;
    store().setDomainView(view);
    store().select(['p_ready']);
    await screen.findByTestId('domain-field-appearance-sprite');
    await user.click(screen.getByTestId('domain-field-appearance-tint-ok'));
    expect(placeView('p_ready')['appearance']).toEqual({ sprite: 'frame', tint: 'ok' });
  });

  it('a sink of cases has both: a display and an appearance, and a quantity sink only the display', async () => {
    await open();
    store().select(['p_shipped']);
    await screen.findByTestId('domain-display');
    expect(screen.getByTestId('domain-appearance')).toBeInTheDocument();
    // Parcels are allowed as symbols of a sink of cases.
    expect(screen.getByTestId('domain-field-display-icon-parcel')).toBeInTheDocument();
    store().select(['p_co2']);
    await waitFor(() => {
      expect(screen.queryByTestId('domain-appearance')).toBeNull();
    });
    expect(screen.getByTestId('domain-display')).toBeInTheDocument();
  });

  it('keeps the new fields when the kind of the entry changes within what holds cases', async () => {
    const user = await open();
    store().select(['p_welded']);
    await user.selectOptions(await screen.findByTestId('domain-field-kind'), 'buffer');
    expect(placeView('p_welded')).toMatchObject({
      kind: 'buffer',
      appearance: { sprite: 'frame', tint: 'neutral' },
    });
  });
});

describe('the hover card of a counter with a graphic and of a stage (N2)', () => {
  const net = loadExample('bike-frames');
  const view = net.domainView as DomainView;
  const card = (id: string, count: number) =>
    buildDomainCard({
      net,
      view,
      marking: { [id]: Array.from({ length: count }, () => 1) },
      id,
    });

  it('names the limit and how full the container is', () => {
    expect(card('p_tubes', 120)?.limit).toEqual({ max: '200 kg', low: '40 kg', filled: 60 });
    expect(card('p_tubes', 213)?.limit).toEqual({
      max: '200 kg',
      low: '40 kg',
      filled: 100,
      over: 13,
    });
    expect(card('p_scrap', 3)?.limit).toEqual({ max: '10 kg', filled: 30 });
  });

  it('names the scale of a pictogram with its unit', () => {
    expect(card('p_co2', 130)?.scale).toEqual({ per: 50, unit: 'kg' });
    expect(card('p_shipped', 12)?.scale).toEqual({ per: 5, unit: '' });
    expect(card('p_orders', 3)?.scale).toBeUndefined();
  });

  it('names how the cases of a place look', () => {
    expect(card('p_welded', 1)?.look).toEqual({ sprite: 'frame', tint: 'neutral' });
    expect(card('p_orders', 1)?.look).toEqual({ sprite: 'document' });
    expect(card('p_tubes', 1)?.look).toBeUndefined();
  });

  it('shows these rows on the card', async () => {
    await open();
    // The real card is a portal that follows the pointer; the rows come from the same model.
    const { DomainHoverCard } = await import('./domain-hover-card');
    render(
      <DomainHoverCard
        model={card('p_tubes', 213)!}
        anchor={{ left: 10, right: 40, top: 100, bottom: 130 }}
      />,
    );
    expect(await screen.findByTestId('domain-card-limit')).toHaveTextContent('200 kg');
    expect(screen.getByTestId('domain-card-low')).toHaveTextContent('40 kg');
    expect(screen.getByTestId('domain-card-filled')).toHaveTextContent('100 %');
    expect(screen.getByTestId('domain-card-over')).toHaveTextContent('by 13');
  });
});

describe('the status of the view reports a fill level over its limit (N2)', () => {
  it('names it in the panel and in the status bar, and says nothing otherwise', async () => {
    const user = await open();
    await user.click(screen.getByTestId('right-tab-domain'));
    expect(screen.queryByTestId('domain-overflows')).toBeNull();
    expect(screen.queryByTestId('domain-overflow')).toBeNull();
    // 213 kg of tube in a store that holds 200.
    const net = structuredClone(store().net);
    net.marking['p_tubes'] = Array.from({ length: 213 }, () => 1);
    useEditorStore.setState({ net });
    const list = await screen.findByTestId('domain-overflows');
    expect(list).toHaveTextContent('Fill level exceeded: Rohrlager 213 > 200');
    expect(screen.getByTestId('domain-overflow')).toHaveTextContent(
      'Fill level exceeded: Rohrlager 213 > 200',
    );
    // It is a note, not a problem of the view.
    expect(screen.getByTestId('domain-status')).toHaveTextContent('0 problems');
  });

  it('follows the simulated marking while simulating', async () => {
    await open();
    store().startSimulation();
    await waitFor(() => {
      expect(useEditorStore.getState().simMarking).not.toBeNull();
    });
    const marking = { ...useEditorStore.getState().simMarking! };
    marking['p_scrap'] = Array.from({ length: 11 }, () => 1);
    useEditorStore.setState({ simMarking: marking });
    expect(await screen.findByTestId('domain-overflow')).toHaveTextContent(
      'Fill level exceeded: Schrott 11 > 10',
    );
    store().stopSimulation();
  });
});
