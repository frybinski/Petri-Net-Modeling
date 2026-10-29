import { parseNet, type PetriNet } from '@pnm/core';

/**
 * The client of the server that the app is served from (see `apps/server`, `docs/server.md`). The
 * app finds out whether there is one by asking for `api/health`; GitHub Pages and a local file
 * have none, and then nothing here is used.
 */

export interface ServerHealth {
  ok: true;
  app: 'petri-net-modeling';
  version: string;
  /** The name that the status bar shows. */
  name: string;
  features: { api: boolean; projects: boolean; llm: boolean; auth: boolean };
  llm: { models: string[]; defaultModel: string | null };
}

export interface ProjectInfo {
  id: string;
  name: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  places: number;
  transitions: number;
  arcs: number;
  bytes: number;
  shared: { read: boolean; write: boolean };
}

export interface TrashedProject extends ProjectInfo {
  deletedAt: string;
  purgeAt: string;
}

export interface VersionInfo {
  version: number;
  savedAt: string;
  name: string;
  bytes: number;
  places: number;
  transitions: number;
  arcs: number;
  note?: string;
}

export type ShareMode = 'read' | 'write';

export interface ShareLink {
  token: string;
  url: string;
  createdAt: string;
}

/** The answer of the server was an error; `code` is the word from `{ error: { code } }`. */
export class ServerError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ServerError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** The project was changed by someone else since the version that this save was based on. */
  get isConflict(): boolean {
    return this.status === 409;
  }

  /** The newest version on the server, for a conflict. */
  get currentVersion(): number | null {
    const details = this.details;
    if (typeof details === 'object' && details !== null && 'currentVersion' in details) {
      const value = (details as { currentVersion: unknown }).currentVersion;
      return typeof value === 'number' ? value : null;
    }
    return null;
  }
}

/** Where the server's paths start: the base of the app (`/` when a server serves it). */
function base(): string {
  return import.meta.env.BASE_URL;
}

/** The address of a path of the server, for example `api/v1/projects`. */
export function serverUrl(path: string): string {
  return `${base()}${path.replace(/^\/+/, '')}`;
}

/** The base URL of the language model proxy of the server, for the provider. */
export function serverLlmBaseUrl(): string {
  return serverUrl('llm/v1');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isHealth(value: unknown): value is ServerHealth {
  if (!isRecord(value) || value['ok'] !== true || value['app'] !== 'petri-net-modeling') {
    return false;
  }
  const features = value['features'];
  return (
    typeof value['version'] === 'string' &&
    typeof value['name'] === 'string' &&
    isRecord(features) &&
    isRecord(value['llm'])
  );
}

/** The name of the `<meta>` tag with which the server marks the page it delivers (apps/server). */
export const SERVER_MARKER_NAME = 'pnm-server';

/**
 * True if the page was delivered by the server of the app: the server adds a marker to `index.html`.
 * Without it (GitHub Pages, the dev server, a local file) the app does not ask for `api/health` at
 * all, so that no request ends in a 404 that the browser reports as an error.
 */
export function pageMarkedByServer(doc: Document = document): boolean {
  return doc.querySelector(`meta[name="${SERVER_MARKER_NAME}"]`) !== null;
}

/**
 * Asks the address the app comes from whether a server is there. Anything that is not the answer
 * of the server (a 404, an HTML page that stands in for every path, a timeout) is "no server".
 */
export async function fetchHealth(timeoutMs = 4000): Promise<ServerHealth | null> {
  try {
    const response = await fetch(serverUrl('api/health'), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    if (!(response.headers.get('content-type') ?? '').includes('json')) return null;
    const body: unknown = await response.json();
    return isHealth(body) ? body : null;
  } catch {
    return null;
  }
}

interface CallOptions {
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

async function call(
  method: string,
  path: string,
  options: CallOptions = {},
): Promise<{ data: unknown; response: Response }> {
  let response: Response;
  try {
    response = await fetch(serverUrl(path), {
      method,
      headers: {
        Accept: 'application/json',
        ...(options.body !== undefined && { 'Content-Type': 'application/json' }),
        ...options.headers,
      },
      ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
      ...(options.signal && { signal: options.signal }),
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ServerError(0, 'network', 'The server could not be reached.');
  }
  if (response.status === 204) return { data: null, response };
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    // An answer that is not JSON (a proxy's error page) is reported by its status below.
  }
  if (!response.ok) {
    const error = isRecord(data) && isRecord(data['error']) ? data['error'] : null;
    const message =
      error && typeof error['message'] === 'string'
        ? error['message']
        : `The server answered with HTTP ${response.status}.`;
    const code = error && typeof error['code'] === 'string' ? error['code'] : 'error';
    throw new ServerError(response.status, code, message, error?.['details']);
  }
  return { data, response };
}

function field<T>(data: unknown, key: string): T {
  if (!isRecord(data) || !(key in data)) {
    throw new ServerError(
      502,
      'bad_response',
      'The answer of the server is not what was expected.',
    );
  }
  return data[key] as T;
}

/** Reads the net of an answer; a document that is no net is an error of the server's answer. */
function netOf(data: unknown): PetriNet {
  try {
    return parseNet(field<unknown>(data, 'net'));
  } catch (error) {
    if (error instanceof ServerError) throw error;
    throw new ServerError(502, 'bad_response', 'The server sent a document that is not a net.');
  }
}

export interface LoadedProject {
  project: ProjectInfo;
  net: PetriNet;
  shares: Partial<Record<ShareMode, ShareLink>>;
}

export interface SharedProject {
  mode: ShareMode;
  project: { id: string; name: string; version: number; updatedAt: string };
  net: PetriNet;
}

const enc = encodeURIComponent;

/** The calls to the project store and the share links. */
export const serverApi = {
  async list(signal?: AbortSignal): Promise<ProjectInfo[]> {
    const { data } = await call('GET', 'api/v1/projects', signal ? { signal } : {});
    return field<ProjectInfo[]>(data, 'projects');
  },

  async create(net: PetriNet, name?: string): Promise<ProjectInfo> {
    const { data } = await call('POST', 'api/v1/projects', {
      body: { net, ...(name !== undefined && name.trim() !== '' && { name: name.trim() }) },
    });
    return field<ProjectInfo>(data, 'project');
  },

  async get(id: string): Promise<LoadedProject> {
    const { data } = await call('GET', `api/v1/projects/${enc(id)}`);
    return {
      project: field<ProjectInfo>(data, 'project'),
      net: netOf(data),
      shares: field<Partial<Record<ShareMode, ShareLink>>>(data, 'shares'),
    };
  },

  async versions(id: string): Promise<VersionInfo[]> {
    const { data } = await call('GET', `api/v1/projects/${enc(id)}/versions`);
    return field<VersionInfo[]>(data, 'versions');
  },

  async getVersion(id: string, version: number): Promise<{ version: VersionInfo; net: PetriNet }> {
    const { data } = await call('GET', `api/v1/projects/${enc(id)}/versions/${version}`);
    return { version: field<VersionInfo>(data, 'version'), net: netOf(data) };
  },

  /** Saves a new version; `version` is the one the changes are based on (409 if it is not current). */
  async save(id: string, net: PetriNet, version: number, name?: string): Promise<ProjectInfo> {
    const { data } = await call('PUT', `api/v1/projects/${enc(id)}`, {
      body: { net, ...(name !== undefined && { name }) },
      headers: { 'If-Match': `"${version}"` },
    });
    return field<ProjectInfo>(data, 'project');
  },

  async remove(id: string): Promise<void> {
    await call('DELETE', `api/v1/projects/${enc(id)}`);
  },

  async trash(): Promise<TrashedProject[]> {
    const { data } = await call('GET', 'api/v1/trash');
    return field<TrashedProject[]>(data, 'projects');
  },

  async restore(id: string): Promise<ProjectInfo> {
    const { data } = await call('POST', `api/v1/trash/${enc(id)}/restore`);
    return field<ProjectInfo>(data, 'project');
  },

  async share(id: string, mode: ShareMode, rotate = false): Promise<ShareLink> {
    const { data } = await call('POST', `api/v1/projects/${enc(id)}/share`, {
      body: { mode, ...(rotate && { rotate: true }) },
    });
    if (!isRecord(data) || typeof data['token'] !== 'string' || typeof data['url'] !== 'string') {
      throw new ServerError(
        502,
        'bad_response',
        'The answer of the server is not what was expected.',
      );
    }
    return {
      token: data['token'],
      url: data['url'],
      createdAt: typeof data['createdAt'] === 'string' ? data['createdAt'] : '',
    };
  },

  async unshare(id: string, mode?: ShareMode): Promise<void> {
    await call('DELETE', `api/v1/projects/${enc(id)}/share${mode ? `?mode=${mode}` : ''}`);
  },

  async shared(token: string): Promise<SharedProject> {
    const { data } = await call('GET', `api/v1/shared/${enc(token)}`);
    return {
      mode: field<ShareMode>(data, 'mode'),
      project: field<SharedProject['project']>(data, 'project'),
      net: netOf(data),
    };
  },

  async saveShared(
    token: string,
    net: PetriNet,
    version: number,
  ): Promise<{ id: string; name: string; version: number; updatedAt: string }> {
    const { data } = await call('PUT', `api/v1/shared/${enc(token)}`, {
      body: { net },
      headers: { 'If-Match': `"${version}"` },
    });
    return field<{ id: string; name: string; version: number; updatedAt: string }>(data, 'project');
  },
};

/** The token in an address like `/s/<token>`, or `null`. */
export function shareTokenOf(pathname: string): string | null {
  const prefix = `${base()}s/`;
  if (!pathname.startsWith(prefix)) return null;
  const token = pathname.slice(prefix.length).replace(/\/+$/, '');
  return /^[A-Za-z0-9_-]{20,128}$/.test(token) ? token : null;
}
