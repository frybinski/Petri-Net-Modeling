import type { Marking, PetriNet } from '@pnm/core';
import type { Step } from '@pnm/analysis';
import { Play } from 'lucide-react';
import { en } from '../../i18n/en';
import { stepText } from '../../lib/analysis-format';
import { playTrace, showAfter } from '../../lib/analysis-replay';
import { Button } from '../ui/button';

/**
 * A recorded run as a list of steps. Clicking a step shows the net after it; "Replay" plays the
 * whole run in the simulation.
 */
export function TraceSteps({
  net,
  steps,
  label,
  target,
  testId,
}: {
  net: PetriNet;
  steps: Step[];
  label: string;
  /** The marking in which the run ends, to check the replay against. */
  target: Marking | null;
  testId?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5" data-testid={testId}>
      {steps.length === 0 ? (
        <p className="m-0 text-xs text-muted">{en.analysis.graph.none}</p>
      ) : (
        <ol className="m-0 flex list-none flex-wrap gap-1 p-0">
          {steps.map((step, index) => (
            <li key={index}>
              <button
                type="button"
                onClick={() => {
                  showAfter(label, steps, index + 1, index + 1 === steps.length ? target : null);
                }}
                className="inline-flex max-w-full items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-left text-[11px] leading-snug transition-colors hover:bg-surface-hover"
                title={en.analysis.properties.counterexampleHint}
                data-testid="trace-step"
              >
                <span className="text-muted tabular-nums">{index + 1}.</span>
                <span className="truncate">{stepText(net, step)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      <div>
        <Button
          size="sm"
          variant="secondary"
          icon={<Play size={12} aria-hidden="true" />}
          onClick={() => {
            playTrace(label, steps, target);
          }}
          data-testid="trace-replay"
        >
          {en.analysis.space.replay}
        </Button>
      </div>
    </div>
  );
}
