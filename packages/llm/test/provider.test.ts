import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LlmError, createProvider, resetRememberedModes, type ProviderConfig } from '../src';

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

type Reply = Response | Error | ((sent: Sent) => Response | Promise<Response>);

function completion(content: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({
    model: 'served-model',
    choices: [{ message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 11, completion_tokens: 7 },
    ...extra,
  });
}

function fail(status: number, message: string): Response {
  return Response.json({ error: { message } }, { status });
}

/** A fetch that answers from a list and records what was sent. */
function mockFetch(replies: Reply[]): { fetch: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const record: Sent = {
      url: String(input),
      headers: { ...(init?.headers as Record<string, string> | undefined) },
      body:
        typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {},
    };
    sent.push(record);
    const reply = replies[Math.min(sent.length - 1, replies.length - 1)];
    if (reply instanceof Error) throw reply;
    if (typeof reply === 'function') return reply(record);
    if (!reply) throw new Error('no reply');
    return reply.clone();
  };
  return { fetch: impl as typeof fetch, sent };
}

const base: ProviderConfig = { baseUrl: 'http://localhost:11434/v1/', model: 'm1' };
const request = { system: 'sys', user: 'usr', schema: { type: 'object' } };

beforeEach(() => {
  resetRememberedModes();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('chat', () => {
  it('posts to {baseUrl}/chat/completions and asks for the JSON Schema first', async () => {
    const { fetch, sent } = mockFetch([completion('{"a": 1}')]);
    const result = await createProvider({ ...base, apiKey: 'secret-key', fetch }).chat(request);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(sent[0]?.headers['Authorization']).toBe('Bearer secret-key');
    const body = sent[0]?.body ?? {};
    expect(body['model']).toBe('m1');
    expect(body['temperature']).toBe(0.2);
    expect(body['messages']).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'usr' },
    ]);
    expect(body['response_format']).toMatchObject({
      type: 'json_schema',
      json_schema: { schema: { type: 'object' } },
    });
    expect(result).toMatchObject({
      text: '{"a": 1}',
      json: { a: 1 },
      model: 'served-model',
      mode: 'schema',
      usage: { prompt: 11, completion: 7 },
    });
  });

  it('sends no Authorization header without a key and uses the global fetch by default', async () => {
    const { fetch, sent } = mockFetch([completion('{}')]);
    vi.stubGlobal('fetch', fetch);
    await createProvider(base).chat(request);
    expect(sent[0]?.headers['Authorization']).toBeUndefined();
  });

  it('falls back from json_schema to json_object to no format, and remembers the mode', async () => {
    const { fetch, sent } = mockFetch([
      fail(400, "'response_format' of type 'json_schema' is not supported"),
      fail(400, 'json_object is not supported'),
      completion('{"a": 2}'),
    ]);
    const provider = createProvider({ ...base, fetch });
    const first = await provider.chat(request);
    expect(first).toMatchObject({ mode: 'none', json: { a: 2 } });
    expect(
      sent.map((s) => (s.body['response_format'] as { type?: string } | undefined)?.type),
    ).toEqual(['json_schema', 'json_object', undefined]);
    // The next request starts with the mode that worked.
    await provider.chat(request);
    expect(sent).toHaveLength(4);
    expect(sent[3]?.body['response_format']).toBeUndefined();
  });

  it('falls back to json_object when the schema is refused', async () => {
    const { fetch } = mockFetch([fail(400, 'bad response_format'), completion('{"a": 3}')]);
    const result = await createProvider({ ...base, fetch }).chat(request);
    expect(result.mode).toBe('object');
  });

  it('honours a fixed JSON mode', async () => {
    const { fetch, sent } = mockFetch([completion('{}')]);
    await createProvider({ ...base, fetch, jsonMode: 'none' }).chat(request);
    expect(sent[0]?.body['response_format']).toBeUndefined();
    const second = mockFetch([completion('{}')]);
    await createProvider({ ...base, fetch: second.fetch, jsonMode: 'object' }).chat(request);
    expect(second.sent[0]?.body['response_format']).toEqual({ type: 'json_object' });
    const third = mockFetch([fail(400, 'no')]);
    await expect(
      createProvider({ ...base, fetch: third.fetch, jsonMode: 'schema' }).chat(request),
    ).rejects.toMatchObject({ kind: 'bad-response' });
    expect(third.sent).toHaveLength(1);
  });

  it('reads JSON from a code block or from text around it, and keeps the text', async () => {
    const block = mockFetch([completion('```json\n{"a": 4}\n```')]);
    const r1 = await createProvider({ ...base, fetch: block.fetch }).chat(request);
    expect(r1.json).toEqual({ a: 4 });
    const embedded = mockFetch([completion('Sure. {"a": 5} Enjoy.')]);
    const r2 = await createProvider({ ...base, fetch: embedded.fetch }).chat(request);
    expect(r2.json).toEqual({ a: 5 });
    expect(r2.text).toBe('Sure. {"a": 5} Enjoy.');
    const none = mockFetch([completion('I cannot do that.')]);
    const r3 = await createProvider({ ...base, fetch: none.fetch }).chat(request);
    expect(r3.json).toBeUndefined();
    expect(r3.text).toBe('I cannot do that.');
  });

  it('accepts content given as parts', async () => {
    const parts = Response.json({
      choices: [
        {
          message: {
            content: [
              { type: 'text', text: '{"a":' },
              { type: 'text', text: '6}' },
            ],
          },
        },
      ],
    });
    const { fetch } = mockFetch([parts]);
    const result = await createProvider({ ...base, fetch }).chat(request);
    expect(result.json).toEqual({ a: 6 });
    expect(result.model).toBe('m1');
    expect(result.usage).toBeUndefined();
  });

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate-limit'],
    [500, 'bad-response'],
    [404, 'bad-response'],
  ] as const)(
    'maps HTTP %i to the error kind %s without trying other modes',
    async (status, kind) => {
      const { fetch, sent } = mockFetch([fail(status, 'nope')]);
      const error = await createProvider({ ...base, fetch })
        .chat(request)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(LlmError);
      expect((error as LlmError).kind).toBe(kind);
      expect((error as LlmError).status).toBe(status);
      expect((error as LlmError).message).toContain('nope');
      expect(sent).toHaveLength(1);
    },
  );

  it('reports a server that cannot be reached as a network error', async () => {
    const { fetch } = mockFetch([new TypeError('Failed to fetch')]);
    await expect(createProvider({ ...base, fetch }).chat(request)).rejects.toMatchObject({
      kind: 'network',
    });
  });

  it('reports an answer that is not a chat completion as bad-response', async () => {
    for (const reply of [new Response('<html>', { status: 200 }), Response.json({ choices: [] })]) {
      const { fetch } = mockFetch([reply]);
      await expect(
        createProvider({ ...base, fetch, jsonMode: 'none' }).chat(request),
      ).rejects.toMatchObject({ kind: 'bad-response' });
    }
  });

  it('times out', async () => {
    const hanging = (_url: unknown, init?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    const provider = createProvider({ ...base, fetch: hanging as typeof fetch, timeoutMs: 20 });
    await expect(provider.chat(request)).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('can be cancelled by the caller', async () => {
    const hanging = (_url: unknown, init?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    const controller = new AbortController();
    const provider = createProvider({ ...base, fetch: hanging as typeof fetch });
    const pending = provider.chat({ ...request, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
    // Already cancelled before the call.
    await expect(provider.chat({ ...request, signal: controller.signal })).rejects.toMatchObject({
      kind: 'aborted',
    });
  });

  it('never puts the API key into an error message', async () => {
    const key = 'sk-very-secret-key';
    const echoing = mockFetch([fail(401, `Invalid key ${key}`)]);
    const error = await createProvider({ ...base, apiKey: key, fetch: echoing.fetch })
      .chat(request)
      .catch((e: unknown) => e);
    expect((error as LlmError).message).not.toContain(key);
    expect((error as LlmError).message).toContain('***');
    const network = mockFetch([new TypeError(`cannot reach with ${key}`)]);
    const error2 = await createProvider({ ...base, apiKey: key, fetch: network.fetch })
      .chat(request)
      .catch((e: unknown) => e);
    expect((error2 as LlmError).message).not.toContain(key);
  });
});

describe('listModels', () => {
  it('reads the OpenAI shape and sorts the names', async () => {
    const { fetch, sent } = mockFetch([
      Response.json({ data: [{ id: 'zeta' }, { id: 'alpha' }, { id: 'alpha' }] }),
    ]);
    const models = await createProvider({ ...base, apiKey: 'k1234', fetch }).listModels();
    expect(models).toEqual(['alpha', 'zeta']);
    expect(sent[0]?.url).toBe('http://localhost:11434/v1/models');
  });

  it('reads the Ollama shape and plain arrays', async () => {
    const a = mockFetch([Response.json({ models: [{ name: 'qwen:7b' }, { model: 'llama:8b' }] })]);
    expect(await createProvider({ ...base, fetch: a.fetch }).listModels()).toEqual([
      'llama:8b',
      'qwen:7b',
    ]);
    const b = mockFetch([Response.json(['x', 'y'])]);
    expect(await createProvider({ ...base, fetch: b.fetch }).listModels()).toEqual(['x', 'y']);
  });

  it('fails with the kind of the problem', async () => {
    const { fetch } = mockFetch([fail(401, 'bad key')]);
    await expect(createProvider({ ...base, fetch }).listModels()).rejects.toMatchObject({
      kind: 'auth',
    });
  });
});

describe('test', () => {
  it('reports success with the model name', async () => {
    const { fetch, sent } = mockFetch([completion('OK')]);
    const result = await createProvider({ ...base, fetch }).test();
    expect(result.ok).toBe(true);
    expect(result.message).toContain('served-model');
    expect(sent[0]?.body['response_format']).toBeUndefined();
    expect(sent[0]?.body['max_tokens']).toBe(16);
  });

  it('reports failures as a message and never throws', async () => {
    const wrongKey = mockFetch([fail(401, 'nope')]);
    const r1 = await createProvider({ ...base, fetch: wrongKey.fetch }).test();
    expect(r1.ok).toBe(false);
    expect(r1.message).toMatch(/API key/);
    const offline = mockFetch([new TypeError('Failed to fetch')]);
    const r2 = await createProvider({ ...base, fetch: offline.fetch }).test();
    expect(r2).toMatchObject({ ok: false });
    const noModel = await createProvider({ ...base, model: ' ' }).test();
    expect(noModel.ok).toBe(false);
  });
});
