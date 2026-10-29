import { z } from 'zod';
import { VERSION } from '../version';
import {
  analyzeRequest,
  checkRequest,
  convertRequest,
  domainCheckRequest,
  domainGenerateRequest,
  domainGenericRequest,
  layoutRequest,
  replayRequest,
  simulateRequest,
  validateRequest,
} from './schemas';

type Json = Record<string, unknown>;

/** The JSON Schema of a request body, from the schema that checks it. */
function schemaOf(schema: z.ZodType): Json {
  const { $schema: _schema, ...rest } = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: 'input',
  }) as Json;
  return rest;
}

const ref = (name: string): Json => ({ $ref: `#/components/schemas/${name}` });

const errorResponse = (description: string): Json => ({
  description,
  content: { 'application/json': { schema: ref('Error') } },
});

const json = (description: string, schema: Json = { type: 'object' }): Json => ({
  description,
  content: { 'application/json': { schema } },
});

const body = (name: string): Json => ({
  required: true,
  content: { 'application/json': { schema: ref(name) } },
});

/** The answers that every call that takes a body can give. */
const commonErrors: Record<string, Json> = {
  '400': errorResponse(
    'The request is not valid: not JSON, an unknown or wrong option, a rate or mapping that names nothing.',
  ),
  '401': errorResponse('The server asks for a password (PNM_BASIC_AUTH).'),
  '403': errorResponse('The address of the client is not in PNM_ALLOWED_NETS.'),
  '413': errorResponse('The request is larger than PNM_MAX_BODY.'),
  '415': errorResponse('The body was not sent with the content type application/json.'),
};

const jobErrors: Record<string, Json> = {
  '422': errorResponse(
    'The net or the log cannot be used: it is no net (net_format), it has errors (net_invalid, with the findings in details), the run was too large, or a job needed more memory than allowed (resource_limit).',
  ),
  '503': errorResponse(
    'Every worker is busy and the queue is full (busy); try again after Retry-After.',
  ),
  '504': errorResponse('The job did not finish within PNM_JOB_TIMEOUT and was stopped.'),
};

function tool(
  summary: string,
  description: string,
  request: string,
  ok: Json,
  extra: Record<string, Json> = {},
): Json {
  return {
    tags: ['Tools'],
    summary,
    description,
    requestBody: body(request),
    responses: { '200': ok, ...commonErrors, ...jobErrors, ...extra },
  };
}

/** The path parameter objects of a pattern like `/projects/{id}/versions/{n}`. */
export function pathParameters(path: string): Json[] {
  return [...path.matchAll(/\{(\w+)\}/g)].map((match) => ({
    name: match[1],
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));
}

/**
 * The description of the interface (OpenAPI 3.1). The paths and texts are written by hand; the
 * schemas of the request bodies come from the schemas that check the requests. A test compares the
 * paths with the routes of the server, so a route cannot be added or removed without this.
 */
export function buildOpenApi(options: { publicUrl?: string } = {}): Json {
  const paths: Record<string, Record<string, Json>> = {
    '/api/health': {
      get: {
        tags: ['Server'],
        summary: 'Health check and the features of this server',
        description:
          'Needs no password. The app calls it to find out whether it runs on a server. `features.llm` is true when a language model is connected.',
        responses: {
          '200': json('The server is up.', ref('Health')),
          '403': errorResponse('The address of the client is not in PNM_ALLOWED_NETS.'),
        },
      },
    },
    '/api/v1/openapi.json': {
      get: {
        tags: ['Server'],
        summary: 'This description',
        responses: { '200': json('The OpenAPI document.') },
      },
    },
    '/api/v1/validate': {
      post: tool(
        'Check a net and its domain view',
        'The same result as `pnm validate --json`, without the name of the file. A net with errors is answered with 200 and `ok: false`.',
        'ValidateRequest',
        json('The findings.'),
      ),
    },
    '/api/v1/simulate': {
      post: tool(
        'Run the timed simulation of a net',
        'The same key figures as `pnm simulate --metrics`. With `formats` the event log comes back as CSV, XES or as the event stream (at most 200 000 events).',
        'SimulateRequest',
        json('Key figures and run data; `csv`, `xes` and `stream` if asked for.'),
      ),
    },
    '/api/v1/replay': {
      post: tool(
        'Replay an event log on a net',
        'The same result as `pnm replay --json`: token replay fitness, deviations and key figures. `log` is the text of a CSV or XES file.',
        'ReplayRequest',
        json('Fitness, deviations and key figures.'),
      ),
    },
    '/api/v1/analyze': {
      post: tool(
        'Structure, invariants and state space of a net',
        'The same result as `pnm analyze --json`.',
        'AnalyzeRequest',
        json('The analysis.'),
      ),
    },
    '/api/v1/check': {
      post: tool(
        'Check DECLARE and LTLf properties of a net',
        'The same result as `pnm check --json`: on the state space, or on the cases of an event log if `log` is given. A violated property is a 200 with `ok: false`.',
        'CheckRequest',
        json('The verdicts with counterexamples.'),
      ),
    },
    '/api/v1/convert': {
      post: {
        tags: ['Tools'],
        summary: 'Convert a net to JSON, PNML, SVG or TikZ',
        description:
          'The answer is the file, as `pnm export` writes it, with a Content-Disposition. The format can also be given as `?format=` when the net is sent as it is.',
        requestBody: body('ConvertRequest'),
        responses: {
          '200': {
            description: 'The file.',
            content: {
              'image/svg+xml': { schema: { type: 'string' } },
              'application/xml': { schema: { type: 'string' } },
              'application/x-tex': { schema: { type: 'string' } },
              'application/json': { schema: { type: 'string' } },
            },
          },
          ...commonErrors,
          ...jobErrors,
        },
      },
    },
    '/api/v1/layout': {
      post: tool(
        'Compute a new automatic layout',
        'The net with new positions, as `pnm layout` makes them.',
        'LayoutRequest',
        json('`{ net }`.'),
      ),
    },
    '/api/v1/domain/check': {
      post: tool(
        'Check a domain view',
        'The same result as `pnm domain check --json`. Without `view` the view in the net is checked.',
        'DomainCheckRequest',
        json('The findings of the rules V1 to V8.'),
      ),
    },
    '/api/v1/domain/generic': {
      post: tool(
        'Add a generic domain view',
        'The net with a generic domain view (stations where the net has its nodes).',
        'DomainGenericRequest',
        json('`{ net }`.'),
      ),
    },
    '/api/v1/domain/generate': {
      post: tool(
        'Let the language model of the server make the domain view',
        'Asks the model with the repair loop of the app. Needs a language model (`features.llm`). The answer holds the net with the view and the record of the rounds. Allow several minutes in a proxy in front.',
        'DomainGenerateRequest',
        json('`{ net, model, fellBack, rounds, filled, dropped, notes }`.'),
        {
          '429': errorResponse('The language model is busy.'),
          '502': errorResponse('The language model could not be used.'),
          '503': errorResponse('No language model is connected, or every worker is busy.'),
        },
      ),
    },
    '/llm/v1/chat/completions': {
      post: {
        tags: ['Language model'],
        summary: 'Chat completion, passed to the language model of the server',
        description:
          'OpenAI compatible. The server adds its key; clients send none. Only the usual fields are passed on (`model`, `messages`, `temperature`, `top_p`, `max_tokens`, `stream`, `stop`, `seed`, `response_format`, ...). With `stream: true` the answer is a stream of server-sent events. At most two requests run at a time, ten more wait; beyond that the answer is 429.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: {
          '200': json('The completion, or an event stream.'),
          '400': errorResponse('Not valid.'),
          '403': errorResponse('The model is not offered by this server.'),
          '404': errorResponse('The model is not known to the language model server.'),
          '429': errorResponse('Too many requests are waiting.'),
          '502': errorResponse(
            'The language model server could not be reached or refused the key of this server.',
          ),
          '503': errorResponse('No language model is connected.'),
          '504': errorResponse('The language model did not answer within PNM_LLM_TIMEOUT.'),
        },
      },
    },
    '/llm/v1/models': {
      get: {
        tags: ['Language model'],
        summary: 'The models that the server offers',
        responses: {
          '200': json('`{ object: "list", data: [{ id, object: "model" }] }`.'),
          '502': errorResponse('The language model server could not be reached.'),
          '503': errorResponse('No language model is connected.'),
        },
      },
    },
  };

  const schemas: Record<string, Json> = {
    Error: {
      type: 'object',
      required: ['error'],
      properties: {
        error: {
          type: 'object',
          required: ['code', 'message'],
          properties: {
            code: { type: 'string', description: 'A fixed word for the kind of error.' },
            message: { type: 'string' },
            details: {
              description:
                'More, depending on the code: the findings of a net, the options that are wrong.',
            },
          },
        },
      },
    },
    Health: {
      type: 'object',
      required: ['ok', 'app', 'version', 'name', 'features', 'llm'],
      properties: {
        ok: { const: true },
        app: { const: 'petri-net-modeling' },
        version: { type: 'string' },
        name: { type: 'string' },
        features: {
          type: 'object',
          properties: {
            api: { type: 'boolean' },
            projects: { type: 'boolean' },
            llm: { type: 'boolean' },
            auth: { type: 'boolean' },
          },
        },
        llm: {
          type: 'object',
          properties: {
            models: { type: 'array', items: { type: 'string' } },
            defaultModel: { type: ['string', 'null'] },
          },
        },
      },
    },
    ValidateRequest: schemaOf(validateRequest),
    SimulateRequest: schemaOf(simulateRequest),
    ReplayRequest: schemaOf(replayRequest),
    AnalyzeRequest: schemaOf(analyzeRequest),
    CheckRequest: schemaOf(checkRequest),
    ConvertRequest: schemaOf(convertRequest),
    LayoutRequest: schemaOf(layoutRequest),
    DomainCheckRequest: schemaOf(domainCheckRequest),
    DomainGenericRequest: schemaOf(domainGenericRequest),
    DomainGenerateRequest: schemaOf(domainGenerateRequest),
  };

  return buildDocument(paths, schemas, options);
}

/** Puts the parts together and adds the path parameters. */
export function buildDocument(
  paths: Record<string, Record<string, Json>>,
  schemas: Record<string, Json>,
  options: { publicUrl?: string },
): Json {
  for (const [path, operations] of Object.entries(paths)) {
    const parameters = pathParameters(path);
    if (parameters.length === 0) continue;
    for (const operation of Object.values(operations)) {
      operation['parameters'] = [
        ...parameters,
        ...((operation['parameters'] as Json[] | undefined) ?? []),
      ];
    }
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Petri Net Modeling server',
      version: VERSION,
      description:
        'The functions of the command line `pnm` over HTTP, a proxy to the language model of the server, and a store for projects with versions and share links. A net is sent as the `.pn.json` object, as its text or as PNML.',
    },
    servers: [{ url: options.publicUrl ?? '/' }],
    tags: [
      { name: 'Server' },
      { name: 'Tools', description: 'The functions of the command line.' },
      { name: 'Language model' },
      { name: 'Projects', description: 'Stored nets with versions and share links.' },
    ],
    paths,
    components: { schemas },
  };
}
