import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/basic-auth';
import { FIXTURE_WEB, startApp, type RunningApp } from './helpers';

let running: RunningApp | undefined;
afterEach(async () => {
  await running?.stop();
  running = undefined;
});

async function start(overrides: Record<string, string | undefined> = {}): Promise<RunningApp> {
  running = await startApp(overrides);
  return running;
}

/** A request with exactly the headers given (fetch sets some of its own). */
function raw(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string; path?: string } = {},
): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const target = new URL(options.path ?? '/', url);
    const req = request(
      target,
      { method: options.method ?? 'GET', headers: options.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(options.body);
  });
}

describe('health', () => {
  it('says what this server is and offers', async () => {
    const { url } = await start({
      PNM_LLM_BASE_URL: 'http://127.0.0.1:9/v1',
      PNM_LLM_MODELS: 'm1,m2',
      PNM_SERVER_NAME: 'aifb-test',
    });
    const response = await fetch(`${url}/api/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      ok: true,
      app: 'petri-net-modeling',
      version: expect.any(String),
      name: 'aifb-test',
      features: { api: true, projects: true, llm: true, auth: false },
      llm: { models: ['m1', 'm2'], defaultModel: 'm1' },
    });
  });

  it('switches the language model feature off without an upstream', async () => {
    const { url } = await start();
    const body = (await (await fetch(`${url}/api/health`)).json()) as {
      features: { llm: boolean };
    };
    expect(body.features.llm).toBe(false);
  });

  it('answers HEAD', async () => {
    const { url } = await start();
    const response = await fetch(`${url}/api/health`, { method: 'HEAD' });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
  });
});

describe('static files', () => {
  it('serves index.html with no-cache and the security headers', async () => {
    const { url } = await start();
    const response = await fetch(`${url}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(await response.text()).toContain('Fixture app');
  });

  it('marks the page it delivers, so that the app asks for the health only here', async () => {
    const { url } = await start();
    for (const path of ['/', '/some/page', '/s/abcDEF-123_xyz']) {
      const html = await (await fetch(`${url}${path}`)).text();
      expect(html, path).toMatch(/<meta name="pnm-server" content="[^"]+" \/>\s*<\/head>/);
      expect(html, path).toContain('Fixture app');
    }
  });

  it('answers a conditional request for the marked page with 304, and compresses it on request', async () => {
    const { url } = await start();
    const first = await fetch(`${url}/`);
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();
    const second = await fetch(`${url}/`, { headers: { 'If-None-Match': etag ?? '' } });
    expect(second.status).toBe(304);
    // The same ETag for the same content, also for the fallback paths.
    expect((await fetch(`${url}/some/page`)).headers.get('etag')).toBe(etag);
  });

  it('serves hashed assets as immutable with the right type', async () => {
    const { url } = await start();
    const response = await fetch(`${url}/assets/app-abc123.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('serves other files with a short cache and their type', async () => {
    const { url } = await start();
    const response = await fetch(`${url}/favicon.svg`);
    expect(response.headers.get('content-type')).toBe('image/svg+xml');
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
  });

  it('compresses what compresses well when the client accepts it', async () => {
    const { url } = await start();
    const compressed = await raw(url, {
      path: '/assets/app-abc123.js',
      headers: { 'Accept-Encoding': 'gzip' },
    });
    expect(compressed.headers['content-encoding']).toBe('gzip');
    const plain = await raw(url, { path: '/assets/app-abc123.js' });
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.body).toContain('fixtureApp');
  });

  it('answers a conditional request with 304', async () => {
    const { url } = await start();
    const first = await fetch(`${url}/assets/app-abc123.js`);
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();
    const second = await fetch(`${url}/assets/app-abc123.js`, {
      headers: { 'If-None-Match': etag ?? '' },
    });
    expect(second.status).toBe(304);
  });

  it('falls back to index.html for the paths of the app, but not for missing files', async () => {
    const { url } = await start();
    const spa = await fetch(`${url}/some/page`);
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain('Fixture app');
    const missing = await fetch(`${url}/assets/missing.js`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-type')).toContain('application/json');
  });

  it('opens the app on a share link path', async () => {
    const { url } = await start();
    const response = await fetch(`${url}/s/abcDEF-123_xyz`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Fixture app');
  });

  it('does not leave the folder', async () => {
    const { url } = await start();
    for (const path of [
      '/..%2f..%2fpackage.json',
      '/%2e%2e/%2e%2e/etc/passwd',
      '/assets/..%5c..%5cx',
      '/%00',
    ]) {
      const response = await raw(url, { path });
      expect(response.body, path).not.toContain('"name"');
      expect(response.body, path).not.toContain('root:');
    }
    const dotdot = await raw(url, { path: '/../../../etc/passwd' });
    expect(dotdot.body).not.toContain('root:');
  });

  it('says so when the app is not installed', async () => {
    const { url } = await start({ PNM_WEB_DIR: `${FIXTURE_WEB}/nowhere` });
    const response = await fetch(`${url}/`);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'not_found' } });
    expect((await fetch(`${url}/api/health`)).status).toBe(200);
  });
});

describe('security headers', () => {
  it('sets them on pages, files and API answers', async () => {
    const { url } = await start();
    for (const path of ['/', '/assets/app-abc123.js', '/api/health', '/api/nothing']) {
      const response = await fetch(`${url}${path}`);
      const headers = response.headers;
      expect(headers.get('x-content-type-options'), path).toBe('nosniff');
      expect(headers.get('referrer-policy'), path).toBe('no-referrer');
      expect(headers.get('x-frame-options'), path).toBe('DENY');
      const csp = headers.get('content-security-policy') ?? '';
      expect(csp, path).toContain("default-src 'self'");
      expect(csp, path).toContain("connect-src 'self'");
      expect(csp, path).toContain("frame-ancestors 'none'");
      expect(csp, path).toContain("worker-src 'self' blob:");
      expect(csp, path).toContain("object-src 'none'");
      // The build of the app inlines small fonts as data: URIs.
      expect(csp, path).toContain("font-src 'self' data:");
    }
  });

  it('allows the one inline script of index.html by its hash, and no inline scripts otherwise', async () => {
    const { url } = await start();
    const csp = (await fetch(`${url}/`)).headers.get('content-security-policy') ?? '';
    expect(csp).toMatch(/script-src 'self' 'unsafe-eval' 'sha256-[A-Za-z0-9+/=]+'/);
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).not.toMatch(/default-src[^;]*\*/);
  });
});

describe('routing', () => {
  it('answers unknown API paths with JSON 404, not with the app', async () => {
    const { url } = await start();
    for (const path of ['/api/nothing', '/api/v1/nothing', '/llm/v1/embeddings', '/llm/']) {
      const response = await fetch(`${url}${path}`);
      expect(response.status, path).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: 'not_found' } });
    }
  });

  it('answers a wrong method with 405 and the allowed ones', async () => {
    const { url } = await start();
    const response = await fetch(`${url}/api/health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
    expect(await response.json()).toMatchObject({ error: { code: 'method_not_allowed' } });
  });

  it('does not accept POST on static paths', async () => {
    const { url } = await start();
    const response = await fetch(`${url}/`, { method: 'POST', body: 'x' });
    expect(response.status).toBe(404);
  });
});

describe('the client filter', () => {
  it('lets the machine itself in even if it is in no listed network', async () => {
    const { url } = await start({ PNM_ALLOWED_NETS: '203.0.113.0/24' });
    expect((await fetch(`${url}/api/health`)).status).toBe(200);
  });

  it('refuses an address outside the networks, and says which one it was', async () => {
    const { url, logs } = await start({
      PNM_ALLOWED_NETS: '203.0.113.0/24',
      PNM_TRUSTED_PROXIES: '127.0.0.1',
    });
    const response = await fetch(`${url}/api/health`, {
      headers: { 'X-Forwarded-For': '198.51.100.7' },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'forbidden' } });
    expect(logs.entries().find((e) => e['msg'] === 'denied')).toMatchObject({
      client: '198.51.100.7',
    });
    const allowed = await fetch(`${url}/api/health`, {
      headers: { 'X-Forwarded-For': '203.0.113.5' },
    });
    expect(allowed.status).toBe(200);
  });

  it('does not believe X-Forwarded-For from a peer that is not a trusted proxy', async () => {
    // The test client is 127.0.0.1, which is not listed as a proxy, so the header is ignored and
    // the loopback address passes.
    const { url } = await start({ PNM_ALLOWED_NETS: '203.0.113.0/24' });
    const response = await fetch(`${url}/api/health`, {
      headers: { 'X-Forwarded-For': '198.51.100.7' },
    });
    expect(response.status).toBe(200);
  });

  describe('the warning about a forwarding header that is not believed', () => {
    const warnings = (logs: { entries(): Array<Record<string, unknown>> }) =>
      logs.entries().filter((e) => e['msg'] === 'forwarded header ignored');

    it('is logged once, with the peer and the hint, and without the header', async () => {
      const { url, logs } = await start();
      for (let i = 0; i < 3; i += 1) {
        const response = await fetch(`${url}/api/health`, {
          headers: { 'X-Forwarded-For': '198.51.100.77, 10.1.2.3' },
        });
        expect(response.status).toBe(200);
      }
      const found = warnings(logs);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ level: 'warn', peer: '127.0.0.1' });
      expect(String(found[0]?.['hint'])).toContain('PNM_TRUSTED_PROXIES');
      expect(logs.lines.join('\n')).not.toContain('198.51.100.77');
      expect(logs.lines.join('\n')).not.toContain('10.1.2.3');
    });

    it('is not logged for requests without the header or with an empty one', async () => {
      const { url, logs } = await start();
      await fetch(`${url}/api/health`);
      await fetch(`${url}/api/health`, { headers: { 'X-Forwarded-For': ' ' } });
      expect(warnings(logs)).toHaveLength(0);
    });

    it('is not logged when the peer is a trusted proxy', async () => {
      const { url, logs } = await start({ PNM_TRUSTED_PROXIES: '127.0.0.1' });
      await fetch(`${url}/api/health`, { headers: { 'X-Forwarded-For': '198.51.100.7' } });
      expect(warnings(logs)).toHaveLength(0);
    });

    it('is logged again by a new process, not by the next request', async () => {
      const first = await start();
      await fetch(`${first.url}/api/health`, { headers: { 'X-Forwarded-For': '198.51.100.7' } });
      expect(warnings(first.logs)).toHaveLength(1);
      await first.stop();
      running = undefined;
      const second = await start();
      await fetch(`${second.url}/api/health`, { headers: { 'X-Forwarded-For': '198.51.100.7' } });
      expect(warnings(second.logs)).toHaveLength(1);
    });
  });
});

describe('basic auth', () => {
  const entry = hashPassword('alice', 'correct horse');
  const login = `Basic ${Buffer.from('alice:correct horse').toString('base64')}`;

  it('asks for a password for the app and the API', async () => {
    const { url } = await start({ PNM_BASIC_AUTH: entry });
    const page = await fetch(`${url}/`);
    expect(page.status).toBe(401);
    expect(page.headers.get('www-authenticate')).toMatch(/^Basic realm=/);
    expect((await fetch(`${url}/api/v1/nothing`)).status).toBe(401);
    expect((await fetch(`${url}/`, { headers: { Authorization: login } })).status).toBe(200);
    expect(
      (await fetch(`${url}/`, { headers: { Authorization: 'Basic d3Jvbmc6d3Jvbmc=' } })).status,
    ).toBe(401);
  });

  it('leaves the health check, the share page and the files of the app open', async () => {
    const { url } = await start({ PNM_BASIC_AUTH: entry });
    expect((await fetch(`${url}/api/health`)).status).toBe(200);
    expect((await fetch(`${url}/s/sometoken`)).status).toBe(200);
    expect((await fetch(`${url}/assets/app-abc123.js`)).status).toBe(200);
    expect((await fetch(`${url}/favicon.svg`)).status).toBe(200);
    // The files of the build hold no data; the pages and the data do.
    expect((await fetch(`${url}/some/page`)).status).toBe(401);
  });

  it('reports in the health check that a login is in use', async () => {
    const { url } = await start({ PNM_BASIC_AUTH: entry });
    const body = (await (await fetch(`${url}/api/health`)).json()) as {
      features: { auth: boolean };
    };
    expect(body.features.auth).toBe(true);
  });
});

describe('the name of the server in the Host header', () => {
  it('answers under the public address, under localhost and under the address of the machine', async () => {
    const { url } = await start({ PNM_PUBLIC_URL: 'https://pnm.example.org' });
    for (const host of [
      'pnm.example.org',
      'PNM.example.org:8443',
      'localhost:8080',
      '127.0.0.1:9',
      '[::1]:80',
    ]) {
      const response = await raw(url, { path: '/api/health', headers: { Host: host } });
      expect(response.status, host).toBe(200);
    }
  });

  it('turns away a name that is not the server (DNS rebinding) and names the setting', async () => {
    const { url, logs } = await start({ PNM_PUBLIC_URL: 'https://pnm.example.org' });
    for (const host of [
      'evil.example',
      'evil.example:8080',
      'pnm.example.org.evil.example',
      '10.1.2.3:8080',
    ]) {
      const response = await raw(url, { path: '/api/health', headers: { Host: host } });
      expect(response.status, host).toBe(421);
      const body = JSON.parse(response.body) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('misdirected');
      expect(body.error.message).toContain('PNM_ALLOWED_HOSTS');
    }
    expect(
      logs.entries().some((e) => e['msg'] === 'host refused' && e['host'] === 'evil.example'),
    ).toBe(true);
    // Also for the pages and the API behind it.
    expect((await raw(url, { path: '/', headers: { Host: 'evil.example' } })).status).toBe(421);
    expect(
      (await raw(url, { path: '/api/v1/projects', headers: { Host: 'evil.example' } })).status,
    ).toBe(421);
  });

  it('accepts further names from PNM_ALLOWED_HOSTS', async () => {
    const { url } = await start({
      PNM_PUBLIC_URL: 'https://pnm.example.org',
      PNM_ALLOWED_HOSTS: 'pnm, Other.Example',
    });
    for (const host of ['pnm:8080', 'other.example']) {
      expect((await raw(url, { path: '/api/health', headers: { Host: host } })).status, host).toBe(
        200,
      );
    }
    expect(
      (await raw(url, { path: '/api/health', headers: { Host: 'third.example' } })).status,
    ).toBe(421);
  });

  it('reads X-Forwarded-Host only from a trusted proxy', async () => {
    const { url } = await start({
      PNM_PUBLIC_URL: 'https://pnm.example.org',
      PNM_TRUSTED_PROXIES: '127.0.0.1',
    });
    const good = await raw(url, {
      path: '/api/health',
      headers: { Host: 'pnm.example.org', 'X-Forwarded-Host': 'pnm.example.org' },
    });
    expect(good.status).toBe(200);
    const bad = await raw(url, {
      path: '/api/health',
      headers: { Host: 'pnm.example.org', 'X-Forwarded-Host': 'evil.example' },
    });
    expect(bad.status).toBe(421);
    // Not trusted: the header says nothing.
    const other = await startApp({ PNM_PUBLIC_URL: 'https://pnm.example.org' });
    try {
      const ignored = await raw(other.url, {
        path: '/api/health',
        headers: { Host: 'pnm.example.org', 'X-Forwarded-Host': 'evil.example' },
      });
      expect(ignored.status).toBe(200);
    } finally {
      await other.stop();
    }
  });
});

describe('requests from other sites', () => {
  it('refuses a change that carries a foreign Origin', async () => {
    const { url } = await start();
    const response = await raw(url, {
      method: 'POST',
      path: '/api/health',
      headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(403);
    expect(JSON.parse(response.body)).toMatchObject({ error: { code: 'cross_origin' } });
  });

  it('accepts the origin of the server itself, by its address or its public address', async () => {
    const { url } = await start({ PNM_PUBLIC_URL: 'https://pnm.example.org' });
    for (const origin of [url, 'https://pnm.example.org']) {
      const response = await raw(url, {
        method: 'POST',
        path: '/api/health',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: '{}',
      });
      // The route exists for GET only, so this is the wrong method, not a refused origin.
      expect(response.status, origin).toBe(405);
    }
  });

  it('does not care about Origin on reads', async () => {
    const { url } = await start();
    const response = await fetch(`${url}/api/health`, {
      headers: { Origin: 'https://evil.example' },
    });
    expect(response.status).toBe(200);
  });
});

describe('the access log', () => {
  it('records method, path, status, duration and size, and nothing of the content', async () => {
    const { url, logs } = await start();
    await fetch(`${url}/api/health?secret=1`);
    await fetch(`${url}/s/SECRETTOKENSECRETTOKEN`);
    await fetch(`${url}/definitely/not/there.txt`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const entries = logs.entries().filter((e) => e['msg'] === 'request');
    expect(entries.length).toBe(3);
    expect(entries[0]).toMatchObject({ method: 'GET', path: '/api/health', status: 200 });
    expect(entries[0]?.['durationMs']).toEqual(expect.any(Number));
    expect(entries[0]?.['bytes']).toBeGreaterThan(0);
    const text = logs.lines.join('\n');
    expect(text).not.toContain('SECRETTOKEN');
    expect(text).not.toContain('secret=1');
    expect(entries[1]).toMatchObject({ path: '/s/:token' });
  });
});
