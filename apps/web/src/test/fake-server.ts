import { createEmptyNet, serializeNet, type PetriNet } from '@pnm/core';
import { vi } from 'vitest';

/**
 * An in-memory stand-in for the server, behind `fetch`: the health check, the projects with
 * versions and `If-Match`, share links and the trash. It lets the tests of the app run the real
 * client code against answers in the shape that the real server gives (apps/server tests check
 * that shape).
 */

interface StoredVersion {
  version: number;
  savedAt: string;
  net: PetriNet;
  note?: string;
}

interface StoredProject {
  id: string;
  name: string;
  createdAt: string;
  versions: StoredVersion[];
  shares: Partial<Record<'read' | 'write', { token: string; createdAt: string }>>;
  deletedAt?: string;
}

export interface FakeServerOptions {
  name?: string;
  llm?: boolean;
  models?: string[];
  defaultModel?: string | null;
}

export interface FakeServer {
  projects: Map<string, StoredProject>;
  calls: Array<{ method: string; path: string; headers: Record<string, string>; body?: unknown }>;
  /** Saves a version behind the back of the app, as another person would. */
  saveElsewhere(id: string, net: PetriNet): void;
  add(name: string, net?: PetriNet): string;
  install(): void;
  restore(): void;
}

/**
 * A request body as the test double reads it. `any` is deliberate: the double looks at the fields
 * it knows and ignores the rest, and the real validation is the server's own (apps/server).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

const error = (status: number, code: string, message: string, details?: unknown): Response =>
  json(status, { error: { code, message, ...(details !== undefined && { details }) } });

export function createFakeServer(options: FakeServerOptions = {}): FakeServer {
  const projects = new Map<string, StoredProject>();
  const calls: FakeServer['calls'] = [];
  let counter = 0;
  const now = (): string => new Date(Date.UTC(2026, 9, 29, 12, 0, counter++)).toISOString();

  const info = (p: StoredProject) => {
    const last = p.versions.at(-1)!;
    return {
      id: p.id,
      name: p.name,
      version: last.version,
      createdAt: p.createdAt,
      updatedAt: last.savedAt,
      places: last.net.places.length,
      transitions: last.net.transitions.length,
      arcs: last.net.arcs.length,
      bytes: serializeNet(last.net).length,
      shared: { read: p.shares.read !== undefined, write: p.shares.write !== undefined },
    };
  };
  const link = (p: StoredProject, mode: 'read' | 'write') => {
    const share = p.shares[mode];
    return (
      share && {
        token: share.token,
        url: `http://server.test/s/${share.token}`,
        createdAt: share.createdAt,
      }
    );
  };
  const shares = (p: StoredProject) => ({
    ...(p.shares.read && { read: link(p, 'read') }),
    ...(p.shares.write && { write: link(p, 'write') }),
  });

  const server: FakeServer = {
    projects,
    calls,
    add(name, net = createEmptyNet(name)) {
      counter += 1;
      const id = `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
      projects.set(id, {
        id,
        name,
        createdAt: now(),
        versions: [{ version: 1, savedAt: now(), net: { ...net, name } }],
        shares: {},
      });
      return id;
    },
    saveElsewhere(id, net) {
      const p = projects.get(id)!;
      p.versions.push({ version: p.versions.length + 1, savedAt: now(), net });
    },
    install() {
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === 'string' ? input : input.toString(),
          'http://server.test',
        );
        const method = init?.method ?? 'GET';
        const headers = Object.fromEntries(new Headers(init?.headers).entries());
        const body =
          typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
        calls.push({
          method,
          path: url.pathname + url.search,
          headers,
          ...(body !== undefined && { body }),
        });
        return handle(method, url, headers, body as Body | undefined);
      });
    },
    restore() {
      vi.unstubAllGlobals();
    },
  };

  function handle(
    method: string,
    url: URL,
    headers: Record<string, string>,
    body: Body | undefined,
  ): Response {
    const path = url.pathname;
    if (path === '/api/health') {
      return json(200, {
        ok: true,
        app: 'petri-net-modeling',
        version: '1.2.0',
        name: options.name ?? 'aifb-test',
        features: { api: true, projects: true, llm: options.llm !== false, auth: false },
        llm: { models: options.models ?? [], defaultModel: options.defaultModel ?? null },
      });
    }
    if (path === '/llm/v1/models') {
      return json(200, {
        object: 'list',
        data: (options.models ?? ['fake-model', 'fake-model-large']).map((id) => ({
          id,
          object: 'model',
        })),
      });
    }
    let m: RegExpExecArray | null;
    if (path === '/api/v1/projects' && method === 'GET') {
      const list = [...projects.values()].filter((p) => !p.deletedAt).map(info);
      return json(200, { projects: list.reverse() });
    }
    if (path === '/api/v1/projects' && method === 'POST') {
      const id = server.add(body?.['name'] ?? body?.['net']?.name ?? 'Untitled', body?.['net']);
      return json(201, { project: info(projects.get(id)!), shares: {} });
    }
    if (path === '/api/v1/trash' && method === 'GET') {
      const list = [...projects.values()]
        .filter((p) => p.deletedAt)
        .map((p) => ({ ...info(p), deletedAt: p.deletedAt, purgeAt: '2026-11-28T12:00:00.000Z' }));
      return json(200, { projects: list });
    }
    if ((m = /^\/api\/v1\/trash\/([^/]+)\/restore$/.exec(path)) && method === 'POST') {
      const p = projects.get(m[1]!);
      if (!p?.deletedAt) return error(404, 'not_found', 'The project does not exist.');
      delete p.deletedAt;
      return json(200, { project: info(p) });
    }
    if ((m = /^\/api\/v1\/projects\/([^/]+)(?:\/(versions|share))?(?:\/(\d+))?$/.exec(path))) {
      const p = projects.get(m[1]!);
      if (!p || p.deletedAt) return error(404, 'not_found', 'The project does not exist.');
      const part = m[2];
      if (part === 'versions' && m[3] === undefined && method === 'GET') {
        return json(200, {
          versions: [...p.versions].reverse().map((v) => ({
            version: v.version,
            savedAt: v.savedAt,
            name: v.net.name,
            bytes: 100,
            places: v.net.places.length,
            transitions: v.net.transitions.length,
            arcs: v.net.arcs.length,
            ...(v.note && { note: v.note }),
          })),
        });
      }
      if (part === 'versions' && m[3] !== undefined && method === 'GET') {
        const v = p.versions.find((x) => x.version === Number(m![3]));
        if (!v) return error(404, 'not_found', 'Version does not exist.');
        return json(200, {
          project: info(p),
          version: {
            version: v.version,
            savedAt: v.savedAt,
            name: v.net.name,
            bytes: 100,
            places: v.net.places.length,
            transitions: v.net.transitions.length,
            arcs: v.net.arcs.length,
          },
          net: v.net,
        });
      }
      if (part === 'share' && method === 'POST') {
        const mode = body?.['mode'] as 'read' | 'write';
        const existing = p.shares[mode];
        if (existing && body?.['rotate'] !== true) return json(200, { mode, ...link(p, mode) });
        counter += 1;
        p.shares[mode] = {
          token: `${mode}-token-${String(counter).padStart(30, '0')}`.padEnd(43, 'x').slice(0, 43),
          createdAt: now(),
        };
        return json(201, { mode, ...link(p, mode) });
      }
      if (part === 'share' && method === 'DELETE') {
        const mode = url.searchParams.get('mode') as 'read' | 'write' | null;
        if (mode) delete p.shares[mode];
        else p.shares = {};
        return new Response(null, { status: 204 });
      }
      if (part === undefined && method === 'GET') {
        const last = p.versions.at(-1)!;
        return json(
          200,
          { project: info(p), shares: shares(p), net: last.net },
          { ETag: `"${last.version}"` },
        );
      }
      if (part === undefined && method === 'PUT') {
        const current = p.versions.at(-1)!.version;
        const match = headers['if-match']?.replace(/"/g, '');
        if (match === undefined) return error(428, 'precondition_required', 'If-Match is missing.');
        if (match !== '*' && Number(match) !== current) {
          return error(
            409,
            'conflict',
            `The project was changed in the meantime: it is at version ${current}.`,
            { currentVersion: current },
          );
        }
        p.name = body?.['name'] ?? body?.['net']?.name ?? p.name;
        p.versions.push({ version: current + 1, savedAt: now(), net: body?.['net'] });
        return json(200, { project: info(p) });
      }
      if (part === undefined && method === 'DELETE') {
        p.deletedAt = now();
        p.shares = {};
        return new Response(null, { status: 204 });
      }
    }
    if ((m = /^\/api\/v1\/shared\/([^/]+)$/.exec(path))) {
      const token = m[1]!;
      const p = [...projects.values()].find(
        (x) => !x.deletedAt && (x.shares.read?.token === token || x.shares.write?.token === token),
      );
      if (!p) return error(404, 'not_found', 'This link does not exist or was removed.');
      const mode = p.shares.write?.token === token ? 'write' : 'read';
      const last = p.versions.at(-1)!;
      if (method === 'GET') {
        return json(200, {
          mode,
          project: { id: p.id, name: p.name, version: last.version, updatedAt: last.savedAt },
          net: last.net,
        });
      }
      if (method === 'PUT') {
        if (mode !== 'write') return error(403, 'forbidden', 'This link is read-only.');
        const match = headers['if-match']?.replace(/"/g, '');
        if (Number(match) !== last.version) {
          return error(409, 'conflict', 'The project was changed in the meantime.', {
            currentVersion: last.version,
          });
        }
        p.versions.push({ version: last.version + 1, savedAt: now(), net: body?.['net'] });
        const v = p.versions.at(-1)!;
        return json(200, {
          project: { id: p.id, name: p.name, version: v.version, updatedAt: v.savedAt },
        });
      }
    }
    return error(404, 'not_found', `There is nothing at ${path}.`);
  }

  return server;
}
