import { z } from 'zod';
import type { Indicator, PetriNet } from './model';

const finite = z.number().refine(Number.isFinite, { message: 'must be a finite number' });

const positionSchema = z.object({ x: finite, y: finite });

// Tokens are any JSON value except `null`.
const tokenSchema = z.json().refine((value) => value !== null, { message: 'must not be null' });

const placeSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  position: positionSchema,
  type: z.string().optional(),
  // Ranges (integer >= 1) are checked by `validate()` so that files with such
  // errors can still be opened and repaired in the editor.
  capacity: finite.optional(),
  role: z.enum(['case', 'resource', 'quantity']).optional(),
});

// Ranges of the timing fields are checked by `validate()` as well.
const timingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fixed'), value: finite }),
  z.object({ kind: z.literal('uniform'), min: finite, max: finite }),
  z.object({ kind: z.literal('exponential'), mean: finite }),
]);

// What the ids refer to and the range of `digits` are checked by `validate()`.
const measureSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tokens'), of: z.string() }),
  z.object({ kind: z.literal('inflow'), of: z.string(), via: z.string().optional() }),
  z.object({ kind: z.literal('outflow'), of: z.string(), via: z.string().optional() }),
  z.object({ kind: z.literal('firings'), of: z.string() }),
]);

const indicatorSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  unit: z.string().optional(),
  measure: measureSchema,
  per: z.union([z.literal('case'), z.literal('hour'), measureSchema]).optional(),
  factor: finite.optional(),
  digits: finite.optional(),
});

const indicatorListSchema = z.array(indicatorSchema);

const simulationSchema = z.object({
  seed: finite.optional(),
  warmup: finite.optional(),
  startTime: z.string().optional(),
  caseIdPrefix: z.string().optional(),
  indicators: indicatorListSchema.optional(),
});

const transitionSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  position: positionSchema,
  guard: z.string().optional(),
  timing: timingSchema.optional(),
  priority: finite.optional(),
  rate: finite.optional(),
});

const arcSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  weight: finite,
  inscription: z.string().optional(),
  points: z.array(positionSchema).optional(),
});

const annotationSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  position: positionSchema,
});

export const netSchema = z.object({
  version: z.literal('1.0'),
  profile: z.enum(['pt-net', 'json-net']),
  name: z.string(),
  types: z.record(z.string(), z.unknown()),
  places: z.array(placeSchema),
  transitions: z.array(transitionSchema),
  arcs: z.array(arcSchema),
  marking: z.record(z.string(), z.array(tokenSchema)),
  annotations: z.array(annotationSchema).optional(),
  simulation: simulationSchema.optional(),
  // Passed through; `@pnm/domain` checks the content.
  domainView: z.unknown().optional(),
  domainViewGeneration: z.unknown().optional(),
  // Passed through; `@pnm/analysis` checks the content.
  properties: z.unknown().optional(),
}) satisfies z.ZodType<PetriNet, unknown>;

/** Checks an untrusted value as a list of indicators (for the PNML reader). */
export function parseIndicatorList(
  value: unknown,
): { ok: true; indicators: Indicator[] } | { ok: false; error: string } {
  const result = indicatorListSchema.safeParse(value);
  return result.success
    ? { ok: true, indicators: result.data }
    : { ok: false, error: formatIssues(result.error).slice(0, 3).join('; ') };
}

/** Renders a Zod issue path like `places[2].capacity`. */
export function formatPath(path: ReadonlyArray<PropertyKey>): string {
  let out = '';
  for (const part of path) {
    if (typeof part === 'number') out += `[${part}]`;
    else out += out === '' ? String(part) : `.${String(part)}`;
  }
  return out === '' ? '(root)' : out;
}

export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${formatPath(issue.path)}: ${issue.message}`);
}
