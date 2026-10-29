import { z } from 'zod';
import { ApiError } from '../errors';
import { isRecord } from '../http';

/** The largest number of states an analysis may be asked for. */
export const MAX_STATES = 2_000_000;
/** The largest number of events a run may produce, and how many it may return as a file. */
export const MAX_RUN_EVENTS = 10_000_000;
export const MAX_RETURNED_EVENTS = 200_000;
export const DEFAULT_API_MAX_EVENTS = 1_000_000;

/** A net as the interface takes it: the `.pn.json` as an object, or its text or PNML as a string. */
const net = z.union([z.string().min(1), z.record(z.string(), z.unknown())]);

const positive = z.number().positive().finite();
const nonNegative = z.number().min(0).finite();
const iso = z
  .string()
  .refine((text) => !Number.isNaN(Date.parse(text)), 'must be an ISO 8601 date and time');

export const validateRequest = z.strictObject({ net });

export const simulateRequest = z.strictObject({
  net,
  /** Model time to simulate; default 3600. */
  seconds: positive.max(1e9).optional(),
  seed: z.number().int().optional(),
  warmup: nonNegative.optional(),
  /** Arrivals per hour by transition id or name; `"off"` or `null` switches the arrivals off. */
  rates: z.record(z.string(), z.union([nonNegative, z.literal('off'), z.null()])).optional(),
  startTime: iso.optional(),
  maxEvents: z.number().int().positive().max(MAX_RUN_EVENTS).optional(),
  /** What to return besides the key figures. */
  formats: z
    .array(z.enum(['csv', 'xes', 'stream']))
    .max(3)
    .optional(),
});

export const replayRequest = z.strictObject({
  net,
  /** The event log as text: CSV or XES. */
  log: z.string().min(1),
  map: z.record(z.string(), z.string()).optional(),
  ignore: z.array(z.string()).optional(),
  completeOnly: z.enum(['zero', 'span']).optional(),
  timeOrigin: z.string().min(1).optional(),
  columns: z
    .strictObject({
      case: z.string().optional(),
      activity: z.string().optional(),
      time: z.string().optional(),
      lifecycle: z.string().optional(),
    })
    .optional(),
  checkGuards: z.boolean().optional(),
  seed: z.number().int().optional(),
  warmup: nonNegative.optional(),
  formats: z
    .array(z.enum(['csv', 'xes']))
    .max(2)
    .optional(),
});

export const analyzeRequest = z.strictObject({
  net,
  states: z.number().int().positive().max(MAX_STATES).optional(),
  /** Time limit for the state space in milliseconds. */
  timeMs: positive.optional(),
  coverability: z.boolean().optional(),
  structureOnly: z.boolean().optional(),
});

const markingEntry = z.record(z.string(), z.union([z.number().int().min(0), z.array(z.unknown())]));

export const checkRequest = z.strictObject({
  net,
  declare: z.array(z.string().min(1)).max(100).optional(),
  ltlf: z.array(z.string().min(1)).max(100).optional(),
  /** What ends a run: `deadlock` (default), `all`, or a list of markings. */
  final: z.union([z.enum(['deadlock', 'all']), z.array(markingEntry).max(1000)]).optional(),
  states: z.number().int().positive().max(MAX_STATES).optional(),
  timeMs: positive.optional(),
  /** An event log (CSV) to check instead of the state space. */
  log: z.string().min(1).optional(),
  includeOpen: z.boolean().optional(),
});

export const CONVERT_FORMATS = ['json', 'pnml', 'svg', 'tikz'] as const;

export const convertRequest = z.strictObject({
  net,
  format: z.enum(CONVERT_FORMATS),
  dark: z.boolean().optional(),
  padding: nonNegative.optional(),
  inscriptions: z.boolean().optional(),
  standalone: z.boolean().optional(),
  scale: positive.optional(),
  labels: z.enum(['names', 'ids', 'none']).optional(),
  tokens: z.enum(['dots', 'count', 'none']).optional(),
  styles: z.enum(['inline', 'external']).optional(),
  grayscale: z.boolean().optional(),
  toolspecific: z.boolean().optional(),
});

export const layoutRequest = z.strictObject({
  net,
  direction: z.enum(['RIGHT', 'DOWN']).optional(),
  spacing: nonNegative.optional(),
});

export const domainCheckRequest = z.strictObject({ net, view: z.unknown().optional() });
export const domainGenericRequest = z.strictObject({ net });

export const domainGenerateRequest = z.strictObject({
  net,
  description: z.string().trim().min(1).max(4000),
  model: z.string().min(1).max(200).optional(),
  rounds: z.number().int().min(1).max(10).optional(),
  temperature: z.number().min(0).max(2).optional(),
  jsonMode: z.enum(['auto', 'schema', 'object', 'none']).optional(),
  width: z.number().min(200).optional(),
  height: z.number().min(200).optional(),
});

export type ValidateRequest = z.infer<typeof validateRequest>;
export type SimulateRequestBody = z.infer<typeof simulateRequest>;
export type ReplayRequestBody = z.infer<typeof replayRequest>;
export type AnalyzeRequestBody = z.infer<typeof analyzeRequest>;
export type CheckRequestBody = z.infer<typeof checkRequest>;
export type ConvertRequestBody = z.infer<typeof convertRequest>;
export type LayoutRequestBody = z.infer<typeof layoutRequest>;
export type DomainCheckRequestBody = z.infer<typeof domainCheckRequest>;
export type DomainGenericRequestBody = z.infer<typeof domainGenericRequest>;
export type DomainGenerateRequestBody = z.infer<typeof domainGenerateRequest>;

/** True for a body that is a net itself (it can be sent as it is, without `{ "net": … }`). */
export function looksLikeNet(body: Record<string, unknown>): boolean {
  return (
    !('net' in body) &&
    typeof body['version'] === 'string' &&
    Array.isArray(body['places']) &&
    Array.isArray(body['transitions'])
  );
}

/**
 * Checks a request body against a schema. A body that is a net on its own counts as
 * `{ "net": … }`. Throws a 400 that says what is wrong.
 */
export function parseRequest<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const input = isRecord(body) && looksLikeNet(body) ? { net: body } : body;
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => ({
    path: issue.path.map(String).join('.') || '(body)',
    message: issue.message,
  }));
  const first = issues[0];
  throw new ApiError(
    400,
    'bad_request',
    `The request is not valid: ${first ? `${first.path}: ${first.message}` : 'unknown problem'}`,
    { details: { issues } },
  );
}
