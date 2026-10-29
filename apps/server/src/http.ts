import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, errorBody } from './errors';

/** Sends a JSON body. API answers are never cached. */
export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const text = JSON.stringify(body);
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(text);
}

export function sendText(
  res: ServerResponse,
  status: number,
  text: string,
  contentType: string,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(text);
}

export function sendError(res: ServerResponse, error: ApiError): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  sendJson(res, error.status, errorBody(error), error.headers);
}

/** Reads a request body of at most `limit` bytes; a larger one is answered with 413. */
export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) {
    drain(req);
    throw tooLarge(limit);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > limit) {
      drain(req);
      throw tooLarge(limit);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function tooLarge(limit: number): ApiError {
  return new ApiError(
    413,
    'payload_too_large',
    `The request is larger than ${formatBytes(limit)}.`,
    { headers: { Connection: 'close' } },
  );
}

/** Lets the client finish sending (so that it can read the answer), but not for long. */
function drain(req: IncomingMessage): void {
  req.resume();
  const timer = setTimeout(() => {
    req.destroy();
  }, 5000);
  timer.unref();
  req.once('close', () => {
    clearTimeout(timer);
  });
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 2) return `${Math.round((bytes / 1024 ** 2) * 10) / 10} MB`;
  if (bytes >= 1024) return `${Math.round((bytes / 1024) * 10) / 10} kB`;
  return `${bytes} bytes`;
}

/** True if the request says that its body is JSON. */
export function isJsonRequest(req: IncomingMessage): boolean {
  const type = req.headers['content-type'];
  return typeof type === 'string' && /^application\/(?:[\w.+-]+\+)?json\s*(?:;|$)/i.test(type);
}

/**
 * Reads a JSON body. The content type must be `application/json`: it cannot be sent by a form or a
 * simple cross-site request, which would otherwise be a way to act with the visitor's rights.
 */
export async function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  if (!isJsonRequest(req)) {
    throw new ApiError(
      415,
      'unsupported_media_type',
      'Send the body with the content type application/json.',
    );
  }
  const body = await readBody(req, limit);
  if (body.length === 0) {
    throw new ApiError(400, 'bad_request', 'The request has no body.');
  }
  try {
    return JSON.parse(body.toString('utf8'));
  } catch (error) {
    throw new ApiError(
      400,
      'invalid_json',
      `The body is not valid JSON (${(error as Error).message}).`,
    );
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The first value of a header. */
export function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
