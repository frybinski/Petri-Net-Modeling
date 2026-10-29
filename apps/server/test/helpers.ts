import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, type App, type AppDeps } from '../src/app';
import { loadConfig, type Config } from '../src/config';
import { startFakeLlm, type FakeLlm, type FakeLlmOptions } from '../src/fake-llm/server';
import { createLogger, type Logger } from '../src/logger';

const here = dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = resolve(here, '..');
export const REPO = resolve(SERVER_ROOT, '..', '..');
export const FIXTURE_WEB = join(here, 'fixtures', 'web');
export const SERVER_BUNDLE = join(SERVER_ROOT, 'dist', 'server.js');
export const WORKER_BUNDLE = join(SERVER_ROOT, 'dist', 'worker.js');
export const example = (name: string): string => join(REPO, 'examples', `${name}.pn.json`);

/** A placeholder for a key in tests; it must never show up in an answer or a log line. */
export const SECRET_KEY = 'sk-test-0123456789-must-not-leak';

export function tempDir(): { dir: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'pnm-server-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** The settings of a test server: loopback, a fixture web folder, an empty data folder. */
export function testConfig(
  dataDir: string,
  overrides: Record<string, string | undefined> = {},
): Config {
  return loadConfig({
    PNM_PUBLIC_URL: 'http://localhost:8080',
    PNM_PORT: '1',
    PNM_BIND_ADDRESS: '127.0.0.1',
    PNM_WEB_DIR: FIXTURE_WEB,
    PNM_DATA_DIR: dataDir,
    ...overrides,
  });
}

export interface LogCapture extends Logger {
  lines: string[];
  entries(): Array<Record<string, unknown>>;
}

export function captureLogs(): LogCapture {
  const lines: string[] = [];
  const logger = createLogger({
    write: (line) => lines.push(line),
    level: 'debug',
  });
  return {
    ...logger,
    lines,
    entries: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

export interface RunningApp {
  app: App;
  config: Config;
  /** `http://127.0.0.1:<port>` */
  url: string;
  logs: LogCapture;
  data: string;
  stop(): Promise<void>;
}

/** Starts the application in this process on a free port. */
export async function startApp(
  overrides: Record<string, string | undefined> = {},
  deps: AppDeps = {},
): Promise<RunningApp> {
  const scratch = tempDir();
  const logs = captureLogs();
  const config = testConfig(scratch.dir, { ...overrides, PNM_PORT: overrides['PNM_PORT'] ?? '1' });
  const app = createApp({ ...config, port: 0 }, { logger: logs, ...deps });
  const port = await app.start();
  return {
    app,
    config,
    url: `http://127.0.0.1:${port}`,
    logs,
    data: scratch.dir,
    async stop() {
      await app.close(500);
      scratch.cleanup();
    },
  };
}

/** A port that is free right now. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

export interface RunningWithLlm extends RunningApp {
  fake: FakeLlm;
}

/**
 * Starts a fake language model server and the application in front of it. `base` is the part of
 * the fake's address that the application is given (`/v1` for Ollama, `/api` for Open WebUI).
 */
export async function startWithFake(
  options: {
    fake?: FakeLlmOptions;
    base?: '/v1' | '/api';
    env?: Record<string, string | undefined>;
  } = {},
): Promise<RunningWithLlm> {
  const fake = await startFakeLlm(options.fake ?? {});
  const running = await startApp({
    PNM_LLM_BASE_URL: `${fake.url}${options.base ?? '/v1'}`,
    ...(options.fake?.apiKey !== undefined && { PNM_LLM_API_KEY: options.fake.apiKey }),
    ...options.env,
  });
  return {
    ...running,
    fake,
    async stop() {
      await running.stop();
      await fake.close();
    },
  };
}

/** A chat request body for the proxy. */
export function chatBody(model: string, content = 'Say hello', extra: object = {}): string {
  return JSON.stringify({ model, messages: [{ role: 'user', content }], ...extra });
}

export const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;
