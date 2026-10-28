import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { setSimulationClientFactory } from '../../lib/sim-client';
import { useEditorStore } from '../../store/editor-store';
import { toEventLogCsv } from '@pnm/io';
import { eventLog } from '../../store/sim-log';
import { SPLIT_DEFAULT, useUiStore } from '../../store/ui-store';
import { loadExample } from '../../test/domain-fixtures';

const store = () => useEditorStore.getState();
const ui = () => useUiStore.getState();

const settled = () =>
  vi.waitFor(() => {
    expect(store().computing).toBe(false);
  });

beforeEach(() => {
  store().newNet();
  useUiStore.setState({
    toasts: [],
    confirm: null,
    shortcutsOpen: false,
    diagnosticsOpen: false,
    viewMode: 'domain',
    rightTab: 'main',
    splitRatio: SPLIT_DEFAULT,
    hover: { id: null, source: null },
    followedCase: null,
    domainControls: true,
  });
  store().loadNet(loadExample('parcel-center'), 'parcel-center.pn.json');
  // jsdom does not implement pointer capture.
  HTMLElement.prototype.setPointerCapture = () => undefined;
  HTMLElement.prototype.releasePointerCapture = () => undefined;
});

afterEach(() => {
  store().stopSimulation();
  setSimulationClientFactory();
  vi.useRealTimers();
});

async function startFromBar(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByTestId('domain-simulate'));
  await settled();
  return user;
}

describe('the control bar of the domain view', () => {
  it('offers Simulate while editing and starts the simulation', async () => {
    const user = userEvent.setup();
    render(<App />);
    const bar = screen.getByRole('toolbar', { name: 'Simulation bar of the domain view' });
    expect(within(bar).getByTestId('domain-simulate')).toBeInTheDocument();
    expect(screen.queryByTestId('domain-play')).toBeNull();
    await user.click(screen.getByTestId('domain-simulate'));
    await settled();
    expect(store().mode).toBe('simulate');
    expect(screen.getByTestId('domain-play')).toBeInTheDocument();
    expect(screen.queryByTestId('domain-simulate')).toBeNull();
    // The clock and the cases are shown.
    expect(screen.getByTestId('domain-clock')).toHaveTextContent('00:00:00');
    expect(screen.getByTestId('domain-cases')).toHaveTextContent('0');
  });

  it('runs the same actions as the simulation panel', async () => {
    const user = await startFromBar();
    // Play and pause.
    await user.click(screen.getByTestId('domain-play'));
    expect(store().simPlaying).toBe(true);
    expect(screen.getByTestId('domain-play')).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByTestId('domain-play'));
    expect(store().simPlaying).toBe(false);
    // Speed.
    expect(screen.getByTestId('domain-speed-10')).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByTestId('domain-speed-60'));
    expect(store().simSpeed).toBe(60);
    await user.click(screen.getByTestId('domain-speed-max'));
    expect(store().simSpeed).toBe('max');
    // Step, back, reset.
    expect(screen.getByTestId('domain-back')).toBeDisabled();
    await user.click(screen.getByTestId('domain-step'));
    await settled();
    expect(store().simTime).toBeGreaterThan(0);
    expect(screen.getByTestId('domain-clock')).not.toHaveTextContent('00:00:00');
    expect(screen.getByTestId('domain-back')).toBeEnabled();
    await user.click(screen.getByTestId('domain-back'));
    await settled();
    expect(store().simTime).toBe(0);
    await user.click(screen.getByTestId('domain-step'));
    await settled();
    await user.click(screen.getByTestId('domain-reset'));
    await settled();
    expect(store().simTime).toBe(0);
    // Back to editing.
    await user.click(screen.getByTestId('domain-exit'));
    expect(store().mode).toBe('edit');
    expect(screen.getByTestId('domain-simulate')).toBeInTheDocument();
  });

  it('hides and shows the controls', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('domain-controls-hide'));
    expect(screen.queryByTestId('domain-controls')).toBeNull();
    expect(ui().domainControls).toBe(false);
    await user.click(screen.getByTestId('domain-controls-show'));
    expect(screen.getByTestId('domain-controls')).toBeInTheDocument();
  });

  it('shows the key figures with a note during the warm-up', async () => {
    await startFromBar();
    const kpis = screen.getByTestId('domain-kpis');
    expect(within(kpis).getByTestId('domain-kpi-throughput')).toHaveTextContent('–');
    expect(within(kpis).getByTestId('domain-kpi-warmup')).toHaveTextContent('20m 00s');
    expect(within(kpis).getByTestId('domain-kpi-cases')).toHaveTextContent('0');
  });
});

describe('the animation loop', () => {
  const frames = (): number =>
    Number(screen.getByTestId('domain-canvas').getAttribute('data-frames') ?? 0);
  const bundles = (): number =>
    Number(screen.getByTestId('domain-canvas').getAttribute('data-bundles') ?? 0);

  it('runs while the simulation plays and rests when it is paused and nothing moves', async () => {
    const user = await startFromBar();
    await user.click(screen.getByTestId('domain-speed-10'));
    await user.click(screen.getByTestId('domain-play'));
    const running = frames();
    await waitFor(() => {
      expect(frames()).toBeGreaterThan(running + 5);
    });
    await user.click(screen.getByTestId('domain-play'));
    // Motions and flashes end within a second.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const rested = frames();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(frames()).toBe(rested);
  });

  it('draws again when something changes while it rests', async () => {
    await startFromBar();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const rested = frames();
    act(() => {
      ui().setHover('t_scan', 'net');
    });
    await waitFor(() => {
      expect(frames()).toBeGreaterThan(rested);
    });
  });

  it('takes every bundle of events in the order of arrival', async () => {
    const user = await startFromBar();
    const first = bundles();
    for (let i = 0; i < 3; i += 1) {
      await user.click(screen.getByTestId('domain-step'));
      await settled();
    }
    expect(bundles()).toBe(first + 3);
    // The log of the store and the animation saw the same events in the same order.
    const ids = eventLog.all().map((e) => e.id);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
  });

  it('shows what the simulation holds after a reset without events in between', async () => {
    const user = await startFromBar();
    const canvas = screen.getByTestId('domain-canvas');
    store().setSimSpeed(60);
    store().setPlaying(true);
    await waitFor(
      () => {
        expect(Number(canvas.getAttribute('data-sprites'))).toBeGreaterThan(0);
      },
      { timeout: 6000 },
    );
    store().setPlaying(false);
    await user.click(screen.getByTestId('domain-reset'));
    await settled();
    // The parcel center starts without cases; nothing of the run before is left in the picture.
    await waitFor(() => {
      expect(canvas).toHaveAttribute('data-sprites', '0');
    });
    expect(canvas).toHaveAttribute('data-moving', '0');
  });
});

describe('following a case', () => {
  /** Plays until a case waits somewhere and returns where its sprite is, in canvas pixels. */
  async function findCase(): Promise<{ id: string; x: number; y: number }> {
    store().setSimSpeed(60);
    store().setPlaying(true);
    const canvas = screen.getByTestId('domain-canvas');
    await waitFor(
      () => {
        expect(canvas.getAttribute('data-cases') ?? '').not.toBe('');
      },
      { timeout: 6000 },
    );
    store().setPlaying(false);
    // The animation settles, then the positions are those of the cases at rest.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const [id, xy] = (canvas.getAttribute('data-cases') ?? '').split(';')[0]!.split('@');
    const [x, y] = xy!.split(',').map(Number);
    return { id: id!, x: x!, y: y! };
  }

  it('shows a card with the steps of the case, and lets go with the button and with Escape', async () => {
    const user = await startFromBar();
    const found = await findCase();
    const canvas = screen.getByTestId('domain-canvas');
    // The sheet is drawn at zoom 1 in jsdom, where nothing has a size.
    const zoom = Number(canvas.getAttribute('data-zoom'));
    const panX = Number(canvas.getAttribute('data-pan-x'));
    const panY = Number(canvas.getAttribute('data-pan-y'));
    const point = { clientX: panX + found.x * zoom, clientY: panY + found.y * zoom };
    fireEvent.pointerDown(canvas, { ...point, button: 0, pointerId: 1 });
    fireEvent.pointerUp(canvas, { ...point, button: 0, pointerId: 1 });
    expect(ui().followedCase).toBe(found.id);
    const card = await screen.findByTestId('domain-case-card');
    expect(within(card).getByTestId('domain-case-title')).toHaveTextContent(`Case ${found.id}`);
    expect(within(card).getAllByTestId('domain-case-step').length).toBeGreaterThan(0);

    await user.click(within(card).getByTestId('domain-case-stop'));
    expect(ui().followedCase).toBeNull();
    expect(screen.queryByTestId('domain-case-card')).toBeNull();

    // Again, and end it with Escape.
    fireEvent.pointerDown(canvas, { ...point, button: 0, pointerId: 1 });
    fireEvent.pointerUp(canvas, { ...point, button: 0, pointerId: 1 });
    expect(ui().followedCase).toBe(found.id);
    await user.keyboard('{Escape}');
    expect(ui().followedCase).toBeNull();
  });

  it('ends with the simulation', async () => {
    await startFromBar();
    act(() => {
      ui().followCase('P-0001');
    });
    expect(await screen.findByTestId('domain-case-card')).toBeInTheDocument();
    act(() => {
      store().stopSimulation();
    });
    await waitFor(() => {
      expect(ui().followedCase).toBeNull();
    });
  });
});

describe('firing from the picture', () => {
  it('fires an enabled transition when it is clicked, and only while simulating', async () => {
    render(<App />);
    const canvas = screen.getByTestId('domain-canvas');
    await waitFor(() => {
      expect(canvas).toHaveAttribute('data-zoom');
    });
    // The arrival door of the parcel center: a click while editing only selects.
    const view = store().net.domainView as { transitions: Record<string, { pos: number[] }> };
    const [dx, dy] = view.transitions['t_arr']!.pos as [number, number];
    const click = (x: number, y: number): void => {
      const zoom = Number(canvas.getAttribute('data-zoom'));
      const panX = Number(canvas.getAttribute('data-pan-x'));
      const panY = Number(canvas.getAttribute('data-pan-y'));
      const point = { clientX: panX + x * zoom, clientY: panY + y * zoom };
      fireEvent.pointerDown(canvas, { ...point, button: 0, pointerId: 2 });
      fireEvent.pointerUp(canvas, { ...point, button: 0, pointerId: 2 });
    };
    click(dx, dy);
    expect(store().selection).toEqual(['t_arr']);
    expect(store().simHistory).toHaveLength(0);

    act(() => {
      store().startSimulation();
    });
    await settled();
    await waitFor(() => {
      expect(store().enabled.has('t_arr')).toBe(true);
    });
    click(dx, dy);
    await settled();
    expect(store().simHistory.map((s) => s.transitionId)).toEqual(['t_arr']);
    expect(store().simTime).toBe(0);
    expect(store().simMetrics?.casesInSystem).toBe(1);
  });
});

describe('acceptance A3 through the view', () => {
  beforeEach(() => {
    // jsdom has no geometry for SVG paths, which the token flights of the net editor measure.
    Object.defineProperty(SVGElement.prototype, 'getTotalLength', {
      configurable: true,
      value: () => 10,
    });
    Object.defineProperty(SVGElement.prototype, 'getPointAtLength', {
      configurable: true,
      value: () => ({ x: 0, y: 0 }),
    });
  });

  /** Steps through 60 events with the given view and returns the log and its CSV export. */
  async function run(viewMode: 'net' | 'domain') {
    useUiStore.setState({ viewMode });
    const { unmount } = render(<App />);
    act(() => {
      store().startSimulation();
    });
    await settled();
    for (let i = 0; i < 60; i += 1) {
      await act(async () => {
        await store().stepNext();
      });
    }
    const events = [...eventLog.all()];
    const csv = toEventLogCsv(events, store().net);
    store().stopSimulation();
    unmount();
    return { events, csv };
  }

  it('gives the same events and the same export with and without the domain view', async () => {
    const without = await run('net');
    const withView = await run('domain');
    expect(without.events.length).toBeGreaterThan(60);
    expect(withView.events).toEqual(without.events);
    expect(withView.csv).toBe(without.csv);
  });
});
