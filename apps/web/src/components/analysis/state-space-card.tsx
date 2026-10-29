import { Loader2, Network } from 'lucide-react';
import type { PetriNet } from '@pnm/core';
import type { BehaviourProperties, CoverabilityResult, LivenessClass } from '@pnm/analysis';
import { en } from '../../i18n/en';
import { elementName, markingText } from '../../lib/analysis-format';
import {
  LIMIT_CHOICES,
  isStale,
  useAnalysisStore,
  type SpaceOutcome,
} from '../../store/analysis-store';
import { useEditorStore } from '../../store/editor-store';
import { Button } from '../ui/button';
import { SelectField } from '../ui/fields';
import { PanelSection } from '../sim/section';
import { ErrorNote, Fact, StaleNote, YesNo } from './parts';
import { TraceSteps } from './trace-steps';

const BADGE: Record<LivenessClass, string> = {
  dead: 'bg-danger-soft text-danger',
  L1: 'bg-warn-soft text-warn',
  L3: 'bg-accent-soft text-accent',
  L4: 'bg-ok-soft text-ok',
  unknown: 'bg-surface-2 text-muted',
};

function boundedText(
  behaviour: BehaviourProperties,
  coverability: CoverabilityResult | null,
  net: PetriNet,
): { value: boolean | null; text: string } {
  const t = en.analysis.space;
  if (behaviour.bounded === true) {
    return { value: true, text: t.boundedYes(behaviour.maxPlaceTokens) };
  }
  if (coverability?.applicable && coverability.bounded === false) {
    return {
      value: false,
      text: t.boundedNoCover(
        coverability.unboundedPlaces.map((id) => elementName(net, id)).join(', '),
      ),
    };
  }
  if (coverability?.applicable && coverability.bounded === true) {
    return { value: true, text: t.boundedYes(behaviour.maxPlaceTokens) };
  }
  return { value: null, text: t.boundedUnknown };
}

function Outcome({ net, outcome }: { net: PetriNet; outcome: SpaceOutcome }) {
  const t = en.analysis.space;
  const { report, coverability } = outcome;
  const { space, behaviour } = report;
  const bounded = boundedText(behaviour, coverability, net);
  const openGraph = useAnalysisStore((s) => s.openGraph);
  return (
    <>
      <dl className="m-0 flex flex-col gap-2.5" data-testid="space-result">
        <Fact
          label={t.states}
          value={<span data-testid="space-states">{behaviour.states.toLocaleString('en')}</span>}
        >
          {space.truncated ? t.cutOff(space.reason ?? '') : t.complete}
        </Fact>
        <Fact
          label={t.edges}
          value={<span data-testid="space-edges">{behaviour.edges.toLocaleString('en')}</span>}
        />
        <Fact label={t.bounded} testId="space-bounded" value={<YesNo value={bounded.value} />}>
          {bounded.text}
        </Fact>
        <Fact
          label={t.deadlocks}
          testId="space-deadlocks"
          value={<YesNo value={behaviour.deadlockFree} />}
        >
          {behaviour.deadlockCount > 0
            ? t.deadlockCount(behaviour.deadlockCount)
            : behaviour.deadlockFree
              ? t.deadlockNone
              : t.deadlockNoneSoFar}
        </Fact>
        <Fact label={t.live} testId="space-live" value={<YesNo value={behaviour.live} />}>
          {behaviour.live === null ? t.liveUnknown : behaviour.live ? t.liveYes : t.liveNo}
        </Fact>
        <Fact
          label={t.reversible}
          testId="space-reversible"
          value={<YesNo value={behaviour.reversible} />}
        >
          {behaviour.reversible === null
            ? t.liveUnknown
            : behaviour.reversible
              ? t.reversibleYes
              : t.reversibleNo}
        </Fact>
      </dl>

      {behaviour.deadlocks.length > 0 ? (
        <div className="flex flex-col gap-2" data-testid="space-deadlock-list">
          {behaviour.deadlocks.map((witness, index) => (
            <div
              key={witness.stateId}
              className="flex flex-col gap-1.5 rounded-md border border-border bg-surface-2 p-2"
              data-testid="deadlock-witness"
            >
              <span className="text-xs font-semibold text-danger">
                {t.deadlockItem(index + 1, witness.trace.length)}
              </span>
              <span className="text-[11px] text-muted" data-testid="deadlock-marking">
                {t.marking}: {markingText(net, witness.marking)}
              </span>
              <TraceSteps
                net={net}
                steps={witness.trace}
                label={t.deadlockItem(index + 1, witness.trace.length)}
                target={witness.marking}
                testId="deadlock-trace"
              />
            </div>
          ))}
        </div>
      ) : null}

      <details className="text-xs" data-testid="space-liveness">
        <summary className="cursor-pointer font-medium text-muted select-none hover:text-fg">
          {t.transitions}
        </summary>
        <ul className="m-0 mt-1.5 flex list-none flex-col gap-1 p-0">
          {behaviour.transitions.map((entry) => (
            <li key={entry.transitionId} className="flex items-center justify-between gap-2">
              <span className="truncate">{entry.name || entry.transitionId}</span>
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${BADGE[entry.liveness]}`}
                title={t.livenessHelp[entry.liveness]}
                data-testid={`liveness-${entry.transitionId}`}
              >
                {t.liveness[entry.liveness]}
              </span>
            </li>
          ))}
        </ul>
        <p className="m-0 mt-1.5 text-[11px] text-muted">
          {(['dead', 'L1', 'L3', 'L4'] as const)
            .map((cls) => `${t.liveness[cls]}: ${t.livenessHelp[cls]}`)
            .join(' ')}
        </p>
      </details>

      <details className="text-xs" data-testid="space-bounds">
        <summary className="cursor-pointer font-medium text-muted select-none hover:text-fg">
          {t.places}
        </summary>
        <ul className="m-0 mt-1.5 flex list-none flex-col gap-1 p-0">
          {net.places.map((place) => {
            const omega = coverability?.bounds[place.id] === 'ω';
            return (
              <li key={place.id} className="flex items-center justify-between gap-2">
                <span className="truncate">{place.name || place.id}</span>
                <span className="shrink-0 font-mono text-[11px]" data-testid={`bound-${place.id}`}>
                  {omega ? 'ω' : (behaviour.bounds[place.id] ?? 0)}
                </span>
              </li>
            );
          })}
        </ul>
      </details>

      {coverability?.applicable ? (
        <p className="m-0 text-[11px] text-muted" data-testid="space-coverability">
          <strong className="font-semibold text-fg">{t.coverability}:</strong>{' '}
          {t.coverabilityNodes(coverability.nodes.length)}
          {coverability.unboundedPlaces.length > 0
            ? `; ${t.unbounded}: ${coverability.unboundedPlaces.map((id) => elementName(net, id)).join(', ')}`
            : ''}
        </p>
      ) : null}

      <div>
        <Button
          size="sm"
          variant="secondary"
          icon={<Network size={13} aria-hidden="true" />}
          onClick={openGraph}
          data-testid="space-show-graph"
        >
          {t.showGraph}
        </Button>
      </div>
    </>
  );
}

export function StateSpaceCard() {
  const t = en.analysis.space;
  const net = useEditorStore((s) => s.net);
  const result = useAnalysisStore((s) => s.space);
  const busy = useAnalysisStore((s) => s.busy.space);
  const progress = useAnalysisStore((s) => s.progress);
  const error = useAnalysisStore((s) => s.errors.space);
  const limit = useAnalysisStore((s) => s.limit);
  const setLimit = useAnalysisStore((s) => s.setLimit);
  const explore = useAnalysisStore((s) => s.exploreStateSpace);
  const cancel = useAnalysisStore((s) => s.cancel);
  const stale = isStale(result, net);
  const choices = LIMIT_CHOICES.includes(limit as (typeof LIMIT_CHOICES)[number])
    ? [...LIMIT_CHOICES]
    : [...LIMIT_CHOICES, limit].sort((a, b) => a - b);

  return (
    <PanelSection title={t.title} hint={t.hint} data-testid="space-card">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <SelectField
            label={t.limit}
            value={String(limit)}
            options={choices.map((n) => ({ value: String(n), label: n.toLocaleString('en') }))}
            onChange={(value) => {
              setLimit(Number(value));
            }}
            disabled={busy}
            data-testid="space-limit"
          />
        </div>
        {busy ? (
          <Button size="md" variant="secondary" onClick={cancel} data-testid="space-cancel">
            {en.analysis.cancel}
          </Button>
        ) : (
          <Button
            size="md"
            variant="primary"
            onClick={() => {
              void explore();
            }}
            data-testid="space-explore"
          >
            {t.explore}
          </Button>
        )}
      </div>
      {busy ? (
        <p
          className="m-0 flex items-center gap-2 text-xs text-muted"
          role="status"
          data-testid="space-progress"
        >
          <Loader2 size={13} className="animate-spin" aria-hidden="true" />
          {progress ? t.progress(progress.states, progress.edges) : '…'}
        </p>
      ) : null}
      {stale ? (
        <StaleNote
          disabled={busy}
          onRefresh={() => {
            void explore();
          }}
        />
      ) : null}
      {error ? <ErrorNote message={error} /> : null}
      {result ? <Outcome net={net} outcome={result.value} /> : null}
    </PanelSection>
  );
}
