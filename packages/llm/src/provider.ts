import { LlmError, errorMessage } from './errors';
import { parseJsonLoose } from './json';

export type JsonMode = 'auto' | 'schema' | 'object' | 'none';
/** How a request asked for JSON; `none` means it did not. */
export type UsedMode = 'schema' | 'object' | 'none';

export interface ProviderConfig {
  /** The URL up to and including `/v1`, for example `http://localhost:11434/v1`. */
  baseUrl: string;
  model: string;
  /** Sent as a bearer token. Never logged, stored in a result or put into an error message. */
  apiKey?: string;
  /** Default 0.2. */
  temperature?: number;
  /** Default 120000. */
  timeoutMs?: number;
  /** Default `auto`: JSON Schema, then JSON object, then plain text. */
  jsonMode?: JsonMode;
  /** Replaces the global `fetch` (tests). */
  fetch?: typeof fetch;
}

export interface ChatRequest {
  system: string;
  user: string;
  /** JSON Schema of the answer, for the mode `schema`. */
  schema?: unknown;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ChatResult {
  /** The text of the answer. */
  text: string;
  /** The JSON in the answer; absent if the text holds none. */
  json?: unknown;
  /** The model that answered (as reported by the server, else as configured). */
  model: string;
  usage?: { prompt: number; completion: number };
  /** How the request asked for JSON. */
  mode: UsedMode;
}

/** The part of a provider that the generation needs; the fake provider implements it too. */
export interface ChatProvider {
  chat(request: ChatRequest): Promise<ChatResult>;
}

export interface Provider extends ChatProvider {
  listModels(signal?: AbortSignal): Promise<string[]>;
  test(signal?: AbortSignal): Promise<{ ok: boolean; message: string }>;
}

export const DEFAULT_TEMPERATURE = 0.2;
export const DEFAULT_TIMEOUT_MS = 120_000;

/** The mode that worked, per server and model, for the rest of the session. */
const rememberedModes = new Map<string, UsedMode>();

/** Forgets which JSON modes worked (tests). */
export function resetRememberedModes(): void {
  rememberedModes.clear();
}

function modeKey(config: ProviderConfig): string {
  return `${normalizeBaseUrl(config.baseUrl)}|${config.model}`;
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function redact(text: string, secret: string | undefined): string {
  return secret !== undefined && secret.length >= 4 ? text.split(secret).join('***') : text;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The error message of an OpenAI-style error body, or the start of the text. */
function serverMessage(body: string): string {
  try {
    const data = asRecord(JSON.parse(body));
    const error = data ? data['error'] : undefined;
    const record = asRecord(error);
    if (record && typeof record['message'] === 'string') return record['message'];
    if (typeof error === 'string') return error;
    if (data && typeof data['message'] === 'string') return data['message'];
  } catch {
    // Not JSON: use the text itself.
  }
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > 300 ? `${flat.slice(0, 300)}…` : flat;
}

/** True if the server refused the way JSON was requested, so another mode may work. */
function rejectsResponseFormat(status: number, message: string): boolean {
  if (status === 401 || status === 403 || status === 429) return false;
  if (status === 400 || status === 422) return true;
  return /response_format|json_schema|json_object|structured output|grammar/i.test(message);
}

interface Attempt {
  text: string;
  model: string;
  usage?: { prompt: number; completion: number };
}

function contentOf(message: unknown): string | null {
  const record = asRecord(message);
  if (!record) return null;
  const content = record['content'];
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = content.flatMap((part) => {
      const p = asRecord(part);
      return p && typeof p['text'] === 'string' ? [p['text']] : [];
    });
    return parts.join('');
  }
  return null;
}

function modesFor(
  requested: JsonMode,
  hasSchema: boolean,
  remembered: UsedMode | undefined,
): UsedMode[] {
  if (requested === 'schema') return hasSchema ? ['schema'] : ['object'];
  if (requested === 'object') return ['object'];
  if (requested === 'none') return ['none'];
  const all: UsedMode[] = hasSchema ? ['schema', 'object', 'none'] : ['object', 'none'];
  if (remembered === undefined) return all;
  const at = all.indexOf(remembered);
  return at >= 0 ? all.slice(at) : all;
}

/**
 * A client for an OpenAI-compatible chat completion API (`POST {baseUrl}/chat/completions`),
 * for example Ollama, LM Studio or a cloud service. Uses `fetch`, so it runs in the browser and in
 * Node.
 */
export function createProvider(config: ProviderConfig): Provider {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const headers = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
  });

  /** Runs one HTTP request with a time limit and the caller's cancellation. */
  async function request(
    url: string,
    init: RequestInit,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    if (signal?.aborted) throw new LlmError('aborted', 'Cancelled');
    const fetchFn = config.fetch ?? globalThis.fetch;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = (): void => {
      controller.abort();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      return await fetchFn(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (timedOut) {
        throw new LlmError('timeout', `No answer within ${Math.round(timeoutMs / 1000)} seconds`);
      }
      if (signal?.aborted) throw new LlmError('aborted', 'Cancelled');
      throw new LlmError(
        'network',
        `Could not reach ${baseUrl}: ${redact(errorMessage(error), config.apiKey)}`,
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /** Reads the body of an answer (the headers arrive when the model has finished). */
  async function readBody(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch (error) {
      throw new LlmError('network', `The answer was cut off: ${errorMessage(error)}`);
    }
  }

  function httpError(status: number, body: string): LlmError {
    const message = redact(serverMessage(body), config.apiKey);
    if (status === 401 || status === 403) {
      return new LlmError(
        'auth',
        `The server refused the request (HTTP ${status})${message ? `: ${message}` : ''}. Check the API key.`,
        status,
      );
    }
    if (status === 429) {
      return new LlmError(
        'rate-limit',
        `Too many requests (HTTP 429)${message ? `: ${message}` : ''}`,
        status,
      );
    }
    if (status === 404) {
      return new LlmError(
        'bad-response',
        `Not found (HTTP 404)${message ? `: ${message}` : ''}. Check the base URL and the model name.`,
        status,
      );
    }
    return new LlmError(
      'bad-response',
      `The server answered with HTTP ${status}${message ? `: ${message}` : ''}`,
      status,
    );
  }

  async function attempt(
    mode: UsedMode,
    req: ChatRequest,
    temperature: number,
  ): Promise<{ ok: true; value: Attempt } | { ok: false; error: LlmError; body: string }> {
    const body: Record<string, unknown> = {
      model: config.model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
      temperature,
      stream: false,
    };
    if (req.maxTokens !== undefined) body['max_tokens'] = req.maxTokens;
    if (mode === 'schema' && req.schema !== undefined) {
      body['response_format'] = {
        type: 'json_schema',
        json_schema: { name: 'domain_view', schema: req.schema, strict: false },
      };
    } else if (mode === 'schema' || mode === 'object') {
      body['response_format'] = { type: 'json_object' };
    }
    const response = await request(
      `${baseUrl}/chat/completions`,
      { method: 'POST', headers: headers(), body: JSON.stringify(body) },
      req.signal,
    );
    const text = await readBody(response);
    if (!response.ok) return { ok: false, error: httpError(response.status, text), body: text };

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return {
        ok: false,
        error: new LlmError('bad-response', 'The server did not answer with JSON'),
        body: text,
      };
    }
    const record = asRecord(data);
    const choices = record ? record['choices'] : undefined;
    const first = Array.isArray(choices) ? asRecord(choices[0]) : null;
    const content = first ? contentOf(first['message']) : null;
    if (content === null) {
      const message = record ? serverMessage(JSON.stringify(record['error'] ?? '')) : '';
      return {
        ok: false,
        error: new LlmError(
          'bad-response',
          `The answer has no message${message ? `: ${message}` : ''}`,
        ),
        body: text,
      };
    }
    const usage = asRecord(record?.['usage']);
    const prompt = usage ? usage['prompt_tokens'] : undefined;
    const completion = usage ? usage['completion_tokens'] : undefined;
    return {
      ok: true,
      value: {
        text: content,
        model: typeof record?.['model'] === 'string' ? record['model'] : config.model,
        ...(typeof prompt === 'number' && typeof completion === 'number'
          ? { usage: { prompt, completion } }
          : {}),
      },
    };
  }

  async function chat(req: ChatRequest): Promise<ChatResult> {
    const key = modeKey(config);
    const modes = modesFor(
      config.jsonMode ?? 'auto',
      req.schema !== undefined,
      rememberedModes.get(key),
    );
    const temperature = config.temperature ?? DEFAULT_TEMPERATURE;
    let lastError: LlmError | null = null;
    for (const [index, mode] of modes.entries()) {
      const result = await attempt(mode, req, temperature);
      if (!result.ok) {
        lastError = result.error;
        const more = index < modes.length - 1;
        const status = result.error.status;
        if (more && status !== undefined && rejectsResponseFormat(status, result.error.message)) {
          continue;
        }
        throw result.error;
      }
      if ((config.jsonMode ?? 'auto') === 'auto') rememberedModes.set(key, mode);
      const chatResult: ChatResult = {
        text: result.value.text,
        model: result.value.model,
        mode,
        ...(result.value.usage ? { usage: result.value.usage } : {}),
      };
      try {
        chatResult.json = parseJsonLoose(result.value.text);
      } catch {
        // The text holds no JSON; the caller decides what that means.
      }
      return chatResult;
    }
    throw lastError ?? new LlmError('bad-response', 'The server rejected every request');
  }

  async function listModels(signal?: AbortSignal): Promise<string[]> {
    const response = await request(
      `${baseUrl}/models`,
      { method: 'GET', headers: headers() },
      signal,
    );
    const text = await readBody(response);
    if (!response.ok) throw httpError(response.status, text);
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new LlmError('bad-response', 'The model list is not JSON');
    }
    const record = asRecord(data);
    const list = record?.['data'] ?? record?.['models'] ?? data;
    if (!Array.isArray(list))
      throw new LlmError('bad-response', 'The model list has an unknown shape');
    const names = list.flatMap((item) => {
      if (typeof item === 'string') return [item];
      const entry = asRecord(item);
      const name = entry?.['id'] ?? entry?.['name'] ?? entry?.['model'];
      return typeof name === 'string' ? [name] : [];
    });
    return [...new Set(names)].sort((a, b) => a.localeCompare(b));
  }

  async function test(signal?: AbortSignal): Promise<{ ok: boolean; message: string }> {
    if (config.model.trim() === '') {
      return { ok: false, message: 'Enter a model name first' };
    }
    try {
      const started = Date.now();
      const result = await attempt(
        'none',
        {
          system: 'You answer in one word.',
          user: 'Say OK.',
          maxTokens: 16,
          ...(signal ? { signal } : {}),
        },
        0,
      );
      if (!result.ok) return { ok: false, message: result.error.message };
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      return { ok: true, message: `Connected to ${result.value.model} (${seconds} s)` };
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
  }

  return { chat, listModels, test };
}
