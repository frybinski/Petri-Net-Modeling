import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { createServer, get, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SERVER_MARKER_NAME, createStaticFiles, markServerPage } from '../src/static';

describe('marking the page', () => {
  it('puts the marker at the end of the head', () => {
    const html = '<html><head><title>x</title></head><body></body></html>';
    const marked = markServerPage(html);
    expect(marked).toMatch(/<meta name="pnm-server" content="[^"]+" \/>\s*<\/head>/);
    expect(marked.replace(/\s*<meta name="pnm-server"[^>]*>\s*/, '')).toBe(html);
    expect(marked).toContain(`name="${SERVER_MARKER_NAME}"`);
  });

  it('also works with an upper case tag and with no head at all', () => {
    expect(markServerPage('<HTML><HEAD></HEAD></HTML>')).toContain('pnm-server');
    expect(markServerPage('<p>x</p>').startsWith('<meta name="pnm-server"')).toBe(true);
  });
});

describe('the page of the app on disk', () => {
  let dir: string;
  let http: Server;
  let base: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pnm-static-'));
    await writeFile(
      join(dir, 'index.html'),
      '<!doctype html><html><head><title>One</title></head><body></body></html>',
    );
    const files = createStaticFiles(dir);
    http = createServer((req, res) => {
      void files.serve(req, res, '/').then((handled) => {
        if (!handled) {
          res.writeHead(404);
          res.end();
        }
      });
    });
    await new Promise<void>((done) => http.listen(0, '127.0.0.1', done));
    base = `http://127.0.0.1:${(http.address() as AddressInfo).port}/`;
  });

  afterEach(async () => {
    vi.useRealTimers();
    await new Promise<void>((done) => http.close(() => done()));
    await rm(dir, { recursive: true, force: true });
  });

  it('serves the new content, with a new ETag, after the file changed', async () => {
    const first = await fetch(base);
    const firstTag = first.headers.get('etag');
    expect(await first.text()).toContain('One');

    const body = `<!doctype html><html><head><title>Two</title></head><body>${'x'.repeat(2000)}</body></html>`;
    await writeFile(join(dir, 'index.html'), body);
    const later = new Date(Date.now() + 60_000);
    await utimes(join(dir, 'index.html'), later, later);
    // The file is looked at again after a few seconds, not on every request.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 10_000 });

    const second = await fetch(base);
    expect(second.headers.get('etag')).not.toBe(firstTag);
    const html = await second.text();
    expect(html).toContain('Two');
    expect(html).toContain('pnm-server');
  });

  it('compresses the marked page and gives the same content', async () => {
    const body = `<!doctype html><html><head><title>Big</title></head><body>${'y'.repeat(4000)}</body></html>`;
    await writeFile(join(dir, 'index.html'), body);
    const later = new Date(Date.now() + 60_000);
    await utimes(join(dir, 'index.html'), later, later);
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 10_000 });

    const response = await new Promise<{ encoding: string | undefined; body: Buffer }>(
      (resolve, reject) => {
        get(base, { headers: { 'Accept-Encoding': 'gzip' } }, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () =>
            resolve({ encoding: res.headers['content-encoding'], body: Buffer.concat(chunks) }),
          );
        }).on('error', reject);
      },
    );
    expect(response.encoding).toBe('gzip');
    const html = gunzipSync(response.body).toString('utf8');
    expect(html).toContain('Big');
    expect(html).toMatch(/<meta name="pnm-server"[^>]*>\s*<\/head>/);
  });
});
