import { createEmptyNet, type PetriNet } from '@pnm/core';
import { createSimulation } from '@pnm/sim';
import { describe, expect, it } from 'vitest';
import {
  EventLogParseError,
  looksLikeXes,
  parseLogTime,
  readCsvHeaders,
  readLog,
  toEventLogCsv,
  toXes,
} from '../src';

/** arrive (rate) -> wait -> serve (5 s, uses a clerk) -> done */
function shop(): PetriNet {
  const net = createEmptyNet('Shop');
  net.simulation = { seed: 3, startTime: '2026-01-05T08:00:00Z', caseIdPrefix: 'K-' };
  for (const id of ['wait', 'clerk', 'done']) {
    net.places.push({ id, name: id, position: { x: 0, y: 0 } });
  }
  net.marking['clerk'] = [1];
  net.transitions.push(
    { id: 'arrive', name: 'Arrive', position: { x: 0, y: 0 }, rate: 360 },
    {
      id: 'serve',
      name: 'Serve, politely',
      position: { x: 0, y: 0 },
      timing: { kind: 'fixed', value: 5 },
    },
  );
  const arcs: Array<[string, string]> = [
    ['arrive', 'wait'],
    ['wait', 'serve'],
    ['clerk', 'serve'],
    ['serve', 'clerk'],
    ['serve', 'done'],
  ];
  arcs.forEach(([source, target], i) => net.arcs.push({ id: `a${i}`, source, target, weight: 1 }));
  return net;
}

async function exported(): Promise<{ csv: string; xes: string; net: PetriNet }> {
  const net = shop();
  const sim = createSimulation(net);
  const events = [...sim.initialEvents, ...(await sim.advance(300))];
  return { csv: toEventLogCsv(events, net), xes: toXes(events, net), net };
}

describe('readLog: the CSV of this tool', () => {
  it('reads every row with seconds since the first event', async () => {
    const { csv } = await exported();
    const log = readLog({ csv });
    const rows = csv.trimEnd().split('\n').length - 1;
    expect(log.format).toBe('csv');
    expect(log.events).toHaveLength(rows);
    expect(log.events[0]?.time).toBe(0);
    expect(log.events.every((e, i, all) => i === 0 || e.time >= all[i - 1]!.time)).toBe(true);
    expect(log.activities).toEqual(['Arrive', 'Serve, politely']);
    expect(log.cases).toBeGreaterThan(10);
    expect(log.span).toBeCloseTo(log.events[log.events.length - 1]!.time, 9);
    expect(log.warnings).toEqual([]);
    expect(log.columns).toEqual({
      case: 'case_id',
      activity: 'activity',
      time: 'timestamp',
      lifecycle: 'lifecycle',
    });
    const first = log.events[0]!;
    expect(first).toMatchObject({ caseId: 'K-0001', activity: 'Arrive', lifecycle: 'start' });
  });

  it('keeps the times to the millisecond', () => {
    const log = readLog({
      csv: 'case_id,activity,timestamp,lifecycle\nc,a,2026-01-05T08:00:00.250Z,start\nc,a,2026-01-05T08:00:07.125Z,complete\n',
    });
    expect(log.events.map((e) => e.time)).toEqual([0, 6.875]);
  });

  it('can take another moment as time 0', () => {
    const csv = 'case_id,activity,timestamp\nc,a,2026-01-05T08:00:10Z\n';
    expect(readLog({ csv }, { timeOrigin: '2026-01-05T08:00:00Z' }).events[0]?.time).toBe(10);
    expect(readLog({ csv }, { timeOrigin: '1767600000' }).events[0]?.time).toBeCloseTo(
      Date.parse('2026-01-05T08:00:10Z') / 1000 - 1767600000,
      6,
    );
    expect(() => readLog({ csv }, { timeOrigin: 'yesterday' })).toThrow(/time origin/);
  });
});

describe('readLog: other CSV files', () => {
  it('treats every row as complete without a lifecycle column', () => {
    const log = readLog({
      csv: 'case_id,activity,timestamp\nc1,A,2026-01-05T08:00:00Z\nc1,B,2026-01-05T08:00:30Z\n',
    });
    expect(log.events.map((e) => e.lifecycle)).toEqual(['complete', 'complete']);
    expect(log.warnings.join(' ')).toMatch(/no lifecycle column/);
  });

  it('maps columns with other names, by guess and by choice', () => {
    const csv = 'device,event,time,room\nd1,Enter,100,A1\nd1,Leave,160.5,A1\nd2,Enter,130,B2\n';
    expect(() => readLog({ csv })).toThrow(/case column/);
    const log = readLog({ csv }, { columns: { case: 'device', activity: 'event', time: 'time' } });
    expect(log.events).toEqual([
      {
        caseId: 'd1',
        activity: 'Enter',
        time: 0,
        lifecycle: 'complete',
        attributes: { room: 'A1' },
      },
      {
        caseId: 'd2',
        activity: 'Enter',
        time: 30,
        lifecycle: 'complete',
        attributes: { room: 'B2' },
      },
      {
        caseId: 'd1',
        activity: 'Leave',
        time: 60.5,
        lifecycle: 'complete',
        attributes: { room: 'A1' },
      },
    ]);
    expect(log.cases).toBe(2);
    // The usual names are found without help, in any case.
    const guessed = readLog({ csv: 'Case,Activity,Timestamp\nx,A,5\n' });
    expect(guessed.events).toHaveLength(1);
  });

  it('reads Unix seconds, semicolons, tabs, quotes and a byte order mark', () => {
    const semicolon = readLog({
      csv: '﻿case_id;activity;timestamp\n1;"A;B";1767600000\n1;C;1767600090\n',
    });
    expect(semicolon.activities).toEqual(['A;B', 'C']);
    expect(semicolon.events.map((e) => e.time)).toEqual([0, 90]);
    const tab = readLog({ csv: 'case_id\tactivity\ttimestamp\n1\tA\t5\n' });
    expect(tab.events).toHaveLength(1);
  });

  it('reads a time without a zone as UTC and milliseconds as milliseconds', () => {
    expect(parseLogTime('2026-01-05 08:00:00')?.ms).toBe(Date.parse('2026-01-05T08:00:00Z'));
    expect(parseLogTime('1767600000000')).toEqual({ ms: 1767600000000, unixMs: true });
    expect(parseLogTime('1767600000')).toEqual({ ms: 1767600000000 });
    expect(parseLogTime('soon')).toBeNull();
    const log = readLog({
      csv: 'case_id,activity,timestamp\nc,A,1767600000000\nc,B,1767600005000\n',
    });
    expect(log.events.map((e) => e.time)).toEqual([0, 5]);
    expect(log.warnings.join(' ')).toMatch(/milliseconds/);
  });

  it('sorts by time and keeps the order of the file for equal times', () => {
    const log = readLog({
      csv: 'case_id,activity,timestamp\nb,Y,10\na,X,5\nc,Z,10\nd,W,10\n',
    });
    expect(log.events.map((e) => e.activity)).toEqual(['X', 'Y', 'Z', 'W']);
  });

  it('places events one second apart when there is no time column', () => {
    const log = readLog({ csv: 'case_id,activity\nc,A\nc,B\n' });
    expect(log.events.map((e) => e.time)).toEqual([0, 1]);
    expect(log.warnings.join(' ')).toMatch(/no time column/);
  });

  it('skips rows it cannot use and says so', () => {
    const log = readLog({
      csv: [
        'case_id,activity,timestamp,lifecycle',
        'c,A,5,start',
        ',B,6,complete',
        'c,C,,complete',
        'c,D,7,schedule',
        'c,A,9,complete',
        '',
      ].join('\n'),
    });
    expect(log.events.map((e) => e.activity)).toEqual(['A', 'A']);
    expect(log.warnings.join('\n')).toMatch(/1 rows without a case or an activity/);
    expect(log.warnings.join('\n')).toMatch(/1 rows without a time/);
    expect(log.warnings.join('\n')).toMatch(/1 rows with the lifecycle "schedule"/);
  });
});

describe('readLog: XES', () => {
  it('reads the XES of this tool: the same events as the CSV', async () => {
    const { csv, xes } = await exported();
    const fromCsv = readLog({ csv });
    const fromXes = readLog({ xes });
    expect(fromXes.format).toBe('xes');
    expect(fromXes.events).toEqual(fromCsv.events);
    expect(fromXes.cases).toBe(fromCsv.cases);
    expect(fromXes.activities).toEqual(fromCsv.activities);
  });

  it('takes complete when the lifecycle is missing, and keeps attributes', () => {
    const xes = `<?xml version="1.0"?>
<log xes.version="1.0">
  <trace>
    <string key="concept:name" value="t1"/>
    <string key="customer" value="Ada"/>
    <event>
      <string key="concept:name" value="Register"/>
      <date key="time:timestamp" value="2026-01-05T08:00:00.000+00:00"/>
      <int key="amount" value="120"/>
    </event>
    <event>
      <string key="concept:name" value="Pay"/>
      <string key="lifecycle:transition" value="COMPLETE"/>
      <date key="time:timestamp" value="2026-01-05T08:01:00.000+01:00"/>
    </event>
    <event>
      <string key="concept:name" value="Pay"/>
      <string key="lifecycle:transition" value="assign"/>
      <date key="time:timestamp" value="2026-01-05T08:00:30.000Z"/>
    </event>
  </trace>
  <trace>
    <event><string key="concept:name" value="Register"/><date key="time:timestamp" value="2026-01-05T08:02:00Z"/></event>
  </trace>
</log>`;
    const log = readLog({ xes });
    // The payment, at 08:01 in a zone one hour ahead, is the earliest event.
    expect(log.events).toEqual([
      {
        caseId: 't1',
        activity: 'Pay',
        time: 0,
        lifecycle: 'complete',
        attributes: { customer: 'Ada' },
      },
      {
        caseId: 't1',
        activity: 'Register',
        time: 3540,
        lifecycle: 'complete',
        attributes: { customer: 'Ada', amount: '120' },
      },
      { caseId: 'trace-1', activity: 'Register', time: 3660, lifecycle: 'complete' },
    ]);
    expect(log.warnings.join('\n')).toMatch(/1 events with the lifecycle "assign"/);
    expect(log.warnings.join('\n')).toMatch(/1 traces without a concept:name/);
  });

  it('places events without time stamps by their position', () => {
    const log = readLog({
      xes: '<log><trace><string key="concept:name" value="c"/><event><string key="concept:name" value="A"/></event><event><string key="concept:name" value="B"/></event></trace></log>',
    });
    expect(log.events.map((e) => e.time)).toEqual([0, 1]);
    expect(log.warnings.join(' ')).toMatch(/no time:timestamp/);
  });
});

describe('readLog: files that are no event log', () => {
  it('rejects them with a message', () => {
    expect(() => readLog({ csv: '' })).toThrow(EventLogParseError);
    expect(() => readLog({ csv: 'a,b\n1,2\n' })).toThrow(/case column/);
    expect(() => readLog({ csv: 'case_id,activity\n' })).toThrow(/no events/);
    expect(() => readLog({ csv: 'case_id,activity\nc,"a\n' })).toThrow(/not closed/);
    expect(() => readLog({ csv: 'case_id,activity,timestamp\nc,a,never\n' })).toThrow(/Line 2/);
    expect(() =>
      readLog({ csv: 'case_id,activity\nc,a\n' }, { columns: { time: 'when' } }),
    ).toThrow(/column "when"/);
    expect(() => readLog({ xes: '<log><trace></log>' })).toThrow(/well-formed/);
    expect(() => readLog({ xes: '<pnml/>' })).toThrow(/no <log>/);
    expect(() => readLog({ xes: '<log/>' })).toThrow(/no events/);
    expect(() => readLog({})).toThrow(/csv or xes/);
  });

  it('tells XES from CSV', () => {
    expect(looksLikeXes('  <?xml version="1.0"?><log/>')).toBe(true);
    expect(looksLikeXes('case_id,activity')).toBe(false);
  });
});

describe('readCsvHeaders', () => {
  it('lists the columns of the header row', () => {
    expect(readCsvHeaders('case_id,activity,timestamp\nc,a,1\n')).toEqual([
      'case_id',
      'activity',
      'timestamp',
    ]);
    expect(readCsvHeaders('﻿device; event ;"time stamp"\r\nd1;enter;1')).toEqual([
      'device',
      'event',
      'time stamp',
    ]);
    expect(readCsvHeaders('')).toEqual([]);
    expect(readCsvHeaders('"open')).toEqual([]);
  });
});
