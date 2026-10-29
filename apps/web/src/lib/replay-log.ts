import type { ActivityMapping, CompleteOnly, LiveEvent, LogEvent } from '@pnm/sim';

/** An event log that is ready to be replayed: read, with the activities mapped to transitions. */
export interface ReplayLog {
  fileName: string;
  events: LogEvent[];
  activities: string[];
  cases: number;
  /** Seconds from the first to the last event. */
  span: number;
  /** The moment that time 0 is, ISO 8601. */
  origin: string;
  mapping: ActivityMapping;
  completeOnly: CompleteOnly;
  /** Also check the guards of the transitions. */
  strict: boolean;
  /** Seconds left out of the key figures; without it the warm-up of the net. */
  warmup?: number;
}

/** Splits one line at `delimiter`; a field in double quotes may hold the delimiter. */
function splitLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += char;
    } else if (char === '"' && field === '') quoted = true;
    else if (char === delimiter) {
      fields.push(field.trim());
      field = '';
    } else field += char;
  }
  fields.push(field.trim());
  return fields;
}

export interface LiveLines {
  events: LiveEvent[];
  /** Lines that have no case or no activity. */
  skipped: number;
}

/**
 * Reads the lines that are pasted into a live replay: `case,activity` with, in any order, a
 * `start` or `complete` and the time in seconds since the replay was opened. Without a time the
 * event happens now, without a lifecycle it is the end of the activity. Separated by comma,
 * semicolon or tab; a header line (`case_id,activity,...`) is skipped.
 */
export function parseLiveLines(text: string): LiveLines {
  const events: LiveEvent[] = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const delimiter = [',', ';', '\t'].find((d) => line.includes(d)) ?? ',';
    const [caseId = '', activity = '', ...rest] = splitLine(line, delimiter);
    if (caseId === '' || activity === '') {
      skipped += 1;
      continue;
    }
    if (/^(case|case_id|caseid)$/i.test(caseId) && /^activity$/i.test(activity)) continue;
    let lifecycle: LiveEvent['lifecycle'] = 'complete';
    let time: number | undefined;
    for (const field of rest) {
      const lower = field.toLowerCase();
      if (lower === 'start' || lower === 'complete') lifecycle = lower;
      else if (/^[+-]?\d+(\.\d+)?$/.test(field)) time = Number(field);
    }
    events.push({ caseId, activity, lifecycle, ...(time !== undefined && { time }) });
  }
  return { events, skipped };
}
