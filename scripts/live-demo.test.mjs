// Tests of the live demo script: `node --test scripts` (also `pnpm test:scripts`).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { toConsole, toLines, walk } from './live-demo.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'live-demo.mjs');
const office = JSON.parse(
  readFileSync(join(here, '..', 'examples', 'smart-office.pn.json'), 'utf8'),
);

describe('walk', () => {
  const events = walk(office, { cases: 8, seed: 3 });
  const names = new Set(office.transitions.map((t) => t.name));

  it('lets every case in through the arrival and out through the exit', () => {
    const cases = new Set(events.map((e) => e.case));
    assert.equal(cases.size, 8);
    for (const id of cases) {
      const mine = events.filter((e) => e.case === id);
      assert.equal(mine[0].activity, 'Ankunft');
      assert.equal(mine.at(-1).activity, 'Verlassen');
      assert.equal(mine.at(-1).lifecycle, 'complete');
      // Each activity starts and then completes.
      for (let i = 0; i < mine.length; i += 2) {
        assert.equal(mine[i].lifecycle, 'start');
        assert.equal(mine[i + 1].lifecycle, 'complete');
        assert.equal(mine[i].activity, mine[i + 1].activity);
        assert.ok(mine[i + 1].time >= mine[i].time);
      }
    }
  });

  it('uses the names of the transitions and sorts by time', () => {
    for (const event of events) assert.ok(names.has(event.activity), event.activity);
    for (let i = 1; i < events.length; i += 1) assert.ok(events[i].time >= events[i - 1].time);
  });

  it('never has two cases at the one coffee machine', () => {
    const spans = [];
    for (const e of events.filter((e) => e.activity === 'Kaffee holen')) {
      if (e.lifecycle === 'start') spans.push({ case: e.case, from: e.time });
      else spans.find((s) => s.case === e.case).to = e.time;
    }
    spans.sort((a, b) => a.from - b.from);
    for (let i = 1; i < spans.length; i += 1) assert.ok(spans[i].from >= spans[i - 1].to - 0.11);
  });

  it('is the same for the same seed and not for another', () => {
    assert.deepEqual(walk(office, { cases: 8, seed: 3 }), events);
    assert.notDeepEqual(walk(office, { cases: 8, seed: 4 }), events);
  });

  it('scales the times', () => {
    const slow = walk(office, { cases: 2, seed: 1, scale: 1 });
    const fast = walk(office, { cases: 2, seed: 1, scale: 10 });
    assert.equal(slow.length, fast.length);
    assert.ok(slow.at(-1).time > 5 * fast.at(-1).time);
  });

  it('refuses a net without an arrival', () => {
    assert.throws(() => walk({ ...office, transitions: [], arcs: [] }), /lets cases in/);
  });
});

describe('formats', () => {
  const events = walk(office, { cases: 1 });
  it('lines: case, activity, lifecycle, time', () => {
    const lines = toLines(events).split('\n');
    assert.equal(lines.length, events.length);
    assert.match(lines[0], /^D-001,Ankunft,start,[\d.]+$/);
  });
  it('console: a push call with the events', () => {
    const text = toConsole(events);
    assert.ok(text.startsWith('window.pnm.live.push(['));
    assert.ok(text.endsWith(']);'));
    assert.deepEqual(JSON.parse(text.slice('window.pnm.live.push('.length, -2)), events);
  });
});

describe('the command line', () => {
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  it('prints lines by default and the other formats on request', () => {
    const lines = run('--cases', '2');
    assert.equal(lines.status, 0);
    assert.match(lines.stdout, /^D-001,Ankunft,start,/);
    assert.equal(JSON.parse(run('--cases', '1', '--format', 'json').stdout).length > 4, true);
    assert.ok(run('--format', 'console').stdout.startsWith('window.pnm.live.push('));
  });
  it('rejects an unknown format', () => {
    const result = run('--format', 'xml');
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Unknown format/);
  });
});
