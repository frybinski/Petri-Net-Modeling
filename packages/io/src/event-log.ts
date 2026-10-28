import type { Id, PetriNet, SimulationSettings } from '@pnm/core';
import { DEFAULT_START_TIME, type SimEvent } from '@pnm/sim';

/** One row of an event log: something that happened to a case. */
export interface EventLogRow {
  caseId: string;
  activity: string;
  /** ISO 8601 timestamp in UTC with milliseconds. */
  timestamp: string;
  lifecycle: 'start' | 'complete';
}

/** The columns of the CSV file, in order. */
export const CSV_COLUMNS = ['case_id', 'activity', 'timestamp', 'lifecycle'] as const;

/**
 * The event log of a run: one row per `start` and `complete` event and case it concerns, in the
 * order of the event stream. Events that belong to no case (resource work without a case,
 * edits, warnings) are left out.
 */
export function eventLogRows(
  events: Iterable<SimEvent>,
  net: PetriNet,
  settings: SimulationSettings = net.simulation ?? {},
): EventLogRow[] {
  const origin = Date.parse(settings.startTime ?? DEFAULT_START_TIME);
  const base = Number.isNaN(origin) ? Date.parse(DEFAULT_START_TIME) : origin;
  const names = new Map<Id, string>(net.transitions.map((t) => [t.id, t.name]));
  const rows: EventLogRow[] = [];
  for (const event of events) {
    if (event.type !== 'start' && event.type !== 'complete') continue;
    const activity = names.get(event.transitionId) ?? event.transitionId;
    const timestamp = new Date(base + Math.round(event.t * 1000)).toISOString();
    for (const caseId of event.caseIds) {
      rows.push({ caseId, activity, timestamp, lifecycle: event.type });
    }
  }
  return rows;
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * The event log as CSV (RFC 4180, comma separated, header row, `\n` line ends) with the columns
 * `case_id, activity, timestamp, lifecycle`. The activity is the name of the transition.
 */
export function toEventLogCsv(
  events: Iterable<SimEvent>,
  net: PetriNet,
  settings?: SimulationSettings,
): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of eventLogRows(events, net, settings)) {
    lines.push([row.caseId, row.activity, row.timestamp, row.lifecycle].map(csvField).join(','));
  }
  return `${lines.join('\n')}\n`;
}

/** True for the characters that XML 1.0 allows in text. */
function allowedInXml(code: number): boolean {
  return (
    code === 0x9 ||
    code === 0xa ||
    code === 0xd ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

function xml(value: string): string {
  // Characters that XML 1.0 does not allow at all are dropped; the rest is escaped.
  return [...value]
    .filter((char) => allowedInXml(char.codePointAt(0) ?? 0))
    .join('')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The event log as XES 1.0: one trace per case with `concept:name`, `lifecycle:transition` and
 * `time:timestamp` on every event. Traces are in the order in which their cases first appear.
 */
export function toXes(
  events: Iterable<SimEvent>,
  net: PetriNet,
  settings?: SimulationSettings,
): string {
  const traces = new Map<string, EventLogRow[]>();
  for (const row of eventLogRows(events, net, settings)) {
    const trace = traces.get(row.caseId);
    if (trace) trace.push(row);
    else traces.set(row.caseId, [row]);
  }
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<log xes.version="1.0" xes.features="" xmlns="http://www.xes-standard.org/">',
    '  <extension name="Concept" prefix="concept" uri="http://www.xes-standard.org/concept.xesext"/>',
    '  <extension name="Lifecycle" prefix="lifecycle" uri="http://www.xes-standard.org/lifecycle.xesext"/>',
    '  <extension name="Time" prefix="time" uri="http://www.xes-standard.org/time.xesext"/>',
    '  <global scope="trace">',
    '    <string key="concept:name" value="__INVALID__"/>',
    '  </global>',
    '  <global scope="event">',
    '    <string key="concept:name" value="__INVALID__"/>',
    '    <string key="lifecycle:transition" value="complete"/>',
    '    <date key="time:timestamp" value="1970-01-01T00:00:00.000Z"/>',
    '  </global>',
    '  <classifier name="Activity" keys="concept:name"/>',
    '  <classifier name="Activity and lifecycle" keys="concept:name lifecycle:transition"/>',
    `  <string key="concept:name" value="${xml(net.name)}"/>`,
  ];
  for (const [caseId, rows] of traces) {
    out.push('  <trace>', `    <string key="concept:name" value="${xml(caseId)}"/>`);
    for (const row of rows) {
      out.push(
        '    <event>',
        `      <string key="concept:name" value="${xml(row.activity)}"/>`,
        `      <string key="lifecycle:transition" value="${row.lifecycle}"/>`,
        `      <date key="time:timestamp" value="${row.timestamp}"/>`,
        '    </event>',
      );
    }
    out.push('  </trace>');
  }
  out.push('</log>');
  return `${out.join('\n')}\n`;
}
