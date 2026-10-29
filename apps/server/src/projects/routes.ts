import { parseNet, NetFormatError, type PetriNet } from '@pnm/core';
import { z } from 'zod';
import { parseRequest } from '../api/schemas';
import { ApiError } from '../errors';
import { header, readJson, sendJson } from '../http';
import type { Logger } from '../logger';
import type { RequestContext, Router } from '../router';
import {
  ConflictError,
  ID_PATTERN,
  NotFoundError,
  TOKEN_PATTERN,
  type ProjectStore,
  type Share,
  type ShareMode,
} from './store';

const netObject = z.record(z.string(), z.unknown());
const name = z.string().max(200);
const note = z.string().max(500);

const createRequest = z.strictObject({ net: netObject, name: name.optional() });
const saveRequest = z.strictObject({
  net: netObject,
  name: name.optional(),
  note: note.optional(),
});
const shareRequest = z.strictObject({
  mode: z.enum(['read', 'write']),
  rotate: z.boolean().optional(),
});

export { createRequest as createProjectRequest, saveRequest as saveProjectRequest, shareRequest };

export interface ProjectDeps {
  store: ProjectStore;
  logger: Logger;
}

/** The net of a request, checked against the file format; the findings of `validate` do not matter. */
function netOf(input: unknown): PetriNet {
  try {
    return parseNet(input);
  } catch (error) {
    if (error instanceof NetFormatError) {
      throw new ApiError(422, 'net_format', error.message, { details: { issues: error.issues } });
    }
    throw error;
  }
}

/** What `If-Match` says: a version number (`3`, `"3"`, `W/"3"`) or `*`. */
export function parseIfMatch(value: string | undefined): number | '*' {
  if (value === undefined) {
    throw new ApiError(
      428,
      'precondition_required',
      'Send If-Match with the version that your changes are based on (or * to overwrite).',
    );
  }
  const text = value
    .trim()
    .replace(/^W\//, '')
    .replace(/^"(.*)"$/, '$1');
  if (text === '*') return '*';
  if (/^\d+$/.test(text)) return Number(text);
  throw new ApiError(
    400,
    'bad_request',
    'If-Match must be a version number, for example "3", or *.',
  );
}

function etag(version: number): string {
  return `"${version}"`;
}

/** Turns the errors of the store into answers. */
async function guarded<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    if (error instanceof NotFoundError) throw new ApiError(404, 'not_found', error.message);
    if (error instanceof ConflictError) {
      throw new ApiError(409, 'conflict', error.message, {
        details: { currentVersion: error.currentVersion },
        headers: { ETag: etag(error.currentVersion) },
      });
    }
    throw error;
  }
}

function idOf(ctx: RequestContext): string {
  const id = ctx.params['id'] ?? '';
  if (!ID_PATTERN.test(id)) throw new ApiError(404, 'not_found', 'The project does not exist.');
  return id;
}

function tokenOf(ctx: RequestContext): string {
  const token = ctx.params['token'] ?? '';
  if (!TOKEN_PATTERN.test(token)) throw new ApiError(404, 'not_found', 'This link does not exist.');
  return token;
}

function noContent(ctx: RequestContext): void {
  ctx.res.writeHead(204, { 'Cache-Control': 'no-store' });
  ctx.res.end();
}

export function registerProjects(router: Router, deps: ProjectDeps): void {
  const { store } = deps;
  const body = (ctx: RequestContext): Promise<unknown> => readJson(ctx.req, ctx.config.maxBody);
  const linkOf = (
    ctx: RequestContext,
    share: Share,
  ): { token: string; url: string; createdAt: string } => ({
    token: share.token,
    url: `${ctx.config.publicUrl}/s/${share.token}`,
    createdAt: share.createdAt,
  });
  const sharesOf = (ctx: RequestContext, id: string): Record<string, unknown> => {
    const shares = store.shares(id);
    return {
      ...(shares.read && { read: linkOf(ctx, shares.read) }),
      ...(shares.write && { write: linkOf(ctx, shares.write) }),
    };
  };

  router.get(
    '/api/v1/projects',
    (ctx) => {
      sendJson(ctx.res, 200, { projects: store.list() });
    },
    { summary: 'The stored projects, newest first' },
  );

  router.post(
    '/api/v1/projects',
    async (ctx) => {
      const request = parseRequest(createRequest, await body(ctx));
      const net = netOf(request.net);
      const project = await store.create({
        net,
        ...(request.name !== undefined && { name: request.name }),
      });
      sendJson(
        ctx.res,
        201,
        { project, shares: {} },
        { Location: `/api/v1/projects/${project.id}`, ETag: etag(project.version) },
      );
    },
    { summary: 'Store a net as a new project (version 1)' },
  );

  router.get(
    '/api/v1/projects/:id',
    async (ctx) => {
      const id = idOf(ctx);
      const { info, net } = await guarded(() => store.get(id));
      sendJson(
        ctx.res,
        200,
        { project: info, shares: sharesOf(ctx, id), net },
        { ETag: etag(info.version) },
      );
    },
    { summary: 'The newest version of a project' },
  );

  router.put(
    '/api/v1/projects/:id',
    async (ctx) => {
      const id = idOf(ctx);
      const ifMatch = parseIfMatch(header(ctx.req, 'if-match'));
      const request = parseRequest(saveRequest, await body(ctx));
      const net = netOf(request.net);
      const project = await guarded(() =>
        store.save(id, {
          net,
          ifMatch,
          ...(request.name !== undefined && { name: request.name }),
          ...(request.note !== undefined && { note: request.note }),
        }),
      );
      sendJson(ctx.res, 200, { project }, { ETag: etag(project.version) });
    },
    { summary: 'Save a new version; If-Match carries the version that the changes are based on' },
  );

  router.delete(
    '/api/v1/projects/:id',
    async (ctx) => {
      await guarded(() => store.remove(idOf(ctx)));
      noContent(ctx);
    },
    { summary: 'Move a project to the trash' },
  );

  router.get(
    '/api/v1/projects/:id/versions',
    (ctx) => {
      const id = idOf(ctx);
      const versions = (() => {
        try {
          return store.versions(id);
        } catch (error) {
          if (error instanceof NotFoundError) throw new ApiError(404, 'not_found', error.message);
          throw error;
        }
      })();
      sendJson(ctx.res, 200, { versions });
    },
    { summary: 'The saved versions of a project, newest first' },
  );

  router.get(
    '/api/v1/projects/:id/versions/:n',
    async (ctx) => {
      const id = idOf(ctx);
      const n = Number(ctx.params['n']);
      if (!Number.isInteger(n) || n < 1)
        throw new ApiError(404, 'not_found', 'This version does not exist.');
      const { info, version, net } = await guarded(() => store.getVersion(id, n));
      sendJson(ctx.res, 200, { project: info, version, net }, { ETag: etag(version.version) });
    },
    { summary: 'One saved version of a project' },
  );

  router.post(
    '/api/v1/projects/:id/share',
    async (ctx) => {
      const id = idOf(ctx);
      const request = parseRequest(shareRequest, await body(ctx));
      const { share, created } = await guarded(() =>
        store.share(id, request.mode, request.rotate === true),
      );
      sendJson(ctx.res, created ? 201 : 200, { mode: request.mode, ...linkOf(ctx, share) });
    },
    { summary: 'Make a share link for reading or for reading and writing' },
  );

  router.delete(
    '/api/v1/projects/:id/share',
    async (ctx) => {
      const id = idOf(ctx);
      const mode = ctx.query.get('mode');
      if (mode !== null && mode !== 'read' && mode !== 'write') {
        throw new ApiError(400, 'bad_request', 'mode must be read or write.');
      }
      await guarded(() => store.unshare(id, mode === null ? undefined : mode));
      noContent(ctx);
    },
    { summary: 'Remove the share link of one mode, or all links' },
  );

  router.get(
    '/api/v1/trash',
    (ctx) => {
      sendJson(ctx.res, 200, { projects: store.trash() });
    },
    { summary: 'Projects in the trash' },
  );

  router.post(
    '/api/v1/trash/:id/restore',
    async (ctx) => {
      const project = await guarded(() => store.restore(idOf(ctx)));
      sendJson(ctx.res, 200, { project });
    },
    { summary: 'Take a project out of the trash' },
  );

  /** The project behind a link, and what the link allows. */
  function linked(ctx: RequestContext): { id: string; mode: ShareMode } {
    const found = store.byToken(tokenOf(ctx));
    if (!found) throw new ApiError(404, 'not_found', 'This link does not exist or was removed.');
    return found;
  }

  router.get(
    '/api/v1/shared/:token',
    async (ctx) => {
      const { id, mode } = linked(ctx);
      const { info, net } = await guarded(() => store.get(id));
      sendJson(
        ctx.res,
        200,
        {
          mode,
          project: {
            id: info.id,
            name: info.name,
            version: info.version,
            updatedAt: info.updatedAt,
          },
          net,
        },
        { ETag: etag(info.version) },
      );
    },
    { open: true, summary: 'The newest version of the project behind a share link' },
  );

  router.put(
    '/api/v1/shared/:token',
    async (ctx) => {
      const { id, mode } = linked(ctx);
      if (mode !== 'write') {
        throw new ApiError(403, 'forbidden', 'This link is read-only.');
      }
      const ifMatch = parseIfMatch(header(ctx.req, 'if-match'));
      const request = parseRequest(saveRequest, await body(ctx));
      const net = netOf(request.net);
      const project = await guarded(() =>
        store.save(id, {
          net,
          ifMatch,
          note: request.note ?? 'saved through a share link',
          ...(request.name !== undefined && { name: request.name }),
        }),
      );
      sendJson(
        ctx.res,
        200,
        {
          project: {
            id: project.id,
            name: project.name,
            version: project.version,
            updatedAt: project.updatedAt,
          },
        },
        { ETag: etag(project.version) },
      );
    },
    { open: true, summary: 'Save a new version through a share link that allows writing' },
  );
}
