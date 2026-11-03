import {
  DOMAIN_RULES,
  viewChoicesSchema,
  type DomainDiagnostic,
  type DomainRule,
  type ViewChoices,
} from '@pnm/domain';
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
  /** `PROMPT_VERSION` of the texts that were sent; absent in records of 1.4.0 and before (version 1). */
  promptVersion?: number;
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
  /** Remarks of the tool, for example a failed round or a choice that replaced the model's. */
  notes?: string[];
  /** The way of the dialog: a free description or the guided form (N4); absent before 1.5.0. */
  mode?: 'free' | 'guided';
  /** The binding choices of the guided way. */
  choices?: ViewChoices;
  /** The title of the concept the guided form was filled from, if one was picked. */
  concept?: string;
  /** What the model said it could not do or only approximated (the `notes` of its answers). */
  modelNotes?: string[];
}

const diagnosticSchema = z.object({
  rule: z.enum(DOMAIN_RULES as [DomainRule, ...DomainRule[]]),
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
  promptVersion: z.number().int().positive().optional(),
  baseUrl: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  description: z.string(),
  prompt: z.object({ system: z.string(), user: z.string() }),
  rounds: z.array(roundSchema),
  filled: z.array(z.string()),
  dropped: z.array(z.string()),
  notes: z.array(z.string()).optional(),
  mode: z.enum(['free', 'guided']).optional(),
  choices: viewChoicesSchema.optional(),
  concept: z.string().optional(),
  modelNotes: z.array(z.string()).optional(),
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
