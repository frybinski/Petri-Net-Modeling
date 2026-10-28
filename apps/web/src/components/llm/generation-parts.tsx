import type { PetriNet } from '@pnm/core';
import { buildStaticScene, paintScene, type DomainDiagnostic, type DomainView } from '@pnm/domain';
import type { DomainViewGeneration, RoundLog } from '@pnm/llm/record';
import { AlertCircle, AlertTriangle, Check, Copy } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { en } from '../../i18n/en';
import { countSeverities, originCounts } from '../../lib/domain-view';
import { paletteFor } from '../../lib/domain-theme';
import { seconds } from '../../lib/llm-format';
import { useUiStore } from '../../store/ui-store';
import { Button } from '../ui/button';

export function FindingRow({ diagnostic }: { diagnostic: DomainDiagnostic }) {
  const error = diagnostic.severity === 'error';
  const Icon = error ? AlertCircle : AlertTriangle;
  return (
    <li
      className="flex items-start gap-2 px-1 py-0.5"
      data-testid="llm-finding"
      data-rule={diagnostic.rule}
    >
      <Icon
        size={13}
        aria-hidden="true"
        className={`mt-0.5 shrink-0 ${error ? 'text-danger' : 'text-warn'}`}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span
            className={`rounded px-1 font-mono text-[10px] font-semibold ${error ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn'}`}
          >
            {diagnostic.rule}
          </span>
          <span className="text-xs break-words">{diagnostic.message}</span>
        </span>
        <span className="block truncate font-mono text-[10px] text-muted">{diagnostic.path}</span>
      </span>
    </li>
  );
}

export function FindingList({
  diagnostics,
  label,
}: {
  diagnostics: readonly DomainDiagnostic[];
  label: string;
}) {
  return (
    <ul
      className="m-0 flex max-h-48 list-none flex-col gap-0.5 overflow-y-auto p-0"
      aria-label={label}
    >
      {diagnostics.map((d, i) => (
        <FindingRow key={`${d.rule}:${d.path}:${i}`} diagnostic={d} />
      ))}
    </ul>
  );
}

/** The log of the rounds: what was asked, what the checking program found. */
export function RoundLogList({ rounds }: { rounds: readonly RoundLog[] }) {
  return (
    <ol className="m-0 flex list-none flex-col gap-2 p-0" data-testid="llm-rounds">
      {rounds.map((round) => {
        const { errors, warnings } = countSeverities(round.diagnostics);
        return (
          <li
            key={round.round}
            className="rounded-md border border-border bg-surface-2 p-2"
            data-testid="llm-round"
          >
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
              <span className="font-semibold">{en.llm.round(round.round)}</span>
              <span className="text-muted">
                {round.kind === 'generate' ? en.llm.roundGenerate : en.llm.roundRepair}
              </span>
              <span className="text-muted">
                {en.llm.roundMode}: {round.mode}
              </span>
              {round.usage ? (
                <span className="text-muted tabular-nums">
                  {en.llm.roundTokens(round.usage.prompt, round.usage.completion)}
                </span>
              ) : null}
              <span className="text-muted tabular-nums">{seconds(round.durationMs)}</span>
              {round.written ? (
                <span className="text-muted">{en.llm.roundWritten(round.written.length)}</span>
              ) : null}
              <span
                className={`ml-auto font-medium ${errors > 0 ? 'text-danger' : warnings > 0 ? 'text-warn' : 'text-ok'}`}
              >
                {en.llm.findings(errors, warnings)}
              </span>
            </div>
            {round.error ? (
              <p className="m-0 mt-1 text-xs text-danger">
                {en.llm.roundFailed}: {round.error}
              </p>
            ) : null}
            {round.diagnostics.length > 0 ? (
              <div className="mt-1">
                <FindingList diagnostics={round.diagnostics} label={en.llm.round(round.round)} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      icon={copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      onClick={() => {
        void navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => {
              setCopied(false);
            }, 1500);
          })
          .catch(() => {
            // The clipboard may be blocked; the text can still be selected by hand.
          });
      }}
    >
      {copied ? en.llm.copied : en.llm.copy}
    </Button>
  );
}

/** The first request, as sent: system text and user text, each with a copy button. */
export function PromptBlock({ prompt }: { prompt: { system: string; user: string } }) {
  return (
    <div className="flex flex-col gap-3" data-testid="llm-prompt">
      {(
        [
          [en.llm.promptSystem, prompt.system],
          [en.llm.promptUser, prompt.user],
        ] as const
      ).map(([title, text]) => (
        <div key={title} className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">{title}</span>
            <CopyButton text={text} />
          </div>
          <pre className="m-0 max-h-56 overflow-auto rounded-md bg-surface-2 p-2 font-mono text-[11px] leading-4 break-words whitespace-pre-wrap">
            {text}
          </pre>
        </div>
      ))}
    </div>
  );
}

/** A collapsible block with a heading, in the style of the dialogs. */
export function Details({
  title,
  children,
  testId,
}: {
  title: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <details className="group rounded-md border border-border" data-testid={testId}>
      <summary className="cursor-pointer px-2.5 py-1.5 text-xs font-medium select-none hover:bg-surface-hover">
        {title}
      </summary>
      <div className="border-t border-border p-2.5">{children}</div>
    </details>
  );
}

/** A small rendering of the domain view of a net, drawn with the painter of the domain view. */
export function ViewPreview({ net, view }: { net: PetriNet; view: DomainView }) {
  const theme = useUiStore((s) => s.theme);
  const ref = useRef<HTMLCanvasElement>(null);
  const scene = useMemo(() => buildStaticScene(net, view), [net, view]);
  const aspect = view.meta.canvas.height / view.meta.canvas.width;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const palette = paletteFor(theme);
    const ratio = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth || 640;
    const scale = (cssWidth * ratio) / scene.width;
    canvas.width = Math.max(1, Math.round(scene.width * scale));
    canvas.height = Math.max(1, Math.round(scene.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    paintScene(ctx, scene, palette, { scale });
  }, [scene, theme]);

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={en.llm.preview}
      className="block w-full rounded-md border border-border"
      style={{ aspectRatio: `${view.meta.canvas.width} / ${view.meta.canvas.height}` }}
      data-testid="llm-preview"
      data-aspect={aspect.toFixed(3)}
    />
  );
}

/** Counts of the entries by origin, and what was filled in or dropped. */
export function OriginSummary({
  view,
  filled,
  dropped,
}: {
  view: DomainView;
  filled: readonly string[];
  dropped: readonly string[];
}) {
  const counts = originCounts(view);
  const filledArcs = filled.filter((p) => p.startsWith('arcs.')).length;
  const rows: Array<[string, string, string]> = [
    [en.llm.fromModel, String(counts.llm), 'summary-llm'],
    [
      en.llm.filledGeneric,
      filledArcs > 0 ? `${filled.length} (${filledArcs} arcs)` : String(filled.length),
      'summary-filled',
    ],
    [en.llm.droppedInvalid, String(dropped.length), 'summary-dropped'],
  ];
  return (
    <dl
      className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-xs"
      aria-label={en.llm.entriesBySource}
      data-testid="llm-summary"
    >
      {rows.map(([label, value, id]) => (
        <div key={id} className="contents">
          <dt className="text-muted">{label}</dt>
          <dd className="m-0 tabular-nums" data-testid={id}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Everything the record says about a generation, for the log dialog. */
export function RecordSummary({ record }: { record: DomainViewGeneration }) {
  const started = Date.parse(record.startedAt);
  const finished = Date.parse(record.finishedAt);
  const rows: Array<[string, string]> = [
    [en.llm.logModel, record.model],
    [en.llm.logServer, record.baseUrl],
    [en.llm.logStarted, record.startedAt.replace('T', ' ').slice(0, 19) + ' UTC'],
    [
      en.llm.logDuration,
      Number.isFinite(started) && Number.isFinite(finished) ? seconds(finished - started) : '–',
    ],
    [en.llm.logDescription, record.description || '–'],
    [en.llm.filledGeneric, en.llm.logFilled(record.filled.length)],
    [en.llm.droppedInvalid, en.llm.logDropped(record.dropped.length)],
  ];
  return (
    <dl
      className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-xs"
      data-testid="llm-record"
    >
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted">{label}</dt>
          <dd className="m-0 min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
