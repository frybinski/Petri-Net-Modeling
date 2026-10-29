import type { LogEvent } from '@pnm/sim';
import { EventLogParseError, csvRecords } from './event-log';
import { childElements, parseXml, XmlParseError, type XmlElement } from './xml';

/** Names of the columns of a CSV log, when they are not the usual ones. */
export interface LogColumns {
  case?: string;
  activity?: string;
  time?: string;
  lifecycle?: string;
}

export interface ReadLogOptions {
  /**
   * The moment that time 0 is: `first` (default) the earliest event, or an ISO 8601 time or Unix
   * seconds. Events before it get negative times.
   */
  timeOrigin?: 'first' | string;
  /** CSV: the columns, by their header, where the usual names do not apply. */
  columns?: LogColumns;
  /** CSV: the separator. Default: the one that the header line uses (`,` `;` or tab). */
  delimiter?: ',' | ';' | '\t';
}

export interface ReadLogResult {
  /** In the order of the replay: by time, events at one time in the order of the file. */
  events: LogEvent[];
  /** The activities in the order of their first event. */
  activities: string[];
  cases: number;
  /** Seconds from the first to the last event. */
  span: number;
  /** Remarks about what was skipped or assumed. */
  warnings: string[];
  format: 'csv' | 'xes';
  /** CSV: the headers of the file and the columns that were used. */
  headers?: string[];
  columns?: Required<LogColumns>;
}

/** The columns that are tried, in this order, when the person names none. */
const COLUMN_NAMES: Record<keyof LogColumns, readonly string[]> = {
  case: ['case_id', 'caseid', 'case id', 'case', 'case:concept:name', 'trace', 'trace_id'],
  activity: ['activity', 'concept:name', 'event', 'event_name', 'activity_name', 'task', 'name'],
  time: [
    'timestamp',
    'time:timestamp',
    'time',
    'datetime',
    'date',
    'complete_timestamp',
    'end_time',
  ],
  lifecycle: ['lifecycle', 'lifecycle:transition', 'lifecycle_transition', 'transition'],
};

/** Time in milliseconds since 1970 of an ISO 8601 text or of Unix seconds; `null` if it is neither. */
export function parseLogTime(value: string): { ms: number; unixMs?: boolean } | null {
  const text = value.trim();
  if (text === '') return null;
  if (/^[+-]?\d+(\.\d+)?$/.test(text)) {
    const n = Number(text);
    // Seconds since 1970 stay below 1e11 until the year 5138; larger numbers are milliseconds.
    return Math.abs(n) >= 1e11 ? { ms: n, unixMs: true } : { ms: n * 1000 };
  }
  // A time without a zone is read as UTC, so that a file reads the same everywhere.
  let iso = text.replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, '$1T$2');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(iso)) iso += 'Z';
  if (!/^\d{4}-\d{2}-\d{2}(T|$)/.test(iso)) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : { ms };
}

/** `start` or `complete` for the usual spellings of the lifecycle; `null` for others, such as `schedule`. */
function lifecycleOf(value: string): 'start' | 'complete' | null {
  switch (value.trim().toLowerCase()) {
    case 'start':
    case 'started':
    case 'begin':
      return 'start';
    case '':
    case 'complete':
    case 'completed':
    case 'end':
    case 'finish':
    case 'finished':
      return 'complete';
    default:
      return null;
  }
}

interface RawEvent {
  caseId: string;
  activity: string;
  /** Milliseconds since 1970. */
  ms: number;
  lifecycle: 'start' | 'complete';
  attributes: Record<string, string> | undefined;
}

class Collector {
  warnings: string[] = [];
  private counts = new Map<string, number>();
  /** Counts a kind of remark; it is worded when the log has been read. */
  count(kind: string): void {
    this.counts.set(kind, (this.counts.get(kind) ?? 0) + 1);
  }
  words(kind: string, text: (n: number) => string): void {
    const n = this.counts.get(kind);
    if (n) this.warnings.push(text(n));
  }
  /** Words the skipped rows by lifecycle (`schedule`, `assign`, ...), which were counted as `lifecycle:<value>`. */
  skippedLifecycles(noun: string): void {
    for (const [kind, n] of this.counts) {
      if (kind.startsWith('lifecycle:')) {
        this.warnings.push(
          `${n} ${noun} with the lifecycle "${kind.slice('lifecycle:'.length)}" were skipped.`,
        );
      }
    }
  }
}

function build(
  raw: RawEvent[],
  options: ReadLogOptions,
  c: Collector,
  format: 'csv' | 'xes',
): ReadLogResult {
  if (raw.length === 0) throw new EventLogParseError('The event log has no events.');
  const ordered = raw
    .map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.ms - b.event.ms || a.index - b.index)
    .map((entry) => entry.event);
  let origin = ordered[0]!.ms;
  if (options.timeOrigin !== undefined && options.timeOrigin !== 'first') {
    const parsed = parseLogTime(options.timeOrigin);
    if (parsed === null) {
      throw new EventLogParseError(
        `The time origin "${options.timeOrigin}" is neither an ISO 8601 time nor Unix seconds.`,
      );
    }
    origin = parsed.ms;
  }
  const activities: string[] = [];
  const known = new Set<string>();
  const cases = new Set<string>();
  const events: LogEvent[] = ordered.map((event) => {
    if (!known.has(event.activity)) {
      known.add(event.activity);
      activities.push(event.activity);
    }
    cases.add(event.caseId);
    return {
      caseId: event.caseId,
      activity: event.activity,
      time: (event.ms - origin) / 1000,
      lifecycle: event.lifecycle,
      ...(event.attributes !== undefined && { attributes: event.attributes }),
    };
  });
  return {
    events,
    activities,
    cases: cases.size,
    span: events[events.length - 1]!.time - events[0]!.time,
    warnings: c.warnings,
    format,
  };
}

// --- CSV --------------------------------------------------------------------------------------

function detectDelimiter(text: string): ',' | ';' | '\t' {
  const line = text.slice(0, Math.max(0, text.search(/\r|\n/)) || text.length);
  const count = (char: string): number => line.split(char).length - 1;
  const [comma, semicolon, tab] = [count(','), count(';'), count('\t')];
  if (tab > comma && tab > semicolon) return '\t';
  return semicolon > comma ? ';' : ',';
}

function findColumn(headers: readonly string[], wanted: string): number {
  const exact = headers.findIndex((h) => h.trim() === wanted);
  if (exact >= 0) return exact;
  return headers.findIndex((h) => h.trim().toLowerCase() === wanted.trim().toLowerCase());
}

function guessColumn(headers: readonly string[], kind: keyof LogColumns): number {
  const lower = headers.map((h) => h.trim().toLowerCase());
  for (const name of COLUMN_NAMES[kind]) {
    const index = lower.indexOf(name);
    if (index >= 0) return index;
  }
  return -1;
}

function readCsv(text: string, options: ReadLogOptions): ReadLogResult {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delimiter = options.delimiter ?? detectDelimiter(source);
  const records = csvRecords(source, delimiter);
  const headers = records[0];
  if (headers === undefined) throw new EventLogParseError('The event log is empty.');
  const c = new Collector();

  const indexes: Record<keyof LogColumns, number> = {
    case: -1,
    activity: -1,
    time: -1,
    lifecycle: -1,
  };
  for (const kind of ['case', 'activity', 'time', 'lifecycle'] as const) {
    const named = options.columns?.[kind];
    if (named !== undefined && named !== '') {
      indexes[kind] = findColumn(headers, named);
      if (indexes[kind] < 0) {
        throw new EventLogParseError(
          `The column "${named}" is not in the file (columns: ${headers.map((h) => `"${h.trim()}"`).join(', ')}).`,
        );
      }
    } else {
      indexes[kind] = guessColumn(headers, kind);
    }
  }
  if (indexes.case < 0 || indexes.activity < 0) {
    throw new EventLogParseError(
      `The header needs a case column and an activity column (columns: ${headers
        .map((h) => `"${h.trim()}"`)
        .join(', ')}). Say which ones they are.`,
    );
  }
  const used = new Set(Object.values(indexes));
  const raw: RawEvent[] = [];
  let unixMs = false;
  let row = 0;
  for (const [line, record] of records.slice(1).entries()) {
    row += 1;
    const caseId = (record[indexes.case] ?? '').trim();
    const activity = (record[indexes.activity] ?? '').trim();
    if (caseId === '' || activity === '') {
      c.count('blank');
      continue;
    }
    const lifecycle =
      indexes.lifecycle < 0 ? 'complete' : lifecycleOf(record[indexes.lifecycle] ?? '');
    if (lifecycle === null) {
      c.count(`lifecycle:${(record[indexes.lifecycle] ?? '').trim()}`);
      continue;
    }
    let ms: number;
    if (indexes.time < 0) {
      ms = row * 1000;
    } else {
      const given = record[indexes.time] ?? '';
      const parsed = parseLogTime(given);
      if (parsed === null) {
        if (given.trim() === '') {
          c.count('notime');
          continue;
        }
        throw new EventLogParseError(
          `Line ${line + 2}: "${given.trim()}" is not an ISO 8601 date and time or Unix seconds.`,
        );
      }
      if (parsed.unixMs) unixMs = true;
      ms = parsed.ms;
    }
    let attributes: Record<string, string> | undefined;
    headers.forEach((header, index) => {
      const value = record[index];
      if (used.has(index) || value === undefined || value === '' || header.trim() === '') return;
      (attributes ??= {})[header.trim()] = value;
    });
    raw.push({ caseId, activity, ms, lifecycle, attributes });
  }
  if (indexes.time < 0) {
    c.warnings.push(
      'The file has no time column: the events are one second apart, in the order of the file.',
    );
  }
  if (indexes.lifecycle < 0) {
    c.warnings.push(
      'The file has no lifecycle column: every event counts as the end of an activity.',
    );
  }
  if (unixMs)
    c.warnings.push('Numbers of 1e11 and more in the time column were read as milliseconds.');
  c.words('blank', (n) => `${n} rows without a case or an activity were skipped.`);
  c.words('notime', (n) => `${n} rows without a time were skipped.`);
  c.skippedLifecycles('rows');
  const result = build(raw, options, c, 'csv');
  result.headers = headers.map((h) => h.trim());
  result.columns = {
    case: headers[indexes.case]!.trim(),
    activity: headers[indexes.activity]!.trim(),
    time: indexes.time < 0 ? '' : headers[indexes.time]!.trim(),
    lifecycle: indexes.lifecycle < 0 ? '' : headers[indexes.lifecycle]!.trim(),
  };
  return result;
}

// --- XES --------------------------------------------------------------------------------------

/** The `key` and `value` of attribute elements (`string`, `date`, `int`, `float`, `boolean`, `id`). */
function attributesOf(element: XmlElement): Map<string, string> {
  const result = new Map<string, string>();
  for (const child of childElements(element)) {
    const key = child.attributes['key'];
    const value = child.attributes['value'];
    if (key !== undefined && value !== undefined) result.set(key, value);
  }
  return result;
}

function readXes(text: string, options: ReadLogOptions): ReadLogResult {
  let root: XmlElement;
  try {
    root = parseXml(text);
  } catch (error) {
    if (error instanceof XmlParseError)
      throw new EventLogParseError(`The XES file is not well-formed XML: ${error.message}`);
    throw error;
  }
  if (root.name !== 'log') throw new EventLogParseError('The XES file has no <log> element.');
  const c = new Collector();
  const raw: RawEvent[] = [];
  let anonymous = 0;
  let sequence = 0;
  let noTimes = 0;
  const traces = childElements(root, 'trace');
  for (const trace of traces) {
    const traceAttributes = attributesOf(trace);
    let caseId = traceAttributes.get('concept:name');
    if (caseId === undefined || caseId === '') {
      anonymous += 1;
      caseId = `trace-${anonymous}`;
    }
    for (const event of childElements(trace, 'event')) {
      const own = attributesOf(event);
      const activity = own.get('concept:name');
      if (activity === undefined || activity === '') {
        c.count('noname');
        continue;
      }
      const lifecycle = lifecycleOf(own.get('lifecycle:transition') ?? 'complete');
      if (lifecycle === null) {
        c.count(`lifecycle:${(own.get('lifecycle:transition') ?? '').trim()}`);
        continue;
      }
      sequence += 1;
      const given = own.get('time:timestamp');
      let ms = sequence * 1000;
      if (given === undefined) noTimes += 1;
      else {
        const parsed = parseLogTime(given);
        if (parsed === null) {
          throw new EventLogParseError(
            `Line ${event.line}: "${given}" is not an ISO 8601 date and time.`,
          );
        }
        ms = parsed.ms;
      }
      let attributes: Record<string, string> | undefined;
      for (const [key, value] of [...traceAttributes, ...own]) {
        if (key === 'concept:name' || key === 'time:timestamp' || key === 'lifecycle:transition')
          continue;
        (attributes ??= {})[key] = value;
      }
      raw.push({ caseId, activity, ms, lifecycle, attributes });
    }
  }
  if (noTimes > 0) {
    c.warnings.push(
      noTimes === raw.length
        ? 'The events have no time:timestamp: they are one second apart, in the order of the file.'
        : `${noTimes} events have no time:timestamp and were placed by their position in the file.`,
    );
  }
  c.words('noname', (n) => `${n} events without a concept:name were skipped.`);
  c.skippedLifecycles('events');
  if (anonymous > 0) c.warnings.push(`${anonymous} traces without a concept:name were numbered.`);
  return build(raw, options, c, 'xes');
}

/** True if `text` looks like XES (XML) rather than CSV. */
export function looksLikeXes(text: string): boolean {
  return (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).trimStart().startsWith('<');
}

/**
 * Reads an event log for the replay from CSV (the export of this tool, or any file with a case,
 * an activity and a time column, comma, semicolon or tab separated) or XES. Times become seconds
 * since the first event. Throws `EventLogParseError` for a file that is no event log.
 */
export function readLog(
  source: { csv?: string; xes?: string },
  options: ReadLogOptions = {},
): ReadLogResult {
  if (source.xes !== undefined) return readXes(source.xes, options);
  if (source.csv !== undefined) return readCsv(source.csv, options);
  throw new EventLogParseError('Give the log as csv or xes text.');
}
