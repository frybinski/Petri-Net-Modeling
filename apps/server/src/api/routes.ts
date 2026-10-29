import { parseNet, serializeNet, type PetriNet } from '@pnm/core';
import {
  createProvider,
  errorMessage,
  generateDomainView,
  toGenerationRecord,
  LlmError,
} from '@pnm/llm';
import type { z } from 'zod';
import { ApiError } from '../errors';
import { isRecord, readJson, sendJson } from '../http';
import type { LlmProxy } from '../llm/proxy';
import type { Logger } from '../logger';
import type { RequestContext, Router } from '../router';
import type { OperationName } from './ops';
import { buildOpenApi } from './openapi';
import type { JobPool } from './pool';
import {
  analyzeRequest,
  checkRequest,
  convertRequest,
  domainCheckRequest,
  domainGenerateRequest,
  domainGenericRequest,
  layoutRequest,
  looksLikeNet,
  parseRequest,
  replayRequest,
  simulateRequest,
  validateRequest,
} from './schemas';

export interface ApiDeps {
  pool: JobPool;
  llm: LlmProxy;
  logger: Logger;
}

/** The media types and file extensions of the formats of `POST /api/v1/convert`. */
const FILE_TYPES: Record<string, { type: string; extension: string }> = {
  json: { type: 'application/json; charset=utf-8', extension: 'pn.json' },
  pnml: { type: 'application/xml; charset=utf-8', extension: 'pnml' },
  svg: { type: 'image/svg+xml; charset=utf-8', extension: 'svg' },
  tikz: { type: 'application/x-tex; charset=utf-8', extension: 'tex' },
};

/** A file name stem that is safe in a header: letters, digits, dot, dash and underscore. */
function fileStem(name: string): string {
  const stem = name
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return stem === '' ? 'net' : stem.slice(0, 80);
}

/** The body of a request that sends a net: JSON, with a size limit. */
function body(ctx: RequestContext): Promise<unknown> {
  return readJson(ctx.req, ctx.config.maxBody);
}

export function registerApi(router: Router, deps: ApiDeps): void {
  const { pool, llm } = deps;

  let description: unknown;
  router.get(
    '/api/v1/openapi.json',
    (ctx) => {
      description ??= buildOpenApi({ publicUrl: ctx.config.publicUrl });
      sendJson(ctx.res, 200, description);
    },
    { summary: 'This description' },
  );

  function tool<S extends z.ZodType>(
    path: string,
    op: OperationName,
    schema: S,
    summary: string,
  ): void {
    router.post(
      path,
      async (ctx) => {
        const params = parseRequest(schema, await body(ctx));
        const result = await pool.run(op, params, { signal: ctx.signal });
        sendJson(ctx.res, 200, result);
      },
      { summary },
    );
  }

  tool('/api/v1/validate', 'validate', validateRequest, 'Check a net and its domain view');
  tool('/api/v1/simulate', 'simulate', simulateRequest, 'Run the timed simulation of a net');
  tool('/api/v1/replay', 'replay', replayRequest, 'Replay an event log on a net');
  tool('/api/v1/analyze', 'analyze', analyzeRequest, 'Structure, invariants, state space of a net');
  tool('/api/v1/check', 'check', checkRequest, 'Check DECLARE and LTLf properties of a net');
  tool('/api/v1/layout', 'layout', layoutRequest, 'Compute a new automatic layout');
  tool('/api/v1/domain/check', 'domain.check', domainCheckRequest, 'Check a domain view');
  tool(
    '/api/v1/domain/generic',
    'domain.generic',
    domainGenericRequest,
    'Add a generic domain view',
  );

  router.post(
    '/api/v1/convert',
    async (ctx) => {
      let input = await body(ctx);
      // `?format=svg` goes with a net sent as it is, or with a request that names no format.
      const queryFormat = ctx.query.get('format');
      if (queryFormat !== null && isRecord(input) && !('format' in input)) {
        input = { ...(looksLikeNet(input) ? { net: input } : input), format: queryFormat };
      }
      const params = parseRequest(convertRequest, input);
      const result = await pool.run<{ format: string; name: string; content: string }>(
        'convert',
        params,
        { signal: ctx.signal },
      );
      const file = FILE_TYPES[result.format] ?? FILE_TYPES['json']!;
      const name = `${fileStem(result.name)}.${file.extension}`;
      ctx.res.writeHead(200, {
        'Content-Type': file.type,
        'Content-Length': Buffer.byteLength(result.content),
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'no-store',
      });
      ctx.res.end(result.content);
    },
    { summary: 'Convert a net to JSON, PNML, SVG or TikZ; the answer is the file' },
  );

  router.post(
    '/api/v1/domain/generate',
    async (ctx) => {
      if (!llm.enabled) {
        throw new ApiError(503, 'unavailable', 'No language model is connected to this server.');
      }
      const params = parseRequest(domainGenerateRequest, await body(ctx));
      const model = params.model ?? llm.defaultModel;
      if (model === null) {
        throw new ApiError(400, 'bad_request', 'The request needs a "model".');
      }
      llm.assertModelAllowed(model);
      // The net is read in a thread (PNML can be large); the result is a plain net document.
      const parsed = await pool.run<{ net: unknown }>(
        'parse',
        { net: params.net },
        { signal: ctx.signal },
      );
      const net: PetriNet = parseNet(parsed.net);
      const provider = createProvider({
        baseUrl: ctx.config.llm.baseUrl ?? '',
        model,
        ...(ctx.config.llm.apiKey !== null && { apiKey: ctx.config.llm.apiKey }),
        ...(params.temperature !== undefined && { temperature: params.temperature }),
        ...(params.jsonMode !== undefined && { jsonMode: params.jsonMode }),
        timeoutMs: ctx.config.llm.timeoutMs,
        fetch: llm.queuedFetch,
      });
      let result;
      try {
        result = await generateDomainView(net, provider, {
          description: params.description,
          ...(params.width !== undefined &&
            params.height !== undefined && {
              canvas: { width: params.width, height: params.height },
            }),
          ...(params.rounds !== undefined && { maxRounds: params.rounds }),
          signal: ctx.signal,
        });
      } catch (error) {
        throw generationError(error, deps.logger, ctx.config.llm.baseUrl ?? '');
      }
      const record = toGenerationRecord(result, {
        description: params.description,
        baseUrl: `${ctx.config.publicUrl}/llm/v1`,
      });
      const withView: PetriNet = { ...net, domainView: result.view, domainViewGeneration: record };
      sendJson(ctx.res, 200, {
        net: JSON.parse(serializeNet(withView)) as unknown,
        model: result.model,
        fellBack: result.fellBack,
        rounds: result.rounds,
        filled: result.filled,
        dropped: result.dropped,
        notes: result.notes,
      });
    },
    { summary: 'Let the language model of the server make the domain view' },
  );
}

/** The error that a client gets when the language model could not be used. */
function generationError(error: unknown, logger: Logger, baseUrl: string): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof LlmError) {
    switch (error.kind) {
      case 'aborted':
        return new ApiError(400, 'bad_request', 'The request was cancelled.');
      case 'timeout':
        return new ApiError(504, 'timeout', 'The language model did not answer in time.');
      case 'rate-limit':
        return new ApiError(429, 'too_many_requests', 'The language model is busy.', {
          headers: { 'Retry-After': '10' },
        });
      case 'auth':
        logger.error('llm upstream refused the key', { via: 'domain/generate' });
        return new ApiError(
          502,
          'bad_gateway',
          'The language model server refused the key of this server. Tell the operator.',
        );
      default:
        return new ApiError(
          502,
          'bad_gateway',
          `The language model could not be used: ${errorMessage(error).split(baseUrl).join('the language model server').slice(0, 300)}`,
        );
    }
  }
  throw error;
}
