import type { PetriNet } from '@pnm/core';
import type { Invariant, InvariantResult } from '@pnm/analysis';
import { Loader2 } from 'lucide-react';
import { en } from '../../i18n/en';
import { elementName } from '../../lib/analysis-format';
import { isStale, useAnalysisStore } from '../../store/analysis-store';
import { useEditorStore } from '../../store/editor-store';
import { Button } from '../ui/button';
import { PanelSection } from '../sim/section';
import { ErrorNote, StaleNote, YesNo } from './parts';

function InvariantList({
  title,
  hint,
  list,
  kind,
}: {
  title: string;
  hint: string;
  list: Invariant[];
  kind: 'p' | 't';
}) {
  const select = useEditorStore((s) => s.select);
  return (
    <div className="flex flex-col gap-1" data-testid={`${kind}-invariants`}>
      <h4 className="m-0 text-xs font-semibold">{title}</h4>
      <p className="m-0 text-[11px] text-muted">{hint}</p>
      {list.length === 0 ? (
        <p className="m-0 text-xs text-muted">{en.analysis.invariants.none}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {list.map((invariant, index) => (
            <li key={invariant.equation}>
              <button
                type="button"
                onClick={() => {
                  select(
                    invariant.terms
                      .map((term) => term.complementOf ?? term.id)
                      .filter((id, i, all) => all.indexOf(id) === i),
                  );
                }}
                className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-left font-mono text-[11px] leading-snug transition-colors hover:bg-surface-hover"
                data-testid={`${kind}-invariant-${index}`}
              >
                {invariant.equation}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Result({ net, result }: { net: PetriNet; result: InvariantResult }) {
  const t = en.analysis.invariants;
  const uncovered = net.places.filter((p) => !result.coveredPlaces.includes(p.id));
  const uncoveredTransitions = net.transitions.filter(
    (tr) => !result.coveredTransitions.includes(tr.id),
  );
  const hasCapacity = net.places.some((p) => p.capacity !== undefined);
  return (
    <>
      {result.approximate ? (
        <p className="m-0 text-[11px] text-muted">{en.analysis.jsonSkeleton}</p>
      ) : null}
      <InvariantList title={t.place} hint={t.placeHint} list={result.pInvariants} kind="p" />
      <div className="flex items-start gap-2" data-testid="p-covered">
        <YesNo value={result.truncated ? null : result.coveredByPInvariants} />
        <p className="m-0 text-[11px] leading-snug text-muted">
          {result.coveredByPInvariants ? t.covered : t.notCovered(uncovered.length)}{' '}
          {!result.coveredByPInvariants && uncovered.length > 0
            ? uncovered.map((p) => elementName(net, p.id)).join(', ')
            : null}
        </p>
      </div>
      {hasCapacity ? <p className="m-0 text-[11px] text-muted">{t.capacityHint}</p> : null}
      <InvariantList
        title={t.transition}
        hint={t.transitionHint}
        list={result.tInvariants}
        kind="t"
      />
      <div className="flex items-start gap-2" data-testid="t-covered">
        <YesNo value={result.truncated ? null : result.coveredByTInvariants} />
        <p className="m-0 text-[11px] leading-snug text-muted">
          {result.coveredByTInvariants
            ? t.tCovered
            : t.tNotCovered(uncoveredTransitions.map((tr) => elementName(net, tr.id)).join(', '))}
        </p>
      </div>
      {result.truncated ? <p className="m-0 text-[11px] text-warn">{t.truncated}</p> : null}
    </>
  );
}

export function InvariantsCard() {
  const net = useEditorStore((s) => s.net);
  const result = useAnalysisStore((s) => s.invariants);
  const busy = useAnalysisStore((s) => s.busy.invariants);
  const error = useAnalysisStore((s) => s.errors.invariants);
  const run = useAnalysisStore((s) => s.runInvariants);
  const stale = isStale(result, net);
  return (
    <PanelSection
      title={en.analysis.invariants.title}
      hint={result ? en.analysis.invariants.hint : undefined}
      data-testid="invariants-card"
      actions={
        result ? null : (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            icon={busy ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : null}
            onClick={() => {
              void run();
            }}
            data-testid="invariants-run"
          >
            {en.analysis.invariants.run}
          </Button>
        )
      }
    >
      {stale ? (
        <StaleNote
          disabled={busy}
          onRefresh={() => {
            void run();
          }}
        />
      ) : null}
      {error ? <ErrorNote message={error} /> : null}
      {result ? <Result net={net} result={result.value} /> : null}
    </PanelSection>
  );
}
