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
import { parseArgs, repositoryRoot, runEval } from '../scripts/eval-lib';
import { EXAMPLE_IDS, loadExample, modelAnswer } from './helpers';

const run = promisify(execFile);
const KEY = 'sk-test-secret-0123';

/** A server that talks like an OpenAI-compatible one and answers with the example views. */
let server: Server;
let baseUrl = '';
let requests: Array<{ authorization: string | undefined; body: Record<string, unknown> }> = [];
const calls = new Map<string, number>();

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
  };
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
