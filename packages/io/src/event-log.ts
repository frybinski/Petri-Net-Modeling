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

/** Raised by `parseEventLogCsv` for text that is not an event log in the format of `toEventLogCsv`. */
export class EventLogParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventLogParseError';
  }
}

/**
 * Splits RFC 4180 text into records of fields; handles quotes, doubled quotes and CR LF. The
 * fields are separated by `delimiter` (default a comma).
 */
export function csvRecords(text: string, delimiter = ','): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let started = false;
  const endField = (): void => {
    record.push(field);
    field = '';
  };
  const endRecord = (): void => {
    endField();
    // A completely empty line is no record.
    if (!(record.length === 1 && record[0] === '' && !started)) records.push(record);
    record = [];
    started = false;
  };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === '') {
      quoted = true;
      started = true;
    } else if (char === delimiter) {
      started = true;
      endField();
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      endRecord();
    } else {
      started = true;
      field += char;
    }
  }
  if (quoted) throw new EventLogParseError('A quoted field is not closed.');
  if (started || field !== '' || record.length > 0) endRecord();
  return records;
}

/**
 * Reads the CSV of `toEventLogCsv` (and files with the same columns in any order) back into rows.
 * The columns `case_id` and `activity` are required; `timestamp` and `lifecycle` are optional
 * (`lifecycle` defaults to `complete`, a missing timestamp reads as the empty string). Rows keep
 * the order of the file.
 */
export function parseEventLogCsv(text: string): EventLogRow[] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records = csvRecords(source);
  const header = records[0];
  if (header === undefined) throw new EventLogParseError('The event log is empty.');
  const column = (name: string): number => header.findIndex((h) => h.trim() === name);
  const caseColumn = column('case_id');
  const activityColumn = column('activity');
  if (caseColumn < 0 || activityColumn < 0) {
    throw new EventLogParseError('The header needs the columns "case_id" and "activity".');
  }
  const timeColumn = column('timestamp');
  const lifecycleColumn = column('lifecycle');
  const rows: EventLogRow[] = [];
  for (const [index, record] of records.slice(1).entries()) {
    const lifecycle = (lifecycleColumn < 0 ? 'complete' : (record[lifecycleColumn] ?? '')).trim();
    if (lifecycle !== 'start' && lifecycle !== 'complete') {
      throw new EventLogParseError(
        `Line ${index + 2}: the lifecycle must be "start" or "complete" (got "${lifecycle}").`,
      );
    }
    const caseId = record[caseColumn] ?? '';
    const activity = record[activityColumn] ?? '';
    if (caseId === '' || activity === '') {
      throw new EventLogParseError(`Line ${index + 2}: case_id and activity must not be empty.`);
    }
    rows.push({
      caseId,
      activity,
      timestamp: timeColumn < 0 ? '' : (record[timeColumn] ?? ''),
      lifecycle,
    });
  }
  return rows;
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
