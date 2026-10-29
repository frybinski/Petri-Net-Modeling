import { tokenLabel, type Id, type PetriNet } from '@pnm/core';
import type { SimEvent, SimEventType } from '@pnm/sim';
import { Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import { en } from '../../i18n/en';
import { exportEventLog } from '../../lib/files';
import { eventTransition, recentEvents } from '../../lib/trace';
import { formatClock } from '../../lib/sim-format';
import { useEditorStore } from '../../store/editor-store';
import { eventLog } from '../../store/sim-log';
import { Button } from '../ui/button';
import { Tooltip } from '../ui/tooltip';

const TYPES: SimEventType[] = [
  'spawn',
  'start',
  'complete',
  'marking-edited',
  'breakpoint',
  'warning',
  'idle',
];

/** The element an event concerns (a transition, or a place for edits and breakpoints). */
function eventElement(event: SimEvent): Id | undefined {
  if (event.type === 'marking-edited') return event.placeId;
  if (event.type === 'breakpoint') return event.elementId;
  return eventTransition(event);
}

function caseOf(event: SimEvent): string {
  switch (event.type) {
    case 'spawn':
      return event.caseId;
    case 'start':
    case 'complete':
      return event.caseIds.join(', ');
    default:
      return '';
  }
}

function details(event: SimEvent): string {
  switch (event.type) {
    case 'start': {
      const names = Object.entries(event.binding);
      if (names.length > 0) {
        return names.map(([name, value]) => `$${name} = ${tokenLabel(value, 14)}`).join(', ');
      }
      return event.slot > 0 ? `#${event.slot + 1}` : '';
    }
    case 'complete':
      return event.slot > 0 ? `#${event.slot + 1}` : '';
    case 'marking-edited':
      return en.trace.editedBy(event.delta);
    case 'warning':
      return event.message;
    default:
      return '';
  }
}

const BADGE: Record<SimEventType, string> = {
  spawn: 'bg-accent-soft text-accent',
  start: 'bg-surface-2 text-fg',
  complete: 'bg-ok-soft text-ok',
  'marking-edited': 'bg-warn-soft text-warn',
  idle: 'bg-surface-2 text-muted',
  breakpoint: 'bg-danger-soft text-danger',
  warning: 'bg-warn-soft text-warn',
};

function nameOf(net: PetriNet, id: Id | undefined): string {
  if (id === undefined) return '';
  return (
    net.transitions.find((t) => t.id === id)?.name ??
    net.places.find((p) => p.id === id)?.name ??
    id
  );
}

/** The events of the run, newest first, with filters and the export of the event log. */
export function TraceTab() {
  const net = useEditorStore((s) => s.net);
  const version = useEditorStore((s) => s.simLogVersion);
  const select = useEditorStore((s) => s.select);
  const [type, setType] = useState<SimEventType | ''>('');
  const [transitionId, setTransitionId] = useState('');

  // The log changes without the arrays around it changing; the version tells when to look again.
  /* eslint-disable react-hooks/exhaustive-deps */
  const rows = useMemo(
    () => recentEvents(eventLog.all(), type, transitionId),
    [version, type, transitionId],
  );
  /* eslint-enable react-hooks/exhaustive-deps */
  const total = eventLog.length;

  return (
    <div className="flex flex-col" data-testid="trace-tab">
      <section className="flex flex-col gap-2 border-b border-border px-4 py-3">
        <div className="grid grid-cols-2 gap-1.5">
          <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-muted">
            {en.trace.filterType}
            <select
              value={type}
              onChange={(event) => {
                setType(event.target.value as SimEventType | '');
              }}
              className="h-7 min-w-0 rounded-md border border-border-strong bg-surface px-1.5 text-xs font-normal text-fg"
              data-testid="trace-filter-type"
            >
              <option value="">{en.trace.allTypes}</option>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {en.trace.types[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-muted">
            {en.trace.filterTransition}
            <select
              value={transitionId}
              onChange={(event) => {
                setTransitionId(event.target.value);
              }}
              className="h-7 min-w-0 rounded-md border border-border-strong bg-surface px-1.5 text-xs font-normal text-fg"
              data-testid="trace-filter-transition"
            >
              <option value="">{en.trace.allTransitions}</option>
              {net.transitions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex gap-1.5">
          <Tooltip content={en.trace.exportCsvTip}>
            <Button
              size="sm"
              icon={<Download size={13} aria-hidden="true" />}
              onClick={() => {
                void exportEventLog('csv');
              }}
              data-testid="export-csv"
            >
              {en.trace.exportCsv}
            </Button>
          </Tooltip>
          <Tooltip content={en.trace.exportXesTip}>
            <Button
              size="sm"
              icon={<Download size={13} aria-hidden="true" />}
              onClick={() => {
                void exportEventLog('xes');
              }}
              data-testid="export-xes"
            >
              {en.trace.exportXes}
            </Button>
          </Tooltip>
        </div>
      </section>

      {total === 0 ? (
        <p className="m-0 px-4 py-3 text-sm text-muted" data-testid="trace-empty">
          {en.trace.empty}
        </p>
      ) : rows.length === 0 ? (
        <p className="m-0 px-4 py-3 text-sm text-muted">{en.trace.noMatch}</p>
      ) : (
        <div className="px-2 py-2">
          <table
            className="w-full table-fixed border-collapse text-left text-xs"
            data-testid="trace-table"
          >
            <thead>
              <tr className="text-[11px] tracking-wide text-muted uppercase">
                <th className="w-[4.1rem] px-1.5 py-1 font-semibold">{en.trace.time}</th>
                <th className="w-[4.3rem] px-1 py-1 font-semibold">{en.trace.event}</th>
                <th className="px-1 py-1 font-semibold">{en.trace.transition}</th>
                <th className="w-[3.6rem] px-1 py-1 font-semibold">{en.trace.case}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((event) => {
                const element = eventElement(event);
                const extra = details(event);
                return (
                  <tr
                    key={event.id}
                    className={`border-t border-border align-top odd:bg-surface-2/40 ${
                      element ? 'cursor-pointer hover:bg-surface-hover' : ''
                    }`}
                    onClick={() => {
                      if (element) select([element]);
                    }}
                    data-testid="trace-row"
                    data-type={event.type}
                  >
                    <td className="px-1.5 py-1 font-mono text-[11px] tabular-nums">
                      {formatClock(event.t)}
                    </td>
                    <td className="px-1 py-1">
                      <span
                        className={`inline-block rounded-full px-1.5 py-px text-[10px] font-medium ${BADGE[event.type]}`}
                      >
                        {en.trace.types[event.type]}
                      </span>
                    </td>
                    <td className="px-1 py-1">
                      <div className="truncate" title={nameOf(net, element)}>
                        {nameOf(net, element)}
                      </div>
                      {extra ? (
                        <div className="truncate font-mono text-[10px] text-muted" title={extra}>
                          {extra}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-1 py-1 font-mono text-[11px]">
                      <div className="truncate" title={caseOf(event)}>
                        {caseOf(event)}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="m-0 px-1.5 pt-2 text-[11px] text-muted">
            {en.trace.showing(rows.length, total)}
            {eventLog.dropped > 0 ? ` ${en.trace.dropped(eventLog.dropped)}` : ''}
          </p>
        </div>
      )}
    </div>
  );
}
