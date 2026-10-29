import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlaceNode } from './place-node';
import { TransitionNode } from './transition-node';
import { TooltipProvider } from '../ui/tooltip';
import type { PlaceFlowNode, PlaceNodeData, TransitionFlowNode, TransitionNodeData } from './types';

// Handles need the React Flow node renderer; the markers under test do not.
vi.mock('./node-handles', () => ({ RING_OUTSIDE: 8, NodeHandles: () => null }));

const transitionData = (over: Partial<TransitionNodeData> = {}): TransitionNodeData => ({
  name: 'Scan',
  bindings: 0,
  picking: false,
  enabled: false,
  simulating: true,
  hasError: false,
  isArcSource: false,
  renaming: false,
  running: 0,
  progress: 0,
  breakpoint: false,
  ...over,
});

const placeData = (over: Partial<PlaceNodeData> = {}): PlaceNodeData => ({
  name: 'Queue',
  tokens: 2,
  json: false,
  chips: [],
  chipsMore: 0,
  chipSide: 'right',
  hasError: false,
  isArcSource: false,
  renaming: false,
  ...over,
});

function renderTransition(data: TransitionNodeData) {
  const props = { id: 't', data, selected: false } as unknown as NodeProps<TransitionFlowNode>;
  return render(
    <ReactFlowProvider>
      <TooltipProvider>
        <TransitionNode {...props} />
      </TooltipProvider>
    </ReactFlowProvider>,
  );
}

function renderPlace(data: PlaceNodeData) {
  const props = { id: 'p', data, selected: false } as unknown as NodeProps<PlaceFlowNode>;
  return render(
    <ReactFlowProvider>
      <PlaceNode {...props} />
    </ReactFlowProvider>,
  );
}

describe('transition node in the timed simulation', () => {
  it('shows a clock for a transition that takes time', () => {
    renderTransition(transitionData({ timing: '5–9 s' }));
    expect(screen.getByTestId('timing-icon')).toBeInTheDocument();
  });

  it('has no clock for an instant transition', () => {
    renderTransition(transitionData());
    expect(screen.queryByTestId('timing-icon')).toBeNull();
    expect(screen.queryByTestId('transition-progress')).toBeNull();
  });

  it('shows the progress of a running firing as a progress bar', () => {
    const { container } = renderTransition(transitionData({ running: 1, progress: 0.4 }));
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    expect(bar).toHaveAccessibleName('Scan: 40% done');
    expect(screen.queryByTestId('running-count')).toBeNull();
    expect(container.querySelector('.pn-transition')).toHaveAttribute('data-busy', 'true');
    expect(container.querySelector('.pn-progress')).toHaveStyle({ height: '40%' });
  });

  it('shows the number of parallel firings as a badge', () => {
    renderTransition(transitionData({ running: 3, progress: 0.1 }));
    expect(screen.getByTestId('running-count')).toHaveTextContent('3');
  });

  it('marks a breakpoint', () => {
    renderTransition(transitionData({ breakpoint: true }));
    expect(screen.getByTestId('breakpoint-marker')).toBeInTheDocument();
  });

  it('shows none of this outside the simulation', () => {
    renderTransition(
      transitionData({ simulating: false, running: 2, progress: 0.5, breakpoint: true }),
    );
    expect(screen.queryByTestId('transition-progress')).toBeNull();
    expect(screen.queryByTestId('running-count')).toBeNull();
    expect(screen.queryByTestId('breakpoint-marker')).toBeNull();
  });
});

describe('place node in the timed simulation', () => {
  it('draws a yellow or red ring around a queue that fills up', () => {
    const { rerender } = renderPlace(placeData({ bottleneck: 'warn' }));
    expect(screen.getByTestId('bottleneck-ring')).toHaveAttribute('data-level', 'warn');
    const props = {
      id: 'p',
      data: placeData({ bottleneck: 'crit' }),
      selected: false,
    } as unknown as NodeProps<PlaceFlowNode>;
    rerender(
      <ReactFlowProvider>
        <PlaceNode {...props} />
      </ReactFlowProvider>,
    );
    expect(screen.getByTestId('bottleneck-ring')).toHaveAttribute('data-level', 'crit');
  });

  it('has no ring and no breakpoint by default', () => {
    renderPlace(placeData());
    expect(screen.queryByTestId('bottleneck-ring')).toBeNull();
    expect(screen.queryByTestId('breakpoint-marker')).toBeNull();
  });

  it('draws a red ring for a moment around a place that got a token created by a replay', () => {
    renderPlace(placeData({ deviation: true }));
    expect(screen.getByTestId('deviation-ring')).toBeInTheDocument();
  });

  it('has no deviation ring by default', () => {
    renderPlace(placeData());
    expect(screen.queryByTestId('deviation-ring')).toBeNull();
  });

  it('marks a breakpoint on a place', () => {
    renderPlace(placeData({ breakpoint: 5 }));
    expect(screen.getByTestId('breakpoint-marker')).toBeInTheDocument();
  });
});
