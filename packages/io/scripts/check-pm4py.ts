/* eslint-disable no-console -- a command line script reports on the console. */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNetText } from '@pnm/core';
import { createSimulation, type SimEvent } from '@pnm/sim';
import { eventLogRows, toEventLogCsv, toXes } from '../src';

/**
 * Acceptance A8: the event log of a simulation can be read by pm4py, and discovery gives a Petri
 * net with the activities of the transitions that carry cases.
 *
 *     pnpm --filter @pnm/io check:pm4py [-- --out-dir DIR --date YYYY-MM-DD --hours 2 --seed 1]
 *
 * Python comes from the environment variable PNM_PYTHON (for example the interpreter of a venv
 * with `pip install pm4py pandas`), else `python3`. Exit status: 0 all checks passed, 1 a check
 * failed, 3 pm4py is not available, 64 bad arguments.
 */

interface Options {
  outDir: string;
  scratch: string;
  date: string;
  hours: number;
  seed: number;
  example: string;
}

interface CheckResult {
  pm4py: string;
  pandas: string;
  rows: number;
  cases: number;
  completeRows: number;
  activities: string[];
  expected: string[];
  places: number;
  transitions: number;
  arcs: number;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
}

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');

function parseArgs(argv: string[]): Options {
  const options: Options = {
    outDir: join(root, 'docs', 'eval'),
    scratch: join(tmpdir(), 'pnm-pm4py'),
    date: new Date().toISOString().slice(0, 10),
    hours: 2,
    seed: 1,
    example: 'parcel-center',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--') continue;
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`${flag ?? ''} needs a value`);
    i += 1;
    switch (flag) {
      case '--out-dir':
        options.outDir = resolve(value);
        break;
      case '--scratch':
        options.scratch = resolve(value);
        break;
      case '--date':
        options.date = value;
        break;
      case '--hours':
        options.hours = Number(value);
        break;
      case '--seed':
        options.seed = Number(value);
        break;
      case '--example':
        options.example = value;
        break;
      default:
        throw new Error(`Unknown option ${flag ?? ''}`);
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date)) throw new Error('--date must be YYYY-MM-DD');
  if (!Number.isFinite(options.hours) || options.hours <= 0) throw new Error('--hours must be > 0');
  return options;
}

function markdown(
  options: Options,
  python: string,
  result: CheckResult,
  details: { events: number; casesOnTransitions: number },
): string {
  const rows = result.checks.map(
    (c) => `| ${c.passed ? 'PASS' : 'FAIL'} | ${c.name} | ${c.detail} |`,
  );
  const passed = result.checks.every((c) => c.passed);
  return `${[
    `# Event log and pm4py (acceptance A8), ${options.date}`,
    '',
    `Result: **${passed ? 'PASS' : 'FAIL'}**. The net \`${options.example}\` was simulated for ${options.hours} h of model time (seed ${options.seed}). The log was exported as CSV and XES by \`@pnm/io\` and read with pm4py ${result.pm4py} and pandas ${result.pandas} (${python === 'python3' ? 'python3' : 'the interpreter in PNM_PYTHON'}).`,
    '',
    '| Result | Check | Detail |',
    '| ------ | ----- | ------ |',
    ...rows,
    '',
    '## Numbers',
    '',
    '| What | Value |',
    '| ---- | ----- |',
    `| Events of the simulation | ${details.events} |`,
    `| Rows of the CSV (start and complete, one per case) | ${result.rows} |`,
    `| Rows with lifecycle complete | ${result.completeRows} |`,
    `| Cases | ${result.cases} |`,
    `| Transitions that carry cases | ${details.casesOnTransitions} |`,
    `| Activities in the discovered net | ${result.activities.length} |`,
    `| Discovered net (inductive miner) | ${result.places} places, ${result.transitions} transitions, ${result.arcs} arcs |`,
    '',
    '## Activities',
    '',
    `Expected (transitions that carry cases): ${result.expected.join(', ')}.`,
    '',
    `Discovered: ${result.activities.join(', ')}.`,
    '',
    '## Reproducing it',
    '',
    '```sh',
    'python3 -m venv .venv && .venv/bin/pip install pm4py pandas',
    'PNM_PYTHON=.venv/bin/python pnpm --filter @pnm/io check:pm4py',
    '```',
    '',
  ].join('\n')}`;
}

async function main(): Promise<number> {
  let options: Options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 64;
  }
  const python = process.env['PNM_PYTHON'] ?? 'python3';
  const probe = spawnSync(python, ['-c', 'import pm4py, pandas'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    console.error(
      `pm4py is not available in "${python}". Create a venv with \`python3 -m venv .venv && ` +
        '.venv/bin/pip install pm4py pandas` and set PNM_PYTHON=.venv/bin/python.',
    );
    return 3;
  }

  const net = parseNetText(
    readFileSync(join(root, 'examples', `${options.example}.pn.json`), 'utf8'),
  );
  net.simulation = { ...(net.simulation ?? {}), seed: options.seed };
  const sim = createSimulation(net, { seed: options.seed });
  const events: SimEvent[] = [...sim.initialEvents];
  const seconds = options.hours * 3600;
  for (let t = 0; t < seconds; t += 600) {
    events.push(...(await sim.advance(Math.min(600, seconds - t), { maxEvents: 100_000 })));
  }

  mkdirSync(options.scratch, { recursive: true });
  const csvPath = join(options.scratch, `${options.example}.csv`);
  const xesPath = join(options.scratch, `${options.example}.xes`);
  const expectedPath = join(options.scratch, 'activities.json');
  const outPath = join(options.scratch, 'pm4py-result.json');
  writeFileSync(csvPath, toEventLogCsv(events, net));
  writeFileSync(xesPath, toXes(events, net));
  // The activities that a miner can see: names of transitions with at least one case row.
  const carrying = [...new Set(eventLogRows(events, net).map((row) => row.activity))].sort();
  writeFileSync(expectedPath, JSON.stringify(carrying));

  const run = spawnSync(
    python,
    [
      join(here, 'check-pm4py.py'),
      '--csv',
      csvPath,
      '--xes',
      xesPath,
      '--expected-json',
      expectedPath,
      '--out',
      outPath,
    ],
    { encoding: 'utf8' },
  );
  if (run.status === 3) {
    console.error(run.stderr);
    return 3;
  }
  let result: CheckResult;
  try {
    result = JSON.parse(readFileSync(outPath, 'utf8')) as CheckResult;
  } catch {
    console.error(run.stdout, run.stderr);
    console.error('The Python script did not write a result.');
    return 1;
  }
  for (const check of result.checks) {
    console.log(`${check.passed ? 'PASS' : 'FAIL'}  ${check.name}: ${check.detail}`);
  }
  mkdirSync(options.outDir, { recursive: true });
  const file = join(options.outDir, `pm4py-${options.date}.md`);
  writeFileSync(
    file,
    markdown(options, python, result, {
      events: events.length,
      casesOnTransitions: carrying.length,
    }),
  );
  console.log(`Wrote ${file}`);
  return result.checks.every((c) => c.passed) ? 0 : 1;
}

process.exit(await main());
