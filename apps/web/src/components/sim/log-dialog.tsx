import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import {
  EventLogParseError,
  readCsvHeaders,
  readLog,
  type LogColumns,
  type ReadLogResult,
} from '@pnm/io';
import { autoMapActivities, type ActivityMapping } from '@pnm/sim';
import { useMemo } from 'react';
import { en } from '../../i18n/en';
import type { ReplayLog } from '../../lib/replay-log';
import { formatSpan } from '../../lib/sim-format';
import { useEditorStore } from '../../store/editor-store';
import { useReplayStore, type ColumnChoice, type LogDraft } from '../../store/replay-store';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Dialog } from '../ui/dialog';
import { SelectField, TextField } from '../ui/fields';

type Read = { ok: true; log: ReadLogResult } | { ok: false; error: string };

/** Reads the log of the draft with the columns and the time origin that were chosen. */
function readDraft(
  draft: Pick<LogDraft, 'text' | 'format' | 'columns' | 'timeOrigin' | 'customOrigin'>,
  startTime: string | undefined,
): Read {
  const columns: LogColumns = {};
  for (const [key, value] of Object.entries(draft.columns)) {
    if (value !== '') columns[key as keyof ColumnChoice] = value;
  }
  const custom = draft.customOrigin.trim();
  const timeOrigin =
    draft.timeOrigin === 'net' && startTime !== undefined
      ? startTime
      : draft.timeOrigin === 'custom' && custom !== ''
        ? custom
        : 'first';
  try {
    const log = readLog(draft.format === 'xes' ? { xes: draft.text } : { csv: draft.text }, {
      timeOrigin,
      columns,
    });
    return { ok: true, log };
  } catch (error) {
    if (error instanceof EventLogParseError) return { ok: false, error: error.message };
    throw error;
  }
}

/** Seconds as a span for the preview; a log can be days long. */
function spanText(seconds: number): string {
  if (seconds < 86_400) return formatSpan(seconds);
  const days = Math.floor(seconds / 86_400);
  return `${days} d ${formatSpan(seconds - days * 86_400)}`;
}

function ColumnSelects({ draft, headers }: { draft: LogDraft; headers: string[] }) {
  const update = useReplayStore((s) => s.update);
  const t = en.replay;
  const fields: Array<{ key: keyof ColumnChoice; label: string; optional: boolean }> = [
    { key: 'case', label: t.columnCase, optional: false },
    { key: 'activity', label: t.columnActivity, optional: false },
    { key: 'time', label: t.columnTime, optional: false },
    { key: 'lifecycle', label: t.columnLifecycle, optional: true },
  ];
  return (
    <section className="flex flex-col gap-2" data-testid="log-columns">
      <h3 className="m-0 text-xs font-semibold tracking-wide text-muted uppercase">
        {t.columnsTitle}
      </h3>
      <p className="m-0 text-[11px] text-muted">{t.columnsHint}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {fields.map(({ key, label }) => (
          <SelectField
            key={key}
            label={label}
            value={draft.columns[key]}
            options={[
              { value: '', label: t.guess },
              ...headers.map((header) => ({ value: header, label: header })),
            ]}
            onChange={(value) => {
              update({ columns: { ...draft.columns, [key]: value } });
            }}
            data-testid={`log-column-${key}`}
          />
        ))}
      </div>
    </section>
  );
}

/** Dialog that maps the activities of an event log to the transitions of the net and starts the replay. */
export function LogDialog() {
  const open = useReplayStore((s) => s.open);
  const draft = useReplayStore((s) => s.draft);
  const update = useReplayStore((s) => s.update);
  const close = useReplayStore((s) => s.close);
  const net = useEditorStore((s) => s.net);
  const t = en.replay;
  const startTime = net.simulation?.startTime;

  // The file is read again only when something about reading it changes, not for every choice of
  // a transition.
  const text = draft?.text;
  const format = draft?.format;
  const columns = draft?.columns;
  const timeOrigin = draft?.timeOrigin;
  const customOrigin = draft?.customOrigin;
  const read = useMemo<Read | null>(
    () =>
      text === undefined ||
      format === undefined ||
      columns === undefined ||
      timeOrigin === undefined ||
      customOrigin === undefined
        ? null
        : readDraft({ text, format, columns, timeOrigin, customOrigin }, startTime),
    [text, format, columns, timeOrigin, customOrigin, startTime],
  );
  const headers = useMemo(
    () => (text !== undefined && format === 'csv' ? readCsvHeaders(text) : []),
    [text, format],
  );
  const log = read?.ok === true ? read.log : null;
  const auto = useMemo(
    () => (log === null ? null : autoMapActivities(net, log.activities)),
    [log, net],
  );
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    for (const event of log?.events ?? []) {
      result.set(event.activity, (result.get(event.activity) ?? 0) + 1);
    }
    return result;
  }, [log]);

  if (draft === null) return null;

  const effective: ActivityMapping = { ...auto?.mapping, ...draft.mapping };
  const unmapped = (log?.activities ?? []).filter((a) => (effective[a] ?? null) === null);

  const start = (): void => {
    if (log === null) return;
    const mapping: ActivityMapping = {};
    for (const activity of log.activities) mapping[activity] = effective[activity] ?? null;
    const replayLog: ReplayLog = {
      fileName: draft.fileName,
      events: log.events,
      activities: log.activities,
      cases: log.cases,
      span: log.span,
      origin: log.origin,
      mapping,
      completeOnly: draft.completeOnly,
      strict: draft.strict,
    };
    useReplayStore.getState().setLog(replayLog);
    close();
    void useEditorStore.getState().startLogReplay(replayLog);
  };

  return (
    <Dialog
      open={open}
      title={t.dialogTitle}
      onClose={close}
      width="max-w-2xl"
      footer={
        <>
          <Button onClick={close} data-testid="log-cancel">
            {t.cancel}
          </Button>
          <Button variant="primary" onClick={start} disabled={log === null} data-testid="log-start">
            {t.start}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4" data-testid="log-dialog">
        <p className="m-0 text-sm">
          <span className="text-muted">{t.file}: </span>
          <span className="font-medium break-all" data-testid="log-file-name">
            {draft.fileName}
          </span>
        </p>

        {draft.format === 'csv' ? <ColumnSelects draft={draft} headers={headers} /> : null}

        <section className="flex flex-col gap-1.5" aria-live="polite" data-testid="log-preview">
          <h3 className="m-0 text-xs font-semibold tracking-wide text-muted uppercase">
            {t.previewTitle}
          </h3>
          {log !== null ? (
            <>
              <p className="m-0 flex items-start gap-2 text-sm">
                <CheckCircle2 size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-ok" />
                <span data-testid="log-preview-summary">
                  {t.previewEvents(log.events.length, log.cases, spanText(log.span))}
                </span>
              </p>
              <p className="m-0 text-[11px] text-muted">{t.timeZero(log.origin)}</p>
              {log.warnings.length > 0 ? (
                <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="log-warnings">
                  {log.warnings.map((warning) => (
                    <li key={warning} className="flex items-start gap-2 text-xs">
                      <AlertTriangle
                        size={13}
                        aria-hidden="true"
                        className="mt-0.5 shrink-0 text-warn"
                      />
                      <span className="min-w-0 break-words">{warning}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p
              className="m-0 flex items-start gap-2 text-sm text-danger"
              role="alert"
              data-testid="log-error"
            >
              <AlertTriangle size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
              <span>
                {t.unreadable} {read?.ok === false ? read.error : ''}
              </span>
            </p>
          )}
        </section>

        {log !== null ? (
          <section className="flex flex-col gap-2" data-testid="log-mapping-section">
            <h3 className="m-0 text-xs font-semibold tracking-wide text-muted uppercase">
              {t.mappingTitle}
            </h3>
            <p className="m-0 text-[11px] text-muted">{t.mappingHint}</p>
            <table className="w-full table-fixed border-collapse text-xs" data-testid="log-mapping">
              <thead>
                <tr className="text-left text-[11px] tracking-wide text-muted uppercase">
                  <th className="px-1 py-1 font-semibold">{t.activity}</th>
                  <th className="w-16 px-1 py-1 text-right font-semibold">{t.events}</th>
                  <th className="w-56 px-1 py-1 font-semibold">{t.transition}</th>
                </tr>
              </thead>
              <tbody>
                {log.activities.map((activity) => {
                  const chosen = effective[activity] ?? null;
                  return (
                    <tr
                      key={activity}
                      className="border-t border-border align-middle"
                      data-testid="log-mapping-row"
                      data-mapped={chosen !== null}
                    >
                      <td className="px-1 py-1">
                        <div className="truncate" title={activity}>
                          {activity}
                        </div>
                        {chosen === null ? (
                          <div className="flex items-center gap-1 text-[11px] text-warn">
                            <AlertTriangle size={11} aria-hidden="true" />
                            {t.notMapped}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-1 py-1 text-right tabular-nums">
                        {(counts.get(activity) ?? 0).toLocaleString('en')}
                      </td>
                      <td className="px-1 py-1">
                        <SelectField
                          hideLabel
                          label={`${t.transition}: ${activity}`}
                          value={chosen ?? ''}
                          options={[
                            { value: '', label: t.skipOption },
                            ...net.transitions.map((transition) => ({
                              value: transition.id,
                              label: transition.name,
                            })),
                          ]}
                          onChange={(value) => {
                            update({
                              mapping: {
                                ...draft.mapping,
                                [activity]: value === '' ? null : value,
                              },
                            });
                          }}
                          data-testid="log-map-select"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p
              className={`m-0 text-xs ${unmapped.length > 0 ? 'text-warn' : 'text-muted'}`}
              data-testid="log-unmapped"
            >
              {t.unmappedNote(unmapped.length)}
            </p>
          </section>
        ) : null}

        <section className="flex flex-col gap-2" data-testid="log-options">
          <h3 className="m-0 text-xs font-semibold tracking-wide text-muted uppercase">
            {t.optionsTitle}
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SelectField
              label={t.completeOnly}
              hint={t.completeHint}
              value={draft.completeOnly}
              options={[
                { value: 'zero', label: t.completeZero },
                { value: 'span', label: t.completeSpan },
              ]}
              onChange={(value) => {
                update({ completeOnly: value === 'span' ? 'span' : 'zero' });
              }}
              data-testid="log-complete-only"
            />
            <div className="flex flex-col gap-2">
              <SelectField
                label={t.timeOrigin}
                hint={t.originHint}
                value={draft.timeOrigin}
                options={[
                  { value: 'first', label: t.originFirst },
                  ...(startTime !== undefined ? [{ value: 'net', label: t.originNet }] : []),
                  { value: 'custom', label: t.originCustom },
                ]}
                onChange={(value) => {
                  update({ timeOrigin: value === 'net' || value === 'custom' ? value : 'first' });
                }}
                data-testid="log-time-origin"
              />
              {draft.timeOrigin === 'custom' ? (
                <TextField
                  label={t.originCustomLabel}
                  value={draft.customOrigin}
                  onCommit={(value) => {
                    update({ customOrigin: value });
                  }}
                  data-testid="log-custom-origin"
                />
              ) : null}
            </div>
          </div>
          {net.profile === 'json-net' ? (
            <Checkbox
              label={t.checkGuards}
              hint={t.checkGuardsHint}
              checked={draft.strict}
              onChange={(checked) => {
                update({ strict: checked });
              }}
              data-testid="log-strict"
            />
          ) : null}
        </section>
      </div>
    </Dialog>
  );
}
