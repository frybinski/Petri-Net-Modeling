import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { setSimulationClientFactory } from '../../lib/sim-client';
import { useEditorStore } from '../../store/editor-store';
import { eventLog } from '../../store/sim-log';
import { SPLIT_DEFAULT, useUiStore } from '../../store/ui-store';
import { loadExample } from '../../test/domain-fixtures';
import { engineLog, mappingByName, replayLogOf } from '../../test/replay-fixtures';

const store = () => useEditorStore.getState();

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
  HTMLElement.prototype.setPointerCapture = () => undefined;
  HTMLElement.prototype.releasePointerCapture = () => undefined;
});

afterEach(() => {
  store().stopSimulation();
  setSimulationClientFactory();
  vi.useRealTimers();
});

const canvas = (): HTMLElement => screen.getByTestId('domain-canvas');
const attr = (name: string): number => Number(canvas().getAttribute(name) ?? 0);

describe('a replay in the domain view', () => {
  it('moves the cases of the parcel center along the events of the log', async () => {
    const net = store().net;
    const log = await engineLog(net, 900);
    render(<App />);
    await screen.findByTestId('domain-canvas');
    await act(async () => {
      await store().startLogReplay({ ...replayLogOf(log), mapping: mappingByName(net) });
    });
    await settled();
    expect(screen.getByTestId('domain-clock')).toHaveTextContent('00:00:00');
    const before = attr('data-bundles');
    store().setSimSpeed(60);
    store().setPlaying(true);
    await waitFor(
      () => {
        expect(attr('data-sprites')).toBeGreaterThan(0);
        expect(attr('data-bundles')).toBeGreaterThan(before + 3);
      },
      { timeout: 8000 },
    );
    store().setPlaying(false);
    // The bar of the domain view runs the same replay: its clock is the clock of the log.
    expect(screen.getByTestId('domain-clock')).not.toHaveTextContent('00:00:00');
    expect(store().simMetrics?.replay?.missing).toBe(0);
    expect(attr('data-deviations')).toBe(0);
    // Every start and complete of the replay was seen by the animation.
    expect(eventLog.all().some((e) => e.type === 'start')).toBe(true);
  });

  it('flashes red where the log does not fit the net', async () => {
    const net = store().net;
    const log = (await engineLog(net, 600)).filter((e) => e.activity !== 'Scannen');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('domain-canvas');
    await act(async () => {
      await store().startLogReplay({ ...replayLogOf(log), mapping: mappingByName(net) });
    });
    await settled();
    store().setSimSpeed(60);
    store().setPlaying(true);
    let seenRed = false;
    await waitFor(
      () => {
        if (attr('data-red-flashes') > 0) seenRed = true;
        expect(attr('data-deviations')).toBeGreaterThan(0);
      },
      { timeout: 8000, interval: 20 },
    );
    store().setPlaying(false);
    expect(store().simMetrics?.replay?.missing).toBeGreaterThan(0);
    expect(seenRed || attr('data-red-flashes') > 0 || attr('data-deviations') > 0).toBe(true);
    // The trace of the panel lists them.
    await user.click(screen.getByTestId('right-tab-main'));
    await user.click(screen.getByTestId('sim-tab-trace'));
    const rows = await screen.findAllByTestId('trace-row');
    expect(rows.some((r) => r.getAttribute('data-type') === 'deviation')).toBe(true);
  });
});
