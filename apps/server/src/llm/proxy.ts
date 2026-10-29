import type { ServerResponse } from 'node:http';
import type { LlmConfig } from '../config';
import { ApiError, describeError } from '../errors';
import { isRecord, readJson, sendJson } from '../http';
import type { Logger } from '../logger';
import type { RequestContext, Router } from '../router';
import { VERSION } from '../version';
import { QueueFullError, createSlotQueue, type SlotQueue } from './queue';

/**
 * The fields of a chat request that are passed on. Everything else is dropped: Open WebUI reads
 * more than the OpenAI interface has (tools, files, features, ...) and those must not be reachable
 * with the rights of the server's account.
 */
export const FORWARDED_FIELDS = [
  'model',
  'messages',
  'temperature',
  'top_p',
  'max_tokens',
  'max_completion_tokens',
  'stream',
  'stream_options',
  'stop',
  'seed',
  'response_format',
  'presence_penalty',
  'frequency_penalty',
] as const;

/** The time limit for the list of models, which is cheap. */
const MODELS_TIMEOUT_MS = 30_000;
/** The largest answer that is read into memory (a stream is not read, it is passed on). */
const MAX_ANSWER_BYTES = 16 * 1024 * 1024;
const MAX_ERROR_TEXT = 500;

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** Replaces the key, wherever it occurs in a text. */
export function redact(text: string, secret: string | null): string {
  if (secret === null || secret.length < 4) return text;
  return text.split(secret).join('***');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** The token counts of an OpenAI style answer. */
export function usageOf(data: unknown): { prompt?: number; completion?: number } {
  const usage = asRecord(asRecord(data)?.['usage']);
  const prompt = count(usage?.['prompt_tokens']);
  const completion = count(usage?.['completion_tokens']);
  return {
    ...(prompt !== undefined && { prompt }),
    ...(completion !== undefined && { completion }),
  };
}

/** The ids of the models in the answer of `GET /models` (OpenAI, Ollama and Open WebUI shapes). */
export function modelIds(data: unknown): string[] {
  const record = asRecord(data);
  const list = record?.['data'] ?? record?.['models'] ?? data;
  if (!Array.isArray(list)) return [];
  const ids = list.flatMap((item): string[] => {
    if (typeof item === 'string') return [item];
    const entry = asRecord(item);
    const id = entry?.['id'] ?? entry?.['name'] ?? entry?.['model'];
    return typeof id === 'string' ? [id] : [];
  });
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

/** A short text from an error answer of the upstream server, without the key. */
function upstreamMessage(body: string, secret: string | null): string {
  let text = body;
  try {
    const data = asRecord(JSON.parse(body));
    const error = data?.['error'];
    const candidates = [asRecord(error)?.['message'], error, data?.['detail'], data?.['message']];
    const found = candidates.find((c) => typeof c === 'string');
    if (typeof found === 'string') text = found;
  } catch {
    // Not JSON: the text itself.
  }
  const flat = redact(text.replace(/\s+/g, ' ').trim(), secret);
  return flat.length > MAX_ERROR_TEXT ? `${flat.slice(0, MAX_ERROR_TEXT)}…` : flat;
}

export interface LlmProxy {
  /** Adds `POST /llm/v1/chat/completions` and `GET /llm/v1/models` to the router. */
  register(router: Router): void;
  /**
   * A `fetch` for code inside the server (the generation of a domain view): it waits for a slot
   * like a request of a client does and reads the answer completely. The key is not added here; the
   * caller passes `apiKey` to the provider.
   */
  queuedFetch: typeof fetch;
  /** The models that may be used, or `null` for all. */
  allowedModels(): string[] | null;
  /** Throws a 403 for a model that this server does not offer. */
  assertModelAllowed(model: string): void;
  /** The model for a request that names none. */
  readonly defaultModel: string | null;
  readonly queue: SlotQueue;
  /** True if the proxy has an upstream server. */
  readonly enabled: boolean;
}

export interface LlmDeps {
  logger: Logger;
  /** Replaces the global `fetch` (tests). */
  fetch?: typeof fetch;
}

export function createLlmProxy(config: LlmConfig, deps: LlmDeps): LlmProxy {
  const queue = createSlotQueue(config.concurrency, config.maxQueue);
  const doFetch = deps.fetch ?? globalThis.fetch;
  const base = config.baseUrl;
  const key = config.apiKey;
  const allowed = config.models.length > 0 ? config.models : null;

  function requireUpstream(): string {
    if (base === null) {
      throw new ApiError(
        503,
        'unavailable',
        'No language model is connected to this server (PNM_LLM_BASE_URL is not set).',
      );
    }
    return base;
  }

  function upstreamHeaders(json: boolean): Record<string, string> {
    return {
      Accept: json ? 'application/json, text/event-stream' : 'application/json',
      'User-Agent': `petri-net-modeling-server/${VERSION}`,
      ...(json && { 'Content-Type': 'application/json' }),
      ...(key !== null && { Authorization: `Bearer ${key}` }),
    };
  }

  /** An error for a failed connection: the text names no address and holds no key. */
  function connectionError(error: unknown, timedOut: boolean): ApiError {
    if (timedOut) {
      return new ApiError(
        504,
        'timeout',
        `The language model did not answer within ${Math.round(config.timeoutMs / 1000)} seconds.`,
      );
    }
    deps.logger.warn('llm upstream unreachable', {
      error: redact(describeError(error), key),
    });
    return new ApiError(502, 'bad_gateway', 'The language model server could not be reached.');
  }

  /** The error that the client gets for an upstream answer that is not a success. */
  function upstreamError(status: number, body: string, retryAfter: string | null): ApiError {
    const message = upstreamMessage(body, key);
    if (status === 401 || status === 403) {
      deps.logger.error('llm upstream refused the key', { status });
      return new ApiError(
        502,
        'bad_gateway',
        'The language model server refused the key of this server. Tell the operator.',
      );
    }
    if (status === 429) {
      return new ApiError(429, 'too_many_requests', message || 'The language model is busy.', {
        headers: { 'Retry-After': retryAfter ?? '5' },
      });
    }
    if (status === 400 || status === 404 || status === 422) {
      // The request itself was wrong (a model that is not there, a format that is not known): the
      // client needs the reason, and the provider of the app uses the status to try other modes.
      return new ApiError(status, status === 404 ? 'not_found' : 'bad_request', message);
    }
    return new ApiError(
      502,
      'bad_gateway',
      `The language model server answered with HTTP ${status}${message ? `: ${message}` : ''}`,
    );
  }

  async function readCapped(response: Response): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) return '';
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_ANSWER_BYTES) {
        await reader.cancel();
        throw new ApiError(502, 'bad_gateway', 'The answer of the language model is too large.');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  /** Runs one upstream request with the time limit and the client's cancellation. */
  async function upstream(
    url: string,
    init: RequestInit,
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<Response> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = AbortSignal.any([signal, timeout]);
    try {
      return await doFetch(url, { ...init, signal: combined });
    } catch (error) {
      if (signal.aborted) throw error;
      throw connectionError(error, timeout.aborted);
    }
  }

  function checkModel(model: string): void {
    if (allowed !== null && !allowed.includes(model)) {
      throw new ApiError(
        403,
        'forbidden',
        `The model "${model.slice(0, 100)}" is not offered by this server.`,
        { details: { models: allowed } },
      );
    }
  }

  /** Validates a chat request and returns the body that goes upstream. */
  function chatBody(input: unknown): {
    body: Record<string, unknown>;
    model: string;
    stream: boolean;
  } {
    const request = asRecord(input);
    if (request === null) throw new ApiError(400, 'bad_request', 'The body must be a JSON object.');
    const messages = request['messages'];
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new ApiError(400, 'bad_request', 'The request needs a list of messages.');
    }
    const model =
      typeof request['model'] === 'string' && request['model'] !== ''
        ? request['model']
        : config.defaultModel;
    if (model === null) {
      throw new ApiError(400, 'bad_request', 'The request needs a model.');
    }
    checkModel(model);
    const body: Record<string, unknown> = {};
    for (const field of FORWARDED_FIELDS) {
      if (request[field] !== undefined) body[field] = request[field];
    }
    body['model'] = model;
    return { body, model, stream: request['stream'] === true };
  }

  function logRequest(fields: {
    model: string;
    started: number;
    status: number;
    usage?: { prompt?: number; completion?: number };
    queuedMs: number;
  }): void {
    deps.logger.info('llm', {
      model: fields.model.slice(0, 100),
      durationMs: Math.round(performance.now() - fields.started),
      queuedMs: fields.queuedMs,
      status: fields.status,
      promptTokens: fields.usage?.prompt,
      completionTokens: fields.usage?.completion,
    });
  }

  async function slot(signal: AbortSignal): Promise<() => void> {
    try {
      return await queue.acquire(signal);
    } catch (error) {
      if (error instanceof QueueFullError) {
        throw new ApiError(
          429,
          'too_many_requests',
          'The language model is busy: too many requests are waiting. Try again in a moment.',
          { headers: { 'Retry-After': '10' } },
        );
      }
      throw error;
    }
  }

  async function pipeStream(
    response: Response,
    res: ServerResponse,
    signal: AbortSignal,
  ): Promise<{ prompt?: number; completion?: number }> {
    res.writeHead(response.status, {
      'Content-Type': response.headers.get('content-type') ?? 'text/event-stream',
      'Cache-Control': 'no-store',
      // A proxy in front must pass the pieces on as they come.
      'X-Accel-Buffering': 'no',
    });
    let usage: { prompt?: number; completion?: number } = {};
    let carry = '';
    const decoder = new TextDecoder();
    const reader = response.body?.getReader();
    if (!reader) {
      res.end();
      return usage;
    }
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.write(value)) {
          await new Promise<void>((resolve) => {
            const finish = (): void => {
              res.off('drain', finish);
              res.off('close', finish);
              resolve();
            };
            res.on('drain', finish);
            res.on('close', finish);
          });
        }
        // Only the counts are looked at, and only in the lines that have them.
        carry += decoder.decode(value, { stream: true });
        const lines = carry.split('\n');
        carry = (lines.pop() ?? '').slice(-65536);
        for (const line of lines) {
          if (!line.startsWith('data:') || !line.includes('"usage"')) continue;
          try {
            const found = usageOf(JSON.parse(line.slice(5)));
            if (found.prompt !== undefined || found.completion !== undefined) usage = found;
          } catch {
            // A line that is not JSON has no counts.
          }
        }
        if (signal.aborted) break;
      }
    } catch (error) {
      // The upstream failed after the answer began: the only honest signal left is to cut off.
      res.destroy();
      if (!signal.aborted) {
        deps.logger.warn('llm stream failed', {
          error: redact(describeError(error), key),
        });
      }
      return usage;
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    res.end();
    return usage;
  }

  async function chat(ctx: RequestContext): Promise<void> {
    const url = joinUrl(requireUpstream(), 'chat/completions');
    const input = await readJson(ctx.req, config.maxBody);
    const { body, model, stream } = chatBody(input);

    const queuedAt = performance.now();
    const release = await slot(ctx.signal);
    const queuedMs = Math.round(performance.now() - queuedAt);
    const started = performance.now();
    let status = 0;
    let usage: { prompt?: number; completion?: number } | undefined;
    try {
      const response = await upstream(
        url,
        { method: 'POST', headers: upstreamHeaders(true), body: JSON.stringify(body) },
        ctx.signal,
        config.timeoutMs,
      );
      status = response.status;
      if (!response.ok) {
        const text = await readCapped(response).catch(() => '');
        throw upstreamError(response.status, text, response.headers.get('retry-after'));
      }
      const type = response.headers.get('content-type') ?? '';
      if (stream && type.includes('text/event-stream')) {
        usage = await pipeStream(response, ctx.res, ctx.signal);
        return;
      }
      const text = await readCapped(response);
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw new ApiError(
          502,
          'bad_gateway',
          'The language model server did not answer with JSON.',
        );
      }
      usage = usageOf(data);
      ctx.res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      // The answer is passed on as it came, except that the key is never part of it.
      ctx.res.end(redact(text, key));
    } catch (error) {
      if (error instanceof ApiError) status = error.status;
      else if (ctx.signal.aborted) status = 499;
      throw error;
    } finally {
      release();
      logRequest({ model, started, status, ...(usage && { usage }), queuedMs });
    }
  }

  async function models(ctx: RequestContext): Promise<void> {
    const url = joinUrl(requireUpstream(), 'models');
    const started = performance.now();
    const response = await upstream(
      url,
      { method: 'GET', headers: upstreamHeaders(false) },
      ctx.signal,
      Math.min(config.timeoutMs, MODELS_TIMEOUT_MS),
    );
    const text = await readCapped(response);
    if (!response.ok)
      throw upstreamError(response.status, text, response.headers.get('retry-after'));
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError(
        502,
        'bad_gateway',
        'The model list of the language model server is not JSON.',
      );
    }
    const ids = modelIds(data).filter((id) => allowed === null || allowed.includes(id));
    deps.logger.info('llm models', {
      durationMs: Math.round(performance.now() - started),
      status: 200,
      count: ids.length,
    });
    sendJson(ctx.res, 200, {
      object: 'list',
      data: ids.map((id) => ({ id, object: 'model', owned_by: 'server' })),
    });
  }

  const queuedFetch: typeof fetch = async (input, init) => {
    const signal = init?.signal ?? new AbortController().signal;
    const queuedAt = performance.now();
    let release: () => void;
    try {
      release = await queue.acquire(signal);
    } catch (error) {
      // A full queue is an answer, not a failure of the connection: the provider reads the status.
      if (error instanceof QueueFullError) {
        return new Response(
          JSON.stringify({
            error: { message: 'The language model is busy: too many requests are waiting.' },
          }),
          { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '10' } },
        );
      }
      throw error;
    }
    const queuedMs = Math.round(performance.now() - queuedAt);
    const started = performance.now();
    let model = '';
    try {
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
      model =
        typeof asRecord(body)?.['model'] === 'string' ? String(asRecord(body)?.['model']) : '';
    } catch {
      // A body that is not JSON has no model to log.
    }
    let status = 0;
    let usage: { prompt?: number; completion?: number } | undefined;
    try {
      const response = await doFetch(input, init);
      status = response.status;
      // Read it all while the slot is held; the provider reads it all anyway.
      const text = await response.text();
      try {
        usage = usageOf(JSON.parse(text));
      } catch {
        // No JSON, no counts.
      }
      return new Response(text, { status: response.status, headers: response.headers });
    } finally {
      release();
      if (model !== '') {
        logRequest({ model, started, status, ...(usage && { usage }), queuedMs });
      }
    }
  };

  return {
    enabled: base !== null,
    queue,
    queuedFetch,
    allowedModels: () => allowed,
    assertModelAllowed: checkModel,
    defaultModel: config.defaultModel,
    register(router) {
      router.post('/llm/v1/chat/completions', chat, {
        summary: 'Chat completion, passed to the language model of the server',
      });
      router.get('/llm/v1/models', models, {
        summary: 'The models that the server offers',
      });
    },
  };
}
