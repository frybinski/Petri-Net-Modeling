import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setSimulationClientFactory } from '../../lib/sim-client';
import { useEditorStore } from '../../store/editor-store';
import { useReplayStore } from '../../store/replay-store';
import { useUiStore } from '../../store/ui-store';
import { csvOf, fittingLog, overlappingLog, shop } from '../../test/replay-fixtures';
import { TooltipProvider } from '../ui/tooltip';
import { LogDialog } from './log-dialog';

const store = () => useEditorStore.getState();

function renderDialog() {
  return render(
    <TooltipProvider>
      <LogDialog />
    </TooltipProvider>,
  );
}

const open = (text: string, name = 'shop.csv') => {
  useReplayStore.getState().openText(name, text);
};

beforeEach(() => {
  store().loadNet(shop(), null);
  useUiStore.setState({ toasts: [] });
  useReplayStore.getState().clear();
});

afterEach(() => {
  store().stopSimulation();
  setSimulationClientFactory();
});

describe('the dialog that maps an event log to the net', () => {
  it('shows what the log holds and fills the mapping in by name', async () => {
    renderDialog();
    open(csvOf(fittingLog()));
    expect(await screen.findByTestId('log-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('log-file-name')).toHaveTextContent('shop.csv');
    expect(screen.getByTestId('log-preview-summary')).toHaveTextContent(
      '12 events in 3 cases, spanning 31 s',
    );
    const rows = screen.getAllByTestId('log-mapping-row');
    expect(rows.map((r) => r.querySelector('td')?.textContent)).toEqual(['Arrive', 'Serve']);
    const selects = screen.getAllByTestId('log-map-select') as HTMLSelectElement[];
    expect(selects.map((s) => s.selectedOptions[0]?.textContent)).toEqual(['Arrive', 'Serve']);
    expect(screen.getByTestId('log-unmapped')).toHaveTextContent('Every activity is mapped.');
    // The default options.
    expect(screen.getByTestId('log-complete-only')).toHaveValue('zero');
    expect(screen.getByTestId('log-time-origin')).toHaveValue('first');
    expect(screen.queryByTestId('log-strict')).toBeNull();
    expect(screen.getByTestId('log-start')).toBeEnabled();
  });

  it('lists the activities that match no transition, and lets the person choose one', async () => {
    const user = userEvent.setup();
    renderDialog();
    open(
      csvOf(fittingLog())
        .replace(/,Serve,/g, ',Bedienen,')
        .concat('c9,Gossip,2026-01-05T08:01:00.000Z,complete\n'),
    );
    await screen.findByTestId('log-dialog');
    expect(screen.getByTestId('log-unmapped')).toHaveTextContent(
      '2 activities have no transition and will be skipped.',
    );
    const rows = screen.getAllByTestId('log-mapping-row');
    expect(rows.map((r) => r.getAttribute('data-mapped'))).toEqual(['true', 'false', 'false']);
    expect(within(rows[1]!).getByText('No transition: skipped')).toBeInTheDocument();
    await user.selectOptions(within(rows[1]!).getByTestId('log-map-select'), 'Serve');
    expect(screen.getByTestId('log-unmapped')).toHaveTextContent(
      '1 activity has no transition and will be skipped.',
    );
    expect(screen.getAllByTestId('log-mapping-row')[1]).toHaveAttribute('data-mapped', 'true');
    // Choosing "Skip" for a matched activity is a choice, too.
    await user.selectOptions(within(rows[0]!).getByTestId('log-map-select'), '');
    expect(screen.getByTestId('log-unmapped')).toHaveTextContent('2 activities');
  });

  it('starts the replay with the mapping, and keeps the log for the Log source', async () => {
    const user = userEvent.setup();
    renderDialog();
    open(csvOf(overlappingLog()));
    await screen.findByTestId('log-dialog');
    await user.click(screen.getByTestId('log-start'));
    await waitFor(() => {
      expect(store().mode).toBe('simulate');
      expect(store().simSource).toBe('log');
    });
    await waitFor(() => {
      expect(store().computing).toBe(false);
    });
    expect(store().simSourceName).toBe('shop.csv');
    expect(useReplayStore.getState().open).toBe(false);
    const log = useReplayStore.getState().log;
    expect(log?.mapping).toEqual({ Arrive: 'arrive', Serve: 'serve' });
    expect(log?.events).toHaveLength(8);
    expect(store().simMetrics?.replay?.total).toBe(8);
  });

  it('reads the times from the net start time when asked, or from another moment', async () => {
    const user = userEvent.setup();
    renderDialog();
    open(csvOf(fittingLog()));
    await screen.findByTestId('log-dialog');
    expect(screen.getByText(/Time 0 is 2026-01-05 08:00:00Z/)).toBeInTheDocument();
    await user.selectOptions(screen.getByTestId('log-time-origin'), 'custom');
    const custom = screen.getByTestId('log-custom-origin');
    await user.type(custom, '2026-01-05T07:59:00Z');
    fireEvent.blur(custom);
    await waitFor(() => {
      expect(screen.getByText(/Time 0 is 2026-01-05 07:59:00Z/)).toBeInTheDocument();
    });
    await user.clear(custom);
    await user.type(custom, 'yesterday');
    fireEvent.blur(custom);
    expect(await screen.findByTestId('log-error')).toHaveTextContent(/time origin/);
    expect(screen.getByTestId('log-start')).toBeDisabled();
    await user.selectOptions(screen.getByTestId('log-time-origin'), 'net');
    await waitFor(() => {
      expect(screen.queryByTestId('log-error')).toBeNull();
    });
    expect(screen.getByText(/Time 0 is 2026-01-05 08:00:00Z/)).toBeInTheDocument();
  });

  it('lets the person say which column is which when the file uses other names', async () => {
    const user = userEvent.setup();
    renderDialog();
    open('device;event;time\nd1;Arrive;100\nd1;Serve;130\nd2;Arrive;110\n', 'devices.csv');
    const error = await screen.findByTestId('log-error');
    expect(error).toHaveTextContent('case column');
    expect(screen.getByTestId('log-start')).toBeDisabled();
    await user.selectOptions(screen.getByTestId('log-column-case'), 'device');
    await user.selectOptions(screen.getByTestId('log-column-activity'), 'event');
    await waitFor(() => {
      expect(screen.queryByTestId('log-error')).toBeNull();
    });
    expect(screen.getByTestId('log-preview-summary')).toHaveTextContent('3 events in 2 cases');
    expect(screen.getByTestId('log-warnings')).toHaveTextContent('no lifecycle column');
    expect(screen.getByTestId('log-start')).toBeEnabled();
  });

  it('reads XES without column choices, and offers the guards only for JSON nets', async () => {
    renderDialog();
    open(
      '<log><trace><string key="concept:name" value="a"/><event><string key="concept:name" value="Arrive"/><date key="time:timestamp" value="2026-01-05T08:00:00Z"/></event></trace></log>',
      'log.xes',
    );
    await screen.findByTestId('log-dialog');
    expect(screen.queryByTestId('log-columns')).toBeNull();
    expect(screen.getByTestId('log-preview-summary')).toHaveTextContent('1 event in 1 case');
  });

  it('says so for a file that is no event log', async () => {
    renderDialog();
    open('hello world', 'notes.txt');
    expect(await screen.findByTestId('log-error')).toHaveTextContent(
      'The file cannot be used as an event log.',
    );
    expect(screen.queryByTestId('log-mapping')).toBeNull();
    expect(screen.getByTestId('log-start')).toBeDisabled();
  });

  it('takes the warm-up of the net unless another is given', async () => {
    const user = userEvent.setup();
    store().updateSimulationSettings({ warmup: 600 });
    renderDialog();
    open(csvOf(fittingLog()));
    await screen.findByTestId('log-dialog');
    const field = screen.getByTestId('log-warmup');
    expect(field).toHaveValue('');
    expect(field).toHaveAttribute('placeholder', '600');
    await user.type(field, '0');
    fireEvent.blur(field);
    await user.click(screen.getByTestId('log-start'));
    await waitFor(() => {
      expect(store().simSource).toBe('log');
    });
    expect(useReplayStore.getState().log?.warmup).toBe(0);
    await waitFor(() => {
      expect(store().computing).toBe(false);
    });
    store().setSimSpeed('max');
    store().setPlaying(true);
    await waitFor(() => {
      expect(store().simIdle).toBe(true);
    });
    // The log is 31 s long: with the warm-up of the net no case would count.
    expect(store().simMetrics?.completedCases).toBe(3);
  });

  it('closes with Cancel and leaves the simulation alone', async () => {
    const user = userEvent.setup();
    renderDialog();
    open(csvOf(fittingLog()));
    await screen.findByTestId('log-dialog');
    await user.click(screen.getByTestId('log-cancel'));
    expect(useReplayStore.getState().open).toBe(false);
    expect(store().mode).toBe('edit');
    expect(useReplayStore.getState().log).toBeNull();
  });
});
