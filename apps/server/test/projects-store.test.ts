import { mkdirSync, readFileSync, readdirSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { createEmptyNet, parseNetText, type PetriNet } from '@pnm/core';
import { afterEach, describe, expect, it } from 'vitest';
import { silentLogger } from '../src/logger';
import { nodeFs, type FsOps } from '../src/projects/fs-ops';
import {
  ConflictError,
  NotFoundError,
  openProjectStore,
  versionsToKeep,
  type ProjectStore,
} from '../src/projects/store';
import { example, tempDir } from './helpers';

const scratch = tempDir();
let counter = 0;
let stores: ProjectStore[] = [];
afterEach(() => {
  for (const store of stores) store.close();
  stores = [];
});

function dirFor(label: string): string {
  counter += 1;
  return join(scratch.dir, `${label}-${counter}`);
}

async function open(
  dataDir: string,
  options: Partial<Parameters<typeof openProjectStore>[0]> = {},
): Promise<ProjectStore> {
  const store = await openProjectStore({
    dataDir,
    maxVersions: 200,
    trashDays: 30,
    logger: silentLogger,
    ...options,
  });
  stores.push(store);
  return store;
}

function netNamed(name: string, places = 1): PetriNet {
  const net = createEmptyNet(name);
  return {
    ...net,
    places: Array.from({ length: places }, (_, i) => ({
      id: `p${i}`,
      name: `p${i}`,
      position: { x: i * 100, y: 0 },
    })),
  };
}

const parcel = (): PetriNet => parseNetText(readFileSync(example('parcel-center'), 'utf8'));

describe('versionsToKeep', () => {
  it('keeps everything up to the limit', () => {
    expect(versionsToKeep([1, 2, 3], 3)).toEqual([1, 2, 3]);
  });

  it('keeps the newest half and every tenth of the older ones', () => {
    const all = Array.from({ length: 41 }, (_, i) => i + 1);
    expect(versionsToKeep(all, 40)).toEqual([10, 20, ...all.slice(-20)]);
  });

  it('drops the oldest if that is still too many', () => {
    const all = Array.from({ length: 300 }, (_, i) => i + 1);
    const kept = versionsToKeep(all, 20);
    expect(kept).toHaveLength(20);
    expect(kept.at(-1)).toBe(300);
    expect(Math.min(...kept)).toBe(200);
  });
});

describe('creating and reading', () => {
  it('stores a net as version 1 and gives it back unchanged', async () => {
    const store = await open(dirFor('create'));
    const net = parcel();
    const info = await store.create({ net });
    expect(info).toMatchObject({
      name: net.name,
      version: 1,
      places: net.places.length,
      transitions: net.transitions.length,
      arcs: net.arcs.length,
      shared: { read: false, write: false },
    });
    expect(info.id).toMatch(/^[0-9a-f-]{36}$/);
    const read = await store.get(info.id);
    expect(read.net).toEqual(JSON.parse(JSON.stringify(net)));
    expect(store.list().map((p) => p.id)).toEqual([info.id]);
  });

  it('takes the name from the call, else from the net, and cleans it', async () => {
    const store = await open(dirFor('names'));
    expect((await store.create({ net: netNamed('From net') })).name).toBe('From net');
    expect((await store.create({ net: netNamed('x'), name: '  My \t project\n' })).name).toBe(
      'My project',
    );
    expect((await store.create({ net: netNamed(''), name: '   ' })).name).toBe('Untitled net');
    const long = await store.create({ net: netNamed('x'), name: 'n'.repeat(500) });
    expect(long.name).toHaveLength(200);
  });

  it('lists the most recently changed first', async () => {
    let tick = 0;
    const store = await open(dirFor('order'), { now: () => new Date(2026, 0, 1, 0, 0, tick++) });
    const a = await store.create({ net: netNamed('A') });
    const b = await store.create({ net: netNamed('B') });
    expect(store.list().map((p) => p.name)).toEqual(['B', 'A']);
    await store.save(a.id, { net: netNamed('A'), ifMatch: 1 });
    expect(store.list().map((p) => p.name)).toEqual(['A', 'B']);
    expect(b.id).not.toBe(a.id);
  });

  it('says that a project does not exist', async () => {
    const store = await open(dirFor('missing'));
    await expect(store.get('00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(() => store.versions('00000000-0000-4000-8000-000000000000')).toThrow(NotFoundError);
  });
});

describe('versions', () => {
  it('makes every save a new version and keeps the old ones unchanged', async () => {
    const store = await open(dirFor('versions'));
    const { id } = await store.create({ net: netNamed('v1', 1) });
    const second = await store.save(id, { net: netNamed('v2', 2), ifMatch: 1, note: 'second' });
    const third = await store.save(id, { net: netNamed('v3', 3), ifMatch: 2 });
    expect([second.version, third.version]).toEqual([2, 3]);
    expect(store.versions(id).map((v) => v.version)).toEqual([3, 2, 1]);
    expect(store.versions(id).map((v) => v.places)).toEqual([3, 2, 1]);
    expect(store.versions(id)[1]).toMatchObject({ note: 'second', name: 'v2' });
    const first = await store.getVersion(id, 1);
    expect((first.net as PetriNet).name).toBe('v1');
    expect((first.net as PetriNet).places).toHaveLength(1);
    expect(((await store.get(id)).net as PetriNet).name).toBe('v3');
    await expect(store.getVersion(id, 9)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses a save that is based on an old version, and says which one is current', async () => {
    const store = await open(dirFor('conflict'));
    const { id } = await store.create({ net: netNamed('a') });
    await store.save(id, { net: netNamed('b'), ifMatch: 1 });
    try {
      await store.save(id, { net: netNamed('c'), ifMatch: 1 });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictError);
      expect((error as ConflictError).currentVersion).toBe(2);
    }
    expect(store.versions(id)).toHaveLength(2);
  });

  it('lets * overwrite whatever is there', async () => {
    const store = await open(dirFor('star'));
    const { id } = await store.create({ net: netNamed('a') });
    await store.save(id, { net: netNamed('b'), ifMatch: 1 });
    const info = await store.save(id, { net: netNamed('c'), ifMatch: '*' });
    expect(info.version).toBe(3);
  });

  it('lets exactly one of several parallel saves win', async () => {
    const store = await open(dirFor('race'));
    const { id } = await store.create({ net: netNamed('a') });
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => store.save(id, { net: netNamed(`n${i}`), ifMatch: 1 })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      results.filter((r) => r.status === 'rejected' && r.reason instanceof ConflictError),
    ).toHaveLength(9);
    expect(store.versions(id)).toHaveLength(2);
  });

  it('keeps writing in order when saves follow each other quickly', async () => {
    const store = await open(dirFor('chain'));
    const { id } = await store.create({ net: netNamed('a') });
    const saves = Array.from({ length: 8 }, (_, i) =>
      store.save(id, { net: netNamed(`n${i + 2}`), ifMatch: '*' }),
    );
    const versions = (await Promise.all(saves)).map((p) => p.version);
    expect(versions).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('thins old versions out: the newest half stays, of the older ones every tenth', async () => {
    const dir = dirFor('thin');
    const store = await open(dir, { maxVersions: 20 });
    const { id } = await store.create({ net: netNamed('a') });
    for (let n = 2; n <= 31; n += 1)
      await store.save(id, { net: netNamed(`n${n}`), ifMatch: n - 1 });
    const kept = store
      .versions(id)
      .map((v) => v.version)
      .reverse();
    expect(kept).toEqual([10, 20, ...Array.from({ length: 10 }, (_, i) => 22 + i)]);
    // The files agree with the index, and the numbers are not used again.
    const files = readdirSync(join(dir, 'projects', id))
      .filter((f) => f.startsWith('v'))
      .sort();
    expect(files).toEqual(kept.map((n) => `v${String(n).padStart(4, '0')}.pn.json`));
    const next = await store.save(id, { net: netNamed('n32'), ifMatch: 31 });
    expect(next.version).toBe(32);
    await expect(store.getVersion(id, 5)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('writing is atomic', () => {
  /** A file system whose writes break halfway after `failAfter` successful ones. */
  function breaking(
    failAfter: number,
    what: 'writeNew' | 'rename',
  ): { fs: FsOps; calls: () => number } {
    let calls = 0;
    const fs: FsOps = {
      ...nodeFs,
      async writeNew(path, data) {
        if (what === 'writeNew') {
          calls += 1;
          if (calls > failAfter) {
            // Half of the file reaches the disk, then the process "crashes".
            await nodeFs.writeNew(path, data.slice(0, Math.floor(data.length / 2)));
            throw new Error('disk full');
          }
        }
        await nodeFs.writeNew(path, data);
      },
      async rename(from, to) {
        if (what === 'rename') {
          calls += 1;
          if (calls > failAfter) throw new Error('rename failed');
        }
        await nodeFs.rename(from, to);
      },
    };
    return { fs, calls: () => calls };
  }

  it('leaves the project as it was when writing a version breaks', async () => {
    const dir = dirFor('atomic-version');
    // The probe, version 1 and the index of the project are written first; the fourth write breaks.
    const { fs } = breaking(3, 'writeNew');
    const store = await open(dir, { fs });
    const { id } = await store.create({ net: netNamed('first', 1) });
    await expect(store.save(id, { net: netNamed('second', 2), ifMatch: 1 })).rejects.toThrow(
      'disk full',
    );
    const files = readdirSync(join(dir, 'projects', id));
    expect(files.filter((f) => f.endsWith('.tmp'))).toEqual([]);
    expect(files.filter((f) => f.startsWith('v')).sort()).toEqual(['v0001.pn.json']);
    expect(store.versions(id)).toHaveLength(1);
    expect(((await store.get(id)).net as PetriNet).name).toBe('first');
    // The store still works: it only failed to write.
    const again = await open(dir);
    expect(again.versions(id)).toHaveLength(1);
  });

  it('takes the version back when the index cannot be written', async () => {
    const dir = dirFor('atomic-meta');
    // Renames: v1, meta (create) are 2; the version file of the save is the 3rd, its meta the 4th.
    const { fs } = breaking(3, 'rename');
    const store = await open(dir, { fs });
    const { id } = await store.create({ net: netNamed('first') });
    await expect(store.save(id, { net: netNamed('second'), ifMatch: 1 })).rejects.toThrow(
      'rename failed',
    );
    const files = readdirSync(join(dir, 'projects', id));
    expect(files.filter((f) => f.endsWith('.tmp'))).toEqual([]);
    expect(files.filter((f) => f.startsWith('v'))).toEqual(['v0001.pn.json']);
    expect(store.versions(id)).toHaveLength(1);
    const next = await open(dir);
    expect(next.versions(id)).toHaveLength(1);
  });

  it('does not keep a project whose first write broke', async () => {
    const dir = dirFor('atomic-create');
    const { fs } = breaking(1, 'writeNew');
    const store = await open(dir, { fs });
    await expect(store.create({ net: netNamed('x') })).rejects.toThrow('disk full');
    expect(store.list()).toEqual([]);
    expect(readdirSync(join(dir, 'projects'))).toEqual([]);
  });

  it('survives a crash that leaves temporary files and a version the index does not know', async () => {
    const dir = dirFor('crash');
    const store = await open(dir);
    const { id } = await store.create({ net: netNamed('first') });
    await store.save(id, { net: netNamed('second'), ifMatch: 1 });
    store.close();
    const projectDir = join(dir, 'projects', id);
    // A write that never finished, and a version file that was renamed into place but not indexed.
    writeFileSync(join(projectDir, 'v0003.pn.json.abcd1234.tmp'), '{"half":');
    writeFileSync(join(projectDir, 'meta.json.abcd1234.tmp'), '{"half":');
    const third = netNamed('third', 3);
    writeFileSync(
      join(projectDir, 'v0003.pn.json'),
      JSON.stringify({
        version: '1.0',
        profile: 'pt-net',
        name: 'third',
        types: {},
        places: third.places,
        transitions: [],
        arcs: [],
        marking: {},
      }),
    );
    const reopened = await open(dir);
    expect(readdirSync(projectDir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    expect(reopened.versions(id).map((v) => v.version)).toEqual([3, 2, 1]);
    expect(((await reopened.get(id)).net as PetriNet).name).toBe('third');
  });

  it('rebuilds the index from the version files if it is damaged', async () => {
    const dir = dirFor('rebuild');
    const store = await open(dir);
    const { id } = await store.create({ net: netNamed('first') });
    await store.save(id, { net: netNamed('second'), ifMatch: 1 });
    store.close();
    writeFileSync(join(dir, 'projects', id, 'meta.json'), '{ not json');
    const reopened = await open(dir);
    expect(reopened.list()).toHaveLength(1);
    expect(reopened.versions(id).map((v) => v.version)).toEqual([2, 1]);
    expect(reopened.list()[0]?.name).toBe('second');
  });

  it('removes version files that thinning left behind after a crash', async () => {
    const dir = dirFor('leftover');
    const store = await open(dir);
    const { id } = await store.create({ net: netNamed('first') });
    await store.save(id, { net: netNamed('second'), ifMatch: 1 });
    await store.save(id, { net: netNamed('third'), ifMatch: 2 });
    store.close();
    // Pretend version 1 had been thinned out of the index but its file was not removed yet.
    const metaFile = join(dir, 'projects', id, 'meta.json');
    const meta = JSON.parse(readFileSync(metaFile, 'utf8')) as {
      versions: Array<{ version: number }>;
    };
    meta.versions = meta.versions.filter((v) => v.version !== 1);
    writeFileSync(metaFile, JSON.stringify(meta));
    const reopened = await open(dir);
    expect(reopened.versions(id).map((v) => v.version)).toEqual([3, 2]);
    expect(readdirSync(join(dir, 'projects', id)).filter((f) => f.startsWith('v'))).toEqual([
      'v0002.pn.json',
      'v0003.pn.json',
    ]);
  });

  it('fails at the start, with a clear message, if the folder cannot be written', async () => {
    const dir = dirFor('readonly');
    mkdirSync(dir, { recursive: true });
    const failing: FsOps = {
      ...nodeFs,
      async writeNew() {
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
      },
    };
    await expect(open(dir, { fs: failing })).rejects.toThrow(/Cannot write to PNM_DATA_DIR/);
    void chmodSync;
  });
});

describe('persistence', () => {
  it('finds projects, versions and share links again after a restart', async () => {
    const dir = dirFor('restart');
    const first = await open(dir);
    const { id } = await first.create({ net: netNamed('keep') });
    await first.save(id, { net: netNamed('keep 2'), ifMatch: 1 });
    const { share } = await first.share(id, 'write', false);
    first.close();
    const second = await open(dir);
    expect(second.list().map((p) => p.name)).toEqual(['keep 2']);
    expect(second.versions(id)).toHaveLength(2);
    expect(second.byToken(share.token)).toEqual({ id, mode: 'write' });
    expect((await second.save(id, { net: netNamed('keep 3'), ifMatch: 2 })).version).toBe(3);
  });

  it('ignores folders that are not projects', async () => {
    const dir = dirFor('junk');
    mkdirSync(join(dir, 'projects', 'not-an-id'), { recursive: true });
    mkdirSync(join(dir, 'projects', '11111111-2222-4333-8444-555555555555'), { recursive: true });
    writeFileSync(join(dir, 'projects', 'stray.txt'), 'x');
    const store = await open(dir);
    expect(store.list()).toEqual([]);
  });
});

describe('share links', () => {
  it('makes one link per mode with a long random token', async () => {
    const store = await open(dirFor('share'));
    const { id } = await store.create({ net: netNamed('s') });
    const read = await store.share(id, 'read', false);
    const write = await store.share(id, 'write', false);
    expect(read.created && write.created).toBe(true);
    expect(read.share.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(write.share.token).not.toBe(read.share.token);
    expect(store.byToken(read.share.token)).toEqual({ id, mode: 'read' });
    expect(store.byToken(write.share.token)).toEqual({ id, mode: 'write' });
    expect(store.list()[0]?.shared).toEqual({ read: true, write: true });
    expect(store.byToken('x'.repeat(43))).toBeNull();
  });

  it('gives the same link again, or a new one on request that makes the old one useless', async () => {
    const store = await open(dirFor('rotate'));
    const { id } = await store.create({ net: netNamed('s') });
    const first = await store.share(id, 'read', false);
    const again = await store.share(id, 'read', false);
    expect(again).toEqual({ share: first.share, created: false });
    const rotated = await store.share(id, 'read', true);
    expect(rotated.share.token).not.toBe(first.share.token);
    expect(store.byToken(first.share.token)).toBeNull();
    expect(store.byToken(rotated.share.token)).toEqual({ id, mode: 'read' });
  });

  it('removes one link or all', async () => {
    const store = await open(dirFor('unshare'));
    const { id } = await store.create({ net: netNamed('s') });
    const read = await store.share(id, 'read', false);
    const write = await store.share(id, 'write', false);
    await store.unshare(id, 'read');
    expect(store.byToken(read.share.token)).toBeNull();
    expect(store.byToken(write.share.token)).not.toBeNull();
    await store.unshare(id);
    expect(store.byToken(write.share.token)).toBeNull();
    expect(store.list()[0]?.shared).toEqual({ read: false, write: false });
  });
});

describe('the trash', () => {
  it('moves a project out of the list, kills its links and brings it back on request', async () => {
    const store = await open(dirFor('trash'));
    const { id } = await store.create({ net: netNamed('gone') });
    const { share } = await store.share(id, 'read', false);
    await store.remove(id);
    expect(store.list()).toEqual([]);
    expect(store.byToken(share.token)).toBeNull();
    await expect(store.get(id)).rejects.toBeInstanceOf(NotFoundError);
    expect(store.trash().map((p) => p.name)).toEqual(['gone']);
    const restored = await store.restore(id);
    expect(restored.name).toBe('gone');
    expect(restored.shared).toEqual({ read: false, write: false });
    expect(store.trash()).toEqual([]);
    expect(((await store.get(id)).net as PetriNet).name).toBe('gone');
  });

  it('keeps the trash over a restart and purges it after the days are over', async () => {
    const dir = dirFor('purge');
    let now = new Date('2026-10-01T00:00:00Z');
    const clock = (): Date => now;
    const store = await open(dir, { now: clock });
    const { id } = await store.create({ net: netNamed('old') });
    await store.remove(id);
    expect(store.trash()[0]?.purgeAt).toBe('2026-10-31T00:00:00.000Z');
    store.close();
    now = new Date('2026-10-20T00:00:00Z');
    const again = await open(dir, { now: clock });
    expect(again.trash()).toHaveLength(1);
    now = new Date('2026-11-02T00:00:00Z');
    expect(await again.purgeTrash()).toBe(1);
    expect(again.trash()).toEqual([]);
    expect(readdirSync(join(dir, 'trash'))).toEqual([]);
  });

  it('removes at once if the trash is switched off', async () => {
    const dir = dirFor('notrash');
    const store = await open(dir, { trashDays: 0 });
    const { id } = await store.create({ net: netNamed('x') });
    await store.remove(id);
    expect(store.list()).toEqual([]);
    expect(store.trash()).toEqual([]);
    expect(readdirSync(join(dir, 'projects'))).toEqual([]);
  });

  it('cannot restore what is not in the trash', async () => {
    const store = await open(dirFor('norestore'));
    await expect(store.restore('00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
