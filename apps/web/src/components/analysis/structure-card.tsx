import type { PetriNet } from '@pnm/core';
import type { StructureResult } from '@pnm/analysis';
import { Loader2 } from 'lucide-react';
import { en } from '../../i18n/en';
import { elementName } from '../../lib/analysis-format';
import { useAnalysisStore, isStale } from '../../store/analysis-store';
import { useEditorStore } from '../../store/editor-store';
import { Button } from '../ui/button';
import { PanelSection } from '../sim/section';
import { ElementChip, ErrorNote, StaleNote, YesNo } from './parts';

function Chips({ net, label, ids }: { net: PetriNet; label: string; ids: string[] }) {
  if (ids.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-muted">{label}</span>
      <div className="flex flex-wrap gap-1">
        {ids.map((id) => (
          <ElementChip key={id} ids={[id]}>
            {elementName(net, id)}
          </ElementChip>
        ))}
      </div>
    </div>
  );
}

function SetList({ net, title, sets }: { net: PetriNet; title: string; sets: string[][] }) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer select-none font-medium text-muted hover:text-fg">
        {title}
      </summary>
      <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
        {sets.length === 0 ? <li className="text-muted">{en.analysis.structure.noSets}</li> : null}
        {sets.map((set, index) => (
          <li key={set.join(',')} className="flex flex-wrap gap-1" data-testid={`set-${index}`}>
            <ElementChip ids={set}>{set.map((id) => elementName(net, id)).join(', ')}</ElementChip>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Result({ net, result }: { net: PetriNet; result: StructureResult }) {
  const t = en.analysis.structure;
  return (
    <>
      {result.approximate ? (
        <p className="m-0 text-[11px] text-muted">{en.analysis.jsonSkeleton}</p>
      ) : null}
      <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="structure-checks">
        {result.checks.map((check) => (
          <li
            key={check.key}
            className="flex items-start gap-2"
            data-testid={`structure-${check.key}`}
          >
            <YesNo value={check.holds} />
            <div className="flex min-w-0 flex-col">
              <span className="text-sm font-medium">{check.label}</span>
              <span className="text-[11px] leading-snug text-muted">{check.explanation}</span>
            </div>
          </li>
        ))}
      </ul>
      <Chips net={net} label={t.sources} ids={result.sourcePlaces} />
      <Chips net={net} label={t.sinks} ids={result.sinkPlaces} />
      <Chips net={net} label={t.sourceTransitions} ids={result.sourceTransitions} />
      <Chips net={net} label={t.sinkTransitions} ids={result.sinkTransitions} />
      <Chips net={net} label={t.isolated} ids={result.isolated} />
      {result.conflicts.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-muted">{t.conflicts}</span>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {result.conflicts.map((c) => (
              <li key={c.placeId} className="flex flex-wrap items-center gap-1 text-[11px]">
                <ElementChip ids={[c.placeId, ...c.transitionIds]}>
                  {t.conflictItem(
                    elementName(net, c.placeId),
                    c.transitionIds.map((id) => elementName(net, id)).join(' | '),
                  )}
                </ElementChip>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <SetList net={net} title={t.siphons(result.siphons.length)} sets={result.siphons} />
      <SetList net={net} title={t.traps(result.traps.length)} sets={result.traps} />
      {result.setsTruncated ? <p className="m-0 text-[11px] text-warn">{t.setsTruncated}</p> : null}
      {result.commoner ? (
        <div className="flex items-start gap-2" data-testid="structure-commoner">
          <YesNo value={result.commoner.holds} />
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-medium">{t.commoner}</span>
            <span className="text-[11px] leading-snug text-muted">
              {result.commoner.holds
                ? t.commonerHolds
                : `${t.commonerFails(result.commoner.violating.length)}${
                    result.freeChoice ? ` ${t.commonerFree}` : ''
                  }`}
            </span>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function StructureCard() {
  const net = useEditorStore((s) => s.net);
  const result = useAnalysisStore((s) => s.structure);
  const busy = useAnalysisStore((s) => s.busy.structure);
  const error = useAnalysisStore((s) => s.errors.structure);
  const run = useAnalysisStore((s) => s.runStructure);
  const stale = isStale(result, net);
  return (
    <PanelSection
      title={en.analysis.structure.title}
      hint={result ? undefined : en.analysis.structure.hint}
      data-testid="structure-card"
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
            data-testid="structure-run"
          >
            {en.analysis.structure.run}
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
