import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { inlineScriptHashes } from './security';
import { VERSION } from './version';

const gzipAsync = promisify(gzip);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm',
};

const COMPRESSIBLE = /^(?:text\/|application\/(?:json|xml|manifest\+json)|image\/svg\+xml)/;
const COMPRESS_MIN = 1024;
const CACHE_LIMIT_BYTES = 64 * 1024 * 1024;

export function mimeType(file: string): string {
  return TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/** Where a request path goes; `null` for a path that would leave the folder. */
export function resolveInside(root: string, requestPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const target = resolve(join(root, normalize(`/${decoded}`)));
  const base = resolve(root);
  return target === base || target.startsWith(base + sep) ? target : null;
}

/** The files of the build get a hash in their name and never change; the rest may. */
export function cacheControl(requestPath: string, type: string): string {
  if (requestPath.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  if (type.startsWith('text/html')) return 'no-cache';
  return 'public, max-age=3600';
}

export interface StaticFiles {
  /** True if the app is installed (there is an `index.html`). */
  available(): Promise<boolean>;
  /** The hashes of the inline scripts in `index.html`, for the CSP. */
  scriptHashes(): Promise<string[]>;
  /**
   * Answers a GET or HEAD request with a file, or with `index.html` for a path without extension
   * (the app handles it). Returns false if there is nothing to send.
   */
  serve(req: IncomingMessage, res: ServerResponse, requestPath: string): Promise<boolean>;
}

interface CachedGzip {
  key: string;
  body: Buffer;
}

/**
 * The marker that tells the app it was delivered by a server. The app asks `api/health` only if it
 * finds it, so that a page on GitHub Pages or the dev server makes no request that ends in a 404.
 */
export const SERVER_MARKER_NAME = 'pnm-server';

/** `index.html` with the marker of the server in its head. */
export function markServerPage(html: string): string {
  const marker = `<meta name="${SERVER_MARKER_NAME}" content="${VERSION}" />`;
  return /<\/head>/i.test(html)
    ? html.replace(/<\/head>/i, `  ${marker}\n  </head>`)
    : `${marker}\n${html}`;
}

interface IndexDocument {
  mtimeMs: number;
  checkedAt: number;
  html: string;
  body: Buffer;
  etag: string;
  scriptHashes: string[];
}

export function createStaticFiles(root: string): StaticFiles {
  const compressed = new Map<string, CachedGzip>();
  let compressedBytes = 0;
  let index: IndexDocument | null = null;

  async function indexStat(): Promise<{ mtimeMs: number } | null> {
    try {
      const info = await stat(join(root, 'index.html'));
      return info.isFile() ? info : null;
    } catch {
      return null;
    }
  }

  async function gzipped(name: string, etag: string, load: () => Promise<Buffer>): Promise<Buffer> {
    const cached = compressed.get(name);
    if (cached?.key === etag) return cached.body;
    const body = await gzipAsync(await load());
    if (cached) compressedBytes -= cached.body.length;
    if (compressedBytes + body.length > CACHE_LIMIT_BYTES) {
      compressed.clear();
      compressedBytes = 0;
    }
    compressed.set(name, { key: etag, body });
    compressedBytes += body.length;
    return body;
  }

  /** The page of the app, read again when the file changes (at most every few seconds). */
  async function indexDocument(): Promise<IndexDocument | null> {
    if (index !== null && Date.now() - index.checkedAt < 3000) return index;
    const info = await indexStat();
    if (info === null) return null;
    if (index?.mtimeMs === info.mtimeMs) {
      index.checkedAt = Date.now();
      return index;
    }
    const html = markServerPage(await readFile(join(root, 'index.html'), 'utf8'));
    const body = Buffer.from(html, 'utf8');
    index = {
      mtimeMs: info.mtimeMs,
      checkedAt: Date.now(),
      html,
      body,
      etag: `W/"${createHash('sha1').update(body).digest('hex').slice(0, 16)}"`,
      scriptHashes: inlineScriptHashes(html),
    };
    return index;
  }

  return {
    async available() {
      return (await indexStat()) !== null;
    },

    async scriptHashes() {
      // Every answer asks; the file is looked at again at most every few seconds.
      return (await indexDocument())?.scriptHashes ?? [];
    },

    async serve(req, res, requestPath) {
      let file = resolveInside(root, requestPath);
      if (file === null) return false;
      let info = await stat(file).catch(() => null);
      if (info?.isDirectory()) {
        file = join(file, 'index.html');
        info = await stat(file).catch(() => null);
      }
      let servedPath = requestPath;
      if (info === null || !info.isFile()) {
        // A path with a file extension that is missing is a 404 (a missing script must not answer
        // with HTML); any other path belongs to the app.
        if (extname(requestPath) !== '') return false;
        file = join(root, 'index.html');
        info = await stat(file).catch(() => null);
        if (info === null || !info.isFile()) return false;
        servedPath = '/index.html';
      }
      const type = mimeType(file);
      const page = file === resolve(root, 'index.html') ? await indexDocument() : null;
      const size = page ? page.body.length : info.size;
      const etag = page
        ? page.etag
        : `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
      const headers: Record<string, string | number> = {
        'Content-Type': type,
        'Cache-Control': cacheControl(servedPath, type),
        ETag: etag,
        Vary: 'Accept-Encoding',
      };
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, headers);
        res.end();
        return true;
      }
      const wantsGzip =
        COMPRESSIBLE.test(type) &&
        size >= COMPRESS_MIN &&
        /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
      if (wantsGzip) {
        const body = await gzipped(file, createHash('sha1').update(etag).digest('hex'), () =>
          page ? Promise.resolve(page.body) : readFile(file),
        );
        res.writeHead(200, {
          ...headers,
          'Content-Encoding': 'gzip',
          'Content-Length': body.length,
        });
        res.end(req.method === 'HEAD' ? undefined : body);
        return true;
      }
      res.writeHead(200, { ...headers, 'Content-Length': size });
      if (req.method === 'HEAD') {
        res.end();
        return true;
      }
      if (page) {
        res.end(page.body);
        return true;
      }
      await new Promise<void>((done) => {
        const stream = createReadStream(file);
        stream.on('error', () => {
          res.destroy();
          done();
        });
        res.on('close', () => {
          stream.destroy();
          done();
        });
        stream.on('end', done);
        stream.pipe(res);
      });
      return true;
    },
  };
}
