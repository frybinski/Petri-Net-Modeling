import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Loader2,
  RotateCcw,
  Settings,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { en } from '../../i18n/en';
import {
  applyChoicesWithoutLlm,
  applyGeneratedView,
  backToForm,
  cancelGeneration,
  chooseTab,
  closeGenerateDialog,
  failureHint,
  startGeneration,
} from '../../lib/domain-generation';
import { analyseDomainView, countSeverities, hasHandMadeEntries } from '../../lib/domain-view';
import { seconds } from '../../lib/llm-format';
import { isConfigured } from '../../lib/llm-settings';
import { useEditorStore } from '../../store/editor-store';
import {
  useGenerationStore,
  type GenerationFailure,
  type GenerationTab,
  type StepRow,
} from '../../store/generation-store';
import { useLlmStore } from '../../store/llm-store';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { NumberField, inputClass } from '../ui/fields';
import { useChoiceProblems } from '../../lib/use-choice-problems';
import { GuidedForm } from './guided-form';
import {
  Details,
  FindingList,
  OriginSummary,
  PromptBlock,
  RoundLogList,
  ViewPreview,
} from './generation-parts';

/** The current time, refreshed while `active`, for the running step durations. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 250);
    return () => {
      window.clearInterval(timer);
    };
  }, [active]);
  return now;
}

function stepLabel(step: StepRow, maxRounds: number): string {
  switch (step.phase) {
    case 'prompt':
      return en.llm.stepPrompt;
    case 'waiting':
      return en.llm.stepWaiting(step.round, maxRounds);
    case 'validating':
      return en.llm.stepValidating(step.round);
    case 'repairing':
      return en.llm.stepRepairing(step.round + 1, maxRounds);
    case 'filling':
      return en.llm.stepFilling;
    case 'done':
      return en.llm.stepDone;
  }
}

function ProgressList({
  steps,
  maxRounds,
  running,
}: {
  steps: StepRow[];
  maxRounds: number;
  running: boolean;
}) {
  const now = useNow(running);
  return (
    <ol
      className="m-0 flex list-none flex-col gap-1.5 p-0"
      aria-label={en.llm.steps}
      data-testid="llm-progress"
    >
      {steps.map((step) => {
        const active = step.endedAt === null && running;
        const counts = step.diagnostics ? countSeverities(step.diagnostics) : null;
        return (
          <li
            key={step.id}
            className="flex items-center gap-2 text-sm"
            data-testid="llm-step"
            data-phase={step.phase}
            data-round={step.round}
            data-active={active}
          >
            {active ? (
              <Loader2 size={15} className="shrink-0 animate-spin text-accent" aria-hidden="true" />
            ) : (
              <CheckCircle2 size={15} className="shrink-0 text-ok" aria-hidden="true" />
            )}
            <span className={active ? 'font-medium' : ''}>{stepLabel(step, maxRounds)}</span>
            {step.phase === 'validating' && counts ? (
              <span
                className={`text-xs ${counts.errors > 0 ? 'text-danger' : counts.warnings > 0 ? 'text-warn' : 'text-ok'}`}
              >
                {en.llm.findings(counts.errors, counts.warnings)}
              </span>
            ) : null}
            {step.phase !== 'done' ? (
              <span className="ml-auto text-xs text-muted tabular-nums">
                {seconds((step.endedAt ?? now) - step.startedAt)}
              </span>
            ) : null}
          </li>
        );
      })}
      {steps.length === 0 ? (
        <li className="flex items-center gap-2 text-sm text-muted">
          <Circle size={15} aria-hidden="true" />
          {en.llm.stepPrompt}
        </li>
      ) : null}
    </ol>
  );
}

function ProviderLine() {
  const settings = useLlmStore((s) => s.settings);
  const openSettings = useLlmStore((s) => s.openSettings);
  const configured = isConfigured(settings);
  return (
    <div className="flex items-center gap-2 rounded-md bg-surface-2 px-2.5 py-2 text-xs">
      <span className="text-muted">{en.llm.provider}</span>
      {configured ? (
        <span className="min-w-0 truncate font-mono" data-testid="llm-provider-line">
          {settings.model} ·{' '}
          {settings.preset === 'server' ? en.llm.presets['server'] : settings.baseUrl}
        </span>
      ) : (
        <span className="min-w-0 flex-1 text-warn" role="status" data-testid="llm-not-configured">
          {en.llm.notConfigured}
        </span>
      )}
      <Button
        size="sm"
        className="ml-auto"
        icon={<Settings size={13} aria-hidden="true" />}
        onClick={openSettings}
        data-testid="llm-change-provider"
      >
        {en.llm.change}
      </Button>
    </div>
  );
}

/** The two ways into the dialog: a form with choices, or a free description (N4). */
function Tabs() {
  const tab = useGenerationStore((s) => s.tab);
  const tabs: ReadonlyArray<{ id: GenerationTab; label: string }> = [
    { id: 'guided', label: en.llm.tabGuided },
    { id: 'free', label: en.llm.tabFree },
  ];
  return (
    <div
      role="tablist"
      aria-label={en.llm.tabs}
      className="flex gap-1 border-b border-border"
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        chooseTab(tab === 'guided' ? 'free' : 'guided');
        window.setTimeout(() => {
          event.currentTarget.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
        });
      }}
    >
      {tabs.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          id={`llm-tab-${item.id}`}
          aria-selected={tab === item.id}
          aria-controls="llm-tab-panel"
          tabIndex={tab === item.id ? 0 : -1}
          onClick={() => {
            chooseTab(item.id);
          }}
          data-testid={`llm-tab-${item.id}`}
          className="-mb-px border-b-2 border-transparent px-3 py-1.5 text-sm font-medium text-muted hover:text-fg aria-selected:border-accent aria-selected:text-fg"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** The free way: a description in the person's own words, wishes about the look included. */
function FreeText() {
  const description = useGenerationStore((s) => s.description);
  const patch = useGenerationStore((s) => s.patch);
  const id = useId();
  const hintId = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {en.llm.describe}
      </label>
      <textarea
        id={id}
        rows={4}
        autoFocus
        value={description}
        placeholder={en.llm.describePlaceholder}
        aria-describedby={hintId}
        className={`${inputClass} h-auto resize-y py-1.5`}
        data-testid="llm-description"
        onChange={(event) => {
          patch({ description: event.target.value });
        }}
      />
      <p id={hintId} className="m-0 text-[11px] text-muted">
        {en.llm.describeHint}
      </p>
    </div>
  );
}

function FormBody() {
  const tab = useGenerationStore((s) => s.tab);
  const width = useGenerationStore((s) => s.width);
  const height = useGenerationStore((s) => s.height);
  const patch = useGenerationStore((s) => s.patch);
  const net = useEditorStore((s) => s.net);
  const view = analyseDomainView(net).validation?.view ?? null;
  return (
    <div className="flex flex-col gap-4">
      <Tabs />
      <ProviderLine />
      <div
        role="tabpanel"
        id="llm-tab-panel"
        aria-labelledby={`llm-tab-${tab}`}
        className="flex flex-col gap-4"
      >
        {tab === 'guided' ? <GuidedForm /> : <FreeText />}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label={en.llm.canvasWidth}
          value={width}
          min={100}
          max={10000}
          onCommit={(value) => {
            if (value !== undefined) patch({ width: value });
          }}
          data-testid="llm-width"
        />
        <NumberField
          label={en.llm.canvasHeight}
          value={height}
          min={100}
          max={10000}
          onCommit={(value) => {
            if (value !== undefined) patch({ height: value });
          }}
          data-testid="llm-height"
        />
      </div>
      {hasHandMadeEntries(view) ? (
        <p
          className="m-0 rounded-md bg-warn-soft px-2.5 py-2 text-xs text-warn"
          role="note"
          data-testid="llm-replace-note"
        >
          {tab === 'guided' ? en.llm.guided.replaceNote : en.llm.replaceNote}
        </p>
      ) : null}
    </div>
  );
}

function ResultBody() {
  const result = useGenerationStore((s) => s.result);
  if (!result) return null;
  const { generation, record, net } = result;
  const { errors, warnings } = countSeverities(generation.diagnostics);
  const rounds = generation.rounds.length;
  const outcome = generation.fellBack
    ? en.llm.outcomeFellBack
    : generation.filled.some((p) => !p.startsWith('arcs.')) || generation.dropped.length > 0
      ? en.llm.outcomeFilled(rounds)
      : en.llm.outcomeAccepted(rounds);
  const clean = errors + warnings === 0;
  return (
    <div className="flex flex-col gap-4" data-testid="llm-result">
      <p
        className="m-0 flex items-start gap-2 text-sm font-medium"
        role="status"
        data-testid="llm-outcome"
      >
        <CheckCircle2 size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-ok" />
        <span>{outcome}</span>
      </p>
      {generation.modelNotes.length > 0 ? (
        <section
          className="flex flex-col gap-1 rounded-md border border-warn bg-warn-soft px-3 py-2"
          aria-label={en.llm.modelNotes}
          data-testid="llm-model-notes"
        >
          <h3 className="m-0 flex items-center gap-1.5 text-xs font-semibold text-warn">
            <AlertTriangle size={13} aria-hidden="true" />
            {en.llm.modelNotes}
          </h3>
          <ul className="m-0 list-disc pl-5 text-xs">
            {generation.modelNotes.map((note) => (
              <li key={note} data-testid="llm-model-note">
                {note}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <ViewPreview net={net} view={generation.view} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <h3 className="m-0 text-[11px] font-semibold tracking-wide text-muted uppercase">
            {en.llm.summary}
          </h3>
          <OriginSummary
            view={generation.view}
            filled={generation.filled}
            dropped={generation.dropped}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <h3 className="m-0 text-[11px] font-semibold tracking-wide text-muted uppercase">
            {en.llm.remaining}
          </h3>
          {clean ? (
            <p className="m-0 text-xs text-muted" data-testid="llm-no-findings">
              {en.llm.noRemaining}
            </p>
          ) : (
            <FindingList diagnostics={generation.diagnostics} label={en.llm.remaining} />
          )}
        </div>
      </div>
      {generation.notes.length > 0 ? (
        <ul
          className="m-0 list-disc pl-5 text-xs text-muted"
          aria-label={en.llm.notes}
          data-testid="llm-notes"
        >
          {generation.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
      <Details title={`${en.llm.rounds} (${rounds})`} testId="llm-rounds-details">
        <RoundLogList rounds={generation.rounds} />
      </Details>
      <Details title={en.llm.promptTitle} testId="llm-prompt-details">
        <PromptBlock prompt={record.prompt} />
      </Details>
    </div>
  );
}

function FailureBody({ failure }: { failure: GenerationFailure }) {
  const settings = useLlmStore((s) => s.settings);
  const openSettings = useLlmStore((s) => s.openSettings);
  const hint = failureHint(failure.kind, settings);
  return (
    <div className="flex flex-col gap-3" role="alert" data-testid="llm-failure">
      <p className="m-0 flex items-start gap-2 text-sm font-medium text-danger">
        <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
        <span>{en.llm.failedTitle}</span>
      </p>
      <p className="m-0 rounded-md bg-surface-2 p-2 font-mono text-xs break-words">
        {failure.message}
      </p>
      {hint ? <p className="m-0 text-xs text-muted">{hint}</p> : null}
      <div>
        <Button
          size="sm"
          icon={<Settings size={13} aria-hidden="true" />}
          onClick={openSettings}
          data-testid="llm-failure-settings"
        >
          {en.llm.settingsAction}
        </Button>
      </div>
    </div>
  );
}

/** The guided flow: describe the domain, watch the rounds, review the result, use or discard it. */
export function GenerateDialog() {
  const open = useGenerationStore((s) => s.open);
  const stage = useGenerationStore((s) => s.stage);
  const steps = useGenerationStore((s) => s.steps);
  const maxRounds = useGenerationStore((s) => s.maxRounds);
  const failure = useGenerationStore((s) => s.failure);
  const settings = useLlmStore((s) => s.settings);
  const locked = useEditorStore((s) => s.mode === 'simulate');
  const tab = useGenerationStore((s) => s.tab);
  const choices = useGenerationStore((s) => s.choices);
  const problems = useChoiceProblems();
  // The guided way needs a form without errors; the free one needs nothing.
  const guidedBlocked = tab === 'guided' && (choices === null || problems.length > 0);

  let footer;
  let body;
  if (stage === 'running') {
    body = <ProgressList steps={steps} maxRounds={maxRounds} running />;
    footer = (
      <>
        <Button
          onClick={closeGenerateDialog}
          title={en.llm.backgroundTip}
          data-testid="llm-background"
        >
          {en.llm.background}
        </Button>
        <Button variant="danger" onClick={cancelGeneration} data-testid="llm-cancel">
          {en.llm.cancelRun}
        </Button>
      </>
    );
  } else if (stage === 'result') {
    body = <ResultBody />;
    footer = (
      <>
        <Button onClick={closeGenerateDialog} data-testid="llm-discard">
          {en.llm.discard}
        </Button>
        <Button
          icon={<RotateCcw size={14} aria-hidden="true" />}
          onClick={backToForm}
          data-testid="llm-back"
        >
          {en.llm.back}
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            applyGeneratedView();
          }}
          disabled={locked}
          data-testid="llm-use"
        >
          {en.llm.use}
        </Button>
      </>
    );
  } else if (stage === 'error' && failure) {
    body = <FailureBody failure={failure} />;
    footer = (
      <>
        <Button onClick={closeGenerateDialog}>{en.llm.close}</Button>
        <Button variant="primary" onClick={backToForm} data-testid="llm-retry">
          {en.llm.tryAgain}
        </Button>
      </>
    );
  } else {
    body = <FormBody />;
    footer = (
      <>
        <Button onClick={closeGenerateDialog} data-testid="llm-close">
          {en.llm.close}
        </Button>
        {tab === 'guided' ? (
          <Button
            icon={<Wand2 size={14} aria-hidden="true" />}
            onClick={() => {
              void applyChoicesWithoutLlm();
            }}
            disabled={guidedBlocked || locked}
            title={locked ? en.llm.lockedTip : en.llm.guided.applyTip}
            data-testid="guided-apply"
          >
            {en.llm.guided.apply}
          </Button>
        ) : null}
        <Button
          variant="primary"
          icon={<Sparkles size={14} aria-hidden="true" />}
          onClick={() => {
            void startGeneration();
          }}
          disabled={!isConfigured(settings) || locked || guidedBlocked}
          title={locked ? en.llm.lockedTip : undefined}
          data-testid="llm-start"
        >
          {en.llm.generate}
        </Button>
      </>
    );
  }

  return (
    <Dialog
      open={open}
      title={en.llm.dialogTitle}
      onClose={closeGenerateDialog}
      width="max-w-3xl"
      footer={footer}
    >
      <div data-testid="llm-dialog" data-stage={stage}>
        {body}
      </div>
    </Dialog>
  );
}
