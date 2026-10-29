import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { createBasicAuth, parseAccounts } from '../src/basic-auth';
import { FIXTURE_WEB, SERVER_BUNDLE, freePort, tempDir } from './helpers';
import { join } from 'node:path';

const FAKE_BUNDLE = join(SERVER_BUNDLE, '..', 'fake-llm.js');

interface Run {
  child: ChildProcess;
  stdout: () => string;
  stderr: () => string;
  exit: Promise<number | null>;
}

const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
});

function run(args: string[], env: Record<string, string>, stdin?: string): Run {
  const child = spawn(process.execPath, [SERVER_BUNDLE, ...args], {
    env: { PATH: process.env['PATH'] ?? '', ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  children.push(child);
  let out = '';
  let err = '';
  child.stdout.on('data', (chunk: Buffer) => {
    out += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk: Buffer) => {
    err += chunk.toString('utf8');
  });
  child.stdin.on('error', () => undefined);
  child.stdin.end(stdin ?? '');
  const exit = new Promise<number | null>((resolve) => {
    child.on('close', resolve);
  });
  return { child, stdout: () => out, stderr: () => err, exit };
}

async function waitFor(check: () => boolean, what: string): Promise<void> {
  const until = Date.now() + 15_000;
  while (!check()) {
    if (Date.now() > until) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('the bundled server', () => {
  it('prints its version and a help text', async () => {
    const version = run(['--version'], {});
    expect(await version.exit).toBe(0);
    expect(version.stdout()).toMatch(/^\d+\.\d+\.\d+/);
    const help = run(['--help'], {});
    expect(await help.exit).toBe(0);
    expect(help.stdout()).toContain('PNM_*');
    const unknown = run(['frobnicate'], {});
    expect(await unknown.exit).toBe(2);
  });

  it('refuses to start without a public address and says why', async () => {
    const result = run([], {});
    expect(await result.exit).toBe(78);
    expect(result.stderr()).toContain('PNM_PUBLIC_URL is required');
    expect(result.stdout()).toBe('');
  });

  it('prints the settings with check-config, without the key', async () => {
    const result = run(['check-config'], {
      PNM_PUBLIC_URL: 'https://pnm.example.org',
      PNM_LLM_BASE_URL: 'http://llm:11434/v1',
      PNM_LLM_API_KEY: 'placeholder-secret-value',
    });
    expect(await result.exit).toBe(0);
    expect(result.stdout()).toContain('pnm.example.org');
    expect(result.stdout()).not.toContain('placeholder-secret-value');
  });

  it('makes an entry for PNM_BASIC_AUTH from a password on standard input', async () => {
    const result = run(['hash-password', 'alice'], {}, 'correct horse\n');
    expect(await result.exit).toBe(0);
    const entry = result.stdout().trim();
    expect(entry).toMatch(/^alice:scrypt:/);
    const auth = createBasicAuth(parseAccounts(entry));
    expect(auth.check(`Basic ${Buffer.from('alice:correct horse').toString('base64')}`)).toBe(true);
    const missing = run(['hash-password'], {});
    expect(await missing.exit).toBe(2);
  });

  it('rejects a port outside 1 to 65535', async () => {
    const result = run([], { PNM_PUBLIC_URL: 'http://localhost', PNM_PORT: '0' });
    expect(await result.exit).toBe(78);
    expect(result.stderr()).toContain('PNM_PORT');
  });

  it('serves, logs one JSON line per request and stops within the grace time on SIGTERM', async () => {
    const scratch = tempDir();
    const port = await freePort();
    try {
      const result = run([], {
        PNM_PUBLIC_URL: `http://127.0.0.1:${port}`,
        PNM_PORT: String(port),
        PNM_BIND_ADDRESS: '127.0.0.1',
        PNM_WEB_DIR: FIXTURE_WEB,
        PNM_DATA_DIR: scratch.dir,
      });
      await waitFor(() => result.stdout().includes('"msg":"listening"'), 'the server to listen');
      const health = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(health.status).toBe(200);
      result.child.kill('SIGTERM');
      const started = Date.now();
      expect(await result.exit).toBe(0);
      expect(Date.now() - started).toBeLessThan(5000);
      const lines = result
        .stdout()
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(lines.map((l) => l['msg'])).toEqual(
        expect.arrayContaining(['listening', 'request', 'stopping', 'stopped']),
      );
      expect(lines.every((l) => typeof l['time'] === 'string')).toBe(true);
    } finally {
      scratch.cleanup();
    }
  });
});

describe('the bundled stand-in for the language model server', () => {
  it('lists models and answers a chat request, with a key if one is set', async () => {
    const port = await freePort();
    const child = spawn(process.execPath, [FAKE_BUNDLE], {
      env: {
        PATH: process.env['PATH'] ?? '',
        FAKE_LLM_PORT: String(port),
        FAKE_LLM_KEY: 'placeholder',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });
    await waitFor(() => out.includes('listening'), 'the fake server to listen');
    const base = `http://127.0.0.1:${port}`;
    expect((await fetch(`${base}/v1/models`)).status).toBe(401);
    const auth = { Authorization: 'Bearer placeholder' };
    const models = (await (await fetch(`${base}/api/models`, { headers: auth })).json()) as {
      data: Array<{ id: string }>;
    };
    expect(models.data.map((m) => m.id)).toContain('fake-model');
    const chat = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'fake-model', messages: [{ role: 'user', content: 'Hi' }] }),
    });
    expect(chat.status).toBe(200);
    child.kill('SIGTERM');
  });
});
