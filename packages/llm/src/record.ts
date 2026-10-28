import type { DomainDiagnostic } from '@pnm/domain';
import { z } from 'zod';

export type RoundKind = 'generate' | 'repair';

/** What happened in one round of the generation. */
export interface RoundLog {
  round: number;
  /** `generate` asks for a whole view, `repair` for a correction of the findings. */
  kind: RoundKind;
  /** How the request asked for JSON (`schema`, `object` or `none`). */
  mode: 'schema' | 'object' | 'none';
  usage?: { prompt: number; completion: number };
  /** The findings of the checking program for the state after this round's answer. */
  diagnostics: DomainDiagnostic[];
  durationMs: number;
  /** Paths of the entries that this round's answer wrote. */
  written?: string[];
  /** Why the round failed (provider error, answer that is no JSON). */
  error?: string;
}

/** How a view was generated; stored with the net next to, not inside, the view. */
export interface DomainViewGeneration {
  model: string;
  /** The server, without credentials. The API key is never stored. */
  baseUrl: string;
  startedAt: string;
  finishedAt: string;
  /** The description of the domain that the person wrote. */
  description: string;
  /** The first request. */
  prompt: { system: string; user: string };
  rounds: RoundLog[];
  /** Paths of the entries that the tool filled in generically. */
  filled: string[];
  /** Paths of entries of the model that were left out because they were invalid. */
  dropped: string[];
  notes?: string[];
}

const diagnosticSchema = z.object({
  rule: z.enum(['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8']),
  severity: z.enum(['error', 'warning']),
  path: z.string(),
  message: z.string(),
  elementId: z.string().optional(),
});

const roundSchema = z.object({
  round: z.number(),
  kind: z.enum(['generate', 'repair']),
  mode: z.enum(['schema', 'object', 'none']),
  usage: z.object({ prompt: z.number(), completion: z.number() }).optional(),
  diagnostics: z.array(diagnosticSchema),
  durationMs: z.number(),
  written: z.array(z.string()).optional(),
  error: z.string().optional(),
});

export const domainViewGenerationSchema = z.object({
  model: z.string(),
  baseUrl: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  description: z.string(),
  prompt: z.object({ system: z.string(), user: z.string() }),
  rounds: z.array(roundSchema),
  filled: z.array(z.string()),
  dropped: z.array(z.string()),
  notes: z.array(z.string()).optional(),
}) satisfies z.ZodType<DomainViewGeneration, unknown>;

/** Reads the `domainViewGeneration` field of a net; null if it is absent or malformed. */
export function parseGeneration(value: unknown): DomainViewGeneration | null {
  const parsed = domainViewGenerationSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** The server address without user, password, query and fragment. */
export function publicBaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl.trim());
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return (
      baseUrl
        .trim()
        .replace(/\/+$/, '')
        .replace(/\/\/[^/@]*@/, '//')
        .split(/[?#]/)[0] ?? ''
    );
  }
}
