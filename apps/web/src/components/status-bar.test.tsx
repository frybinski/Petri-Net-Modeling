import { ReactFlowProvider } from '@xyflow/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyNet } from '@pnm/core';
import { useEditorStore } from '../store/editor-store';
import { StatusBar } from './status-bar';
import { TooltipProvider } from './ui/tooltip';

const store = () => useEditorStore.getState();

function renderBar() {
  return render(
    <ReactFlowProvider>
      <TooltipProvider>
        <StatusBar />
      </TooltipProvider>
    </ReactFlowProvider>,
  );
}

beforeEach(() => {
  store().loadNet(createEmptyNet('x'), null);
});

describe('status bar notices of the engine', () => {
  it('shows the latest warning while simulating and lets the user dismiss it', async () => {
    const user = userEvent.setup();
    store().startSimulation();
    useEditorStore.setState({
      simNotice: 'More than 10000 transitions started at the same instant',
    });
    renderBar();
    expect(screen.getByTestId('sim-notice')).toHaveTextContent(/More than 10000/);
    await user.click(screen.getByTestId('sim-notice-dismiss'));
    expect(screen.queryByTestId('sim-notice')).toBeNull();
    expect(store().simNotice).toBeNull();
    store().stopSimulation();
  });

  it('shows nothing in the editor', () => {
    useEditorStore.setState({ simNotice: 'left over' });
    renderBar();
    expect(screen.queryByTestId('sim-notice')).toBeNull();
    useEditorStore.setState({ simNotice: null });
  });

  it('receives a zero-time cycle reported by the engine', async () => {
    const net = createEmptyNet('loop');
    net.places.push({ id: 'p', name: 'p', position: { x: 0, y: 0 } });
    net.transitions.push({
      id: 't',
      name: 't',
      position: { x: 0, y: 0 },
      timing: { kind: 'fixed', value: 0 },
      rate: 1,
    });
    net.marking['p'] = [1];
    net.arcs.push(
      { id: 'a1', source: 'p', target: 't', weight: 1 },
      { id: 'a2', source: 't', target: 'p', weight: 1 },
    );
    store().loadNet(net, null);
    store().startSimulation();
    await vi.waitFor(() => {
      expect(store().computing).toBe(false);
    });
    await store().stepNext();
    renderBar();
    expect(screen.getByTestId('sim-notice')).toHaveTextContent(/same instant/);
    store().stopSimulation();
  });
});
