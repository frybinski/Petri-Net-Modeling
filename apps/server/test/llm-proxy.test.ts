import { createProvider } from '@pnm/llm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  JSON_HEADERS,
  SECRET_KEY,
  chatBody,
  startApp,
  startWithFake,
  type RunningWithLlm,
} from './helpers';

let running: RunningWithLlm | undefined;
afterEach(async () => {
  await running?.stop();
  running = undefined;
});

async function start(options: Parameters<typeof startWithFake>[0] = {}): Promise<RunningWithLlm> {
  running = await startWithFake(options);
  return running;
}

function post(url: string, body: string, headers: Record<string, string> = JSON_HEADERS) {
  return fetch(`${url}/llm/v1/chat/completions`, { method: 'POST', headers, body });
}

describe('path mapping', () => {
  it('maps to /v1 for an Ollama style base URL', async () => {
    const { url, fake } = await start({ base: '/v1' });
    const chat = await post(url, chatBody('fake-model'));
    expect(chat.status).toBe(200);
    const models = await fetch(`${url}/llm/v1/models`);
    expect(models.status).toBe(200);
    expect(fake.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'POST /v1/chat/completions',
      'GET /v1/models',
    ]);
  });

  it('maps to /api for Open WebUI (…/api/chat/completions and …/api/models)', async () => {
    const { url, fake } = await start({ base: '/api' });
    expect((await post(url, chatBody('fake-model'))).status).toBe(200);
    expect((await fetch(`${url}/llm/v1/models`)).status).toBe(200);
    expect(fake.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'POST /api/chat/completions',
      'GET /api/models',
    ]);
  });

  it('copes with a trailing slash in the base URL', async () => {
    const fake = await (await import('../src/fake-llm/server')).startFakeLlm();
    const app = await startApp({ PNM_LLM_BASE_URL: `${fake.url}/api///` });
    try {
      expect((await fetch(`${app.url}/llm/v1/models`)).status).toBe(200);
      expect(fake.requests[0]?.path).toBe('/api/models');
    } finally {
      await app.stop();
      await fake.close();
    }
  });

  it('answers like OpenAI: the chat answer and a plain model list', async () => {
    const { url } = await start();
    const chat = (await (await post(url, chatBody('fake-model', 'Hi'))).json()) as {
      choices: Array<{ message: { content: string } }>;
      usage: { prompt_tokens: number };
    };
    expect(chat.choices[0]?.message.content).toBe('Fake answer to: Hi');
    expect(chat.usage.prompt_tokens).toBeGreaterThan(0);
    expect(await (await fetch(`${url}/llm/v1/models`)).json()).toEqual({
      object: 'list',
      data: [
        { id: 'fake-model', object: 'model', owned_by: 'server' },
        { id: 'fake-model-large', object: 'model', owned_by: 'server' },
      ],
    });
  });

  it('works with the provider of the app, which is what the web app uses', async () => {
    const { url } = await start({ base: '/api' });
    const provider = createProvider({ baseUrl: `${url}/llm/v1`, model: 'fake-model' });
    expect(await provider.listModels()).toEqual(['fake-model', 'fake-model-large']);
    const result = await provider.chat({ system: 'You help.', user: 'Hello there' });
    expect(result.text).toBe('Fake answer to: Hello there');
    expect(result.usage).toEqual({ prompt: expect.any(Number), completion: expect.any(Number) });
    expect((await provider.test()).ok).toBe(true);
  });
});

describe('only two endpoints', () => {
  it('answers everything else with 404 and never asks the upstream', async () => {
    const { url, fake } = await start();
    for (const [method, path] of [
      ['GET', '/llm/v1/embeddings'],
      ['POST', '/llm/v1/embeddings'],
      ['GET', '/llm/v1/models/fake-model'],
      ['GET', '/llm/api/tags'],
      ['POST', '/llm/v1/api/pull'],
      ['DELETE', '/llm/v1/models'],
      ['GET', '/llm/v1/chat/completions/../models'],
      ['GET', '/llm/v1/'],
      ['GET', '/llm'],
    ] as const) {
      const response = await fetch(`${url}${path}`, {
        method,
        ...(method === 'POST' && { headers: JSON_HEADERS, body: '{}' }),
      });
      expect([404, 405], `${method} ${path}`).toContain(response.status);
    }
    expect(fake.requests).toEqual([]);
  });

  it('answers a wrong method on the two paths with 405', async () => {
    const { url } = await start();
    expect((await fetch(`${url}/llm/v1/chat/completions`)).status).toBe(405);
    expect(
      (await fetch(`${url}/llm/v1/models`, { method: 'POST', headers: JSON_HEADERS, body: '{}' }))
        .status,
    ).toBe(405);
  });
});

describe('the key', () => {
  it('is added as a bearer token and never given to a client', async () => {
    const { url, fake, logs } = await start({ fake: { apiKey: SECRET_KEY } });
    const chat = await post(url, chatBody('fake-model'));
    expect(chat.status).toBe(200);
    const models = await fetch(`${url}/llm/v1/models`);
    expect(models.status).toBe(200);
    expect(fake.requests.every((r) => r.headers.authorization === `Bearer ${SECRET_KEY}`)).toBe(
      true,
    );
    const everything = [
      JSON.stringify([...chat.headers]),
      await chat.text(),
      JSON.stringify([...models.headers]),
      await models.text(),
      logs.lines.join('\n'),
    ].join('\n');
    expect(everything).not.toContain(SECRET_KEY);
  });

  it('replaces it in an answer that repeats it, in a success and in an error', async () => {
    const { url, logs } = await start({ fake: { apiKey: SECRET_KEY } });
    const leak = await post(url, chatBody('leak'));
    expect(leak.status).toBe(200);
    const text = await leak.text();
    expect(text).toContain('Authorization was: Bearer ***');
    expect(text).not.toContain(SECRET_KEY);
    const error = await post(url, chatBody('leak-error'));
    expect(error.status).toBe(400);
    const body = await error.text();
    expect(body).not.toContain(SECRET_KEY);
    expect(body).toContain('***');
    expect(logs.lines.join('\n')).not.toContain(SECRET_KEY);
  });

  it('is not needed from the client, and what the client sends is not passed on', async () => {
    const { url, fake } = await start({ fake: { apiKey: SECRET_KEY } });
    const response = await post(url, chatBody('fake-model'), {
      ...JSON_HEADERS,
      Authorization: 'Bearer client-supplied-token',
      Cookie: 'session=abc',
      'X-Forwarded-For': '1.2.3.4',
    });
    expect(response.status).toBe(200);
    const seen = fake.requests[0]?.headers;
    expect(seen?.authorization).toBe(`Bearer ${SECRET_KEY}`);
    expect(seen?.cookie).toBeUndefined();
    expect(seen?.['x-forwarded-for']).toBeUndefined();
  });

  it('tells the operator, not the client, when the upstream refuses the key', async () => {
    const { url, logs } = await start({
      fake: { apiKey: SECRET_KEY },
      env: { PNM_LLM_API_KEY: 'wrong-key-value' },
    });
    const response = await post(url, chatBody('fake-model'));
    // 502, not 401: the person at the browser did nothing wrong and must not be asked to log in.
    expect(response.status).toBe(502);
    expect(response.headers.get('www-authenticate')).toBeNull();
    expect(await response.json()).toMatchObject({ error: { code: 'bad_gateway' } });
    expect(
      logs
        .entries()
        .some((e) => e['level'] === 'error' && e['msg'] === 'llm upstream refused the key'),
    ).toBe(true);
    const models = await fetch(`${url}/llm/v1/models`);
    expect(models.status).toBe(502);
  });
});

describe('what is passed on', () => {
  it('forwards the known fields and drops the rest', async () => {
    const { url, fake } = await start();
    const response = await post(
      url,
      chatBody('fake-model', 'x', {
        temperature: 0.1,
        max_tokens: 50,
        response_format: { type: 'json_object' },
        tools: [{ type: 'function' }],
        tool_ids: ['code_interpreter'],
        files: [{ id: 'f' }],
        features: { web_search: true },
        n: 5,
        user: 'someone',
      }),
    );
    expect(response.status).toBe(200);
    expect(Object.keys(fake.requests[0]?.body as object).sort()).toEqual([
      'max_tokens',
      'messages',
      'model',
      'response_format',
      'temperature',
    ]);
  });

  it('uses the default model when the request names none', async () => {
    const { url, fake } = await start({ env: { PNM_LLM_MODELS: 'fake-model-large' } });
    const response = await post(
      url,
      JSON.stringify({ messages: [{ role: 'user', content: 'x' }] }),
    );
    expect(response.status).toBe(200);
    expect((fake.requests[0]?.body as { model: string }).model).toBe('fake-model-large');
  });
});

describe('the list of models', () => {
  it('shows only the allowed ones that the upstream has', async () => {
    const { url } = await start({ env: { PNM_LLM_MODELS: 'fake-model-large,not-installed' } });
    const list = (await (await fetch(`${url}/llm/v1/models`)).json()) as {
      data: Array<{ id: string }>;
    };
    expect(list.data.map((m) => m.id)).toEqual(['fake-model-large']);
  });

  it('refuses a model that is not on the list, without asking the upstream', async () => {
    const { url, fake } = await start({ env: { PNM_LLM_MODELS: 'fake-model' } });
    const response = await post(url, chatBody('fake-model-large'));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: 'forbidden', details: { models: ['fake-model'] } },
    });
    expect(fake.requests).toEqual([]);
    expect((await post(url, chatBody('fake-model'))).status).toBe(200);
  });
});

describe('bad requests', () => {
  it('wants JSON with the right content type', async () => {
    const { url, fake } = await start();
    expect((await post(url, chatBody('fake-model'), { 'Content-Type': 'text/plain' })).status).toBe(
      415,
    );
    expect((await post(url, chatBody('fake-model'), {})).status).toBe(415);
    expect((await post(url, '{not json')).status).toBe(400);
    expect((await post(url, '[]')).status).toBe(400);
    expect((await post(url, JSON.stringify({ model: 'fake-model' }))).status).toBe(400);
    expect((await post(url, JSON.stringify({ model: 'fake-model', messages: [] }))).status).toBe(
      400,
    );
    expect(fake.requests).toEqual([]);
  });

  it('refuses a request over the size limit', async () => {
    const { url, fake } = await start({ env: { PNM_LLM_MAX_BODY: '64kb' } });
    const big = chatBody('fake-model', 'x'.repeat(200_000));
    const response = await post(url, big);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: 'payload_too_large' } });
    expect(fake.requests).toEqual([]);
  });

  it('is off without an upstream', async () => {
    const app = await startApp();
    try {
      const chat = await post(app.url, chatBody('m'));
      expect(chat.status).toBe(503);
      expect(await chat.json()).toMatchObject({ error: { code: 'unavailable' } });
      expect((await fetch(`${app.url}/llm/v1/models`)).status).toBe(503);
    } finally {
      await app.stop();
    }
  });
});

describe('errors of the upstream', () => {
  it('passes on a model that is not there, with its reason', async () => {
    const { url } = await start();
    const response = await post(url, chatBody('unknown-model'));
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain("model 'unknown-model' not found");
  });

  it('makes a server error a 502', async () => {
    const { url } = await start();
    const response = await post(url, chatBody('status-500'));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: 'bad_gateway' } });
  });

  it('passes on 429 with Retry-After', async () => {
    const { url } = await start();
    const response = await post(url, chatBody('status-429'));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBeTruthy();
  });

  it('answers 502 when the upstream cannot be reached, without its address', async () => {
    const app = await startApp({ PNM_LLM_BASE_URL: 'http://127.0.0.1:9/v1' });
    try {
      const response = await post(app.url, chatBody('m'));
      expect(response.status).toBe(502);
      const text = await response.text();
      expect(text).not.toContain('127.0.0.1');
    } finally {
      await app.stop();
    }
  });

  it('gives up after the time limit with 504', async () => {
    const { url } = await start({ env: { PNM_LLM_TIMEOUT: '0.3' } });
    const started = Date.now();
    const response = await post(url, chatBody('hang'));
    expect(response.status).toBe(504);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(await response.json()).toMatchObject({ error: { code: 'timeout' } });
  });
});

describe('the queue', () => {
  it('runs two at a time, lets the next ones wait and refuses beyond the queue with 429', async () => {
    const { url } = await start({ env: { PNM_LLM_QUEUE: '2' } });
    const started = Date.now();
    const call = async (): Promise<{ status: number; at: number }> => {
      const response = await post(url, chatBody('slow-400'));
      await response.text();
      return { status: response.status, at: Date.now() - started };
    };
    const first = [call(), call()];
    await new Promise((resolve) => setTimeout(resolve, 80));
    const second = [call(), call()];
    await new Promise((resolve) => setTimeout(resolve, 80));
    const refused = await call();
    expect(refused.status).toBe(429);
    expect(refused.at).toBeLessThan(300);

    const results = await Promise.all([...first, ...second]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    // Two ran at once (done after ~400 ms), the other two waited for them (done after ~800 ms).
    expect(results[0]?.at).toBeLessThan(700);
    expect(results[1]?.at).toBeLessThan(700);
    expect(results[2]?.at).toBeGreaterThanOrEqual(700);
    expect(results[3]?.at).toBeGreaterThanOrEqual(700);
  });

  it('frees the slot of a client that went away', async () => {
    const { url, app } = await start({ env: { PNM_LLM_CONCURRENCY: '1', PNM_LLM_QUEUE: '1' } });
    const controller = new AbortController();
    const hanging = fetch(`${url}/llm/v1/chat/completions`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: chatBody('hang'),
      signal: controller.signal,
    }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(app.llm.queue.running).toBe(1);
    controller.abort();
    await hanging;
    const until = Date.now() + 3000;
    while (app.llm.queue.running > 0 && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(app.llm.queue.running).toBe(0);
    expect((await post(url, chatBody('fake-model'))).status).toBe(200);
  });

  it('drops a waiting request whose client went away', async () => {
    const { url, app } = await start({ env: { PNM_LLM_CONCURRENCY: '1', PNM_LLM_QUEUE: '5' } });
    const hold = post(url, chatBody('slow-500'));
    await new Promise((resolve) => setTimeout(resolve, 80));
    const controller = new AbortController();
    const waiting = fetch(`${url}/llm/v1/chat/completions`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: chatBody('fake-model'),
      signal: controller.signal,
    }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(app.llm.queue.waiting).toBe(1);
    controller.abort();
    await waiting;
    const until = Date.now() + 3000;
    while (app.llm.queue.waiting > 0 && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(app.llm.queue.waiting).toBe(0);
    expect((await hold).status).toBe(200);
  });
});

describe('streaming', () => {
  it('passes the stream on as it comes', async () => {
    const { url, logs } = await start();
    const response = await post(
      url,
      chatBody('fake-model', 'Stream this please', { stream: true }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const decoder = new TextDecoder();
    let chunks = 0;
    let text = '';
    for (;;) {
      const { done, value } = await (reader as ReadableStreamDefaultReader<Uint8Array>).read();
      if (done) break;
      chunks += 1;
      text += decoder.decode(value, { stream: true });
    }
    expect(chunks).toBeGreaterThan(2);
    expect(text).toContain('data: [DONE]');
    const content = [...text.matchAll(/"content":"([^"]*)"/g)].map((m) => m[1]).join('');
    expect(content).toBe('Fake answer to: Stream this please');

    const entry = logs.entries().find((e) => e['msg'] === 'llm');
    expect(entry).toMatchObject({ model: 'fake-model', status: 200 });
    expect(entry?.['promptTokens']).toBeGreaterThan(0);
    expect(entry?.['completionTokens']).toBeGreaterThan(0);
  });

  it('holds the slot until the stream is over', async () => {
    const { url, app } = await start();
    const response = await post(url, chatBody('fake-model', 'x', { stream: true }));
    expect(app.llm.queue.running).toBe(1);
    await response.text();
    const until = Date.now() + 2000;
    while (app.llm.queue.running > 0 && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(app.llm.queue.running).toBe(0);
  });
});

describe('the log of language model requests', () => {
  it('has time, model, duration, token counts and status, and no content', async () => {
    const { url, logs } = await start({ fake: { apiKey: SECRET_KEY } });
    const prompt = 'A very private question about the confidential process XYZ-42';
    await (await post(url, chatBody('fake-model', prompt))).text();
    await (await fetch(`${url}/llm/v1/models`)).text();
    const entries = logs.entries().filter((e) => e['msg'] === 'llm');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: 'info',
      model: 'fake-model',
      status: 200,
      time: expect.any(String),
      durationMs: expect.any(Number),
      promptTokens: expect.any(Number),
      completionTokens: expect.any(Number),
    });
    const text = logs.lines.join('\n');
    expect(text).not.toContain('XYZ-42');
    expect(text).not.toContain('Fake answer');
    expect(text).not.toContain(SECRET_KEY);
    // No person: not even an address.
    expect(entries[0]).not.toHaveProperty('client');
    expect(JSON.stringify(entries[0])).not.toContain('127.0.0.1');
  });

  it('records failures with their status', async () => {
    const { url, logs } = await start();
    await post(url, chatBody('status-500'));
    const entry = logs.entries().find((e) => e['msg'] === 'llm');
    expect(entry).toMatchObject({ model: 'status-500', status: 502 });
  });
});
