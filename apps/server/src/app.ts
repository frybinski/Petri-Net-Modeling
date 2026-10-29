import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Config } from './config';
import { ApiError, messageOf } from './errors';
import { header, sendError } from './http';
import { createBasicAuth } from './basic-auth';
import { createJobPool, type JobPool } from './api/pool';
import { registerApi } from './api/routes';
import { createLlmProxy, type LlmProxy } from './llm/proxy';
import { createLogger, type Logger } from './logger';
import { clientAddress, isAllowed, parseNetList } from './net-filter';
import { Router, type RequestContext } from './router';
import { registerHealth } from './routes/health';
import { applySecurityHeaders, contentSecurityPolicy } from './security';
import { createStaticFiles } from './static';

/** What the application needs from the outside; tests replace parts of it. */
export interface AppDeps {
  logger?: Logger;
  /** Replaces the global `fetch` for calls to the language model server (tests). */
  fetch?: typeof fetch;
  /** The bundle that runs in a thread of the job pool; default `worker.js` next to this file. */
  workerFile?: string | URL;
}

export interface App {
  server: Server;
  router: Router;
  llm: LlmProxy;
  pool: JobPool;
  /** Starts listening; resolves with the port. */
  start(): Promise<number>;
  /** Stops accepting requests, waits for running ones for `graceMs`, then cuts them off. */
  close(graceMs?: number): Promise<void>;
}

/** Paths that need no password when `PNM_BASIC_AUTH` is set: the files the app is made of. */
function isPublicAsset(path: string): boolean {
  return path.startsWith('/assets/') || path === '/favicon.svg';
}

/** Methods that change something; they are only accepted from the server's own pages. */
const CHANGING = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

export function createApp(config: Config, deps: AppDeps = {}): App {
  const logger = deps.logger ?? createLogger();
  const router = new Router();
  const allowed = parseNetList(config.allowedNets);
  const trusted = parseNetList(config.trustedProxies);
  const auth = createBasicAuth(config.basicAuth);
  const files = createStaticFiles(config.webDir);
  const publicHost = new URL(config.publicUrl).host;

  registerHealth(router);
  const llm = createLlmProxy(config.llm, {
    logger,
    ...(deps.fetch !== undefined && { fetch: deps.fetch }),
  });
  llm.register(router);
  const pool = createJobPool({
    workerFile: deps.workerFile ?? new URL('./worker.js', import.meta.url),
    size: config.jobs.workers,
    timeoutMs: config.jobs.timeoutMs,
    memoryMb: config.jobs.memoryMb,
    maxQueue: config.jobs.maxQueue,
    logger,
  });
  registerApi(router, { pool, llm, logger });

  /** The page of a share link is the app itself; the app reads the token from the address. */
  router.get(
    '/s/:token',
    async (ctx) => {
      if (!(await files.serve(ctx.req, ctx.res, '/index.html'))) notInstalled(ctx.res);
    },
    { open: true, summary: 'The app, opened on a share link' },
  );

  function notInstalled(res: ServerResponse): void {
    sendError(
      res,
      new ApiError(
        404,
        'not_found',
        'The web app is not installed on this server (no index.html).',
      ),
    );
  }

  /** True unless the request is a change that comes from another site. */
  function sameOriginOk(req: IncomingMessage, viaTrustedProxy: boolean): boolean {
    const origin = header(req, 'origin');
    if (origin === undefined) return true;
    let host: string;
    try {
      host = new URL(origin).host;
    } catch {
      return false;
    }
    const own = new Set([publicHost]);
    const requested = header(req, 'host');
    if (requested !== undefined) own.add(requested);
    const forwarded = header(req, 'x-forwarded-host');
    if (viaTrustedProxy && forwarded !== undefined) own.add(forwarded.split(',')[0]?.trim() ?? '');
    return own.has(host);
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const started = performance.now();
    const bytesBefore = req.socket.bytesWritten;
    const abort = new AbortController();
    let routeName: string | undefined;
    const note: RequestContext['note'] = {};

    res.on('close', () => {
      if (!res.writableFinished) abort.abort();
      const raw = (req.url ?? '/').split('?')[0] ?? '/';
      logger.info('request', {
        method: req.method ?? '-',
        path: routeName ?? raw.slice(0, 200),
        status: res.statusCode,
        durationMs: Math.round(performance.now() - started),
        bytes: Math.max(0, req.socket.bytesWritten - bytesBefore),
        ...note,
      });
    });

    try {
      applySecurityHeaders(res, contentSecurityPolicy(await files.scriptHashes()));

      const found = clientAddress(
        req.socket.remoteAddress,
        header(req, 'x-forwarded-for'),
        trusted,
      );
      const client = found.address ?? found.peer;
      if (!isAllowed(found, allowed)) {
        logger.warn('denied', { client: client === '' ? 'unknown' : client });
        throw new ApiError(403, 'forbidden', 'This address may not use the server.');
      }

      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;
      const method = req.method ?? 'GET';
      const matched = router.match(method, path);
      const isApiPath = ['/api', '/llm'].some(
        (prefix) => path === prefix || path.startsWith(`${prefix}/`),
      );
      const isStatic =
        matched.kind === 'none' && !isApiPath && (method === 'GET' || method === 'HEAD');

      const open = matched.kind === 'found' ? matched.route.open : isStatic && isPublicAsset(path);
      if (!open && auth.enabled && !auth.check(header(req, 'authorization'))) {
        throw new ApiError(401, 'unauthorized', 'Log in to use this server.', {
          headers: { 'WWW-Authenticate': 'Basic realm="Petri Net Modeling", charset="UTF-8"' },
        });
      }
      if (CHANGING.has(method) && !sameOriginOk(req, trusted.contains(found.peer))) {
        throw new ApiError(
          403,
          'cross_origin',
          "Requests that change data must come from this server's own pages.",
        );
      }

      if (matched.kind === 'found') {
        routeName = matched.route.pattern;
        await matched.route.handler({
          req,
          res,
          path,
          query: url.searchParams,
          params: matched.params,
          client,
          config,
          log: logger,
          note,
          signal: abort.signal,
        });
        return;
      }
      if (matched.kind === 'method') {
        throw new ApiError(405, 'method_not_allowed', `Use ${matched.allowed.join(' or ')} here.`, {
          headers: { Allow: matched.allowed.join(', ') },
        });
      }
      if (isStatic) {
        routeName = isPublicAsset(path) ? path.slice(0, 200) : '(static)';
        if (await files.serve(req, res, path)) return;
        if (!(await files.available())) return notInstalled(res);
      }
      throw new ApiError(404, 'not_found', 'There is nothing at this address.');
    } catch (error) {
      if (abort.signal.aborted) {
        // The client went away; there is nobody to answer.
        res.destroy();
        return;
      }
      if (error instanceof ApiError) {
        sendError(res, error);
        return;
      }
      logger.error('unhandled error', {
        method: req.method ?? '-',
        error: messageOf(error).slice(0, 300),
      });
      sendError(res, new ApiError(500, 'internal', 'The server could not handle the request.'));
    }
  }

  const server = createServer((req, res) => {
    void handle(req, res);
  });
  // Proxies keep connections open for a while; a short timeout here would race with them.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  return {
    server,
    router,
    llm,
    pool,
    start() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.port, config.bindAddress, () => {
          server.off('error', reject);
          const address = server.address();
          resolve(typeof address === 'object' && address !== null ? address.port : config.port);
        });
      });
    },
    close(graceMs = 10_000) {
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          server.closeAllConnections();
        }, graceMs);
        timer.unref();
        server.close(() => {
          clearTimeout(timer);
          void pool.close().then(() => {
            resolve();
          });
        });
        server.closeIdleConnections();
      });
    },
  };
}
