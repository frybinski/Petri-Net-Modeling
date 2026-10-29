import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setSimulationClientFactory } from '../../lib/sim-client';
import { registerLogFileRequest, useEditorStore } from '../../store/editor-store';
import { useReplayStore } from '../../store/replay-store';
import { useUiStore } from '../../store/ui-store';
import { csvOf, fittingLog, overlappingLog, replayLogOf, shop } from '../../test/replay-fixtures';
import { SimulationPanel } from '../simulation-panel';
import { TooltipProvider } from '../ui/tooltip';

const store = () => useEditorStore.getState();

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

/** Steps the replay `n` times. */
async function step(n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    await store().stepNext();
    await settled();
  }
}

beforeEach(() => {
  store().loadNet(shop(), null);
  useUiStore.setState({ toasts: [], simTab: 'enabled' });
  useReplayStore.getState().clear();
});

afterEach(() => {
  store().stopSimulation();
  registerLogFileRequest(null);
  setSimulationClientFactory();
});

describe('the source switch', () => {
  it('shows the engine as the source and asks for a file when Log is chosen without one', async () => {
    const user = userEvent.setup();
    await store().startSimulation();
    renderPanel();
    const group = screen.getByTestId('sim-source');
    expect(within(group).getByTestId('sim-source-engine')).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByTestId('sim-source-log')).toHaveAttribute('aria-pressed', 'false');
    let asked = 0;
    registerLogFileRequest(() => {
      asked += 1;
    });
    await user.click(screen.getByTestId('sim-source-log'));
    expect(asked).toBe(1);
    expect(screen.getByTestId('sim-source-engine')).toHaveAttribute('aria-pressed', 'true');
  });

  it('replays the log that is loaded and says what it holds', async () => {
    const user = userEvent.setup();
    await store().startSimulation();
    renderPanel();
    useReplayStore.getState().setLog(replayLogOf(fittingLog(), 'shop-events.csv'));
    await user.click(screen.getByTestId('sim-source-log'));
    await waitFor(() => {
      expect(screen.getByTestId('sim-source-log')).toHaveAttribute('aria-pressed', 'true');
    });
    expect(screen.getByTestId('log-source-name')).toHaveTextContent('shop-events.csv');
    expect(screen.getByTestId('log-source-summary')).toHaveTextContent('12 events, 3 cases, 31 s');
    // The panel for the engine is gone: nothing to fire, no arrivals, no resources to change.
    expect(screen.queryByTestId('sim-enabled')).toBeNull();
    expect(screen.queryByTestId('sim-arrivals')).toBeNull();
    expect(screen.queryByTestId('sim-resources')).toBeNull();
    expect(screen.getByTestId('replay-summary')).toHaveTextContent('Event 0 of 12');
    await settled();
    await step(3);
    expect(screen.getByTestId('replay-summary')).toHaveTextContent(/Event \d+ of 12/);
    expect(screen.getByTestId('sim-clock')).not.toHaveTextContent('00:00:00');
    // Breakpoints, the marking and the history stay.
    expect(screen.getByTestId('sim-marking')).toBeInTheDocument();
    // The mapping can be changed, or another log opened.
    await user.click(screen.getByTestId('log-change-mapping'));
    expect(useReplayStore.getState().open).toBe(false);
    useReplayStore.getState().openText('x.csv', csvOf(fittingLog()));
    await user.click(screen.getByTestId('log-change-mapping'));
    expect(useReplayStore.getState().open).toBe(true);
  });

  it('mentions the activities that are skipped', async () => {
    await store().startLogReplay({
      ...replayLogOf(fittingLog()),
      mapping: { Arrive: 'arrive', Serve: null },
    });
    useReplayStore.getState().setLog({
      ...replayLogOf(fittingLog()),
      mapping: { Arrive: 'arrive', Serve: null },
    });
    renderPanel();
    expect(await screen.findByTestId('log-source-skipped')).toHaveTextContent(
      '1 activity is not mapped and skipped',
    );
  });
});

describe('what a replay shows', () => {
  it('has fitness 100 % in the key figures when the log fits', async () => {
    const user = userEvent.setup();
    useReplayStore.getState().setLog(replayLogOf(fittingLog()));
    await store().startLogReplay(replayLogOf(fittingLog()));
    await settled();
    renderPanel();
    await user.click(screen.getByTestId('sim-tab-metrics'));
    const card = await screen.findByTestId('replay-card');
    expect(within(card).getByTestId('replay-fitness')).toHaveTextContent('–');
    store().setSimSpeed('max');
    store().setPlaying(true);
    await waitFor(() => {
      expect(store().simPlaying).toBe(false);
    });
    await waitFor(() => {
      expect(screen.getByTestId('replay-fitness')).toHaveTextContent('100 %');
    });
    expect(screen.getByTestId('replay-created')).toHaveTextContent('0');
    expect(screen.getByTestId('replay-left')).toHaveTextContent('0');
    expect(screen.getByTestId('replay-skipped')).toHaveTextContent('0');
    expect(screen.getByTestId('replay-progress')).toHaveTextContent('Event 12 of 12');
    expect(screen.getByTestId('replay-fitness')).not.toHaveClass('text-danger');
    expect(screen.getByTestId('metric-throughput')).toBeInTheDocument();
  });

  it('shows the deviations in the trace in red, and counts them in the key figures', async () => {
    const user = userEvent.setup();
    await store().startLogReplay(replayLogOf(overlappingLog()));
    await settled();
    renderPanel();
    await step(4);
    await user.click(screen.getByTestId('sim-tab-trace'));
    const rows = await screen.findAllByTestId('trace-row');
    const deviation = rows.find((r) => r.getAttribute('data-type') === 'deviation');
    expect(deviation).toBeDefined();
    expect(deviation).toHaveClass('text-danger');
    expect(deviation).toHaveTextContent('Deviation');
    expect(deviation).toHaveTextContent('clerk');
    expect(deviation).toHaveTextContent('Token created');
    expect(deviation).toHaveTextContent('c2');
    // A click selects the place.
    await user.click(deviation!);
    expect(store().selection).toEqual(['clerk']);
    // The filter finds only deviations.
    await user.selectOptions(screen.getByTestId('trace-filter-type'), 'deviation');
    expect(screen.getAllByTestId('trace-row')).toHaveLength(1);

    await user.click(screen.getByTestId('sim-tab-metrics'));
    expect(screen.getByTestId('replay-created')).toHaveTextContent('1');
    expect(screen.getByTestId('replay-created')).toHaveClass('text-danger');
    expect(screen.getByTestId('replay-fitness')).toHaveClass('text-danger');
    const fitness = screen.getByTestId('replay-fitness').textContent ?? '';
    expect(fitness).toMatch(/^\d\d\.\d %$/);
  });

  it('leads to the analysis from the key figures', async () => {
    const user = userEvent.setup();
    await store().startLogReplay(replayLogOf(fittingLog()));
    await settled();
    renderPanel();
    await user.click(screen.getByTestId('sim-tab-metrics'));
    await user.click(await screen.findByTestId('replay-check'));
    expect(useUiStore.getState().rightTab).toBe('analyze');
  });
});

describe('the live source in the panel', () => {
  it('adds the pasted events, and ends the feed', async () => {
    const user = userEvent.setup();
    await store().startLiveFeed();
    await settled();
    store().setSimSpeed('max');
    renderPanel();
    expect(screen.getByTestId('sim-source-live')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('live-add')).toBeDisabled();
    expect(screen.getByTestId('live-source')).toHaveTextContent('window.pnm.live.push');
    await user.type(
      screen.getByTestId('live-paste'),
      'c1,Arrive,complete,1{enter}c1,Serve,start,2{enter}c2,Arrive,complete,3',
    );
    await user.click(screen.getByTestId('live-add'));
    await waitFor(() => {
      expect(store().simMarking?.['wait']).toHaveLength(1);
    });
    expect(store().simRunning.map((f) => f.transitionId)).toEqual(['serve']);
    expect(screen.getByTestId('live-paste')).toHaveValue('');
    expect(useUiStore.getState().toasts.at(-1)?.message).toBe('3 events added');
    await waitFor(() => {
      expect(screen.getByTestId('replay-summary')).toHaveTextContent(/Waiting for events/);
    });
    expect(screen.getByTestId('sim-status')).toHaveTextContent('Waiting');

    await user.click(screen.getByTestId('live-close'));
    expect(await screen.findByTestId('live-closed')).toBeInTheDocument();
    expect(screen.getByTestId('live-paste')).toBeDisabled();
    expect(screen.getByTestId('live-add')).toBeDisabled();
  });

  it('says so if the text holds no events', async () => {
    const user = userEvent.setup();
    await store().startLiveFeed();
    await settled();
    renderPanel();
    await user.type(screen.getByTestId('live-paste'), 'lonely');
    await user.click(screen.getByTestId('live-add'));
    expect(useUiStore.getState().toasts.at(-1)?.message).toBe('There are no events in the text.');
  });
});

describe('dropping an event log on the panel', () => {
  it('opens the dialog for CSV and XES, and shows the drop target while dragging', async () => {
    await store().startSimulation();
    renderPanel();
    const panel = screen.getByTestId('simulation-panel');
    fireEvent.dragOver(panel, { dataTransfer: { types: ['Files'], files: [] } });
    expect(screen.getByTestId('sim-drop-overlay')).toBeInTheDocument();
    fireEvent.dragLeave(panel, { relatedTarget: document.body });
    expect(screen.queryByTestId('sim-drop-overlay')).toBeNull();

    const file = new File([csvOf(fittingLog())], 'dropped.csv', { type: 'text/csv' });
    fireEvent.drop(panel, { dataTransfer: { types: ['Files'], files: [file] } });
    await waitFor(() => {
      expect(useReplayStore.getState().open).toBe(true);
    });
    expect(useReplayStore.getState().draft).toMatchObject({
      fileName: 'dropped.csv',
      format: 'csv',
    });
    // A drag of something else than files is left alone.
    fireEvent.dragOver(panel, { dataTransfer: { types: ['text/plain'], files: [] } });
    expect(screen.queryByTestId('sim-drop-overlay')).toBeNull();
  });
});
