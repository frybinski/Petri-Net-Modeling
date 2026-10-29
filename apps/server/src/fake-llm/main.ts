import { startFakeLlm } from './server';

/**
 * Starts the stand-in for the language model server: `node fake-llm.js`. It is for trying the
 * server without a GPU (deploy/compose.local.yaml) and for the end-to-end tests.
 *
 *   FAKE_LLM_PORT   port, default 11434
 *   FAKE_LLM_HOST   address to listen on, default 127.0.0.1 (0.0.0.0 inside a container)
 *   FAKE_LLM_KEY    if set, requests need this bearer token
 */
const port = Number(process.env['FAKE_LLM_PORT'] ?? 11434);
const host = process.env['FAKE_LLM_HOST'] ?? '127.0.0.1';
const key = process.env['FAKE_LLM_KEY'];
const fake = await startFakeLlm(
  { ...(key !== undefined && key !== '' && { apiKey: key }) },
  port,
  host,
);
process.stdout.write(`fake LLM server listening on ${host}:${fake.port} (/v1 and /api)\n`);
const stop = (): void => {
  void fake.close().then(() => process.exit(0));
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
