import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SECRET_KEY,
  example,
  json,
  postJson,
  startApp,
  startWithFake,
  type RunningWithLlm,
} from './helpers';

let running: RunningWithLlm | undefined;
afterEach(async () => {
  await running?.stop();
  running = undefined;
});

const net = (): Record<string, unknown> =>
  JSON.parse(readFileSync(example('traffic-light'), 'utf8')) as Record<string, unknown>;

describe('POST /api/v1/domain/generate', () => {
  it('asks the model of the server and returns the net with a checked view and the record', async () => {
    running = await startWithFake({ fake: { apiKey: SECRET_KEY }, base: '/api' });
    const { url, fake, logs } = running;
    const response = await postJson(url, '/api/v1/domain/generate', {
      net: net(),
      description: 'A crossing in town with a pedestrian light.',
      model: 'fake-model',
      rounds: 2,
    });
    expect(response.status).toBe(200);
    const body = await json(response);
    // The fake answers with text that is no view, so the generic view is used.
    expect(body['fellBack']).toBe(true);
    expect(body['model']).toBe('fake-model');
    expect(body['net']['domainView']).toBeDefined();
    expect(body['net']['domainViewGeneration']).toMatchObject({
      model: 'fake-model',
      baseUrl: 'http://localhost:8080/llm/v1',
      description: 'A crossing in town with a pedestrian light.',
    });
    expect(body['rounds'].length).toBeGreaterThanOrEqual(1);
    // The view passes the rules.
    const check = await json(await postJson(url, '/api/v1/domain/check', { net: body['net'] }));
    expect(check['ok']).toBe(true);

    // The requests to the model carried the key; nothing that came back shows it.
    expect(fake.requests.length).toBeGreaterThanOrEqual(1);
    expect(fake.requests.every((r) => r.headers.authorization === `Bearer ${SECRET_KEY}`)).toBe(
      true,
    );
    expect(JSON.stringify(body)).not.toContain(SECRET_KEY);
    expect(JSON.stringify(body)).not.toContain(fake.url);
    const text = logs.lines.join('\n');
    expect(text).not.toContain(SECRET_KEY);
    expect(text).not.toContain('pedestrian light');
    const entries = logs.entries().filter((e) => e['msg'] === 'llm');
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0]).toMatchObject({ model: 'fake-model', status: 200 });
  });

  it('uses the default model and takes the net as PNML as well', async () => {
    running = await startWithFake({ env: { PNM_LLM_MODELS: 'fake-model-large,fake-model' } });
    const { url, fake } = running;
    const pnml = await (
      await postJson(url, '/api/v1/convert', { net: net(), format: 'pnml' })
    ).text();
    const response = await postJson(url, '/api/v1/domain/generate', {
      net: pnml,
      description: 'A crossing.',
      rounds: 1,
    });
    expect(response.status).toBe(200);
    expect((fake.requests.at(-1)?.body as { model: string }).model).toBe('fake-model-large');
  });

  it('refuses a model that the server does not offer', async () => {
    running = await startWithFake({ env: { PNM_LLM_MODELS: 'fake-model' } });
    const { url, fake } = running;
    const response = await postJson(url, '/api/v1/domain/generate', {
      net: net(),
      description: 'x',
      model: 'fake-model-large',
    });
    expect(response.status).toBe(403);
    expect(fake.requests).toEqual([]);
  });

  it('needs a description and a model', async () => {
    running = await startWithFake();
    const { url } = running;
    expect((await postJson(url, '/api/v1/domain/generate', { net: net() })).status).toBe(400);
    expect(
      (await postJson(url, '/api/v1/domain/generate', { net: net(), description: '   ' })).status,
    ).toBe(400);
    const noModel = await postJson(url, '/api/v1/domain/generate', {
      net: net(),
      description: 'x',
    });
    expect(noModel.status).toBe(400);
    expect((await json(noModel))['error']['message']).toContain('model');
  });

  it('is unavailable without a language model', async () => {
    const app = await startApp();
    try {
      const response = await postJson(app.url, '/api/v1/domain/generate', {
        net: net(),
        description: 'x',
        model: 'm',
      });
      expect(response.status).toBe(503);
      expect(await json(response)).toMatchObject({ error: { code: 'unavailable' } });
    } finally {
      await app.stop();
    }
  });

  it('tells the operator, not the client, about a refused key', async () => {
    running = await startWithFake({
      fake: { apiKey: SECRET_KEY },
      env: { PNM_LLM_API_KEY: 'wrong-key-value' },
    });
    const response = await postJson(running.url, '/api/v1/domain/generate', {
      net: net(),
      description: 'x',
      model: 'fake-model',
    });
    expect(response.status).toBe(502);
    const text = JSON.stringify(await response.json());
    expect(text).toContain('Tell the operator');
    expect(text).not.toContain('wrong-key-value');
  });

  it('says that the model could not be reached without giving its address', async () => {
    const app = await startApp({ PNM_LLM_BASE_URL: 'http://127.0.0.1:9/v1' });
    try {
      const response = await postJson(app.url, '/api/v1/domain/generate', {
        net: net(),
        description: 'x',
        model: 'm',
      });
      expect(response.status).toBe(502);
      expect(JSON.stringify(await response.json())).not.toContain('127.0.0.1');
    } finally {
      await app.stop();
    }
  });

  it('waits for a slot like every other request and counts against the same limits', async () => {
    running = await startWithFake({ env: { PNM_LLM_CONCURRENCY: '1', PNM_LLM_QUEUE: '0' } });
    const { url, app } = running;
    const slow = postJson(url, '/llm/v1/chat/completions', {
      model: 'slow-600',
      messages: [{ role: 'user', content: 'x' }],
    });
    const until = Date.now() + 3000;
    while (app.llm.queue.running === 0 && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const response = await postJson(url, '/api/v1/domain/generate', {
      net: net(),
      description: 'x',
      model: 'fake-model',
      rounds: 1,
    });
    // The first round of the generation finds the language model busy and the queue full.
    expect(response.status).toBe(429);
    expect((await slow).status).toBe(200);
  });
});
