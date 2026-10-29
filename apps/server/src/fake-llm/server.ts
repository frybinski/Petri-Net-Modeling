import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
} from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

export interface FakeLlmOptions {
  /** The models it lists. */
  models?: string[];
  /** If set, requests need `Authorization: Bearer <apiKey>`. */
  apiKey?: string;
  /** Waits this long before every chat answer (milliseconds). */
  delayMs?: number;
}

export interface SeenRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  /** The JSON body of a POST, else `undefined`. */
  body: unknown;
}

export interface FakeLlm {
  server: Server;
  /** `http://127.0.0.1:<port>`; the API is below `/v1` (Ollama style) and `/api` (Open WebUI). */
  url: string;
  port: number;
  /** Every request received, newest last. */
  requests: SeenRequest[];
  close(): Promise<void>;
}

export const FAKE_MODELS = ['fake-model', 'fake-model-large'];

const PREFIXES = ['/v1', '/api'];

function readText(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

function lastUserText(body: unknown): string {
  const messages = (body as { messages?: Array<{ role?: string; content?: unknown }> } | null)
    ?.messages;
  const user = [...(messages ?? [])].reverse().find((m) => m.role === 'user');
  return typeof user?.content === 'string' ? user.content : '';
}

function tokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * A stand-in for a language model server that talks like Ollama (`/v1`) and Open WebUI (`/api`):
 * `POST …/chat/completions` (also as a stream) and `GET …/models`. It answers with a fixed text, so
 * the generation of a domain view falls back to the generic view. The model name steers it:
 * `slow-<ms>` waits that long, `hang` never answers, `status-<code>` answers with that status,
 * `leak` repeats the received Authorization header in its answer and `leak-error` in an error (to
 * test that a server in front never passes a key on).
 */
export async function startFakeLlm(
  options: FakeLlmOptions = {},
  port = 0,
  host = '127.0.0.1',
): Promise<FakeLlm> {
  const models = options.models ?? FAKE_MODELS;
  const requests: SeenRequest[] = [];
  const sockets = new Set<Socket>();

  const server = createServer((req, res) => {
    void (async () => {
      const text = req.method === 'POST' ? await readText(req) : '';
      let body: unknown;
      try {
        body = text === '' ? undefined : JSON.parse(text);
      } catch {
        body = undefined;
      }
      const path = (req.url ?? '/').split('?')[0] ?? '/';
      requests.push({ method: req.method ?? 'GET', path, headers: req.headers, body });

      const json = (status: number, value: unknown): void => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(value));
      };
      if (path === '/health') {
        json(200, { ok: true });
        return;
      }
      const prefix = PREFIXES.find((p) => path.startsWith(`${p}/`));
      if (prefix === undefined) {
        json(404, { error: { message: `Not found: ${path}` } });
        return;
      }
      if (
        options.apiKey !== undefined &&
        req.headers.authorization !== `Bearer ${options.apiKey}`
      ) {
        json(401, { detail: 'Not authenticated' });
        return;
      }
      const route = path.slice(prefix.length);
      if (req.method === 'GET' && route === '/models') {
        json(200, {
          object: 'list',
          data: models.map((id) => ({ id, object: 'model', name: id })),
        });
        return;
      }
      if (req.method === 'POST' && route === '/chat/completions') {
        const model = (body as { model?: unknown } | undefined)?.model;
        if (typeof model !== 'string') {
          json(400, { error: { message: 'model is required' } });
          return;
        }
        const wait = /^slow-(\d+)$/.exec(model)?.[1];
        const status = /^status-(\d{3})$/.exec(model)?.[1];
        if (model === 'hang') return;
        if (model === 'leak-error') {
          json(400, { error: { message: `bad request from ${req.headers.authorization ?? ''}` } });
          return;
        }
        const delay = (wait === undefined ? 0 : Number(wait)) + (options.delayMs ?? 0);
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        if (status !== undefined) {
          json(Number(status), { error: { message: `Simulated error ${status}` } });
          return;
        }
        if (!models.includes(model) && wait === undefined && model !== 'leak') {
          json(404, { error: { message: `model '${model}' not found` } });
          return;
        }
        const prompt = lastUserText(body);
        const answer =
          model === 'leak'
            ? `Authorization was: ${req.headers.authorization ?? ''}`
            : `Fake answer to: ${prompt.slice(0, 60).replace(/\s+/g, ' ')}`;
        const usage = {
          prompt_tokens: tokens(JSON.stringify((body as { messages?: unknown }).messages ?? '')),
          completion_tokens: tokens(answer),
        };
        if ((body as { stream?: unknown }).stream === true) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
          const words = answer.split(' ');
          for (const [i, word] of words.entries()) {
            const delta = { content: i === 0 ? word : ` ${word}` };
            res.write(`data: ${JSON.stringify({ model, choices: [{ index: 0, delta }] })}\n\n`);
            await new Promise((resolve) => setTimeout(resolve, 2));
          }
          res.write(
            `data: ${JSON.stringify({ model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage })}\n\n`,
          );
          res.end('data: [DONE]\n\n');
          return;
        }
        json(200, {
          id: 'fake-1',
          object: 'chat.completion',
          model,
          choices: [
            { index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' },
          ],
          usage,
        });
        return;
      }
      json(404, { error: { message: `Not found: ${req.method ?? ''} ${path}` } });
    })();
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      resolve();
    });
  });
  const actual = (server.address() as AddressInfo).port;
  return {
    server,
    url: `http://127.0.0.1:${actual}`,
    port: actual,
    requests,
    close() {
      return new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => {
          resolve();
        });
      });
    },
  };
}
