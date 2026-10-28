import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../store/editor-store';
import { PropertiesPanel } from './properties-panel';
import { TooltipProvider } from './ui/tooltip';

const store = () => useEditorStore.getState();

/** arrive -> queue -> serve (uses worker) -> done */
function build() {
  const arrive = store().addTransition({ x: 0, y: 0 }) as string;
  const queue = store().addPlace({ x: 100, y: 0 }) as string;
  const serve = store().addTransition({ x: 200, y: 0 }) as string;
  const worker = store().addPlace({ x: 200, y: 100 }) as string;
  const done = store().addPlace({ x: 300, y: 0 }) as string;
  store().addArc(arrive, queue);
  store().addArc(queue, serve);
  store().addArc(worker, serve);
  store().addArc(serve, worker);
  store().addArc(serve, done);
  store().setTokens(worker, 2);
  return { arrive, queue, serve, worker, done };
}

function renderPanel() {
  return render(
    <TooltipProvider>
      <PropertiesPanel />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  store().newNet();
});

describe('timing of a transition', () => {
  it('sets, changes and removes the duration', async () => {
    const user = userEvent.setup();
    const { serve } = build();
    store().select([serve]);
    renderPanel();
    const kind = screen.getByTestId('prop-timing-kind');
    expect(kind).toHaveValue('');
    expect(screen.queryByTestId('prop-timing-value')).toBeNull();

    await user.selectOptions(kind, 'fixed');
    expect(store().net.transitions.find((t) => t.id === serve)?.timing).toEqual({
      kind: 'fixed',
      value: 10,
    });
    const value = screen.getByTestId('prop-timing-value');
    await user.clear(value);
    await user.type(value, '12.5{Enter}');
    expect(store().net.transitions.find((t) => t.id === serve)?.timing).toEqual({
      kind: 'fixed',
      value: 12.5,
    });

    await user.selectOptions(kind, 'uniform');
    expect(store().net.transitions.find((t) => t.id === serve)?.timing).toEqual({
      kind: 'uniform',
      min: 6.25,
      max: 18.75,
    });
    await user.selectOptions(kind, 'exponential');
    expect(store().net.transitions.find((t) => t.id === serve)?.timing).toMatchObject({
      kind: 'exponential',
    });
    expect(screen.getByTestId('prop-timing-mean')).toBeInTheDocument();

    await user.selectOptions(kind, '');
    expect(store().net.transitions.find((t) => t.id === serve)).not.toHaveProperty('timing');
    // One undo brings the exponential duration back.
    store().undo();
    expect(store().net.transitions.find((t) => t.id === serve)?.timing?.kind).toBe('exponential');
  });

  it('keeps minimum and maximum in order', async () => {
    const user = userEvent.setup();
    const { serve } = build();
    store().updateTransition(serve, { timing: { kind: 'uniform', min: 5, max: 9 } });
    store().select([serve]);
    renderPanel();
    const min = screen.getByTestId('prop-timing-min');
    await user.clear(min);
    await user.type(min, '20{Enter}');
    expect(store().net.transitions.find((t) => t.id === serve)?.timing).toEqual({
      kind: 'uniform',
      min: 20,
      max: 20,
    });
    const max = screen.getByTestId('prop-timing-max');
    await user.clear(max);
    await user.type(max, '3{Enter}');
    expect(store().net.transitions.find((t) => t.id === serve)?.timing).toEqual({
      kind: 'uniform',
      min: 3,
      max: 3,
    });
  });

  it('sets the priority and clears it again', async () => {
    const user = userEvent.setup();
    const { serve } = build();
    store().select([serve]);
    renderPanel();
    const priority = screen.getByTestId('prop-priority');
    expect(priority).toHaveValue('');
    await user.type(priority, '2.5{Enter}');
    expect(store().net.transitions.find((t) => t.id === serve)?.priority).toBe(2.5);
    await user.clear(priority);
    await user.keyboard('{Enter}');
    expect(store().net.transitions.find((t) => t.id === serve)).not.toHaveProperty('priority');
  });

  it('offers the arrival rate only for transitions without input places', async () => {
    const user = userEvent.setup();
    const { arrive, serve } = build();
    store().select([serve]);
    const { unmount } = renderPanel();
    expect(screen.queryByTestId('prop-rate')).toBeNull();
    unmount();
    store().select([arrive]);
    renderPanel();
    const rate = screen.getByTestId('prop-rate');
    await user.type(rate, '90{Enter}');
    expect(store().net.transitions.find((t) => t.id === arrive)?.rate).toBe(90);
  });
});

describe('role of a place', () => {
  it('shows the computed role and lets resource and case be forced', async () => {
    const user = userEvent.setup();
    const { queue, worker } = build();
    store().select([worker]);
    const { unmount } = renderPanel();
    const role = screen.getByTestId('prop-role');
    expect(role).toHaveValue('');
    expect(role).toHaveTextContent('Automatic (Resource)');
    await user.selectOptions(role, 'case');
    expect(store().net.places.find((p) => p.id === worker)?.role).toBe('case');
    await user.selectOptions(role, '');
    expect(store().net.places.find((p) => p.id === worker)).not.toHaveProperty('role');
    unmount();

    store().select([queue]);
    renderPanel();
    expect(screen.getByTestId('prop-role')).toHaveTextContent('Automatic (Case)');
  });

  it('only describes sources and sinks, whose role follows from the arcs', () => {
    const { done } = build();
    store().select([done]);
    renderPanel();
    expect(screen.queryByTestId('prop-role')).toBeNull();
    expect(screen.getByTestId('prop-role-fixed')).toHaveTextContent('Sink');
  });
});

describe('simulation settings of the net', () => {
  it('are edited in the net properties and removed when empty', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByTestId('prop-seed'), '42{Enter}');
    await user.type(screen.getByTestId('prop-warmup'), '600{Enter}');
    await user.type(screen.getByTestId('prop-start-time'), '2026-02-01T06:00:00Z{Enter}');
    await user.type(screen.getByTestId('prop-case-prefix'), 'K-{Enter}');
    expect(store().net.simulation).toEqual({
      seed: 42,
      warmup: 600,
      startTime: '2026-02-01T06:00:00Z',
      caseIdPrefix: 'K-',
    });
    await user.clear(screen.getByTestId('prop-seed'));
    await user.keyboard('{Enter}');
    await user.clear(screen.getByTestId('prop-warmup'));
    await user.keyboard('{Enter}');
    await user.clear(screen.getByTestId('prop-start-time'));
    await user.keyboard('{Enter}');
    await user.clear(screen.getByTestId('prop-case-prefix'));
    await user.keyboard('{Enter}');
    expect(store().net).not.toHaveProperty('simulation');
  });

  it('rejects a start time that is no timestamp with a message', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByTestId('prop-start-time'), 'tomorrow{Enter}');
    expect(store().net.simulation?.startTime).toBeUndefined();
  });
});
