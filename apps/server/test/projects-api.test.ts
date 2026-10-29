import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/basic-auth';
import { nodeFs, type FsOps } from '../src/projects/fs-ops';
import { example, json, startApp, tempDir, type Loose, type RunningApp } from './helpers';

const apps: RunningApp[] = [];
const scratches: Array<ReturnType<typeof tempDir>> = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.stop();
  for (const s of scratches.splice(0)) s.cleanup();
});

async function start(
  env: Record<string, string | undefined> = {},
  fs?: FsOps,
  dataDir?: string,
): Promise<RunningApp> {
  const app = await startApp(
    { ...(dataDir && { PNM_DATA_DIR: dataDir }), ...env },
    fs ? { fs } : {},
  );
  apps.push(app);
  return app;
}

function dataDir(): string {
  const scratch = tempDir();
  scratches.push(scratch);
  return scratch.dir;
}

const netOf = (name = 'traffic-light'): Record<string, unknown> =>
  JSON.parse(readFileSync(example(name), 'utf8')) as Record<string, unknown>;

function send(
  url: string,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${url}${path}`, {
    method,
    headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...headers },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

async function create(url: string, net = netOf(), name?: string): Promise<string> {
  const response = await send(url, 'POST', '/api/v1/projects', { net, ...(name && { name }) });
  expect(response.status).toBe(201);
  return (await json(response))['project']['id'] as string;
}

describe('creating and reading projects', () => {
  it('stores a net, answers 201 with Location and ETag and gives the net back', async () => {
    const { url } = await start();
    const net = netOf('order-processing');
    const response = await send(url, 'POST', '/api/v1/projects', { net });
    expect(response.status).toBe(201);
    const body = await json(response);
    const id = body['project']['id'] as string;
    expect(response.headers.get('location')).toBe(`/api/v1/projects/${id}`);
    expect(response.headers.get('etag')).toBe('"1"');
    expect(body['project']).toMatchObject({
      name: net['name'],
      version: 1,
      shared: { read: false, write: false },
      places: (net['places'] as unknown[]).length,
    });

    const read = await send(url, 'GET', `/api/v1/projects/${id}`);
    expect(read.status).toBe(200);
    expect(read.headers.get('etag')).toBe('"1"');
    const got = await json(read);
    expect(got['net']['name']).toBe(net['name']);
    expect(got['net']['places']).toEqual(net['places']);
    expect(got['shares']).toEqual({});

    const list = await json(await send(url, 'GET', '/api/v1/projects'));
    expect(list['projects']).toHaveLength(1);
    expect(list['projects'][0]['id']).toBe(id);
    // The list shows nothing that opens a project (no tokens).
    expect(JSON.stringify(list)).not.toContain('token');
  });

  it('names a project as asked', async () => {
    const { url } = await start();
    const id = await create(url, netOf(), 'My crossing');
    const got = await json(await send(url, 'GET', `/api/v1/projects/${id}`));
    expect(got['project']['name']).toBe('My crossing');
  });

  it('answers 404 for ids that do not exist or are not ids', async () => {
    const { url } = await start();
    for (const id of ['00000000-0000-4000-8000-000000000000', 'nope', '..%2f..%2fetc', '%00']) {
      expect((await send(url, 'GET', `/api/v1/projects/${id}`)).status, id).toBe(404);
      expect((await send(url, 'GET', `/api/v1/projects/${id}/versions`)).status, id).toBe(404);
    }
    const id = await create(url);
    expect((await send(url, 'GET', `/api/v1/projects/${id}/versions/9`)).status).toBe(404);
    expect((await send(url, 'GET', `/api/v1/projects/${id}/versions/zero`)).status).toBe(404);
    expect((await send(url, 'GET', `/api/v1/projects/${id}/versions/0`)).status).toBe(404);
  });

  it('rejects documents that are no net with 422 and bodies that are no JSON with 400 and 415', async () => {
    const { url } = await start();
    const broken = await send(url, 'POST', '/api/v1/projects', { net: { version: '1.0' } });
    expect(broken.status).toBe(422);
    expect(await json(broken)).toMatchObject({ error: { code: 'net_format' } });
    expect((await send(url, 'POST', '/api/v1/projects', { net: 'text' })).status).toBe(400);
    expect((await send(url, 'POST', '/api/v1/projects', {})).status).toBe(400);
    expect((await send(url, 'POST', '/api/v1/projects', { net: netOf(), extra: 1 })).status).toBe(
      400,
    );
    const plain = await fetch(`${url}/api/v1/projects`, {
      method: 'POST',
      body: JSON.stringify({ net: netOf() }),
    });
    expect(plain.status).toBe(415);
    expect((await json(await send(url, 'GET', '/api/v1/projects')))['projects']).toEqual([]);
  });

  it('stores a net with errors: work in progress is allowed', async () => {
    const { url } = await start();
    const net = netOf();
    (net['arcs'] as Array<Record<string, unknown>>).push({
      id: 'broken',
      source: 'nowhere',
      target: 'nothing',
      weight: 1,
    });
    expect((await send(url, 'POST', '/api/v1/projects', { net })).status).toBe(201);
  });
});

describe('saving versions', () => {
  it('needs If-Match, answers 409 for an old version and 428 for none', async () => {
    const { url } = await start();
    const id = await create(url);
    const net = netOf();
    const missing = await send(url, 'PUT', `/api/v1/projects/${id}`, { net });
    expect(missing.status).toBe(428);
    expect(await json(missing)).toMatchObject({ error: { code: 'precondition_required' } });

    const ok = await send(
      url,
      'PUT',
      `/api/v1/projects/${id}`,
      { net, note: 'second' },
      { 'If-Match': '"1"' },
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get('etag')).toBe('"2"');
    expect((await json(ok))['project']['version']).toBe(2);

    const stale = await send(url, 'PUT', `/api/v1/projects/${id}`, { net }, { 'If-Match': '"1"' });
    expect(stale.status).toBe(409);
    expect(stale.headers.get('etag')).toBe('"2"');
    expect(await json(stale)).toMatchObject({
      error: { code: 'conflict', details: { currentVersion: 2 } },
    });

    const forced = await send(url, 'PUT', `/api/v1/projects/${id}`, { net }, { 'If-Match': '*' });
    expect(forced.status).toBe(200);
    expect(forced.headers.get('etag')).toBe('"3"');
    // The different ways to write a version number.
    for (const [value, expected] of [
      ['3', 200],
      ['W/"4"', 200],
      ['"abc"', 400],
      ['', 400],
    ] as const) {
      const response = await send(
        url,
        'PUT',
        `/api/v1/projects/${id}`,
        { net },
        { 'If-Match': value },
      );
      expect(response.status, value).toBe(expected);
    }
  });

  it('lists the versions and gives each one back as it was saved', async () => {
    const { url } = await start();
    const first = netOf('traffic-light');
    const id = await create(url, first);
    const second = netOf('producer-consumer');
    await send(
      url,
      'PUT',
      `/api/v1/projects/${id}`,
      { net: second, note: 'changed the net' },
      { 'If-Match': '1' },
    );
    const versions = (await json(await send(url, 'GET', `/api/v1/projects/${id}/versions`)))[
      'versions'
    ] as Array<Loose>;
    expect(versions.map((v) => v['version'])).toEqual([2, 1]);
    expect(versions[0]).toMatchObject({
      name: second['name'],
      note: 'changed the net',
      places: (second['places'] as unknown[]).length,
      transitions: (second['transitions'] as unknown[]).length,
      arcs: (second['arcs'] as unknown[]).length,
    });
    expect(versions[0]?.['bytes']).toBeGreaterThan(100);
    const v1 = await json(await send(url, 'GET', `/api/v1/projects/${id}/versions/1`));
    expect(v1['net']['name']).toBe(first['name']);
    expect(v1['version']['version']).toBe(1);
    const current = await json(await send(url, 'GET', `/api/v1/projects/${id}`));
    expect(current['net']['name']).toBe(second['name']);
    expect(current['project']['name']).toBe(second['name']);
  });

  it('survives a restart of the server', async () => {
    const dir = dataDir();
    const first = await start({}, undefined, dir);
    const id = await create(first.url, netOf(), 'Persistent');
    await send(
      first.url,
      'PUT',
      `/api/v1/projects/${id}`,
      { net: netOf('producer-consumer') },
      { 'If-Match': '1' },
    );
    const share = await json(
      await send(first.url, 'POST', `/api/v1/projects/${id}/share`, { mode: 'read' }),
    );
    await first.stop();
    apps.splice(apps.indexOf(first), 1);

    const second = await start({}, undefined, dir);
    const list = await json(await send(second.url, 'GET', '/api/v1/projects'));
    expect(list['projects']).toHaveLength(1);
    expect(list['projects'][0]).toMatchObject({
      id,
      version: 2,
      shared: { read: true, write: false },
    });
    const linked = await send(second.url, 'GET', `/api/v1/shared/${share['token']}`);
    expect(linked.status).toBe(200);
    expect((await json(linked))['project']['version']).toBe(2);
  });

  it('keeps a version complete when the disk breaks while writing it', async () => {
    const dir = dataDir();
    let writes = 0;
    let breakAt = Infinity;
    const fs: FsOps = {
      ...nodeFs,
      async writeNew(path, data) {
        writes += 1;
        if (writes >= breakAt) {
          await nodeFs.writeNew(path, data.slice(0, 20));
          throw new Error('disk full');
        }
        await nodeFs.writeNew(path, data);
      },
    };
    const { url } = await start({}, fs, dir);
    const id = await create(url);
    breakAt = writes + 1;
    const failed = await send(
      url,
      'PUT',
      `/api/v1/projects/${id}`,
      { net: netOf('producer-consumer') },
      { 'If-Match': '1' },
    );
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toContain('disk full');
    breakAt = Infinity;
    const files = readdirSync(join(dir, 'projects', id));
    expect(files.filter((f) => f.endsWith('.tmp'))).toEqual([]);
    const read = await json(await send(url, 'GET', `/api/v1/projects/${id}`));
    expect(read['project']['version']).toBe(1);
    expect(read['net']['name']).toBe(netOf()['name']);
    // The next save works.
    const next = await send(
      url,
      'PUT',
      `/api/v1/projects/${id}`,
      { net: netOf('producer-consumer') },
      { 'If-Match': '1' },
    );
    expect(next.status).toBe(200);
  });

  it('thins old versions out beyond PNM_MAX_VERSIONS', async () => {
    const { url } = await start({ PNM_MAX_VERSIONS: '20' });
    const id = await create(url);
    for (let n = 1; n < 31; n += 1) {
      const response = await send(
        url,
        'PUT',
        `/api/v1/projects/${id}`,
        { net: netOf() },
        { 'If-Match': String(n) },
      );
      expect(response.status).toBe(200);
    }
    const versions = (await json(await send(url, 'GET', `/api/v1/projects/${id}/versions`)))[
      'versions'
    ] as Array<{ version: number }>;
    expect(versions.map((v) => v.version).reverse()).toEqual([
      10,
      20,
      ...Array.from({ length: 10 }, (_, i) => 22 + i),
    ]);
  });
});

describe('share links', () => {
  it('opens a project for reading and refuses to save through a read link', async () => {
    const { url, config } = await start();
    const id = await create(url);
    const made = await send(url, 'POST', `/api/v1/projects/${id}/share`, { mode: 'read' });
    expect(made.status).toBe(201);
    const link = await json(made);
    expect(link['token']).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(link['url']).toBe(`${config.publicUrl}/s/${link['token']}`);
    expect(link['mode']).toBe('read');

    const again = await send(url, 'POST', `/api/v1/projects/${id}/share`, { mode: 'read' });
    expect(again.status).toBe(200);
    expect((await json(again))['token']).toBe(link['token']);

    const shared = await send(url, 'GET', `/api/v1/shared/${link['token']}`);
    expect(shared.status).toBe(200);
    expect(shared.headers.get('etag')).toBe('"1"');
    const body = await json(shared);
    expect(body['mode']).toBe('read');
    expect(body['net']['name']).toBe(netOf()['name']);
    expect(body['project']).toEqual({
      id,
      name: netOf()['name'],
      version: 1,
      updatedAt: expect.any(String),
    });

    const write = await send(
      url,
      'PUT',
      `/api/v1/shared/${link['token']}`,
      { net: netOf() },
      { 'If-Match': '1' },
    );
    expect(write.status).toBe(403);
    expect(await json(write)).toMatchObject({ error: { code: 'forbidden' } });
    const owner = await json(await send(url, 'GET', `/api/v1/projects/${id}`));
    expect(owner['project']['version']).toBe(1);
    expect(owner['shares']['read']['token']).toBe(link['token']);
  });

  it('lets a write link save versions, with the same protection against overwriting', async () => {
    const { url } = await start();
    const id = await create(url);
    const link = await json(
      await send(url, 'POST', `/api/v1/projects/${id}/share`, { mode: 'write' }),
    );
    const net = netOf('producer-consumer');
    const missing = await send(url, 'PUT', `/api/v1/shared/${link['token']}`, { net });
    expect(missing.status).toBe(428);
    const saved = await send(
      url,
      'PUT',
      `/api/v1/shared/${link['token']}`,
      { net },
      { 'If-Match': '"1"' },
    );
    expect(saved.status).toBe(200);
    expect(saved.headers.get('etag')).toBe('"2"');
    const stale = await send(
      url,
      'PUT',
      `/api/v1/shared/${link['token']}`,
      { net },
      { 'If-Match': '"1"' },
    );
    expect(stale.status).toBe(409);
    const versions = (await json(await send(url, 'GET', `/api/v1/projects/${id}/versions`)))[
      'versions'
    ] as Array<Record<string, unknown>>;
    expect(versions[0]).toMatchObject({ version: 2, note: 'saved through a share link' });
    // The write link is not a way into the rest of the server.
    expect((await send(url, 'GET', `/api/v1/projects/${link['token']}`)).status).toBe(404);
    expect((await send(url, 'DELETE', `/api/v1/shared/${link['token']}`)).status).toBe(405);
  });

  it('removes links and gives a new one on request', async () => {
    const { url } = await start();
    const id = await create(url);
    const read = await json(
      await send(url, 'POST', `/api/v1/projects/${id}/share`, { mode: 'read' }),
    );
    const write = await json(
      await send(url, 'POST', `/api/v1/projects/${id}/share`, { mode: 'write' }),
    );
    const rotated = await json(
      await send(url, 'POST', `/api/v1/projects/${id}/share`, { mode: 'read', rotate: true }),
    );
    expect(rotated['token']).not.toBe(read['token']);
    expect((await send(url, 'GET', `/api/v1/shared/${read['token']}`)).status).toBe(404);
    expect((await send(url, 'GET', `/api/v1/shared/${rotated['token']}`)).status).toBe(200);

    expect((await send(url, 'DELETE', `/api/v1/projects/${id}/share?mode=read`)).status).toBe(204);
    expect((await send(url, 'GET', `/api/v1/shared/${rotated['token']}`)).status).toBe(404);
    expect((await send(url, 'GET', `/api/v1/shared/${write['token']}`)).status).toBe(200);
    expect((await send(url, 'DELETE', `/api/v1/projects/${id}/share`)).status).toBe(204);
    expect((await send(url, 'GET', `/api/v1/shared/${write['token']}`)).status).toBe(404);
    expect((await send(url, 'DELETE', `/api/v1/projects/${id}/share?mode=banana`)).status).toBe(
      400,
    );
  });

  it('answers 404 for tokens that are wrong, short or not tokens', async () => {
    const { url } = await start();
    for (const token of ['x', 'x'.repeat(43), 'a'.repeat(100), '..%2f..']) {
      expect((await send(url, 'GET', `/api/v1/shared/${token}`)).status, token).toBe(404);
    }
  });

  it('validates the request', async () => {
    const { url } = await start();
    const id = await create(url);
    expect(
      (await send(url, 'POST', `/api/v1/projects/${id}/share`, { mode: 'admin' })).status,
    ).toBe(400);
    expect((await send(url, 'POST', `/api/v1/projects/${id}/share`, {})).status).toBe(400);
    expect(
      (
        await send(url, 'POST', '/api/v1/projects/00000000-0000-4000-8000-000000000000/share', {
          mode: 'read',
        })
      ).status,
    ).toBe(404);
  });

  it('is the one thing that works without the password when one is set', async () => {
    const { url } = await start({ PNM_BASIC_AUTH: hashPassword('alice', 'correct horse') });
    const auth = {
      Authorization: `Basic ${Buffer.from('alice:correct horse').toString('base64')}`,
    };
    expect((await send(url, 'GET', '/api/v1/projects')).status).toBe(401);
    const created = await send(url, 'POST', '/api/v1/projects', { net: netOf() }, auth);
    expect(created.status).toBe(201);
    const id = (await json(created))['project']['id'] as string;
    const link = await json(
      await send(url, 'POST', `/api/v1/projects/${id}/share`, { mode: 'write' }, auth),
    );
    expect((await send(url, 'GET', `/api/v1/shared/${link['token']}`)).status).toBe(200);
    expect(
      (
        await send(
          url,
          'PUT',
          `/api/v1/shared/${link['token']}`,
          { net: netOf() },
          { 'If-Match': '1' },
        )
      ).status,
    ).toBe(200);
    expect((await send(url, 'GET', `/s/${link['token']}`)).status).toBe(200);
    // Everything else still asks for the password.
    expect((await send(url, 'GET', `/api/v1/projects/${id}`)).status).toBe(401);
    expect((await send(url, 'GET', `/api/v1/projects/${id}/versions`)).status).toBe(401);
    expect((await send(url, 'DELETE', `/api/v1/projects/${id}`)).status).toBe(401);
    expect((await send(url, 'POST', '/api/v1/validate', netOf())).status).toBe(401);
  });
});

describe('the trash', () => {
  it('moves a project to the trash, stops its links and restores it', async () => {
    const { url } = await start();
    const id = await create(url);
    const link = await json(
      await send(url, 'POST', `/api/v1/projects/${id}/share`, { mode: 'read' }),
    );
    expect((await send(url, 'DELETE', `/api/v1/projects/${id}`)).status).toBe(204);
    expect((await json(await send(url, 'GET', '/api/v1/projects')))['projects']).toEqual([]);
    expect((await send(url, 'GET', `/api/v1/projects/${id}`)).status).toBe(404);
    expect((await send(url, 'GET', `/api/v1/shared/${link['token']}`)).status).toBe(404);
    expect((await send(url, 'DELETE', `/api/v1/projects/${id}`)).status).toBe(404);

    const trash = await json(await send(url, 'GET', '/api/v1/trash'));
    expect(trash['projects']).toHaveLength(1);
    expect(trash['projects'][0]).toMatchObject({
      id,
      deletedAt: expect.any(String),
      purgeAt: expect.any(String),
    });

    const restored = await send(url, 'POST', `/api/v1/trash/${id}/restore`);
    expect(restored.status).toBe(200);
    expect((await send(url, 'GET', `/api/v1/projects/${id}`)).status).toBe(200);
    expect((await send(url, 'GET', `/api/v1/shared/${link['token']}`)).status).toBe(404);
    expect((await send(url, 'POST', `/api/v1/trash/${id}/restore`)).status).toBe(404);
  });
});

describe('requests from other sites', () => {
  it('refuses to change or delete a project when the request comes from another origin', async () => {
    const { url } = await start();
    const id = await create(url);
    const evil = { Origin: 'https://evil.example', 'Content-Type': 'application/json' };
    const attempts: Array<[string, string, string?]> = [
      ['DELETE', `/api/v1/projects/${id}`],
      ['PUT', `/api/v1/projects/${id}`, JSON.stringify({ net: netOf() })],
      ['POST', '/api/v1/projects', JSON.stringify({ net: netOf() })],
    ];
    for (const [method, path, body] of attempts) {
      const response = await fetch(`${url}${path}`, {
        method,
        headers: { ...evil, 'If-Match': '1' },
        ...(body !== undefined && { body }),
      });
      expect(response.status, `${method} ${path}`).toBe(403);
    }
    expect((await send(url, 'GET', `/api/v1/projects/${id}`)).status).toBe(200);
  });
});
