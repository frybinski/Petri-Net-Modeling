import { Activity, FileText, Radio } from 'lucide-react';
import { useState } from 'react';
import { en } from '../../i18n/en';
import { chooseLogFile } from '../../lib/files';
import { parseLiveLines } from '../../lib/replay-log';
import { formatSpan } from '../../lib/sim-format';
import { useEditorStore, type SimSource } from '../../store/editor-store';
import { notify } from '../../store/ui-store';
import { useReplayStore } from '../../store/replay-store';
import { Button } from '../ui/button';
import { Tooltip } from '../ui/tooltip';

const OPTIONS: Array<{
  source: SimSource;
  label: string;
  tip: string;
  icon: typeof Activity;
}> = [
  { source: 'engine', label: en.replay.engine, tip: en.replay.engineTip, icon: Activity },
  { source: 'log', label: en.replay.log, tip: en.replay.logTip, icon: FileText },
  { source: 'live', label: en.replay.live, tip: en.replay.liveTip, icon: Radio },
];

/** Segmented control at the top of the simulation panel: the engine, an event log or a live feed. */
export function SourceSwitch() {
  const source = useEditorStore((s) => s.simSource);
  const setSource = useEditorStore((s) => s.setSimSource);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted" id="sim-source-label">
        {en.replay.source}
      </span>
      <div
        role="group"
        aria-labelledby="sim-source-label"
        className="flex rounded-md border border-border-strong p-0.5"
        data-testid="sim-source"
      >
        {OPTIONS.map(({ source: option, label, tip, icon: Icon }) => (
          <Tooltip key={option} content={tip}>
            <button
              type="button"
              aria-pressed={source === option}
              onClick={() => {
                setSource(option);
              }}
              data-testid={`sim-source-${option}`}
              className="inline-flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded px-2 text-xs font-medium text-muted transition-colors hover:text-fg aria-pressed:bg-accent aria-pressed:text-accent-contrast"
            >
              <Icon size={13} aria-hidden="true" />
              {label}
            </button>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

/** The log that is replayed: its name and size, and the way to change the mapping or open another. */
function LogSource() {
  const name = useEditorStore((s) => s.simSourceName);
  const log = useReplayStore((s) => s.log);
  const reopen = useReplayStore((s) => s.reopen);
  const skipped =
    log === null ? 0 : log.activities.filter((a) => (log.mapping[a] ?? null) === null).length;
  return (
    <div className="flex flex-col gap-2" data-testid="log-source">
      <p className="m-0 flex flex-col text-xs">
        <span className="truncate font-medium" title={name ?? ''} data-testid="log-source-name">
          {name ?? en.replay.noLog}
        </span>
        {log !== null ? (
          <span className="text-muted" data-testid="log-source-summary">
            {en.replay.logSummary(log.events.length, log.cases, formatSpan(log.span))}
          </span>
        ) : null}
        {skipped > 0 ? (
          <span className="text-warn" data-testid="log-source-skipped">
            {en.replay.skipped(skipped)}
          </span>
        ) : null}
      </p>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" onClick={reopen} disabled={log === null} data-testid="log-change-mapping">
          {en.replay.changeMapping}
        </Button>
        <Button size="sm" onClick={chooseLogFile} data-testid="log-open-another">
          {en.replay.openAnother}
        </Button>
      </div>
      <p className="m-0 text-[11px] text-muted">{en.replay.dropHint}</p>
    </div>
  );
}

/** The field that feeds a live replay with pasted events, and a pointer to the console. */
function LiveSource() {
  const closed = useEditorStore((s) => s.simFeedClosed);
  const computing = useEditorStore((s) => s.computing);
  const push = useEditorStore((s) => s.pushLiveEvents);
  const close = useEditorStore((s) => s.closeLiveFeed);
  const [text, setText] = useState('');
  const add = (): void => {
    const { events, skipped } = parseLiveLines(text);
    if (events.length === 0) {
      notify('info', en.replay.nothingToAdd);
      return;
    }
    push(events).then(
      () => {
        setText('');
        notify(
          'success',
          skipped > 0
            ? `${en.replay.added(events.length)}, ${en.replay.skippedLines(skipped)}`
            : en.replay.added(events.length),
        );
      },
      () => undefined,
    );
  };
  return (
    <div className="flex flex-col gap-2" data-testid="live-source">
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        {en.replay.pasteLabel}
        <textarea
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
          rows={4}
          disabled={closed}
          placeholder={en.replay.pastePlaceholder}
          spellCheck={false}
          className="w-full resize-y rounded-md border border-border-strong bg-surface p-2 font-mono text-[11px] font-normal text-fg placeholder:text-muted disabled:opacity-50"
          data-testid="live-paste"
        />
      </label>
      <p className="m-0 text-[11px] text-muted">{en.replay.pasteHint}</p>
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant="primary"
          onClick={add}
          disabled={closed || computing || text.trim() === ''}
          data-testid="live-add"
        >
          {en.replay.addEvents}
        </Button>
        <Button size="sm" onClick={() => void close()} disabled={closed} data-testid="live-close">
          {en.replay.closeFeed}
        </Button>
      </div>
      {closed ? (
        <p className="m-0 text-[11px] text-muted" data-testid="live-closed">
          {en.replay.feedClosedNote}
        </p>
      ) : (
        <p className="m-0 text-[11px] text-muted">
          {en.replay.consoleHint}{' '}
          <code className="font-mono break-all">{en.replay.consoleExample}</code>
        </p>
      )}
    </div>
  );
}

/** What belongs to the chosen source, under the switch. */
export function SourceDetails() {
  const source = useEditorStore((s) => s.simSource);
  if (source === 'log') return <LogSource />;
  if (source === 'live') return <LiveSource />;
  return null;
}
