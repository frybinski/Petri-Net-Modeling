import {
  createEmptyNet,
  indicatorProblems,
  validate,
  type Indicator,
  type PetriNet,
} from '@pnm/core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../../store/editor-store';
import { useUiStore } from '../../store/ui-store';
import { TooltipProvider } from '../ui/tooltip';
import { IndicatorDialog } from './indicator-dialog';
import { IndicatorsSection } from './indicators-section';

const store = () => useEditorStore.getState();

/** The place of the dialog in the app: the section and, when asked for, the dialog. */
function Harness() {
  const dialog = useUiStore((s) => s.indicatorDialog);
  return (
    <TooltipProvider>
      <IndicatorsSection />
      {dialog ? <IndicatorDialog key={dialog.index ?? 'new'} index={dialog.index} /> : null}
    </TooltipProvider>
  );
}

/** order -> cut (takes 3 steel, gives 1 CO2) -> done, with a store of steel and a CO2 counter. */
function frames(indicators: Indicator[] = []): PetriNet {
  const net = createEmptyNet('Frames');
  net.places.push(
    { id: 'orders', name: 'Orders', position: { x: 0, y: 0 } },
    { id: 'steel', name: 'Steel (kg)', position: { x: 0, y: 0 }, role: 'quantity' },
    { id: 'co2', name: 'CO2e (kg)', position: { x: 0, y: 0 }, role: 'quantity' },
    { id: 'done', name: 'Done', position: { x: 0, y: 0 } },
  );
  net.transitions.push(
    { id: 'cut', name: 'Cutting', position: { x: 0, y: 0 } },
    { id: 'weld', name: 'Welding', position: { x: 0, y: 0 } },
  );
  const arcs: Array<[string, string, number?]> = [
    ['orders', 'cut'],
    ['steel', 'cut', 3],
    ['cut', 'co2'],
    ['cut', 'done'],
    ['weld', 'co2', 2],
  ];
  arcs.forEach(([source, target, weight = 1], i) =>
    net.arcs.push({ id: `a${i}`, source, target, weight }),
  );
  if (indicators.length > 0) net.simulation = { indicators };
  return net;
}

const co2: Indicator = {
  id: 'co2-per-frame',
  label: 'CO2e per frame',
  unit: 'kg',
  measure: { kind: 'inflow', of: 'co2' },
  per: 'case',
};

beforeEach(() => {
  store().newNet();
  useUiStore.setState({ indicatorDialog: null, toasts: [] });
});

describe('the list of indicators', () => {
  it('says so when there are none, and offers to add one', () => {
    store().loadNet(frames(), null);
    render(<Harness />);
    expect(screen.getByTestId('indicator-empty')).toBeInTheDocument();
    expect(screen.getByTestId('indicator-add')).toBeEnabled();
  });

  it('lists each indicator with its unit and what it measures', () => {
    store().loadNet(
      frames([
        co2,
        {
          id: 'share',
          label: 'Share',
          unit: '%',
          measure: { kind: 'inflow', of: 'steel', via: 'weld' },
          per: { kind: 'tokens', of: 'steel' },
        },
      ]),
      null,
    );
    render(<Harness />);
    const items = screen.getAllByTestId('indicator-item');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('CO2e per frame');
    expect(items[0]).toHaveTextContent('(kg)');
    expect(items[0]).toHaveTextContent('put on CO2e (kg) · per completed case');
    expect(within(items[0]!).queryByTestId('indicator-problem')).toBeNull();
  });

  it('marks an indicator that points to a deleted element instead of removing it', () => {
    store().loadNet(frames([co2]), null);
    store().select(['co2']);
    store().removeSelected();
    render(<Harness />);
    // The place is gone; the indicator is still there and says what is wrong.
    expect(store().net.places.some((p) => p.id === 'co2')).toBe(false);
    expect(store().net.simulation?.indicators).toHaveLength(1);
    expect(screen.getByTestId('indicator-problem')).toHaveTextContent('has no place "co2"');
    expect(validate(store().net).some((d) => d.code === 'INDICATOR_INVALID')).toBe(true);
  });

  it('removes an indicator in one undo step', async () => {
    const user = userEvent.setup();
    store().loadNet(frames([co2]), null);
    render(<Harness />);
    await user.click(screen.getByTestId('indicator-remove'));
    expect(store().net.simulation).toBeUndefined();
    expect(screen.getByTestId('indicator-empty')).toBeInTheDocument();
    store().undo();
    expect(store().net.simulation?.indicators).toEqual([co2]);
  });

  it('cannot be changed while the simulation runs', () => {
    store().loadNet(frames([co2]), null);
    useEditorStore.setState({ mode: 'simulate' });
    render(<Harness />);
    expect(screen.getByTestId('indicator-add')).toBeDisabled();
    expect(screen.getByTestId('indicator-remove')).toBeDisabled();
  });
});

describe('the indicator editor', () => {
  it('adds an indicator, with an id made from its name, as one undo step', async () => {
    const user = userEvent.setup();
    store().loadNet(frames(), null);
    render(<Harness />);
    await user.click(screen.getByTestId('indicator-add'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Nothing to save without a name.
    expect(screen.getByTestId('indicator-save')).toBeDisabled();
    await user.type(screen.getByTestId('indicator-label'), 'CO2e per frame{Enter}');
    await user.type(screen.getByTestId('indicator-unit'), 'kg{Enter}');
    await user.selectOptions(screen.getByTestId('indicator-measure-kind'), 'inflow');
    await user.selectOptions(screen.getByTestId('indicator-measure-of'), 'co2');
    await user.selectOptions(screen.getByTestId('indicator-per'), 'case');
    expect(screen.getByTestId('indicator-summary')).toHaveTextContent(
      'put on CO2e (kg) · per completed case',
    );
    await user.click(screen.getByTestId('indicator-save'));
    expect(store().net.simulation?.indicators).toEqual([
      {
        id: 'co2e-per-frame',
        label: 'CO2e per frame',
        unit: 'kg',
        measure: { kind: 'inflow', of: 'co2' },
        per: 'case',
      },
    ]);
    expect(useUiStore.getState().indicatorDialog).toBeNull();
    // One undo step takes it away again.
    store().undo();
    expect(store().net.simulation).toBeUndefined();
    store().redo();
    expect(store().net.simulation?.indicators).toHaveLength(1);
  });

  it('adds a share: a flow over one transition relative to another measure, with factor and places', async () => {
    const user = userEvent.setup();
    store().loadNet(frames(), null);
    render(<Harness />);
    await user.click(screen.getByTestId('indicator-add'));
    await user.type(screen.getByTestId('indicator-label'), 'Welding share{Enter}');
    await user.selectOptions(screen.getByTestId('indicator-measure-of'), 'co2');
    // Only the transitions with an arc into the place can be chosen.
    const via = screen.getByTestId('indicator-measure-via');
    expect(
      within(via)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Any transition', 'Cutting', 'Welding']);
    await user.selectOptions(via, 'weld');
    await user.selectOptions(screen.getByTestId('indicator-per'), 'measure');
    await user.selectOptions(screen.getByTestId('indicator-per-measure-of'), 'co2');
    await user.type(screen.getByTestId('indicator-factor'), '100{Enter}');
    await user.type(screen.getByTestId('indicator-digits'), '0{Enter}');
    await user.click(screen.getByTestId('indicator-save'));
    expect(store().net.simulation?.indicators).toEqual([
      {
        id: 'welding-share',
        label: 'Welding share',
        measure: { kind: 'inflow', of: 'co2', via: 'weld' },
        per: { kind: 'inflow', of: 'co2' },
        factor: 100,
        digits: 0,
      },
    ]);
    expect(indicatorProblems(store().net, store().net.simulation!.indicators![0]!)).toEqual([]);
  });

  it('counts the firings of a transition, which are chosen among the transitions', async () => {
    const user = userEvent.setup();
    store().loadNet(frames(), null);
    render(<Harness />);
    await user.click(screen.getByTestId('indicator-add'));
    await user.type(screen.getByTestId('indicator-label'), 'Cuts per hour{Enter}');
    await user.selectOptions(screen.getByTestId('indicator-measure-kind'), 'firings');
    const of = screen.getByTestId('indicator-measure-of');
    expect(
      within(of)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Cutting', 'Welding']);
    expect(screen.queryByTestId('indicator-measure-via')).toBeNull();
    await user.selectOptions(of, 'cut');
    await user.selectOptions(screen.getByTestId('indicator-per'), 'hour');
    await user.click(screen.getByTestId('indicator-save'));
    expect(store().net.simulation?.indicators?.[0]).toMatchObject({
      measure: { kind: 'firings', of: 'cut' },
      per: 'hour',
    });
  });

  it('shows the error at the field and does not save while it is there', async () => {
    const user = userEvent.setup();
    const bad: Indicator = { ...co2, measure: { kind: 'inflow', of: 'gone', via: 'cut' } };
    store().loadNet(frames([bad]), null);
    render(<Harness />);
    await user.click(screen.getByTestId('indicator-item').querySelector('button')!);
    const of = screen.getByTestId('indicator-measure-of');
    // The select names the missing place and the message stands under it.
    expect(within(of).getByRole('option', { name: 'gone (not in the net)' })).toBeInTheDocument();
    const alerts = screen.getAllByRole('alert').map((a) => a.textContent);
    expect(alerts.some((a) => /no place "gone"/.test(a ?? ''))).toBe(true);
    expect(of).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('indicator-save')).toBeDisabled();
    // Choosing an existing place clears the error (and the transition, which belonged to the old
    // place), and the form can be saved.
    await user.selectOptions(of, 'co2');
    expect(of).not.toHaveAttribute('aria-invalid');
    expect(screen.getByTestId('indicator-save')).toBeEnabled();
  });

  it('shows the error of a via without arc at the via field', async () => {
    const user = userEvent.setup();
    const bad: Indicator = { ...co2, measure: { kind: 'inflow', of: 'steel', via: 'cut' } };
    store().loadNet(frames([bad]), null);
    render(<Harness />);
    await user.click(screen.getByTestId('indicator-item').querySelector('button')!);
    const via = screen.getByTestId('indicator-measure-via');
    expect(via).toHaveAttribute('aria-invalid', 'true');
    expect(
      screen
        .getAllByRole('alert')
        .map((a) => a.textContent)
        .join(' '),
    ).toMatch(/no arc from "cut" to "steel"/);
    expect(screen.getByTestId('indicator-save')).toBeDisabled();
    await user.selectOptions(via, '');
    expect(screen.getByTestId('indicator-save')).toBeEnabled();
  });

  it('edits an indicator in place and keeps its id', async () => {
    const user = userEvent.setup();
    store().loadNet(frames([co2]), null);
    render(<Harness />);
    await user.click(screen.getByTestId('indicator-item').querySelector('button')!);
    const label = screen.getByTestId('indicator-label');
    await user.clear(label);
    await user.type(label, 'Carbon per frame{Enter}');
    await user.click(screen.getByTestId('indicator-save'));
    expect(store().net.simulation?.indicators).toEqual([{ ...co2, label: 'Carbon per frame' }]);
  });

  it('cancels without a change', async () => {
    const user = userEvent.setup();
    store().loadNet(frames([co2]), null);
    const before = store().net;
    render(<Harness />);
    await user.click(screen.getByTestId('indicator-item').querySelector('button')!);
    await user.click(screen.getByTestId('indicator-cancel'));
    expect(store().net).toBe(before);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('gives a second indicator with the same name its own id', async () => {
    const user = userEvent.setup();
    store().loadNet(frames([{ ...co2, id: 'co2e-per-frame', label: 'CO2e per frame' }]), null);
    render(<Harness />);
    await user.click(screen.getByTestId('indicator-add'));
    await user.type(screen.getByTestId('indicator-label'), 'CO2e per frame{Enter}');
    await user.selectOptions(screen.getByTestId('indicator-measure-of'), 'steel');
    await user.click(screen.getByTestId('indicator-save'));
    expect(store().net.simulation?.indicators?.map((i) => i.id)).toEqual([
      'co2e-per-frame',
      'co2e-per-frame-2',
    ]);
  });
});
