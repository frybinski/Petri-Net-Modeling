import { createEmptyNet, type PetriNet } from '@pnm/core';
import { createSimulation, type SimEvent } from '@pnm/sim';
import { describe, expect, it } from 'vitest';
import {
  CSV_COLUMNS,
  EventLogParseError,
  eventLogRows,
  parseEventLogCsv,
  toEventLogCsv,
  toXes,
} from '../src';

/** arrive (rate) -> wait -> serve (5 s, uses a clerk) -> done */
function shop(): PetriNet {
  const net = createEmptyNet('Shop, "main"');
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

async function run(): Promise<{ net: PetriNet; events: SimEvent[] }> {
  const net = shop();
  const sim = createSimulation(net);
  const events = [...sim.initialEvents, ...(await sim.advance(300))];
  return { net, events };
}

describe('event log CSV', () => {
  it('has the four columns and a row per start and complete with a case', async () => {
    const { net, events } = await run();
    const csv = toEventLogCsv(events, net);
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe('case_id,activity,timestamp,lifecycle');
    expect([...CSV_COLUMNS]).toEqual(['case_id', 'activity', 'timestamp', 'lifecycle']);
    const expected = events.filter(
      (e) => (e.type === 'start' || e.type === 'complete') && e.caseIds.length > 0,
    ).length;
    expect(lines.length - 1).toBe(expected);
    expect(expected).toBeGreaterThan(20);
  });

  it('writes ISO timestamps from the start time, in event order', async () => {
    const { net, events } = await run();
    const rows = eventLogRows(events, net);
    expect(rows[0]?.timestamp).toBe('2026-01-05T08:00:' + rows[0]!.timestamp.slice(17));
    expect(rows.every((r) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(r.timestamp))).toBe(
      true,
    );
    const times = rows.map((r) => Date.parse(r.timestamp));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(rows.every((r) => r.caseId.startsWith('K-'))).toBe(true);
  });

  it('maps the simulation time onto the start time of the settings', () => {
    const net = shop();
    const events: SimEvent[] = [
      {
        id: 1,
        t: 90.5,
        type: 'start',
        transitionId: 'serve',
        firingId: 1,
        slot: 0,
        caseIds: ['K-1'],
        binding: {},
        consumed: [],
      },
    ];
    expect(eventLogRows(events, net)[0]?.timestamp).toBe('2026-01-05T08:01:30.500Z');
    expect(
      eventLogRows(events, net, { startTime: '2026-03-01T00:00:00+01:00' })[0]?.timestamp,
    ).toBe('2026-02-28T23:01:30.500Z');
  });

  it('quotes fields that contain commas and quotes', async () => {
    const { net, events } = await run();
    const csv = toEventLogCsv(events, net);
    expect(csv).toContain('"Serve, politely"');
    const odd = createEmptyNet('x');
    odd.transitions.push({ id: 't', name: 'say "hi"\nnow', position: { x: 0, y: 0 } });
    const ev: SimEvent[] = [
      {
        id: 1,
        t: 0,
        type: 'complete',
        transitionId: 't',
        firingId: 1,
        slot: 0,
        caseIds: ['C-1'],
        produced: [],
      },
    ];
    expect(toEventLogCsv(ev, odd)).toContain('"say ""hi""\nnow"');
  });

  it('ignores events without a case and writes a row per case of a join', () => {
    const net = shop();
    const events: SimEvent[] = [
      {
        id: 1,
        t: 0,
        type: 'start',
        transitionId: 'serve',
        firingId: 1,
        slot: 0,
        caseIds: [],
        binding: {},
        consumed: [],
      },
      { id: 2, t: 1, type: 'idle' },
      {
        id: 3,
        t: 2,
        type: 'start',
        transitionId: 'serve',
        firingId: 2,
        slot: 0,
        caseIds: ['A', 'B'],
        binding: {},
        consumed: [],
      },
    ];
    expect(eventLogRows(events, net).map((r) => r.caseId)).toEqual(['A', 'B']);
  });

  it('is the same for the same seed', async () => {
    const a = await run();
    const b = await run();
    expect(toEventLogCsv(a.events, a.net)).toBe(toEventLogCsv(b.events, b.net));
  });
});

/** Minimal well-formedness check: balanced tags, quoted attributes, no stray `&` or `<`. */
function checkWellFormed(text: string): { traces: number; events: number } {
  const stack: string[] = [];
  const tag =
    /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<&]*(?:&(?:amp|lt|gt|quot);[^"<&]*)*")*)\s*(\/?)>/g;
  const rest = text.replace(/<\?xml[^>]*\?>/, '');
  let traces = 0;
  let events = 0;
  let position = 0;
  for (const match of rest.matchAll(tag)) {
    const between = rest.slice(position, match.index);
    expect(between.trim()).toBe('');
    position = match.index + match[0].length;
    const [, closing, name, , selfClosing] = match;
    if (closing) expect(stack.pop()).toBe(name);
    else if (!selfClosing) stack.push(name!);
    if (!closing && name === 'trace') traces += 1;
    if (!closing && name === 'event') events += 1;
  }
  expect(rest.slice(position).trim()).toBe('');
  expect(stack).toEqual([]);
  return { traces, events };
}

describe('XES', () => {
  it('is well formed and has one trace per case', async () => {
    const { net, events } = await run();
    const xes = toXes(events, net);
    const { traces, events: count } = checkWellFormed(xes);
    const rows = eventLogRows(events, net);
    expect(traces).toBe(new Set(rows.map((r) => r.caseId)).size);
    expect(count).toBe(rows.length);
    expect(xes).toContain('xes.version="1.0"');
    expect(xes).toContain('<string key="concept:name" value="Shop, &quot;main&quot;"/>');
    expect(xes).toContain('key="lifecycle:transition" value="start"');
    expect(xes).toContain('<date key="time:timestamp" value="2026-01-05T08:');
  });

  it('keeps the events of a trace in time order', async () => {
    const { net, events } = await run();
    const xes = toXes(events, net);
    for (const trace of xes.split('<trace>').slice(1)) {
      const stamps = [...trace.matchAll(/time:timestamp" value="([^"]+)"/g)].map((m) =>
        Date.parse(m[1]!),
      );
      expect(stamps).toEqual([...stamps].sort((a, b) => a - b));
    }
  });

  it('escapes special characters and drops invalid ones', () => {
    const net = createEmptyNet('a<b & c');
    net.transitions.push({ id: 't', name: 'x\u0001<y>', position: { x: 0, y: 0 } });
    const xes = toXes([], net);
    expect(xes).toContain('value="a&lt;b &amp; c"');
    const ev: SimEvent[] = [
      {
        id: 1,
        t: 0,
        type: 'complete',
        transitionId: 't',
        firingId: 1,
        slot: 0,
        caseIds: ['C-1'],
        produced: [],
      },
    ];
    expect(toXes(ev, net)).toContain('value="x&lt;y&gt;"');
    checkWellFormed(toXes(ev, net));
  });
});

describe('parseEventLogCsv', () => {
  it('reads back what toEventLogCsv wrote, including quoted names', async () => {
    const { net, events } = await run();
    const rows = eventLogRows(events, net);
    expect(rows.some((r) => r.activity === 'Serve, politely')).toBe(true);
    expect(parseEventLogCsv(toEventLogCsv(events, net))).toEqual(rows);
  });

  it('accepts other column orders, CR LF, a byte order mark and a missing lifecycle column', () => {
    const rows = parseEventLogCsv('﻿activity,case_id\r\n"A ""x""",c1\r\nB,c1\r\n\r\n');
    expect(rows).toEqual([
      { caseId: 'c1', activity: 'A "x"', timestamp: '', lifecycle: 'complete' },
      { caseId: 'c1', activity: 'B', timestamp: '', lifecycle: 'complete' },
    ]);
  });

  it('rejects logs without the required columns, bad lifecycles and open quotes', () => {
    expect(() => parseEventLogCsv('')).toThrow(EventLogParseError);
    expect(() => parseEventLogCsv('a,b\n1,2\n')).toThrow(/case_id/);
    expect(() => parseEventLogCsv('case_id,activity,lifecycle\nc,a,pause\n')).toThrow(/lifecycle/);
    expect(() => parseEventLogCsv('case_id,activity\nc,"a\n')).toThrow(/not closed/);
    expect(() => parseEventLogCsv('case_id,activity\n,a\n')).toThrow(/must not be empty/);
  });
});
