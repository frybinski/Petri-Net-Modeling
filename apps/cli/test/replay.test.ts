import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readLog } from '@pnm/io';
import { example, pnm, tempDir } from './helpers';

/** The device log of docs/replay.md (the example for chapter 9). */
const DEVICES = `device,event,time
badge-17,arrival,2026-03-02T08:03:00Z
badge-17,entry,2026-03-02T08:03:04Z
badge-17,walk_to_desk,2026-03-02T08:03:24Z
badge-17,work,2026-03-02T08:12:30Z
badge-17,coffee,2026-03-02T08:13:40Z
badge-17,leave,2026-03-02T08:13:50Z
badge-23,arrival,2026-03-02T08:05:10Z
badge-23,entry,2026-03-02T08:05:14Z
badge-23,walk_to_room,2026-03-02T08:05:42Z
badge-23,meeting,2026-03-02T08:20:50Z
badge-23,coffee,2026-03-02T08:21:55Z
badge-23,leave,2026-03-02T08:22:05Z
badge-31,arrival,2026-03-02T08:07:00Z
badge-31,entry,2026-03-02T08:07:05Z
badge-31,walk_to_desk,2026-03-02T08:07:30Z
badge-31,work,2026-03-02T08:16:00Z
badge-31,leave,2026-03-02T08:16:10Z
`;

let scratch: ReturnType<typeof tempDir>;
beforeAll(() => {
  scratch = tempDir();
});
afterAll(() => {
  scratch.cleanup();
});
const tmp = (name: string): string => join(scratch.dir, name);

const PARCEL = example('parcel-center');

/** Runs the parcel center for two hours and writes its log; returns the paths. */
async function exportLog(): Promise<{ csv: string; xes: string; metrics: string }> {
  const csv = tmp('parcel.csv');
  const xes = tmp('parcel.xes');
  const metrics = tmp('parcel-run.json');
  const result = await pnm([
    'simulate',
    PARCEL,
    '--seconds',
    '7200',
    '--csv',
    csv,
    '--xes',
    xes,
    '--metrics',
    metrics,
    '--quiet',
  ]);
  expect(result.status).toBe(0);
  return { csv, xes, metrics };
}

describe('pnm replay', () => {
  it('replays the exported log of the parcel center with fitness 1 and the key figures of the run', async () => {
    const { csv, metrics } = await exportLog();
    const out = tmp('replay-metrics.json');
    const result = await pnm(['replay', PARCEL, csv, '--time-origin', 'net', '--metrics', out]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Paketzentrum: replayed');
    expect(result.stdout).toContain('6394 events');
    expect(result.stdout).toMatch(/fitness\s+1\.0000/);
    expect(result.stdout).toMatch(/deviations\s+none/);
    expect(result.stdout).toContain('cases completed    529  (317.41 per hour)');
    expect(result.stdout).toContain('cycle time         mean 2 min 46 s, max 8 min 09 s');
    expect(result.stdout).toContain('Wrote ' + out);

    const run = JSON.parse(readFileSync(metrics, 'utf8')) as {
      metrics: { completedCases: number; throughputPerHour: number; meanCycleTime: number };
    };
    const replay = JSON.parse(readFileSync(out, 'utf8')) as {
      fitness: number;
      missing: number;
      deviations: unknown[];
      metrics: { completedCases: number; throughputPerHour: number; meanCycleTime: number };
    };
    expect(replay).toMatchObject({ fitness: 1, missing: 0, deviations: [] });
    expect(replay.metrics.completedCases).toBe(run.metrics.completedCases);
    // The export writes whole milliseconds.
    expect(Math.abs(replay.metrics.meanCycleTime - run.metrics.meanCycleTime)).toBeLessThan(0.001);
    // The replay ends with the last event, the run at two hours: a few seconds of observed time.
    expect(replay.metrics.throughputPerHour / run.metrics.throughputPerHour).toBeCloseTo(1, 3);
  });

  it('reads XES as well, and prints JSON on request', async () => {
    const { xes } = await exportLog();
    const result = await pnm(['replay', PARCEL, xes, '--json', '--strict']);
    expect(result.status).toBe(0);
    const json = JSON.parse(result.stdout) as {
      fitness: number;
      events: number;
      deviations: unknown[];
    };
    expect(json).toMatchObject({ fitness: 1, events: 6394, deviations: [] });
    // The summary goes to standard error then.
    expect(result.stderr).toContain('replayed');
  });

  it('counts deviations, names the places, and fails with --strict', async () => {
    const { csv } = await exportLog();
    const lines = readFileSync(csv, 'utf8')
      .split('\n')
      .filter((l) => !l.includes(',Scannen,'));
    const broken = tmp('without-scan.csv');
    writeFileSync(broken, `${lines.join('\n')}`);
    const loose = await pnm(['replay', PARCEL, broken]);
    expect(loose.status).toBe(0);
    expect(loose.stdout).toMatch(/fitness\s+0\.\d{4}/);
    expect(loose.stdout).toMatch(/deviations\s+\d+\s+\(missing \d+, ignored 0, guard 0\)/);
    expect(loose.stdout).toContain('missing    Sortieren found no token on Gescannt');
    const strict = await pnm(['replay', PARCEL, broken, '--strict', '--quiet']);
    expect(strict.status).toBe(1);
    expect(strict.stdout).toBe('');
  });

  it('skips activities that match no transition and says so, until they are mapped or ignored', async () => {
    const { csv } = await exportLog();
    const renamed = tmp('renamed.csv');
    const text = readFileSync(csv, 'utf8')
      .replace(/,Scannen,/g, ',Barcode lesen,')
      .concat('X-1,Etikett drucken,2026-01-05T06:10:00.000Z,complete\n');
    writeFileSync(renamed, text);

    const first = await pnm(['replay', PARCEL, renamed, '--quiet']);
    expect(first.status).toBe(0);
    expect(first.stderr).toContain('2 activities not mapped to a transition and skipped');
    expect(first.stderr).toContain('"Barcode lesen", "Etikett drucken"');

    const mapped = await pnm([
      'replay',
      PARCEL,
      renamed,
      '--map',
      'Barcode lesen=t_scan',
      '--ignore',
      'Etikett drucken',
      '--json',
      '--time-origin',
      'net',
    ]);
    expect(mapped.status).toBe(0);
    expect(mapped.stderr).toContain('replayed');
    expect(mapped.stderr).not.toContain('not mapped to a transition');
    const json = JSON.parse(mapped.stdout) as {
      fitness: number;
      ignored: number;
      mapping: Record<string, string | null>;
    };
    expect(json.fitness).toBe(1);
    // An activity that was ignored on purpose is still counted as skipped.
    expect(json.ignored).toBe(1);
    expect(json.mapping['Barcode lesen']).toBe('t_scan');
    expect(json.mapping['Etikett drucken']).toBeNull();
    // A transition can be named by its name, too.
    const byName = await pnm([
      'replay',
      PARCEL,
      renamed,
      '--map',
      'Barcode lesen=Scannen',
      '--ignore',
      'Etikett drucken',
      '--quiet',
      '--strict',
    ]);
    expect(byName.status).toBe(0);
  });

  it('reads a foreign CSV: other column names, semicolons, Unix seconds', async () => {
    const net = tmp('chain.pn.json');
    const doc = {
      version: '1.0',
      profile: 'pt-net',
      name: 'Chain',
      types: {},
      places: [
        { id: 'a', name: 'A', position: { x: 0, y: 0 } },
        { id: 'b', name: 'B', position: { x: 0, y: 0 } },
        { id: 'c', name: 'C', position: { x: 0, y: 0 } },
      ],
      transitions: [
        { id: 'enter', name: 'Enter', position: { x: 0, y: 0 } },
        { id: 'leave', name: 'Leave', position: { x: 0, y: 0 } },
      ],
      arcs: [
        { id: 'a1', source: 'a', target: 'enter', weight: 1 },
        { id: 'a2', source: 'enter', target: 'b', weight: 1 },
        { id: 'a3', source: 'b', target: 'leave', weight: 1 },
        { id: 'a4', source: 'leave', target: 'c', weight: 1 },
      ],
      marking: {},
    };
    writeFileSync(net, JSON.stringify(doc));
    const log = tmp('devices.csv');
    writeFileSync(
      log,
      'device;event;time\nd1;enter;1767600000\nd1;leave;1767600090\nd2;enter;1767600030\nd2;leave;1767600200\n',
    );
    const plain = await pnm(['replay', net, log]);
    expect(plain.status).toBe(1);
    expect(plain.stderr).toContain('case column');
    const result = await pnm([
      'replay',
      net,
      log,
      '--case-column',
      'device',
      '--activity-column',
      'event',
      '--time-column',
      'time',
      '--json',
    ]);
    expect(result.status).toBe(0);
    const json = JSON.parse(result.stdout) as {
      fitness: number;
      cases: number;
      seconds: number;
      metrics: { completedCases: number };
    };
    expect(json).toMatchObject({ fitness: 1, cases: 2, seconds: 200 });
    expect(json.metrics.completedCases).toBe(2);
  });

  it('writes the replayed events as an event log with the time of the first event', async () => {
    const { csv } = await exportLog();
    const out = tmp('replayed.csv');
    const result = await pnm([
      'replay',
      PARCEL,
      csv,
      '--time-origin',
      'net',
      '--csv',
      out,
      '--quiet',
    ]);
    expect(result.status).toBe(0);
    const again = readLog({ csv: readFileSync(out, 'utf8') });
    const first = readLog({ csv: readFileSync(csv, 'utf8') });
    expect(again.events).toHaveLength(first.events.length);
    expect(again.cases).toBe(first.cases);
    expect(again.span).toBeCloseTo(first.span, 6);
  });

  it('reads the log from standard input', async () => {
    const { csv } = await exportLog();
    const result = await pnm(['replay', PARCEL, '-', '--quiet', '--json'], {
      stdin: readFileSync(csv, 'utf8'),
    });
    expect(result.status).toBe(0);
    expect((JSON.parse(result.stdout) as { fitness: number }).fitness).toBe(1);
  });

  it('refuses wrong use and unusable files', async () => {
    const { csv } = await exportLog();
    expect((await pnm(['replay'])).status).toBe(2);
    const noLog = await pnm(['replay', PARCEL]);
    expect(noLog.status).toBe(2);
    expect(noLog.stderr).toContain('Missing event log');
    const unknown = await pnm(['replay', PARCEL, csv, '--map', 'Nope=t_scan']);
    expect(unknown).toMatchObject({ status: 2 });
    expect(unknown.stderr).toContain('the log has no activity "Nope"');
    const noTransition = await pnm(['replay', PARCEL, csv, '--map', 'Scannen=nowhere']);
    expect(noTransition.status).toBe(2);
    expect(noTransition.stderr).toContain('no transition "nowhere"');
    const badOrigin = await pnm(['replay', example('traffic-light'), csv, '--time-origin', 'net']);
    expect(badOrigin.status).toBe(2);
    const badMode = await pnm(['replay', PARCEL, csv, '--complete-only', 'sometimes']);
    expect(badMode.status).toBe(2);
    const missing = await pnm(['replay', PARCEL, tmp('nope.csv')]);
    expect(missing).toMatchObject({ status: 1 });
    expect(missing.stderr).toContain('no such file');
    const garbage = tmp('garbage.csv');
    writeFileSync(garbage, 'a,b\n1,2\n');
    const bad = await pnm(['replay', PARCEL, garbage]);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('case column');
    const help = await pnm(['replay', '--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('Usage: pnm replay');
  });

  it('with --complete-only the activities that have no start take no time or take the time since the last one', async () => {
    const { csv } = await exportLog();
    const ends = tmp('ends.csv');
    writeFileSync(
      ends,
      readFileSync(csv, 'utf8')
        .split('\n')
        .filter((l, i) => i === 0 || l.endsWith(',complete'))
        .join('\n'),
    );
    for (const mode of ['zero', 'span']) {
      const result = await pnm(['replay', PARCEL, ends, '--complete-only', mode, '--json']);
      expect(result.status).toBe(0);
      const json = JSON.parse(result.stdout) as { cases: number; missing: number; fitness: number };
      expect(json.cases).toBe(653);
      if (mode === 'zero') expect(json.fitness).toBe(1);
      // With span an activity is under way from the end of the last one: resources run short.
      else expect(json.missing).toBeGreaterThan(0);
    }
  });

  it('replays the device log of the documentation: columns and activities mapped by hand', async () => {
    const log = tmp('devices.csv');
    writeFileSync(log, DEVICES);
    const result = await pnm([
      'replay',
      example('smart-office'),
      log,
      '--warmup',
      '0',
      '--case-column',
      'device',
      '--activity-column',
      'event',
      '--time-column',
      'time',
      '--map',
      'arrival=Ankunft',
      '--map',
      'entry=Zutritt',
      '--map',
      'walk_to_desk=Weg Arbeitsplatz',
      '--map',
      'walk_to_room=Weg Meeting',
      '--map',
      'work=Arbeiten',
      '--map',
      'meeting=Meeting',
      '--map',
      'coffee=Kaffee holen',
      '--map',
      'leave=Verlassen',
    ]);
    expect(result.status).toBe(0);
    // Only the missing lifecycle column is remarked; every activity is mapped.
    expect(result.stderr).toContain('no lifecycle column');
    expect(result.stderr).not.toContain('not mapped');
    expect(result.stdout).toContain('17 events, 3 cases');
    expect(result.stdout).toMatch(
      /fitness\s+0\.9621\s+\(1 of 25 tokens had to be created, 1 of 28 were left behind\)/,
    );
    expect(result.stdout).toContain('missing    Verlassen found no token on Zum Ausgang');
    expect(result.stdout).toMatch(/cases completed\s+3/);
  });
});
