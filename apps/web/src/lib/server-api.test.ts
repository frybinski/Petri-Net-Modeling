import { createEmptyNet } from '@pnm/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeServer } from '../test/fake-server';
import {
  SERVER_MARKER_NAME,
  ServerError,
  fetchHealth,
  isHealth,
  pageMarkedByServer,
  serverApi,
  serverLlmBaseUrl,
  serverUrl,
  shareTokenOf,
} from './server-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the marker of the server in the page', () => {
  it('is found only where the server put it', () => {
    expect(pageMarkedByServer()).toBe(false);
    const fake = createFakeServer();
    fake.install();
    expect(pageMarkedByServer()).toBe(true);
    expect(document.querySelector(`meta[name="${SERVER_MARKER_NAME}"]`)).not.toBeNull();
    fake.restore();
    expect(pageMarkedByServer()).toBe(false);
  });

  it('can be looked for in another document', () => {
    const other = new DOMParser().parseFromString(
      `<html><head><meta name="${SERVER_MARKER_NAME}" content="1.2.0"></head><body></body></html>`,
      'text/html',
    );
    expect(pageMarkedByServer(other)).toBe(true);
    expect(pageMarkedByServer(new DOMParser().parseFromString('<p>x</p>', 'text/html'))).toBe(
      false,
    );
  });
});

describe('finding out whether there is a server', () => {
  it('takes the answer of the health check', async () => {
    const fake = createFakeServer({ name: 'aifb-bis-gpu01', defaultModel: 'm1', models: ['m1'] });
    fake.install();
    const health = await fetchHealth();
    expect(health).toMatchObject({
      app: 'petri-net-modeling',
      name: 'aifb-bis-gpu01',
      features: { projects: true, llm: true },
      llm: { defaultModel: 'm1' },
    });
    expect(fake.calls[0]?.path).toBe('/api/health');
  });

  it('does not take a page that answers every path with HTML for a server', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response('<!doctype html><title>app</title>', {
          headers: { 'Content-Type': 'text/html' },
        }),
    );
    expect(await fetchHealth()).toBeNull();
  });

  it('does not take JSON of another application for a server', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    expect(await fetchHealth()).toBeNull();
  });

  it('finds no server where the path does not exist or the network fails', async () => {
    vi.stubGlobal('fetch', async () => new Response('not found', { status: 404 }));
    expect(await fetchHealth()).toBeNull();
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await fetchHealth()).toBeNull();
  });

  it('checks the shape of the answer', () => {
    expect(isHealth(null)).toBe(false);
    expect(isHealth({ ok: true, app: 'other' })).toBe(false);
    expect(
      isHealth({
        ok: true,
        app: 'petri-net-modeling',
        version: '1',
        name: 'x',
        features: {},
        llm: {},
      }),
    ).toBe(true);
  });
});

describe('addresses', () => {
  it('builds addresses below the base of the app', () => {
    expect(serverUrl('api/v1/projects')).toBe('/api/v1/projects');
    expect(serverUrl('/api/health')).toBe('/api/health');
    expect(serverLlmBaseUrl()).toBe('/llm/v1');
  });

  it('reads the token of a share link from the address', () => {
    const token = 'a'.repeat(43);
    expect(shareTokenOf(`/s/${token}`)).toBe(token);
    expect(shareTokenOf(`/s/${token}/`)).toBe(token);
    expect(shareTokenOf('/')).toBeNull();
    expect(shareTokenOf('/s/')).toBeNull();
    expect(shareTokenOf('/s/short')).toBeNull();
    expect(shareTokenOf(`/x/s/${token}`)).toBeNull();
    expect(shareTokenOf(`/s/${token}/more`)).toBeNull();
  });
});

describe('the calls', () => {
  it('lists, creates and reads projects', async () => {
    const fake = createFakeServer();
    fake.install();
    const created = await serverApi.create(createEmptyNet('Crossing'), 'My crossing');
    expect(created).toMatchObject({ name: 'My crossing', version: 1 });
    expect((await serverApi.list()).map((p) => p.name)).toEqual(['My crossing']);
    const loaded = await serverApi.get(created.id);
    expect(loaded.net.name).toBe('My crossing');
    expect(loaded.project.version).toBe(1);
    expect(loaded.shares).toEqual({});
    expect(fake.calls.at(-1)).toMatchObject({
      method: 'GET',
      headers: { accept: 'application/json' },
    });
  });

  it('saves with If-Match and shows the conflict', async () => {
    const fake = createFakeServer();
    fake.install();
    const id = fake.add('P');
    const saved = await serverApi.save(id, createEmptyNet('P2'), 1);
    expect(saved.version).toBe(2);
    expect(fake.calls.at(-1)?.headers['if-match']).toBe('"1"');
    expect(fake.calls.at(-1)?.headers['content-type']).toBe('application/json');
    try {
      await serverApi.save(id, createEmptyNet('P3'), 1);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ServerError);
      const error = e as ServerError;
      expect(error.isConflict).toBe(true);
      expect(error.currentVersion).toBe(2);
      expect(error.code).toBe('conflict');
      expect(error.message).toContain('version 2');
    }
  });

  it('reads versions and share links', async () => {
    const fake = createFakeServer();
    fake.install();
    const id = fake.add('P');
    fake.saveElsewhere(id, createEmptyNet('P v2'));
    expect((await serverApi.versions(id)).map((v) => v.version)).toEqual([2, 1]);
    expect((await serverApi.getVersion(id, 1)).net.name).toBe('P');
    const read = await serverApi.share(id, 'read');
    expect(read.url).toContain(`/s/${read.token}`);
    const again = await serverApi.share(id, 'read');
    expect(again.token).toBe(read.token);
    const rotated = await serverApi.share(id, 'read', true);
    expect(rotated.token).not.toBe(read.token);
    const shared = await serverApi.shared(rotated.token);
    expect(shared).toMatchObject({ mode: 'read', project: { id, version: 2 } });
    await serverApi.unshare(id, 'read');
    await expect(serverApi.shared(rotated.token)).rejects.toMatchObject({ status: 404 });
  });

  it('saves through a link that can write, and is refused through one that cannot', async () => {
    const fake = createFakeServer();
    fake.install();
    const id = fake.add('P');
    const write = await serverApi.share(id, 'write');
    const read = await serverApi.share(id, 'read');
    expect((await serverApi.saveShared(write.token, createEmptyNet('P2'), 1)).version).toBe(2);
    await expect(serverApi.saveShared(read.token, createEmptyNet('P3'), 2)).rejects.toMatchObject({
      status: 403,
    });
    await expect(serverApi.saveShared(write.token, createEmptyNet('P3'), 1)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('removes projects to the trash and brings them back', async () => {
    const fake = createFakeServer();
    fake.install();
    const id = fake.add('P');
    await serverApi.remove(id);
    expect(await serverApi.list()).toEqual([]);
    expect((await serverApi.trash()).map((p) => p.name)).toEqual(['P']);
    await serverApi.restore(id);
    expect((await serverApi.list()).map((p) => p.name)).toEqual(['P']);
  });

  it('turns a failed connection and an error page into errors with a message', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(serverApi.list()).rejects.toMatchObject({ status: 0, code: 'network' });
    vi.stubGlobal('fetch', async () => new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(serverApi.list()).rejects.toMatchObject({
      status: 502,
      message: 'The server answered with HTTP 502.',
    });
  });

  it('refuses an answer that holds no net', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ project: {}, shares: {}, net: { version: '1.0' } }), {
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    await expect(serverApi.get('x')).rejects.toMatchObject({ code: 'bad_response' });
  });
});
