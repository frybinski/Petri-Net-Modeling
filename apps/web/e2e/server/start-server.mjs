// Starts what the end-to-end tests of the server mode need: the real server process
// (apps/server/dist/server.js) with the built web app, and the stand-in for the language model
// server (apps/server/dist/fake-llm.js) behind it. Playwright runs this as a web server (see
// playwright.config.ts) and stops it with SIGTERM when the run is over.
//
//   PNM_E2E_SERVER_PORT   port of the server (default: PNM_E2E_PORT + 1000, else 6173)
//   PNM_E2E_LLM_PORT      port of the stand-in (default: the server port + 1)
//   PNM_E2E_SKIP_BUILD    set to 1 to use the web app and the server as they are built
//
// The data folder is a temporary one and is removed at the end. The key of the stand-in is a
// placeholder; the tests check that it never reaches the browser.

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '..', '..', '..', '..');
const devPort = Number(process.env.PNM_E2E_PORT ?? 5173);
const port = Number(process.env.PNM_E2E_SERVER_PORT ?? devPort + 1000);
const llmPort = Number(process.env.PNM_E2E_LLM_PORT ?? port + 1);
const LLM_KEY = 'e2e-placeholder-key-not-a-secret';

if (process.env.PNM_E2E_SKIP_BUILD !== '1') {
  for (const filter of ['@pnm/web', '@pnm/server']) {
    const result = spawnSync('pnpm', ['--filter', filter, 'build'], {
      cwd: repo,
      stdio: 'inherit',
    });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}

const data = mkdtempSync(join(tmpdir(), 'pnm-e2e-'));
const children = [];

function start(name, args, env) {
  const child = spawn(process.execPath, args, {
    env: { PATH: process.env.PATH, ...env },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  child.on('exit', (code) => {
    if (!stopping) {
      console.error(`${name} ended with status ${code}`);
      stop(1);
    }
  });
  children.push(child);
}

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => {
    rmSync(data, { recursive: true, force: true });
    process.exit(code);
  }, 600).unref();
}
process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));

start('fake LLM server', [join(repo, 'apps', 'server', 'dist', 'fake-llm.js')], {
  FAKE_LLM_PORT: String(llmPort),
  FAKE_LLM_KEY: LLM_KEY,
});

start('server', [join(repo, 'apps', 'server', 'dist', 'server.js')], {
  PNM_PORT: String(port),
  PNM_BIND_ADDRESS: '127.0.0.1',
  PNM_PUBLIC_URL: `http://localhost:${port}`,
  PNM_SERVER_NAME: 'e2e-server',
  PNM_WEB_DIR: join(repo, 'apps', 'web', 'dist'),
  PNM_DATA_DIR: data,
  PNM_LLM_BASE_URL: `http://127.0.0.1:${llmPort}/api`,
  PNM_LLM_API_KEY: LLM_KEY,
  PNM_LLM_MODELS: 'fake-model,fake-model-large',
  PNM_ALLOWED_NETS: '0.0.0.0/0,::/0',
});
