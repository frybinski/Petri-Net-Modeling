import type { PetriNet } from '@pnm/core';
import { EditorView } from '@codemirror/view';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listExamples } from '../../lib/examples';
import { useAnalysisStore } from '../../store/analysis-store';
import { useEditorStore } from '../../store/editor-store';
import { useUiStore } from '../../store/ui-store';
import { TooltipProvider } from '../ui/tooltip';
import { AnalysisPanel } from './analysis-panel';

const editor = () => useEditorStore.getState();

function example(id: string): PetriNet {
  const found = listExamples().find((e) => e.id === id);
  if (!found) throw new Error(`no example ${id}`);
  return found.net;
}

function renderPanel() {
  return render(
    <TooltipProvider>
      <AnalysisPanel />
    </TooltipProvider>,
  );
}

async function analyzeAll(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByTestId('analyze-all'));
  await waitFor(() => {
    expect(screen.getByTestId('space-result')).toBeInTheDocument();
  });
}

beforeEach(() => {
  useAnalysisStore.getState().clear();
  useAnalysisStore.getState().setLimit(20000);
  useAnalysisStore.getState().setFinalMode('deadlock');
  useAnalysisStore.getState().setIncludeOpen(false);
  useUiStore.setState({ toasts: [] });
});

afterEach(() => {
  editor().stopSimulation();
  useAnalysisStore.getState().clear();
});

describe('the result cards', () => {
  it('shows nothing but the buttons before the first analysis, and asks for a net when it is empty', () => {
    editor().newNet();
    renderPanel();
    expect(screen.getByTestId('analysis-empty')).toBeInTheDocument();
    expect(screen.getByTestId('analyze-all')).toBeDisabled();
    act(() => {
      editor().loadNet(example('traffic-light'), null);
    });
    expect(screen.queryByTestId('analysis-empty')).toBeNull();
    expect(screen.getByTestId('analyze-all')).toBeEnabled();
    expect(screen.queryByTestId('structure-checks')).toBeNull();
    expect(screen.getByTestId('structure-run')).toBeInTheDocument();
  });

  it('explains structure, invariants and the state space of the producer/consumer net', async () => {
    const user = userEvent.setup();
    editor().loadNet(example('producer-consumer'), null);
    renderPanel();
    await analyzeAll(user);

    // Structure: a marked graph that is not a state machine, with the reason.
    expect(
      within(screen.getByTestId('structure-markedGraph')).getByRole('img', { name: 'Yes' }),
    ).toBeInTheDocument();
    const machine = screen.getByTestId('structure-stateMachine');
    expect(within(machine).getByRole('img', { name: 'No' })).toBeInTheDocument();
    expect(machine).toHaveTextContent('do not have exactly one input and one output place');

    // Invariants: three equations, including the capacity of the buffer.
    expect(screen.getByTestId('p-invariant-0')).toBeInTheDocument();
    const equations = [0, 1, 2].map((i) => screen.getByTestId(`p-invariant-${i}`).textContent);
    expect(equations).toContain('1·Buffer + 1·Buffer (free) = 3');
    expect(screen.getByTestId('t-invariant-0')).toHaveTextContent(
      '1·produce + 1·deliver + 1·remove + 1·consume',
    );

    // State space: the numbers and the yes/no answers with a sentence each.
    expect(screen.getByTestId('space-states')).toHaveTextContent('16');
    expect(screen.getByTestId('space-edges')).toHaveTextContent('28');
    expect(screen.getByTestId('space-bounded')).toHaveTextContent(
      'Yes, at most 3 tokens on any place.',
    );
    expect(screen.getByTestId('space-deadlocks')).toHaveTextContent(
      'None: some transition is always enabled.',
    );
    expect(screen.getByTestId('space-live')).toHaveTextContent(
      'Yes: every transition can always fire again later.',
    );
    expect(screen.getByTestId('space-reversible')).toHaveTextContent('Yes');
    expect(screen.getByTestId('bound-buffer')).toHaveTextContent('3');
    expect(screen.getByTestId('liveness-produce')).toHaveTextContent('live');
    expect(screen.queryByTestId('space-deadlock-list')).toBeNull();
  });

  it('selects the places of an invariant in the net when its row is clicked', async () => {
    const user = userEvent.setup();
    editor().loadNet(example('mutual-exclusion'), null);
    renderPanel();
    await analyzeAll(user);
    const row = screen
      .getAllByTestId(/^p-invariant-\d$/)
      .find((el) => el.textContent?.includes('Mutex'))!;
    await user.click(row);
    const names = editor()
      .net.places.filter((p) => editor().selection.includes(p.id))
      .map((p) => p.name)
      .sort();
    expect(names).toEqual(['Mutex', 'Process 1 critical', 'Process 2 critical']);
  });

  it('lists the deadlock of the dining philosophers with the way into it', async () => {
    const user = userEvent.setup();
    editor().loadNet(example('dining-philosophers-3'), null);
    renderPanel();
    await analyzeAll(user);
    expect(screen.getByTestId('space-states')).toHaveTextContent('14');
    expect(screen.getByTestId('space-deadlocks')).toHaveTextContent(
      '1 marking without an enabled transition.',
    );
    expect(screen.getByTestId('space-live')).toHaveTextContent('No');
    const witness = screen.getByTestId('deadlock-witness');
    expect(witness).toHaveTextContent('Deadlock 1 after 3 steps');
    const steps = within(witness).getAllByTestId('trace-step');
    expect(steps.map((s) => s.textContent)).toEqual([
      '1.P1 takes left fork',
      '2.P2 takes left fork',
      '3.P3 takes left fork',
    ]);
    // Clicking the last step shows the deadlock in the net; the replay bar confirms it.
    await user.click(steps[2]!);
    await waitFor(() => {
      expect(screen.getByTestId('replay-status')).toHaveAttribute('data-reached', 'true');
    });
    expect(screen.getByTestId('replay-position')).toHaveTextContent('Step 3 of 3');
    expect(editor().mode).toBe('simulate');
  });

  it('plays a deadlock witness with Replay and can leave the replay', async () => {
    const user = userEvent.setup();
    editor().loadNet(example('dining-philosophers-3'), null);
    renderPanel();
    await analyzeAll(user);
    await user.click(within(screen.getByTestId('deadlock-witness')).getByTestId('trace-replay'));
    await waitFor(() => {
      expect(screen.getByTestId('replay-bar')).toBeInTheDocument();
    });
    await waitFor(
      () => {
        expect(screen.getByTestId('replay-status')).toHaveAttribute('data-reached', 'true');
      },
      { timeout: 8000 },
    );
    await user.click(screen.getByTestId('replay-close'));
    expect(screen.queryByTestId('replay-bar')).toBeNull();
    expect(editor().mode).toBe('simulate');
  });

  it('marks results as out of date after an edit and offers to update them', async () => {
    const user = userEvent.setup();
    editor().loadNet(example('mutual-exclusion'), null);
    renderPanel();
    await analyzeAll(user);
    expect(screen.queryByTestId('stale-note')).toBeNull();
    act(() => {
      editor().setTokens(editor().net.places[0]!.id, 2);
    });
    expect(screen.getAllByTestId('stale-note').length).toBeGreaterThanOrEqual(3);
    await user.click(
      within(screen.getAllByTestId('stale-note')[0]!).getByRole('button', { name: 'Update' }),
    );
    await waitFor(() => {
      expect(screen.getAllByTestId('stale-note').length).toBeLessThan(3);
    });
  });

  it('shows ω for unbounded places and lets the exploration be cancelled', async () => {
    const user = userEvent.setup();
    editor().loadNet(example('parcel-center'), null);
    renderPanel();
    useAnalysisStore.getState().setLimit(100000);
    await user.click(screen.getByTestId('space-explore'));
    await screen.findByTestId('space-progress');
    await user.click(screen.getByTestId('space-cancel'));
    await waitFor(() => {
      expect(screen.queryByTestId('space-progress')).toBeNull();
    });
    expect(screen.queryByTestId('space-result')).toBeNull();

    useAnalysisStore.getState().setLimit(1000);
    await user.click(screen.getByTestId('space-explore'));
    await screen.findByTestId('space-result');
    expect(screen.getByTestId('space-result')).toHaveTextContent(
      'Cut off: state limit of 1000 reached',
    );
    expect(screen.getByTestId('space-bounded')).toHaveTextContent(
      'No. The coverability graph shows places that can grow without bound',
    );
    const buffer = editor().net.places.find((p) => p.name === 'Eingangspuffer')!;
    expect(screen.getByTestId(`bound-${buffer.id}`)).toHaveTextContent('ω');
    expect(screen.getByTestId('space-coverability')).toHaveTextContent('unbounded');
  });
});

describe('properties', () => {
  async function formulaEditor(): Promise<EditorView> {
    const content = await screen.findByTestId('property-formula');
    const view = EditorView.findFromDOM(content.closest('.cm-editor') as HTMLElement);
    if (!view) throw new Error('editor not found');
    return view;
  }

  it('adds a DECLARE template through the form and stores it in the document', async () => {
    const user = userEvent.setup();
    editor().loadNet(example('order-processing'), null);
    editor().setProperties(undefined);
    renderPanel();
    expect(screen.getByTestId('properties-empty')).toBeInTheDocument();
    await user.click(screen.getByTestId('property-add'));
    await user.selectOptions(screen.getByTestId('property-template'), 'Response');
    await user.selectOptions(screen.getByTestId('property-activity-a'), 'Approve');
    await user.selectOptions(screen.getByTestId('property-activity-b'), 'Create invoice');
    expect(screen.getByTestId('property-meaning')).toHaveTextContent(
      'Every Approve is eventually followed by Create invoice.',
    );
    await user.click(screen.getByTestId('property-save'));
    expect(editor().net.properties).toEqual([
      expect.objectContaining({
        kind: 'declare',
        template: 'response',
        activities: ['Approve', 'Create invoice'],
      }),
    ]);
    const row = screen.getByTestId('property-row');
    expect(row).toHaveTextContent('response(Approve, Create invoice)');
    expect(within(row).getByTestId('property-status')).toHaveAttribute('data-status', 'pending');
  });

  it('does not accept the same activity twice, a missing count or an unknown template combination', async () => {
    const user = userEvent.setup();
    editor().loadNet(example('order-processing'), null);
    editor().setProperties(undefined);
    renderPanel();
    await user.click(screen.getByTestId('property-add'));
    await user.selectOptions(screen.getByTestId('property-activity-a'), 'Approve');
    await user.selectOptions(screen.getByTestId('property-activity-b'), 'Approve');
    expect(screen.getByTestId('property-problem')).toHaveTextContent(
      'Choose two different activities.',
    );
    expect(screen.getByTestId('property-save')).toBeDisabled();
    await user.selectOptions(screen.getByTestId('property-template'), 'Existence');
    expect(screen.getByTestId('property-count')).toBeInTheDocument();
    expect(screen.queryByTestId('property-activity-b')).toBeNull();
    expect(screen.getByTestId('property-save')).toBeEnabled();
  });

  it('checks the syntax of a formula and the names of its activities while typing', async () => {
    const user = userEvent.setup();
    editor().loadNet(example('order-processing'), null);
    editor().setProperties(undefined);
    renderPanel();
    await user.click(screen.getByTestId('property-add'));
    await user.selectOptions(screen.getByTestId('property-kind'), 'LTLf formula');
    const view = await formulaEditor();
    const type = (text: string): void => {
      act(() => {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      });
    };
    type('G("Approve" ->');
    expect(screen.getByTestId('property-problem')).toHaveTextContent(/position \d+/);
    expect(screen.getByTestId('property-save')).toBeDisabled();
    type('G(Approve -> F Ship)');
    expect(screen.getByTestId('property-problem')).toHaveTextContent(
      '"Ship" is not the name of a transition.',
    );
    type('G(Approve -> F "Create invoice")');
    expect(screen.queryByTestId('property-problem')).toBeNull();
    await user.click(screen.getByTestId('property-save'));
    expect(editor().net.properties).toEqual([
      expect.objectContaining({ kind: 'ltlf', formula: 'G(Approve -> F "Create invoice")' }),
    ]);
  });

  it('edits and removes a property', async () => {
    const user = userEvent.setup();
    editor().loadNet(example('order-processing'), null);
    renderPanel();
    expect(screen.getAllByTestId('property-row')).toHaveLength(3);
    const first = screen.getAllByTestId('property-row')[0]!;
    await user.click(within(first).getByTestId('property-edit'));
    expect(screen.getByTestId('property-editor')).toBeInTheDocument();
    await user.selectOptions(screen.getByTestId('property-template'), 'Chain response');
    await user.click(screen.getByTestId('property-save'));
    expect(editor().net.properties).toBeDefined();
    const list = editor().net.properties as Array<{ template?: string }>;
    expect(list[0]?.template).toBe('chainResponse');
    await user.click(
      within(screen.getAllByTestId('property-row')[0]!).getByTestId('property-remove'),
    );
    expect(screen.getAllByTestId('property-row')).toHaveLength(2);
    act(() => {
      editor().undo();
    });
    expect(screen.getAllByTestId('property-row')).toHaveLength(3);
  });

  it('checks on the state space, shows the verdicts and replays the counterexample', async () => {
    const user = userEvent.setup();
    editor().loadNet(example('order-processing'), null);
    renderPanel();
    await user.click(screen.getByTestId('check-space'));
    await waitFor(() => {
      expect(screen.getByTestId('check-summary')).toBeInTheDocument();
    });
    const rows = screen.getAllByTestId('property-row');
    const statuses = rows.map((r) =>
      within(r).getByTestId('property-status').getAttribute('data-status'),
    );
    expect(statuses).toEqual(['holds', 'violated', 'holds']);
    expect(screen.getByTestId('check-summary')).toHaveTextContent('216 states · a deadlock');
    const counter = within(rows[1]!).getByTestId('counterexample');
    expect(within(counter).getAllByTestId('trace-step')).toHaveLength(9);
    await user.click(within(counter).getByTestId('trace-replay'));
    await waitFor(
      () => {
        expect(screen.getByTestId('replay-status')).toHaveAttribute('data-reached', 'true');
      },
      { timeout: 12000 },
    );
    expect(editor().simMarking?.['invoices']).toHaveLength(5);
  });

  it('marks a verdict as out of date after the property was edited', async () => {
    const user = userEvent.setup();
    editor().loadNet(example('order-processing'), null);
    renderPanel();
    await user.click(screen.getByTestId('check-space'));
    await waitFor(() => {
      expect(screen.getByTestId('check-summary')).toBeInTheDocument();
    });
    const properties = editor().net.properties as Array<Record<string, unknown>>;
    act(() => {
      editor().setProperties([
        { ...properties[2], formula: 'F Approve' },
        properties[0],
        properties[1],
      ]);
    });
    const statuses = screen
      .getAllByTestId('property-row')
      .map((r) => within(r).getByTestId('property-status').getAttribute('data-status'));
    // The first row is the edited property; the other two keep their verdicts.
    expect(statuses).toEqual(['stale', 'holds', 'violated']);
  });

  it('offers the end states and disables the log check until a run exists', async () => {
    const user = userEvent.setup();
    editor().loadNet(example('producer-consumer'), null);
    editor().setProperties([
      { id: 'r', kind: 'declare', template: 'response', activities: ['produce', 'deliver'] },
    ]);
    renderPanel();
    expect(screen.getByTestId('check-log')).toBeDisabled();
    await user.click(screen.getByTestId('check-space'));
    await waitFor(() => {
      expect(screen.getByTestId('property-status')).toHaveTextContent('Holds · Vacuously');
    });
    expect(screen.getByTestId('property-explanation')).toHaveTextContent(
      'Holds vacuously: no run ends in a deadlock',
    );
    await user.selectOptions(screen.getByTestId('check-final'), 'any marking (every prefix)');
    await user.click(screen.getByTestId('check-space'));
    await waitFor(() => {
      expect(screen.getByTestId('property-status')).toHaveAttribute('data-status', 'violated');
    });
    expect(screen.getByTestId('counterexample')).toHaveTextContent('produce');
  });

  it('checks the log of the last simulation run', async () => {
    const user = userEvent.setup();
    editor().loadNet(example('parcel-center'), null);
    renderPanel();
    expect(screen.getByTestId('check-log')).toBeDisabled();
    await editor().startSimulation();
    await waitFor(() => {
      expect(editor().computing).toBe(false);
    });
    for (let i = 0; i < 5; i += 1) {
      await editor().stepNext();
      await waitFor(() => {
        expect(editor().computing).toBe(false);
      });
    }
    await waitFor(() => {
      expect(screen.getByTestId('check-log')).toBeEnabled();
    });
    await user.click(screen.getByTestId('check-include-open'));
    await user.click(screen.getByTestId('check-log'));
    await waitFor(() => {
      expect(screen.getByTestId('log-summary')).toBeInTheDocument();
    });
    const ratios = screen.getAllByTestId('log-ratio').map((el) => el.textContent);
    expect(ratios.length).toBe(3);
    expect(ratios).toContain('100 %');
  });
});

describe('the log check without finished cases', () => {
  it('says that there is nothing to check instead of a share of zero cases', async () => {
    const user = userEvent.setup();
    editor().loadNet(example('parcel-center'), null);
    renderPanel();
    await editor().startSimulation();
    await waitFor(() => {
      expect(editor().computing).toBe(false);
    });
    for (let i = 0; i < 4; i += 1) {
      await editor().stepNext();
      await waitFor(() => {
        expect(editor().computing).toBe(false);
      });
    }
    await waitFor(() => {
      expect(screen.getByTestId('check-log')).toBeEnabled();
    });
    await user.click(screen.getByTestId('check-log'));
    await waitFor(() => {
      expect(screen.getByTestId('log-summary')).toBeInTheDocument();
    });
    expect(screen.getAllByTestId('log-verdict')[0]).toHaveTextContent('No case to check');
    expect(screen.queryByTestId('log-ratio')).toBeNull();
    expect(screen.getByTestId('log-summary')).toHaveTextContent('unfinished');
  });
});

describe('a state space with more than 500 states', () => {
  it('draws the first 500 states and says that there are more', async () => {
    const user = userEvent.setup();
    editor().loadNet(example('parcel-center'), null);
    useAnalysisStore.getState().setLimit(1000);
    renderPanel();
    await user.click(screen.getByTestId('space-explore'));
    await screen.findByTestId('space-result');
    await user.click(screen.getByTestId('space-show-graph'));
    await waitFor(
      () => {
        expect(screen.getAllByTestId('space-node')).toHaveLength(500);
      },
      { timeout: 60000 },
    );
    expect(screen.getByTestId('space-limited')).toHaveTextContent(
      'Showing the first 500 of 1,000 states',
    );
  }, 90000);
});

describe('the state space graph', () => {
  it('opens as a dialog with a node per state and shows a state in the net', async () => {
    const user = userEvent.setup();
    editor().loadNet(example('dining-philosophers-3'), null);
    renderPanel();
    await analyzeAll(user);
    await user.click(screen.getByTestId('space-show-graph'));
    await waitFor(() => {
      expect(screen.getAllByTestId('space-node')).toHaveLength(14);
    });
    expect(
      screen.getAllByTestId('space-node').filter((n) => n.getAttribute('data-deadlock') === 'true'),
    ).toHaveLength(1);
    expect(screen.getByTestId('space-detail')).toHaveTextContent('Click a state');
    fireEvent.click(screen.getAllByTestId('space-node')[0]!);
    expect(screen.getByTestId('space-detail')).toHaveTextContent('State 0');
    expect(screen.getByTestId('space-detail-marking')).toHaveTextContent('Philosopher 1 thinking');
    await user.selectOptions(screen.getByTestId('space-focus'), 'Path to Deadlock 1 after 3 steps');
    await waitFor(() => {
      expect(screen.getAllByTestId('space-node')).toHaveLength(4);
    });
    fireEvent.click(screen.getAllByTestId('space-node').at(-1)!);
    await user.click(screen.getByTestId('space-show-in-net'));
    await waitFor(() => {
      expect(screen.getByTestId('replay-status')).toHaveAttribute('data-reached', 'true');
    });
    expect(useAnalysisStore.getState().graphOpen).toBe(false);
  });
});
