import { createEmptyNet, type PetriNet } from '@pnm/core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorStore } from '../store/editor-store';
import { useUiStore } from '../store/ui-store';
import { SimulationPanel } from './simulation-panel';
import { TooltipProvider } from './ui/tooltip';

const store = () => useEditorStore.getState();

/** arrive (360/h) -> wait -> serve (10 s, one clerk) -> done */
function shop(): PetriNet {
  const net = createEmptyNet('Shop');
  for (const id of ['wait', 'clerk', 'done']) {
    net.places.push({ id, name: id === 'wait' ? 'Queue' : id, position: { x: 0, y: 0 } });
  }
  net.marking['clerk'] = [1];
  net.marking['wait'] = [1, 1];
  net.transitions.push(
    { id: 'arrive', name: 'Arrive', position: { x: 0, y: 0 }, rate: 360 },
    { id: 'serve', name: 'Serve', position: { x: 0, y: 0 }, timing: { kind: 'fixed', value: 10 } },
  );
  const arcs: Array<[string, string]> = [
    ['arrive', 'wait'],
    ['wait', 'serve'],
    ['clerk', 'serve'],
    ['serve', 'clerk'],
    ['serve', 'done'],
  ];
  arcs.forEach(([source, target], i) => net.arcs.push({ id: `a${i}`, source, target, weight: 1 }));
  return net;
}

function plain(): PetriNet {
  const net = createEmptyNet('Plain');
  net.places.push(
    { id: 'p', name: 'P', position: { x: 0, y: 0 } },
    { id: 'q', name: 'Q', position: { x: 0, y: 0 } },
  );
  net.transitions.push({ id: 't', name: 'T', position: { x: 0, y: 0 } });
  net.arcs.push(
    { id: 'a1', source: 'p', target: 't', weight: 1 },
    { id: 'a2', source: 't', target: 'q', weight: 1 },
  );
  net.marking['p'] = [1, 1];
  return net;
}

function renderPanel() {
  return render(
    <TooltipProvider>
      <SimulationPanel />
    </TooltipProvider>,
  );
}

const settled = () =>
  waitFor(() => {
    expect(store().computing).toBe(false);
  });

beforeEach(() => {
  useUiStore.setState({ toasts: [], simTab: 'enabled', bottleneckWarn: 6, bottleneckCritical: 10 });
});

afterEach(() => {
  store().stopSimulation();
});

describe('simulation controls of a timed net', () => {
  beforeEach(async () => {
    store().loadNet(shop(), null);
    store().startSimulation();
    await settled();
  });

  it('shows the clock and the cases in the system', () => {
    renderPanel();
    expect(screen.getByTestId('sim-clock')).toHaveTextContent('00:00:00');
    expect(screen.getByTestId('sim-cases')).toHaveTextContent('2');
    expect(screen.getByTestId('sim-status')).toHaveTextContent('Paused');
    expect(screen.getByTestId('sim-step-next')).toBeInTheDocument();
    expect(screen.queryByTestId('step-random')).toBeNull();
  });

  it('plays and pauses', async () => {
    const user = userEvent.setup();
    renderPanel();
    const play = screen.getByTestId('sim-play');
    expect(play).toHaveTextContent('Play');
    expect(play).toHaveAttribute('aria-pressed', 'false');
    await user.click(play);
    expect(store().simPlaying).toBe(true);
    expect(play).toHaveTextContent('Pause');
    expect(play).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('sim-status')).toHaveTextContent('Running');
    await user.click(play);
    expect(store().simPlaying).toBe(false);
  });

  it('offers the speeds and marks the chosen one', async () => {
    const user = userEvent.setup();
    renderPanel();
    const speeds = within(screen.getByTestId('sim-speed')).getAllByRole('button');
    expect(speeds.map((b) => b.textContent)).toEqual([
      '1×',
      '2×',
      '5×',
      '10×',
      '30×',
      '60×',
      'max',
    ]);
    expect(screen.getByTestId('sim-speed-10')).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByTestId('sim-speed-60'));
    expect(store().simSpeed).toBe(60);
    expect(screen.getByTestId('sim-speed-60')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('sim-speed-10')).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByTestId('sim-speed-max'));
    expect(store().simSpeed).toBe('max');
  });

  it('steps, steps back and resets', async () => {
    const user = userEvent.setup();
    renderPanel();
    const back = screen.getByTestId('sim-back');
    expect(back).toBeDisabled();
    await user.click(screen.getByTestId('sim-step-next'));
    await settled();
    await user.click(screen.getByTestId('sim-step-next'));
    await settled();
    const time = screen.getByTestId('sim-clock').textContent;
    expect(time).not.toBe('00:00:00');
    expect(back).toBeEnabled();
    await user.click(back);
    await settled();
    expect(screen.getByTestId('sim-clock').textContent).not.toBe(time);
    await user.click(screen.getByTestId('sim-reset'));
    await settled();
    expect(screen.getByTestId('sim-clock')).toHaveTextContent('00:00:00');
    expect(back).toBeDisabled();
  });

  it('leaves the simulation with the button', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByTestId('sim-exit'));
    expect(store().mode).toBe('edit');
  });
});

describe('simulation controls without time', () => {
  it('has a random step instead of a clock', async () => {
    const user = userEvent.setup();
    store().loadNet(plain(), null);
    store().startSimulation();
    await settled();
    renderPanel();
    expect(screen.queryByTestId('sim-clock')).toBeNull();
    expect(screen.queryByTestId('sim-step-next')).toBeNull();
    expect(screen.getByTestId('sim-speed-1')).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByTestId('step-random'));
    await settled();
    expect(store().simHistory).toHaveLength(1);
    expect(screen.getByTestId('sim-back')).toBeEnabled();
    await user.click(screen.getByTestId('sim-back'));
    await settled();
    expect(store().simHistory).toHaveLength(0);
    expect(screen.getByTestId('enabled-summary')).toHaveTextContent('1 enabled transition');
  });
});

describe('tabs', () => {
  it('switch with a click and with the arrow keys', async () => {
    const user = userEvent.setup();
    store().loadNet(shop(), null);
    store().startSimulation();
    await settled();
    renderPanel();
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByTestId('sim-tab-enabled')).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByTestId('sim-tab-trace'));
    expect(screen.getByTestId('trace-tab')).toBeInTheDocument();
    expect(screen.getByTestId('sim-tab-trace')).toHaveAttribute('aria-selected', 'true');
    screen.getByTestId('sim-tab-trace').focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByTestId('metrics-tab')).toBeInTheDocument();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByTestId('sim-tab-enabled')).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByTestId('sim-tab-metrics')).toHaveAttribute('aria-selected', 'true');
  });
});

describe('trace tab', () => {
  beforeEach(async () => {
    store().loadNet(shop(), null);
    store().startSimulation();
    await settled();
    await store().stepNext();
    await store().stepNext();
    useUiStore.setState({ simTab: 'trace' });
  });

  it('lists the events, newest first, and filters them', async () => {
    const user = userEvent.setup();
    renderPanel();
    const rows = screen.getAllByTestId('trace-row');
    expect(rows.length).toBeGreaterThan(2);
    const all = rows.length;
    await user.selectOptions(screen.getByTestId('trace-filter-type'), 'complete');
    const completes = screen.getAllByTestId('trace-row');
    expect(completes.every((r) => r.getAttribute('data-type') === 'complete')).toBe(true);
    expect(completes.length).toBeLessThan(all);
    await user.selectOptions(screen.getByTestId('trace-filter-type'), '');
    await user.selectOptions(screen.getByTestId('trace-filter-transition'), 'Serve');
    for (const row of screen.getAllByTestId('trace-row')) expect(row).toHaveTextContent('Serve');
  });

  it('selects the transition of a clicked row', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.selectOptions(screen.getByTestId('trace-filter-transition'), 'Serve');
    await user.click(screen.getAllByTestId('trace-row')[0] as HTMLElement);
    expect(store().selection).toEqual(['serve']);
  });

  it('says so when nothing matches', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.selectOptions(screen.getByTestId('trace-filter-type'), 'breakpoint');
    expect(screen.queryByTestId('trace-row')).toBeNull();
    expect(screen.getByText(/No event matches/)).toBeInTheDocument();
  });
});

describe('export', () => {
  let blobs: Blob[];
  let clicks: HTMLAnchorElement[];

  beforeEach(async () => {
    blobs = [];
    clicks = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return 'blob:test';
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push(this);
    });
    store().loadNet(shop(), null);
    store().startSimulation();
    await settled();
    useUiStore.setState({ simTab: 'trace' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses to export an empty log', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByTestId('export-csv'));
    expect(clicks).toHaveLength(0);
    expect(useUiStore.getState().toasts.at(-1)?.message).toMatch(/no events with a case/);
  });

  it('downloads the event log as CSV with four columns', async () => {
    const user = userEvent.setup();
    await store().stepNext();
    await store().stepNext();
    renderPanel();
    await user.click(screen.getByTestId('export-csv'));
    expect(clicks).toHaveLength(1);
    expect(clicks[0]?.download).toBe('Shop-events.csv');
    const text = await blobs[0]!.text();
    const lines = text.trim().split('\n');
    expect(lines[0]).toBe('case_id,activity,timestamp,lifecycle');
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines.slice(1)) expect(line.split(',')).toHaveLength(4);
    expect(useUiStore.getState().toasts.at(-1)?.message).toMatch(/Exported \d+ rows/);
  });

  it('downloads the event log as XES', async () => {
    const user = userEvent.setup();
    await store().stepNext();
    renderPanel();
    await user.click(screen.getByTestId('export-xes'));
    expect(clicks[0]?.download).toBe('Shop-events.xes');
    const text = await blobs[0]!.text();
    expect(text).toContain('<log xes.version="1.0"');
    expect(text).toContain('<trace>');
  });
});

describe('metrics tab', () => {
  it('shows throughput, cycle time and the tables once cases have finished', async () => {
    store().loadNet(shop(), null);
    store().startSimulation();
    await settled();
    store().setSimSpeed('max');
    for (let i = 0; i < 6; i += 1) await store().stepNext();
    useUiStore.setState({ simTab: 'metrics' });
    renderPanel();
    expect(screen.getByTestId('metric-cases')).toBeInTheDocument();
    expect(screen.getByTestId('metric-cycle')).toBeInTheDocument();
    expect(screen.getByTestId('metrics-places')).toBeInTheDocument();
    expect(screen.getByTestId('metrics-resources')).toBeInTheDocument();
    expect(screen.getAllByTestId('metrics-resource-row')).toHaveLength(1);
  });

  it('changes the queue thresholds', async () => {
    const user = userEvent.setup();
    store().loadNet(shop(), null);
    store().startSimulation();
    await settled();
    useUiStore.setState({ simTab: 'metrics' });
    renderPanel();
    const warn = screen.getByTestId('bottleneck-warn');
    await user.clear(warn);
    await user.type(warn, '3{Enter}');
    expect(useUiStore.getState().bottleneckWarn).toBe(3);
    const critical = screen.getByTestId('bottleneck-critical');
    await user.clear(critical);
    await user.type(critical, '2{Enter}');
    // The red threshold cannot be below the yellow one.
    expect(useUiStore.getState().bottleneckCritical).toBeGreaterThanOrEqual(
      useUiStore.getState().bottleneckWarn,
    );
  });

  it('explains that nets without time have no figures', async () => {
    store().loadNet(plain(), null);
    store().startSimulation();
    await settled();
    useUiStore.setState({ simTab: 'metrics' });
    renderPanel();
    // The tab falls back to the first one for a net without a clock.
    expect(screen.queryByTestId('metrics-tab')).toBeNull();
    expect(screen.getByTestId('sim-tab-enabled')).toHaveAttribute('aria-selected', 'true');
  });
});

describe('controls for a running simulation', () => {
  beforeEach(async () => {
    store().loadNet(shop(), null);
    store().startSimulation();
    await settled();
  });

  it('changes the arrival rate with the slider', async () => {
    renderPanel();
    const slider = screen.getByTestId('arrival-slider');
    expect(screen.getByTestId('arrival-value')).toHaveTextContent('360 per hour');
    fireEvent.change(slider, { target: { value: '0' } });
    await settled();
    expect(screen.getByTestId('arrival-value')).toHaveTextContent('off');
    expect(store().simRates['arrive']).toBeNull();
    fireEvent.change(slider, { target: { value: '720' } });
    await settled();
    expect(store().simRates['arrive']).toBe(720);
  });

  it('adds and withdraws resources', async () => {
    const user = userEvent.setup();
    renderPanel();
    expect(screen.getByTestId('resource-state')).toHaveTextContent('1 free, 0 busy');
    await user.click(screen.getByTestId('resource-plus'));
    await settled();
    expect(screen.getByTestId('resource-state')).toHaveTextContent('2 free, 0 busy');
    await user.click(screen.getByTestId('resource-minus'));
    await settled();
    await user.click(screen.getByTestId('resource-minus'));
    await settled();
    expect(screen.getByTestId('resource-state')).toHaveTextContent('0 free, 0 busy');
    expect(screen.getByTestId('resource-minus')).toBeDisabled();
  });

  it('sets and removes breakpoints on places', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.selectOptions(screen.getByTestId('place-breakpoint-place'), 'Queue');
    const count = screen.getByTestId('place-breakpoint-count');
    await user.clear(count);
    await user.type(count, '4');
    await user.click(screen.getByTestId('place-breakpoint-add'));
    expect(store().simBreakpoints.places).toEqual({ wait: 4 });
    const list = screen.getByTestId('sim-breakpoints');
    expect(list).toHaveTextContent('Queue ≥ 4');
    await user.click(within(list).getByRole('button'));
    expect(store().simBreakpoints.places).toEqual({});
  });

  it('shows the enabled source transition and fires it on a click', async () => {
    const user = userEvent.setup();
    renderPanel();
    // Before the first instant both transitions can start; the clerk is free.
    expect(screen.getByTestId('enabled-summary')).toHaveTextContent('2 enabled transitions');
    await user.click(screen.getAllByTestId('sim-enabled-item')[0] as HTMLElement);
    await settled();
    expect(store().simHistory.map((s) => s.transitionName)).toEqual(['Arrive']);
    expect(screen.getAllByTestId('sim-step')).toHaveLength(1);
  });

  it('shows a notice of the engine', async () => {
    renderPanel();
    expect(screen.queryByTestId('sim-notice')).toBeNull();
    useEditorStore.setState({ simNotice: 'Something happened' });
    await waitFor(() => {
      expect(screen.getByTestId('sim-notice')).toHaveTextContent('Something happened');
    });
  });
});
