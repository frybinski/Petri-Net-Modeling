import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { parseAccounts, type BasicAccount } from './basic-auth';
import { parseNetList } from './net-filter';

/** The networks of the KIT that may use the server unless `PNM_ALLOWED_NETS` says otherwise. */
export const DEFAULT_ALLOWED_NETS = [
  '129.13.0.0/16',
  '141.3.0.0/16',
  '141.52.0.0/16',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
] as const;

export interface LlmConfig {
  /** Up to and including `/v1` (Ollama) or `/api` (Open WebUI); `null` switches the proxy off. */
  baseUrl: string | null;
  /** Sent upstream as a bearer token. Never logged, never put in a response. */
  apiKey: string | null;
  /** The models that users may use; empty means all. */
  models: string[];
  defaultModel: string | null;
  timeoutMs: number;
  concurrency: number;
  maxQueue: number;
  maxBody: number;
}

export interface Config {
  port: number;
  bindAddress: string;
  publicUrl: string;
  /** The name that the app shows for the server. */
  serverName: string;
  webDir: string;
  dataDir: string;
  maxBody: number;
  basicAuth: BasicAccount[];
  allowedNets: string[];
  trustedProxies: string[];
  llm: LlmConfig;
  jobs: { workers: number; timeoutMs: number; memoryMb: number; maxQueue: number };
  projects: { maxVersions: number; trashDays: number };
}

/** The settings are wrong; the message lists every problem. */
export class ConfigError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

/** `10mb`, `512 kB`, `2048` (bytes) as a number of bytes, or `null`. */
export function parseSize(text: string): number | null {
  const match = /^(\d+(?:\.\d+)?)\s*(b|kb?|mb?|gb?)?$/i.exec(text.trim());
  if (!match) return null;
  const unit = (match[2] ?? 'b').toLowerCase().charAt(0);
  const factor = unit === 'k' ? 1024 : unit === 'm' ? 1024 ** 2 : unit === 'g' ? 1024 ** 3 : 1;
  return Math.round(Number(match[1]) * factor);
}

function list(text: string): string[] {
  return text
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

const whole = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d+$/, 'must be a whole number')
    .transform(Number)
    .pipe(z.number().int().min(min, `must be at least ${min}`).max(max, `must be at most ${max}`));

const seconds = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d+(\.\d+)?$/, 'must be a number of seconds')
    .transform(Number)
    .pipe(z.number().min(min, `must be at least ${min}`).max(max, `must be at most ${max}`));

const size = (min: number, max: number) =>
  z
    .string()
    .transform((text, ctx) => {
      const bytes = parseSize(text);
      if (bytes === null) {
        ctx.addIssue({ code: 'custom', message: 'must be a size like 10mb, 512kb or 2048' });
        return z.NEVER;
      }
      return bytes;
    })
    .pipe(z.number().min(min, 'is too small').max(max, 'is too large'));

const url = z.string().transform((text, ctx) => {
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('protocol');
    return text.replace(/\/+$/, '');
  } catch {
    ctx.addIssue({ code: 'custom', message: 'must be an http:// or https:// address' });
    return z.NEVER;
  }
});

/** The default folder of the web app: `apps/web/dist` next to `apps/server`. */
export function defaultWebDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');
}

const schema = z.object({
  PNM_PORT: whole(1, 65535).default(8080),
  PNM_BIND_ADDRESS: z.string().default('0.0.0.0'),
  PNM_PUBLIC_URL: url,
  PNM_SERVER_NAME: z.string().optional(),
  PNM_WEB_DIR: z.string().optional(),
  PNM_DATA_DIR: z.string().default('/data'),
  PNM_MAX_BODY: size(1024, 1024 ** 3).default(10 * 1024 ** 2),
  PNM_BASIC_AUTH: z.string().default(''),
  PNM_ALLOWED_NETS: z.string().default(DEFAULT_ALLOWED_NETS.join(',')),
  PNM_TRUSTED_PROXIES: z.string().default(''),
  PNM_LLM_BASE_URL: url.optional(),
  PNM_LLM_API_KEY: z.string().optional(),
  PNM_LLM_MODELS: z.string().default(''),
  PNM_LLM_DEFAULT_MODEL: z.string().optional(),
  PNM_LLM_TIMEOUT: seconds(1, 3600).default(180),
  PNM_LLM_CONCURRENCY: whole(1, 64).default(2),
  PNM_LLM_QUEUE: whole(0, 1000).default(10),
  PNM_LLM_MAX_BODY: size(1024, 1024 ** 3).default(2 * 1024 ** 2),
  PNM_WORKERS: whole(1, 32).default(2),
  PNM_JOB_TIMEOUT: seconds(0.1, 3600).default(60),
  PNM_WORKER_MEMORY: whole(64, 16384).default(512),
  PNM_JOB_QUEUE: whole(0, 10000).default(16),
  PNM_MAX_VERSIONS: whole(2, 100000).default(200),
  PNM_TRASH_DAYS: whole(0, 3650).default(30),
});

/**
 * Reads the settings from the environment (variables that are empty count as not set). Throws a
 * `ConfigError` that lists everything that is wrong, so that one start shows all problems.
 */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): Config {
  const input: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('PNM_') && value !== undefined && value.trim() !== '') {
      input[key] = value.trim();
    }
  }
  const parsed = schema.safeParse(input);
  const problems: string[] = [];
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const name = String(issue.path[0] ?? 'configuration');
      const required =
        issue.code === 'invalid_type' && input[name] === undefined
          ? name === 'PNM_PUBLIC_URL'
            ? 'is required: the address that users open, for example https://pnm.example.org'
            : 'is required'
          : issue.message;
      problems.push(`${name} ${required}`);
    }
    throw new ConfigError(problems);
  }
  const v = parsed.data;

  const allowedNets = list(v.PNM_ALLOWED_NETS);
  const trustedProxies = list(v.PNM_TRUSTED_PROXIES);
  for (const [name, entries] of [
    ['PNM_ALLOWED_NETS', allowedNets],
    ['PNM_TRUSTED_PROXIES', trustedProxies],
  ] as const) {
    try {
      parseNetList(entries);
    } catch (error) {
      problems.push(`${name}: ${(error as Error).message}`);
    }
  }
  let basicAuth: BasicAccount[] = [];
  try {
    basicAuth = parseAccounts(v.PNM_BASIC_AUTH);
  } catch (error) {
    problems.push(`PNM_BASIC_AUTH: ${(error as Error).message}`);
  }
  const models = list(v.PNM_LLM_MODELS);
  if (v.PNM_LLM_DEFAULT_MODEL !== undefined && models.length > 0) {
    if (!models.includes(v.PNM_LLM_DEFAULT_MODEL)) {
      problems.push('PNM_LLM_DEFAULT_MODEL must be one of PNM_LLM_MODELS');
    }
  }
  if (v.PNM_LLM_API_KEY !== undefined && v.PNM_LLM_BASE_URL === undefined) {
    problems.push('PNM_LLM_API_KEY is set but PNM_LLM_BASE_URL is not');
  }
  if (problems.length > 0) throw new ConfigError(problems);

  return {
    port: v.PNM_PORT,
    bindAddress: v.PNM_BIND_ADDRESS,
    publicUrl: v.PNM_PUBLIC_URL,
    serverName: v.PNM_SERVER_NAME ?? new URL(v.PNM_PUBLIC_URL).hostname,
    webDir: resolve(v.PNM_WEB_DIR ?? defaultWebDir()),
    dataDir: resolve(v.PNM_DATA_DIR),
    maxBody: v.PNM_MAX_BODY,
    basicAuth,
    allowedNets,
    trustedProxies,
    llm: {
      baseUrl: v.PNM_LLM_BASE_URL ?? null,
      apiKey: v.PNM_LLM_API_KEY ?? null,
      models,
      defaultModel: v.PNM_LLM_DEFAULT_MODEL ?? models[0] ?? null,
      timeoutMs: Math.round(v.PNM_LLM_TIMEOUT * 1000),
      concurrency: v.PNM_LLM_CONCURRENCY,
      maxQueue: v.PNM_LLM_QUEUE,
      maxBody: v.PNM_LLM_MAX_BODY,
    },
    jobs: {
      workers: v.PNM_WORKERS,
      timeoutMs: Math.round(v.PNM_JOB_TIMEOUT * 1000),
      memoryMb: v.PNM_WORKER_MEMORY,
      maxQueue: v.PNM_JOB_QUEUE,
    },
    projects: { maxVersions: v.PNM_MAX_VERSIONS, trashDays: v.PNM_TRASH_DAYS },
  };
}

/** The settings as they may be printed: no key, no password hashes. */
export function describeConfig(config: Config): Record<string, unknown> {
  return {
    port: config.port,
    publicUrl: config.publicUrl,
    serverName: config.serverName,
    webDir: config.webDir,
    dataDir: config.dataDir,
    basicAuth: config.basicAuth.length > 0 ? `${config.basicAuth.length} account(s)` : 'off',
    allowedNets: config.allowedNets,
    trustedProxies: config.trustedProxies,
    llm:
      config.llm.baseUrl === null
        ? 'off'
        : {
            baseUrl: config.llm.baseUrl,
            apiKey: config.llm.apiKey === null ? 'none' : 'set',
            models: config.llm.models.length > 0 ? config.llm.models : 'all',
            defaultModel: config.llm.defaultModel,
          },
    jobs: config.jobs,
    projects: config.projects,
  };
}
