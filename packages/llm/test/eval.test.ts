import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { placeRoles } from '@pnm/core';
import { validateDomainView, type DomainView } from '@pnm/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { PROMPT_VERSION } from '../src';
import { parseArgs, repositoryRoot, runEval, type EvalOptions } from '../scripts/eval-lib';
import { EXAMPLE_IDS, loadExample, modelAnswer } from './helpers';

const run = promisify(execFile);
const KEY = 'sk-test-secret-0123';

/** A server that talks like an OpenAI-compatible one and answers with the example views. */
let server: Server;
let baseUrl = '';
let requests: Array<{ authorization: string | undefined; body: Record<string, unknown> }> = [];
const calls = new Map<string, number>();
/** Notes that the simulated model adds to its first answers (N4); `null` for none. */
let notesForNextAnswers: string[] | null = null;

function answerFor(netName: string, repair: boolean): unknown {
  const id = EXAMPLE_IDS.find((x) => loadExample(x).net.name === netName);
  if (!id) return {};
  const { net, view } = loadExample(id);
  const roles = placeRoles(net);
  const place = net.places.find((p) => roles.get(p.id) === 'case')?.id ?? '';
  const station = Object.entries(view.transitions).find(([, t]) => 'box' in t)?.[0] ?? '';
  if (repair) {
    return {
      places: { [place]: view.places[place] },
      transitions: { [station]: view.transitions[station] },
    };
  }
  const answer = modelAnswer(view) as {
    places: Record<string, unknown>;
    transitions: Record<string, unknown>;
    notes?: string[];
  };
  if (notesForNextAnswers) answer.notes = notesForNextAnswers;
  answer.places[place] = { kind: 'slots', of: station };
  answer.transitions[station] = { kind: 'station', box: [view.meta.canvas.width + 5, 0, 40, 40] };
  return answer;
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8');
    });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/v1/chat/completions' && req.method === 'POST') {
        const body = JSON.parse(raw) as { messages: Array<{ content: string }> } & Record<
          string,
          unknown
        >;
        requests.push({ authorization: req.headers.authorization, body });
        const user = body.messages[1]?.content ?? '';
        const name =
          /Write the domain view for the net "([^"]+)"/.exec(user)?.[1] ??
          /"name": "([^"]+)"/.exec(user)?.[1] ??
          '';
        const count = (calls.get(name) ?? 0) + 1;
        calls.set(name, count);
        const content = JSON.stringify(
          answerFor(name, user.includes('## Findings of the checking program')),
        );
        res.end(
          JSON.stringify({
            model: 'sim-model',
            choices: [{ message: { role: 'assistant', content } }],
            usage: { prompt_tokens: 100, completion_tokens: 50 },
          }),
        );
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { message: 'not found' } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'pnm-eval-'));
}

describe('parseArgs', () => {
  it('reads the options and ignores a lone --', () => {
    const parsed = parseArgs(
      [
        '--',
        '--base-url',
        'http://x/v1',
        '--model',
        'm',
        '--rounds',
        '2',
        '--timeout',
        '30',
        '--strict',
        '--examples',
        'a,b',
      ],
      { PNM_LLM_API_KEY: 'from-env' },
    );
    expect(parsed.strict).toBe(true);
    expect(parsed.options).toMatchObject({
      baseUrl: 'http://x/v1',
      model: 'm',
      maxRounds: 2,
      timeoutMs: 30000,
      examples: ['a', 'b'],
      apiKey: 'from-env',
    });
    expect(
      parseArgs(['--base-url', 'u', '--model', 'm', '--api-key', 'k'], { PNM_LLM_API_KEY: 'e' })
        .options.apiKey,
    ).toBe('k');
  });

  it('explains bad input', () => {
    expect(() => parseArgs([])).toThrow(/required/);
    expect(() => parseArgs(['--base-url', 'u'])).toThrow(/required/);
    expect(() => parseArgs(['--model', 'm', '--base-url', 'u', '--bogus', '1'])).toThrow(
      /Unknown option/,
    );
    expect(() => parseArgs(['--model', 'm', '--base-url', 'u', '--rounds', 'x'])).toThrow(/number/);
    expect(() => parseArgs(['--model', 'm', '--base-url', 'u', '--json-mode', 'x'])).toThrow(
      /json-mode/,
    );
    expect(() => parseArgs(['--model'])).toThrow(/needs a value/);
    expect(parseArgs(['--help']).help).toBe(true);
  });
});

describe('evaluation script', () => {
  it('runs both examples against a simulated server and writes the report and the views', async () => {
    requests = [];
    calls.clear();
    const outDir = tempDir();
    const log: string[] = [];
    const outcome = await runEval({
      baseUrl,
      model: 'sim model/1',
      apiKey: KEY,
      examples: [...EXAMPLE_IDS],
      examplesDir: join(repositoryRoot(), 'examples'),
      outDir,
      date: '2026-10-28',
      log: (line) => log.push(line),
    });
    try {
      expect(outcome.rows.map((r) => [r.example, r.passed, r.rounds, r.errorsPerRound])).toEqual([
        ['parcel-center', true, 2, [2, 0]],
        ['smart-office', true, 2, [2, 0]],
      ]);
      expect(readdirSync(outDir).sort()).toEqual([
        'llm-sim-model-1-2026-10-28-parcel-center.json',
        'llm-sim-model-1-2026-10-28-smart-office.json',
        'llm-sim-model-1-2026-10-28.md',
        'llm-sim-model-1-2026-10-28.report.json',
      ]);
      const report = readFileSync(outcome.reportPath, 'utf8');
      expect(report).toContain('| Paketzentrum | PASS | 2 | 2 → 0 |');
      expect(report).toContain('| Smart Office | PASS | 2 | 2 → 0 |');
      expect(report).toContain('V4');
      for (const id of EXAMPLE_IDS) {
        const stored = JSON.parse(
          readFileSync(join(outDir, `llm-sim-model-1-2026-10-28-${id}.json`), 'utf8'),
        ) as DomainView;
        const { net } = loadExample(id);
        expect(
          validateDomainView(net, stored).diagnostics.filter((d) => d.severity === 'error'),
        ).toEqual([]);
      }
      // Progress was printed, findings per round included.
      const text = log.join('\n');
      expect(text).toMatch(/round 1 \(generate.*2 errors/);
      expect(text).toMatch(/round 2 \(repair.*0 errors/);
      expect(text).toContain('=> PASS');
      // The key went to the server, and nowhere else.
      expect(requests.every((r) => r.authorization === `Bearer ${KEY}`)).toBe(true);
      expect(requests).toHaveLength(4);
      for (const file of outcome.files) expect(readFileSync(file, 'utf8')).not.toContain(KEY);
      expect(text).not.toContain(KEY);
      // The net that is evaluated is not among the worked examples of its own prompt.
      const firstUser =
        (requests[0]?.body['messages'] as Array<{ content: string }>)[1]?.content ?? '';
      expect(firstUser.match(/### Example/g)).toHaveLength(1);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('reports a failing server as an error row and still writes the report', async () => {
    const outDir = tempDir();
    try {
      const outcome = await runEval({
        baseUrl: `${baseUrl}/missing`,
        model: 'm',
        examples: ['parcel-center'],
        examplesDir: join(repositoryRoot(), 'examples'),
        outDir,
        date: '2026-10-28',
        log: () => undefined,
      });
      expect(outcome.rows[0]?.error).toMatch(/404|not found/i);
      expect(readFileSync(outcome.reportPath, 'utf8')).toContain('ERROR');
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('works as a command line script, as the package script starts it', async () => {
    requests = [];
    calls.clear();
    const outDir = tempDir();
    const root = join(repositoryRoot(), 'packages', 'llm');
    try {
      const jiti = join(root, 'node_modules', 'jiti', 'lib', 'jiti-cli.mjs');
      expect(existsSync(jiti)).toBe(true);
      const { stdout } = await run(
        process.execPath,
        [
          jiti,
          'scripts/eval.ts',
          '--',
          '--base-url',
          baseUrl,
          '--model',
          'cli-model',
          '--out-dir',
          outDir,
          '--date',
          '2026-10-28',
          '--strict',
        ],
        { cwd: root, timeout: 90_000, env: { ...process.env, PNM_LLM_API_KEY: KEY } },
      );
      expect(stdout).toContain('PASS');
      expect(stdout).toContain('Paketzentrum');
      expect(stdout).not.toContain(KEY);
      expect(existsSync(join(outDir, 'llm-cli-model-2026-10-28.md'))).toBe(true);
      const help = await run(process.execPath, [jiti, 'scripts/eval.ts', '--help'], { cwd: root });
      expect(help.stdout).toContain('--base-url');
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 120_000);
});

const BASE = ['--base-url', 'http://x/v1', '--model', 'm'];

describe('parseArgs, options of N3', () => {
  it('reads --shots as a list or none, and leaves it unset by default', () => {
    expect(parseArgs(BASE).options.shots).toBeUndefined();
    expect(parseArgs([...BASE, '--shots', 'smart-office, bike-frames']).options.shots).toEqual([
      'smart-office',
      'bike-frames',
    ]);
    expect(parseArgs([...BASE, '--shots', 'none']).options.shots).toEqual([]);
    expect(() => parseArgs([...BASE, '--shots', ','])).toThrow(/--shots/);
  });

  it('reads --no-positions and --save-prompts as flags', () => {
    const plain = parseArgs(BASE).options;
    expect(plain.positions).toBeUndefined();
    expect(plain.savePrompts).toBeUndefined();
    const set = parseArgs([...BASE, '--no-positions', '--save-prompts']).options;
    expect(set.positions).toBe(false);
    expect(set.savePrompts).toBe(true);
  });

  it('reads --description more than once, with = inside the text', () => {
    const { options } = parseArgs([
      ...BASE,
      '--description',
      'bike-frames=A factory with a = b',
      '--description',
      'parcel-center=Parcels',
    ]);
    expect(options.descriptions).toEqual({
      'bike-frames': 'A factory with a = b',
      'parcel-center': 'Parcels',
    });
  });

  it('refuses a malformed or doubled --description', () => {
    expect(() => parseArgs([...BASE, '--description', 'no-equals'])).toThrow(/<id>=<text>/);
    expect(() => parseArgs([...BASE, '--description', '=text'])).toThrow(/<id>=<text>/);
    expect(() => parseArgs([...BASE, '--description', 'a='])).toThrow(/<id>=<text>/);
    expect(() => parseArgs([...BASE, '--description', 'a=x', '--description', 'a=y'])).toThrow(
      /"a" is given twice/,
    );
  });

  it('reads --descriptions and --repeat, and refuses a bad count', () => {
    const { options } = parseArgs([...BASE, '--descriptions', 'd.json', '--repeat', '3']);
    expect(options.descriptionsFile).toBe('d.json');
    expect(options.repeat).toBe(3);
    for (const bad of ['0', '1.5', '-1', '101', 'x']) {
      expect(() => parseArgs([...BASE, '--repeat', bad])).toThrow(/--repeat/);
    }
  });
});

function sha(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function firstRequests(): Array<{ system: string; user: string }> {
  return requests.map((r) => {
    const messages = r.body['messages'] as Array<{ content: string }>;
    return { system: messages[0]?.content ?? '', user: messages[1]?.content ?? '' };
  });
}

describe('evaluation script, options of N3', () => {
  async function evaluate(
    extra: Partial<EvalOptions>,
    dir = tempDir(),
  ): Promise<{ dir: string; outcome: Awaited<ReturnType<typeof runEval>> }> {
    requests = [];
    calls.clear();
    const outcome = await runEval({
      baseUrl,
      model: 'sim',
      examples: ['parcel-center'],
      examplesDir: join(repositoryRoot(), 'examples'),
      outDir: dir,
      date: '2026-11-03',
      log: () => undefined,
      ...extra,
    });
    return { dir, outcome };
  }

  it('refuses an unknown net id in --examples, --shots and --description, before any request', async () => {
    requests = [];
    const dir = tempDir();
    try {
      await expect(evaluate({ examples: ['nope'] }, dir)).rejects.toThrow(/--examples.*"nope"/);
      await expect(evaluate({ shots: ['nope'] }, dir)).rejects.toThrow(/--shots.*"nope"/);
      await expect(evaluate({ descriptions: { nope: 'x' } }, dir)).rejects.toThrow(
        /--description.*"nope"/,
      );
      await expect(evaluate({ shots: ['order-processing'] }, dir)).rejects.toThrow(
        /no domain view/,
      );
      expect(requests).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('shows the nets of --shots, never the evaluated net, and none for none', async () => {
    const dir = tempDir();
    try {
      const only = await evaluate({ shots: ['smart-office'], maxRounds: 1 }, dir);
      let first = firstRequests()[0]?.user ?? '';
      expect(first.match(/### Example/g)).toHaveLength(1);
      expect(first).toContain('### Example 1: Smart Office');
      // The evaluated net among the shots is left out, and the same net is given twice only once.
      await evaluate(
        { examples: ['smart-office'], shots: ['smart-office', 'parcel-center'], maxRounds: 1 },
        dir,
      );
      first = firstRequests()[0]?.user ?? '';
      expect(first.match(/### Example/g)).toHaveLength(1);
      expect(first).toContain('### Example 1: Paketzentrum');
      await evaluate({ shots: [], maxRounds: 1 }, dir);
      first = firstRequests()[0]?.user ?? '';
      expect(first).not.toContain('### Example');
      expect(first).not.toContain('Smart Office\n');
      expect(only.outcome.rows[0]?.example).toBe('parcel-center');
      // The default is as before: both examples, minus the net itself.
      await evaluate({ examples: ['bike-frames'], maxRounds: 1 }, dir);
      first = firstRequests()[0]?.user ?? '';
      expect(first.match(/### Example/g)).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sends no positions and no sentence about them with positions: false', async () => {
    const dir = tempDir();
    try {
      await evaluate({ maxRounds: 2 }, dir);
      for (const request of firstRequests()) {
        expect(request.user).toContain('"positions"');
        expect(request.system).toContain('The positions of the net in the editor');
      }
      await evaluate({ positions: false, maxRounds: 2 }, dir);
      expect(firstRequests().length).toBeGreaterThan(1);
      for (const request of firstRequests()) {
        expect(request.user).not.toContain('"positions"');
        expect(request.system).not.toContain('The positions of the net in the editor');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('takes the description from the option, the file, or the built-in sentence, in this order', async () => {
    const dir = tempDir();
    try {
      await evaluate({ maxRounds: 1 }, dir);
      expect(firstRequests()[0]?.user).toContain('A parcel sorting center: parcels arrive');
      const file = join(dir, 'descriptions.json');
      writeFileSync(file, JSON.stringify({ 'parcel-center': 'From the file.' }));
      await evaluate({ maxRounds: 1, descriptionsFile: file }, dir);
      expect(firstRequests()[0]?.user).toContain('From the file.');
      expect(firstRequests()[0]?.user).not.toContain('parcels arrive');
      await evaluate(
        {
          maxRounds: 1,
          descriptionsFile: file,
          descriptions: { 'parcel-center': 'From the option.' },
        },
        dir,
      );
      expect(firstRequests()[0]?.user).toContain('From the option.');
      expect(firstRequests()[0]?.user).not.toContain('From the file.');
      // bike-frames has a built-in sentence now.
      await evaluate({ examples: ['bike-frames'], maxRounds: 1 }, dir);
      expect(firstRequests()[0]?.user).toContain('A bicycle frame factory');
      // A net without one keeps "A process called ...".
      await evaluate({ examples: ['order-processing'], maxRounds: 1 }, dir);
      expect(firstRequests()[0]?.user).toContain('A process called "Order processing"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a descriptions file that is not an object of strings', async () => {
    const dir = tempDir();
    try {
      const file = join(dir, 'bad.json');
      writeFileSync(file, JSON.stringify({ 'parcel-center': 3 }));
      await expect(evaluate({ descriptionsFile: file }, dir)).rejects.toThrow(/must be a string/);
      writeFileSync(file, '[1]');
      await expect(evaluate({ descriptionsFile: file }, dir)).rejects.toThrow(/JSON object/);
      await expect(evaluate({ descriptionsFile: join(dir, 'missing.json') }, dir)).rejects.toThrow(
        /Cannot read/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('generates every net --repeat times and summarizes the runs', async () => {
    const dir = tempDir();
    try {
      const { outcome } = await evaluate({ examples: [...EXAMPLE_IDS], repeat: 3 }, dir);
      expect(outcome.rows).toHaveLength(6);
      expect(outcome.rows.map((r) => [r.example, r.run])).toEqual([
        ['parcel-center', 1],
        ['parcel-center', 2],
        ['parcel-center', 3],
        ['smart-office', 1],
        ['smart-office', 2],
        ['smart-office', 3],
      ]);
      expect(requests).toHaveLength(12);
      const files = readdirSync(dir).sort();
      expect(files).toContain('llm-sim-2026-11-03-parcel-center-run3.json');
      expect(files).toContain('llm-sim-2026-11-03-smart-office-run1.json');
      const report = readFileSync(outcome.reportPath, 'utf8');
      expect(report).toContain('| Paketzentrum #2 | PASS | 2 | 2 → 0 |');
      expect(report).toContain('## Summary of the runs');
      expect(report).toContain('| Paketzentrum | 3 | 3 of 3 (100 %) | 3× 2 |');
      const data = JSON.parse(
        readFileSync(join(dir, 'llm-sim-2026-11-03.report.json'), 'utf8'),
      ) as {
        runs: unknown[];
        summary: Array<{
          example: string;
          runs: number;
          passed: number;
          roundsDistribution: object;
        }>;
      };
      expect(data.runs).toHaveLength(6);
      expect(data.summary[1]).toMatchObject({
        example: 'smart-office',
        runs: 3,
        passed: 3,
        roundsDistribution: { '2': 3 },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps one run without a summary of runs, as before', async () => {
    const dir = tempDir();
    try {
      const { outcome } = await evaluate({}, dir);
      expect(readFileSync(outcome.reportPath, 'utf8')).not.toContain('## Summary of the runs');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes the first request with --save-prompts, and its hashes into the report', async () => {
    const dir = tempDir();
    try {
      const { outcome } = await evaluate({ savePrompts: true, repeat: 2, maxRounds: 2 }, dir);
      const system = readFileSync(
        join(dir, 'llm-sim-2026-11-03-parcel-center-prompt-system.txt'),
        'utf8',
      );
      const user = readFileSync(
        join(dir, 'llm-sim-2026-11-03-parcel-center-prompt-user.txt'),
        'utf8',
      );
      const sent = firstRequests()[0];
      expect(system).toBe(sent?.system);
      expect(user).toBe(sent?.user);
      expect(readdirSync(dir).filter((f) => f.includes('-prompt-'))).toHaveLength(2);
      const report = readFileSync(outcome.reportPath, 'utf8');
      expect(report).toContain(sha(system));
      expect(report).toContain(sha(user));
      const data = JSON.parse(
        readFileSync(join(dir, 'llm-sim-2026-11-03.report.json'), 'utf8'),
      ) as {
        prompts: Array<{ systemSha256: string; userSha256: string; promptVersion: number }>;
      };
      expect(data.prompts).toEqual([
        expect.objectContaining({
          example: 'parcel-center',
          promptVersion: PROMPT_VERSION,
          systemSha256: sha(system),
          userSha256: sha(user),
          shots: ['smart-office'],
        }),
      ]);
      // Without the option, no prompt files.
      const none = await evaluate({ maxRounds: 1 });
      expect(none.outcome.files.some((f) => f.includes('-prompt-'))).toBe(false);
      rmSync(none.dir, { recursive: true, force: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('names the prompt version, the conditions and the similarity in the report', async () => {
    const dir = tempDir();
    try {
      const { outcome } = await evaluate(
        { shots: [], positions: false, repeat: 2, temperature: 0.7, maxRounds: 2 },
        dir,
      );
      const report = readFileSync(outcome.reportPath, 'utf8');
      expect(report).toContain(`Prompt version: ${PROMPT_VERSION}`);
      expect(report).toContain('Worked examples (shots): none (zero-shot)');
      expect(report).toContain('Editor positions sent: no');
      expect(report).toContain('Temperature: 0.7');
      expect(report).toContain('Runs per net: 2');
      expect(report).toContain('## Similarity to the reference view');
      expect(report).toContain('## First request');
      // The answers are the reference view with two mistakes in two entries.
      const data = JSON.parse(
        readFileSync(join(dir, 'llm-sim-2026-11-03.report.json'), 'utf8'),
      ) as {
        conditions: Record<string, unknown>;
        runs: Array<{ similarity: { kindPercent: number; meanDistance: number } }>;
      };
      expect(data.conditions).toMatchObject({
        promptVersion: PROMPT_VERSION,
        shots: [],
        positions: false,
        temperature: 0.7,
        repeat: 2,
        maxRounds: 2,
      });
      for (const run of data.runs) {
        expect(run.similarity.kindPercent).toBe(100);
        expect(run.similarity.meanDistance).toBe(0);
      }
      expect(report).not.toContain(KEY);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runs against the simulated server from the command line with the new options', async () => {
    const dir = tempDir();
    const root = join(repositoryRoot(), 'packages', 'llm');
    try {
      const jiti = join(root, 'node_modules', 'jiti', 'lib', 'jiti-cli.mjs');
      const { stdout } = await run(
        process.execPath,
        [
          jiti,
          'scripts/eval.ts',
          '--base-url',
          baseUrl,
          '--model',
          'cli-model',
          '--out-dir',
          dir,
          '--date',
          '2026-11-03',
          '--shots',
          'none',
          '--no-positions',
          '--repeat',
          '2',
          '--save-prompts',
          '--examples',
          'parcel-center',
        ],
        { cwd: root, timeout: 90_000 },
      );
      expect(stdout).toContain('Paketzentrum #1');
      expect(stdout).toContain('Paketzentrum #2');
      expect(readdirSync(dir)).toContain('llm-cli-model-2026-11-03-parcel-center-prompt-user.txt');
      await expect(
        run(
          process.execPath,
          [
            jiti,
            'scripts/eval.ts',
            '--base-url',
            baseUrl,
            '--model',
            'm',
            '--shots',
            'nope',
            '--out-dir',
            dir,
          ],
          { cwd: root },
        ),
      ).rejects.toMatchObject({ code: 64 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});

describe('evaluation script, the guided way with --choices (N4)', () => {
  const choices = {
    'parcel-center': {
      setting: 'A post office for fairy tales',
      entity: { singular: 'Unicorn', plural: 'Unicorns', emoji: '🦄' },
      stages: { p_scanned: { emoji: '✨' } },
      counters: { p_done: { style: 'pictogram', per: 10, emoji: '🎁' } },
      equipment: 'zones',
      additions: 'Everything is friendly.',
    },
  };

  async function evaluate(extra: Partial<EvalOptions>, dir = tempDir()) {
    requests = [];
    calls.clear();
    const outcome = await runEval({
      baseUrl,
      model: 'sim',
      examples: ['parcel-center'],
      examplesDir: join(repositoryRoot(), 'examples'),
      outDir: dir,
      date: '2026-11-03',
      log: () => undefined,
      ...extra,
    });
    return { dir, outcome };
  }

  function choicesFile(dir: string, content: unknown): string {
    const file = join(dir, 'choices.json');
    writeFileSync(file, JSON.stringify(content));
    return file;
  }

  it('reads --choices', () => {
    const parsed = parseArgs(['--base-url', 'u', '--model', 'm', '--choices', 'c.json']);
    expect(parsed.options.choicesFile).toBe('c.json');
    expect(parseArgs(['--base-url', 'u', '--model', 'm']).options.choicesFile).toBeUndefined();
    expect(() => parseArgs(['--base-url', 'u', '--model', 'm', '--choices'])).toThrow(
      /needs a value/,
    );
  });

  it('sends the choices as binding, applies them, and names the way in the report', async () => {
    const dir = tempDir();
    try {
      const file = choicesFile(dir, choices);
      const { outcome } = await evaluate({ choicesFile: file, maxRounds: 2 }, dir);
      const user = firstRequests()[0]?.user ?? '';
      expect(user).toContain('## Binding choices');
      expect(user).toContain('"emoji" "🦄"');
      expect(user).toContain('A post office for fairy tales. Everything is friendly.');
      expect(user).toContain('Zones and labels');
      const view = JSON.parse(
        readFileSync(join(dir, outcome.rows[0]!.viewFile!), 'utf8'),
      ) as DomainView;
      expect(view.meta.entity).toMatchObject({ emoji: '🦄' });
      expect(view.places['p_scanned']).toMatchObject({ appearance: { emoji: '✨' } });
      expect(view.places['p_done']).toMatchObject({
        display: { style: 'pictogram', per: 10, emoji: '🎁' },
      });
      expect(outcome.rows[0]).toMatchObject({ way: 'guided' });
      const report = readFileSync(outcome.reportPath, 'utf8');
      expect(report).toContain('Way: parcel-center guided');
      expect(report).toContain('Note: Choice applied');
      const data = JSON.parse(
        readFileSync(join(dir, 'llm-sim-2026-11-03.report.json'), 'utf8'),
      ) as { prompts: Array<{ way: string }> };
      expect(data.prompts[0]?.way).toBe('guided');
      // The same net without the file runs the free way.
      const free = await evaluate({ maxRounds: 1 });
      expect(free.outcome.rows[0]).toMatchObject({ way: 'free' });
      expect(firstRequests()[0]?.user).not.toContain('Binding choices');
      rmSync(free.dir, { recursive: true, force: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lists the notes of the model in the report', async () => {
    const dir = tempDir();
    notesForNextAnswers = ['The color pink is not available.'];
    try {
      const { outcome } = await evaluate({ maxRounds: 1 }, dir);
      expect(outcome.rows[0]?.modelNotes).toEqual(['The color pink is not available.']);
      const report = readFileSync(outcome.reportPath, 'utf8');
      expect(report).toContain('Note of the model: The color pink is not available.');
      expect(report).not.toContain('notes');
    } finally {
      notesForNextAnswers = null;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a bad file before the first request', async () => {
    const dir = tempDir();
    try {
      const bad: Array<[unknown, RegExp]> = [
        [{ 'smart-office': {} }, /not one of the evaluated nets/],
        [
          { 'parcel-center': { stages: { p_done: { emoji: '🦄' } } } },
          /not a place that holds cases/,
        ],
        [
          { 'parcel-center': { counters: { p_in: { style: 'fill' } } } },
          /not a place of an amount/,
        ],
        [{ 'parcel-center': { entity: { singular: 'A', plural: 'As', emoji: 'ab' } } }, /V12/],
        [{ 'parcel-center': { layout: 'diagonal' } }, /invalid at layout/],
        [
          { 'parcel-center': { counters: { p_done: { style: 'fill', max: -1 } } } },
          /invalid at counters/,
        ],
        [[], /must be a JSON object/],
      ];
      for (const [content, message] of bad) {
        await expect(evaluate({ choicesFile: choicesFile(dir, content) }, dir)).rejects.toThrow(
          message,
        );
      }
      await expect(evaluate({ choicesFile: join(dir, 'missing.json') }, dir)).rejects.toThrow(
        /Cannot read the choices file/,
      );
      expect(requests).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
