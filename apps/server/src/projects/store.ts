import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { parseNet, serializeNet, type PetriNet } from '@pnm/core';
import type { Logger } from '../logger';
import { nodeFs, writeAtomic, type FsOps } from './fs-ops';

export type ShareMode = 'read' | 'write';

export interface Share {
  token: string;
  createdAt: string;
}

/** What is known of one saved version without opening it. */
export interface VersionInfo {
  version: number;
  savedAt: string;
  /** The name of the net in this version. */
  name: string;
  bytes: number;
  places: number;
  transitions: number;
  arcs: number;
  note?: string;
}

/** `meta.json` of a project. */
interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  shares: Partial<Record<ShareMode, Share>>;
  versions: VersionInfo[];
  deletedAt?: string;
}

/** A project as the interface shows it. */
export interface ProjectInfo {
  id: string;
  name: string;
  /** The number of the newest version. */
  version: number;
  createdAt: string;
  updatedAt: string;
  places: number;
  transitions: number;
  arcs: number;
  bytes: number;
  shared: { read: boolean; write: boolean };
}

export interface TrashedInfo extends ProjectInfo {
  deletedAt: string;
  /** The project is removed for good at this time. */
  purgeAt: string;
}

/** The newest version is not the one that the writer saw. */
export class ConflictError extends Error {
  readonly currentVersion: number;
  constructor(currentVersion: number, yourVersion: number) {
    super(
      `The project was changed in the meantime: it is at version ${currentVersion}, your changes are based on version ${yourVersion}.`,
    );
    this.name = 'ConflictError';
    this.currentVersion = currentVersion;
  }
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} does not exist.`);
    this.name = 'NotFoundError';
  }
}

export interface StoreOptions {
  dataDir: string;
  /** The most versions kept per project; older ones are thinned out (every tenth stays). */
  maxVersions: number;
  /** Days that a removed project stays in the trash; 0 removes it at once. */
  trashDays: number;
  logger: Logger;
  now?: () => Date;
  fs?: FsOps;
}

export const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MAX_NAME = 200;
const MAX_NOTE = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

const versionFile = (n: number): string => `v${String(n).padStart(4, '0')}.pn.json`;
const VERSION_FILE = /^v(\d{4,})\.pn\.json$/;

function cleanName(name: string | undefined, fallback: string): string {
  const cleaned = [...(name ?? '')]
    .filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME);
  return cleaned === '' ? fallback : cleaned;
}

function describeVersion(
  net: PetriNet,
  text: string,
  version: number,
  savedAt: string,
  note?: string,
): VersionInfo {
  return {
    version,
    savedAt,
    name: net.name,
    bytes: Buffer.byteLength(text),
    places: net.places.length,
    transitions: net.transitions.length,
    arcs: net.arcs.length,
    ...(note !== undefined && note !== '' && { note: note.slice(0, MAX_NOTE) }),
  };
}

/**
 * Which versions stay when there are more than `max`: the newest half always, of the older ones
 * every tenth. If that is still too many, the oldest go.
 */
export function versionsToKeep(versions: readonly number[], max: number): number[] {
  if (versions.length <= max) return [...versions];
  const sorted = [...versions].sort((a, b) => a - b);
  const recentCount = Math.max(1, Math.ceil(max / 2));
  const recent = sorted.slice(-recentCount);
  const older = sorted.slice(0, sorted.length - recentCount).filter((n) => n % 10 === 0);
  const kept = [...older, ...recent];
  return kept.slice(Math.max(0, kept.length - max));
}

export interface ProjectStore {
  list(): ProjectInfo[];
  create(input: { net: PetriNet; name?: string }): Promise<ProjectInfo>;
  get(id: string): Promise<{ info: ProjectInfo; net: unknown }>;
  versions(id: string): VersionInfo[];
  getVersion(
    id: string,
    version: number,
  ): Promise<{ info: ProjectInfo; version: VersionInfo; net: unknown }>;
  /** `ifMatch` is the version that the writer saw, or `*` to write whatever the state is. */
  save(
    id: string,
    input: { net: PetriNet; name?: string; note?: string; ifMatch: number | '*' },
  ): Promise<ProjectInfo>;
  share(id: string, mode: ShareMode, rotate: boolean): Promise<{ share: Share; created: boolean }>;
  /** Removes the link of one mode, or of both if no mode is given. */
  unshare(id: string, mode?: ShareMode): Promise<void>;
  shares(id: string): Partial<Record<ShareMode, Share>>;
  remove(id: string): Promise<void>;
  trash(): TrashedInfo[];
  restore(id: string): Promise<ProjectInfo>;
  /** The project and the right that a token gives. */
  byToken(token: string): { id: string; mode: ShareMode } | null;
  purgeTrash(): Promise<number>;
  close(): void;
}

export async function openProjectStore(options: StoreOptions): Promise<ProjectStore> {
  const fs = options.fs ?? nodeFs;
  const now = options.now ?? (() => new Date());
  const { logger } = options;
  const projectsDir = join(options.dataDir, 'projects');
  const trashDir = join(options.dataDir, 'trash');

  const metas = new Map<string, ProjectMeta>();
  const trashed = new Map<string, ProjectMeta>();
  const tokens = new Map<string, { id: string; mode: ShareMode }>();
  const locks = new Map<string, Promise<unknown>>();

  const dirOf = (id: string): string => join(projectsDir, id);

  /** Runs `task` after the earlier tasks on the same project. */
  function withLock<T>(id: string, task: () => Promise<T>): Promise<T> {
    const previous = locks.get(id) ?? Promise.resolve();
    const run = previous.then(task, task);
    const tail = run.catch(() => undefined);
    locks.set(id, tail);
    void tail.then(() => {
      if (locks.get(id) === tail) locks.delete(id);
    });
    return run;
  }

  function indexTokens(meta: ProjectMeta): void {
    for (const mode of ['read', 'write'] as const) {
      const share = meta.shares[mode];
      if (share) tokens.set(share.token, { id: meta.id, mode });
    }
  }

  function dropTokens(meta: ProjectMeta): void {
    for (const mode of ['read', 'write'] as const) {
      const share = meta.shares[mode];
      if (share) tokens.delete(share.token);
    }
  }

  function infoOf(meta: ProjectMeta): ProjectInfo {
    const last = meta.versions.at(-1);
    return {
      id: meta.id,
      name: meta.name,
      version: last?.version ?? 0,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      places: last?.places ?? 0,
      transitions: last?.transitions ?? 0,
      arcs: last?.arcs ?? 0,
      bytes: last?.bytes ?? 0,
      shared: { read: meta.shares.read !== undefined, write: meta.shares.write !== undefined },
    };
  }

  function metaOf(id: string): ProjectMeta {
    const meta = metas.get(id);
    if (!meta) throw new NotFoundError('The project');
    return meta;
  }

  async function writeMeta(meta: ProjectMeta, dir = dirOf(meta.id)): Promise<void> {
    await writeAtomic(fs, join(dir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  }

  async function readNetFile(path: string): Promise<{ text: string; net: PetriNet }> {
    const text = await fs.readFile(path, 'utf8');
    return { text, net: parseNet(JSON.parse(text)) };
  }

  /**
   * Reads a project folder after a start: the index in `meta.json` is trusted, but files are the
   * truth. A version file newer than the index (a crash after writing it) is added; temporary
   * files and version files that the thinning left behind are removed.
   */
  async function loadProject(dir: string, fallbackId: string): Promise<ProjectMeta | null> {
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      return null;
    }
    for (const name of names.filter((n) => n.endsWith('.tmp'))) {
      await fs.rm(join(dir, name), { force: true }).catch(() => undefined);
    }
    const files = names
      .map((name) => ({ name, n: Number(VERSION_FILE.exec(name)?.[1]) }))
      .filter((f) => Number.isInteger(f.n) && f.n > 0)
      .sort((a, b) => a.n - b.n);
    if (files.length === 0) return null;

    let meta: ProjectMeta | null = null;
    try {
      const parsed = JSON.parse(await fs.readFile(join(dir, 'meta.json'), 'utf8')) as ProjectMeta;
      if (typeof parsed.id === 'string' && Array.isArray(parsed.versions)) meta = parsed;
    } catch {
      // Missing or damaged: rebuilt from the version files below.
    }
    let changed = false;
    const rebuilt = meta === null;
    if (meta === null) {
      logger.warn('project index rebuilt', { id: fallbackId });
      meta = {
        id: fallbackId,
        name: fallbackId,
        createdAt: new Date(await fs.mtimeMs(join(dir, files[0]!.name))).toISOString(),
        updatedAt: new Date(await fs.mtimeMs(join(dir, files.at(-1)!.name))).toISOString(),
        shares: {},
        versions: [],
      };
      changed = true;
    }
    const known = new Set(meta.versions.map((v) => v.version));
    const present = new Set(files.map((f) => f.n));
    const lastIndexed = Math.max(0, ...known);
    // In the index but gone: forget.
    const kept = meta.versions.filter((v) => present.has(v.version));
    if (kept.length !== meta.versions.length) changed = true;
    meta.versions = kept;
    for (const file of files) {
      if (known.has(file.n)) continue;
      if (file.n < lastIndexed && meta.versions.length > 0) {
        // Left behind when old versions were thinned out.
        await fs.rm(join(dir, file.name), { force: true }).catch(() => undefined);
        continue;
      }
      try {
        const { text, net } = await readNetFile(join(dir, file.name));
        const savedAt = new Date(await fs.mtimeMs(join(dir, file.name))).toISOString();
        meta.versions.push(describeVersion(net, text, file.n, savedAt));
        meta.updatedAt = savedAt;
        if (rebuilt || meta.name === meta.id) meta.name = net.name;
        changed = true;
      } catch {
        logger.error('version file cannot be read', { id: meta.id, file: file.name });
      }
    }
    meta.versions.sort((a, b) => a.version - b.version);
    if (meta.versions.length === 0) return null;
    if (changed) await writeMeta(meta, dir);
    return meta;
  }

  async function scan(parent: string): Promise<ProjectMeta[]> {
    let ids: string[];
    try {
      ids = await fs.readdir(parent);
    } catch {
      return [];
    }
    const found: ProjectMeta[] = [];
    for (const id of ids) {
      if (!ID_PATTERN.test(id)) continue;
      const meta = await loadProject(join(parent, id), id);
      if (meta) found.push({ ...meta, id });
      else logger.warn('folder without a project skipped', { id });
    }
    return found;
  }

  await fs.mkdir(projectsDir, { recursive: true });
  await fs.mkdir(trashDir, { recursive: true });
  // Fail now, with a clear message, if the folder cannot be written.
  const probe = join(options.dataDir, `.write-test-${randomUUID().slice(0, 8)}.tmp`);
  try {
    await fs.writeNew(probe, 'ok');
    await fs.rm(probe, { force: true });
  } catch (error) {
    throw new Error(
      `Cannot write to PNM_DATA_DIR (${options.dataDir}): ${(error as Error).message}. ` +
        'The folder must belong to the user that runs the server.',
      { cause: error },
    );
  }
  for (const meta of await scan(projectsDir)) {
    if (meta.deletedAt !== undefined) {
      // Moved to the trash in the index, but the folder never moved: it is still a project.
      delete meta.deletedAt;
      await writeMeta(meta);
    }
    metas.set(meta.id, meta);
    indexTokens(meta);
  }
  for (const meta of await scan(trashDir)) trashed.set(meta.id, meta);
  logger.info('project store opened', { projects: metas.size, trashed: trashed.size });

  async function thin(meta: ProjectMeta): Promise<void> {
    const keep = new Set(
      versionsToKeep(
        meta.versions.map((v) => v.version),
        options.maxVersions,
      ),
    );
    if (keep.size === meta.versions.length) return;
    const dropped = meta.versions.filter((v) => !keep.has(v.version));
    meta.versions = meta.versions.filter((v) => keep.has(v.version));
    // The index first: a crash before the files are removed leaves only files that the next
    // start sees are older than the index and removes.
    await writeMeta(meta);
    for (const v of dropped) {
      await fs
        .rm(join(dirOf(meta.id), versionFile(v.version)), { force: true })
        .catch(() => undefined);
    }
  }

  const purgeTimer = setInterval(
    () => {
      void store.purgeTrash().catch((error: unknown) => {
        logger.error('purging the trash failed', { error: (error as Error).message });
      });
    },
    6 * 60 * 60 * 1000,
  );
  purgeTimer.unref();

  const store: ProjectStore = {
    list() {
      return [...metas.values()].map(infoOf).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async create({ net, name }) {
      const id = randomUUID();
      const at = now().toISOString();
      const text = serializeNet(net);
      const dir = dirOf(id);
      await fs.mkdir(dir, { recursive: true });
      try {
        await writeAtomic(fs, join(dir, versionFile(1)), text);
        const meta: ProjectMeta = {
          id,
          name: cleanName(name, cleanName(net.name, 'Untitled net')),
          createdAt: at,
          updatedAt: at,
          shares: {},
          versions: [describeVersion(net, text, 1, at)],
        };
        await writeMeta(meta);
        metas.set(id, meta);
        return infoOf(meta);
      } catch (error) {
        // A project that could not be written completely is not kept.
        await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
    },

    async get(id) {
      const meta = metaOf(id);
      const last = meta.versions.at(-1)!;
      const { net } = await readNetFile(join(dirOf(id), versionFile(last.version)));
      return { info: infoOf(meta), net };
    },

    versions(id) {
      return [...metaOf(id).versions].reverse();
    },

    async getVersion(id, version) {
      const meta = metaOf(id);
      const entry = meta.versions.find((v) => v.version === version);
      if (!entry) throw new NotFoundError(`Version ${version}`);
      const { net } = await readNetFile(join(dirOf(id), versionFile(version)));
      return { info: infoOf(meta), version: entry, net };
    },

    save(id, { net, name, note, ifMatch }) {
      return withLock(id, async () => {
        const meta = metaOf(id);
        const current = meta.versions.at(-1)?.version ?? 0;
        if (ifMatch !== '*' && ifMatch !== current) throw new ConflictError(current, ifMatch);
        const version = current + 1;
        const at = now().toISOString();
        const text = serializeNet(net);
        const file = join(dirOf(id), versionFile(version));
        if (await fs.exists(file)) {
          // Cannot happen with the index right; never overwrite a version.
          throw new Error(`Version file ${versionFile(version)} exists already`);
        }
        await writeAtomic(fs, file, text);
        const next: ProjectMeta = {
          ...meta,
          name: cleanName(name, cleanName(net.name, meta.name)),
          updatedAt: at,
          versions: [...meta.versions, describeVersion(net, text, version, at, note)],
        };
        try {
          await writeMeta(next);
        } catch (error) {
          // The version was written, the index could not be: take the version back.
          await fs.rm(file, { force: true }).catch(() => undefined);
          throw error;
        }
        metas.set(id, next);
        await thin(next).catch((error: unknown) => {
          logger.error('thinning the versions failed', { id, error: (error as Error).message });
        });
        return infoOf(next);
      });
    },

    share(id, mode, rotate) {
      return withLock(id, async () => {
        const meta = metaOf(id);
        const existing = meta.shares[mode];
        if (existing && !rotate) return { share: existing, created: false };
        const share: Share = {
          token: randomBytes(32).toString('base64url'),
          createdAt: now().toISOString(),
        };
        const next: ProjectMeta = { ...meta, shares: { ...meta.shares, [mode]: share } };
        await writeMeta(next);
        if (existing) tokens.delete(existing.token);
        metas.set(id, next);
        tokens.set(share.token, { id, mode });
        return { share, created: true };
      });
    },

    unshare(id, mode) {
      return withLock(id, async () => {
        const meta = metaOf(id);
        const shares = { ...meta.shares };
        for (const m of mode ? [mode] : (['read', 'write'] as const)) delete shares[m];
        const next: ProjectMeta = { ...meta, shares };
        await writeMeta(next);
        dropTokens(meta);
        metas.set(id, next);
        indexTokens(next);
      });
    },

    shares(id) {
      return { ...metaOf(id).shares };
    },

    remove(id) {
      return withLock(id, async () => {
        const meta = metaOf(id);
        if (options.trashDays === 0) {
          dropTokens(meta);
          metas.delete(id);
          await fs.rm(dirOf(id), { recursive: true, force: true });
          return;
        }
        // Links stop working at once and do not come back with the project.
        const gone: ProjectMeta = { ...meta, shares: {}, deletedAt: now().toISOString() };
        await writeMeta(gone);
        dropTokens(meta);
        await fs.rm(join(trashDir, id), { recursive: true, force: true });
        await fs.rename(dirOf(id), join(trashDir, id));
        metas.delete(id);
        trashed.set(id, gone);
      });
    },

    trash() {
      return [...trashed.values()]
        .map((meta) => {
          const deletedAt = meta.deletedAt ?? meta.updatedAt;
          return {
            ...infoOf(meta),
            deletedAt,
            purgeAt: new Date(Date.parse(deletedAt) + options.trashDays * DAY_MS).toISOString(),
          };
        })
        .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
    },

    restore(id) {
      return withLock(id, async () => {
        const meta = trashed.get(id);
        if (!meta) throw new NotFoundError('The project in the trash');
        if (metas.has(id)) throw new Error('A project with this id exists already');
        const { deletedAt: _deletedAt, ...rest } = meta;
        const restored: ProjectMeta = { ...rest, updatedAt: now().toISOString() };
        await fs.rename(join(trashDir, id), dirOf(id));
        await writeMeta(restored);
        trashed.delete(id);
        metas.set(id, restored);
        return infoOf(restored);
      });
    },

    byToken(token) {
      return tokens.get(token) ?? null;
    },

    async purgeTrash() {
      let purged = 0;
      const limit = now().getTime() - options.trashDays * DAY_MS;
      for (const [id, meta] of [...trashed]) {
        const deleted = Date.parse(meta.deletedAt ?? meta.updatedAt);
        if (deleted > limit) continue;
        await fs.rm(join(trashDir, id), { recursive: true, force: true });
        trashed.delete(id);
        purged += 1;
      }
      if (purged > 0) logger.info('trash purged', { projects: purged });
      return purged;
    },

    close() {
      clearInterval(purgeTimer);
    },
  };
  await store.purgeTrash();
  return store;
}
