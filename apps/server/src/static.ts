import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { inlineScriptHashes } from './security';

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

export function createStaticFiles(root: string): StaticFiles {
  const compressed = new Map<string, CachedGzip>();
  let compressedBytes = 0;
  let hashes: { mtime: number; values: string[]; checkedAt: number } | null = null;

  async function indexStat(): Promise<{ mtimeMs: number } | null> {
    try {
      const info = await stat(join(root, 'index.html'));
      return info.isFile() ? info : null;
    } catch {
      return null;
    }
  }

  async function gzipped(file: string, etag: string): Promise<Buffer> {
    const cached = compressed.get(file);
    if (cached?.key === etag) return cached.body;
    const body = await gzipAsync(await readFile(file));
    if (cached) compressedBytes -= cached.body.length;
    if (compressedBytes + body.length > CACHE_LIMIT_BYTES) {
      compressed.clear();
      compressedBytes = 0;
    }
    compressed.set(file, { key: etag, body });
    compressedBytes += body.length;
    return body;
  }

  return {
    async available() {
      return (await indexStat()) !== null;
    },

    async scriptHashes() {
      // Every answer asks; the file is looked at again at most every few seconds.
      if (hashes !== null && Date.now() - hashes.checkedAt < 3000) return hashes.values;
      const info = await indexStat();
      if (info === null) return [];
      if (hashes?.mtime === info.mtimeMs) {
        hashes.checkedAt = Date.now();
        return hashes.values;
      }
      const html = await readFile(join(root, 'index.html'), 'utf8');
      hashes = { mtime: info.mtimeMs, values: inlineScriptHashes(html), checkedAt: Date.now() };
      return hashes.values;
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
      const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
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
        info.size >= COMPRESS_MIN &&
        /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
      if (wantsGzip) {
        const body = await gzipped(file, createHash('sha1').update(etag).digest('hex'));
        res.writeHead(200, {
          ...headers,
          'Content-Encoding': 'gzip',
          'Content-Length': body.length,
        });
        res.end(req.method === 'HEAD' ? undefined : body);
        return true;
      }
      res.writeHead(200, { ...headers, 'Content-Length': info.size });
      if (req.method === 'HEAD') {
        res.end();
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
