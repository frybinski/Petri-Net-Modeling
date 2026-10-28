import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNetText, type PetriNet } from '@pnm/core';
import { createProvider, errorMessage, generateDomainView, type GenerateResult } from '../src';
import type { JsonMode } from '../src/provider';

/** The examples of the repository, with the sentence that follows the name of the net. */
export const EXAMPLE_SENTENCES: Record<string, string> = {
  'parcel-center':
    'A parcel sorting center: parcels arrive at the hall, are scanned, sorted and loaded at the docks.',
  'smart-office':
    'An open-plan office: people enter through a turnstile, work at desks, meet in rooms and fetch coffee.',
};
export const DEFAULT_EXAMPLES = ['parcel-center', 'smart-office'];
const FALLBACK_SENTENCE = 'A process that is modelled as a Petri net.';

export interface EvalOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  jsonMode?: JsonMode;
  temperature?: number;
  maxRounds?: number;
  timeoutMs?: number;
  /** Ids of files in the examples folder, without `.pn.json`. */
  examples: string[];
  examplesDir: string;
  outDir: string;
  /** `YYYY-MM-DD`; default today. */
  date?: string;
  /** Lines of progress. */
  log: (line: string) => void;
  /** Replaces `fetch` (tests). */
  fetch?: typeof fetch;
}

export interface EvalRow {
  example: string;
  netName: string;
  /** The answer of the model passed the rules without anything being filled in or dropped. */
  passed: boolean;
  rounds: number;
  errorsPerRound: number[];
  warningsPerRound: number[];
  remainingWarnings: number;
  filled: number;
  filledNonArcs: number;
  dropped: number;
  fellBack: boolean;
  seconds: number;
  tokens: number;
  error?: string;
  viewFile?: string;
}

export interface EvalOutcome {
  rows: EvalRow[];
  reportPath: string;
  files: string[];
}

export const HELP = `Usage: pnpm --filter @pnm/llm eval -- --base-url <url> --model <name> [options]

Generates the domain view of the parcel center and the smart office with a language model
(acceptance A6) and writes a report and the views to docs/eval/.

  --base-url <url>      OpenAI-compatible server up to /v1, for example http://localhost:11434/v1
  --model <name>        model name as the server knows it
  --api-key <key>       API key (or set PNM_LLM_API_KEY); never written to any file
  --json-mode <mode>    auto (default), schema, object or none
  --temperature <n>     default 0.2
  --rounds <n>          at most this many requests per net, default 3
  --timeout <seconds>   per request, default 300
  --examples <ids>      comma separated ids from examples/, default parcel-center,smart-office
  --out-dir <dir>       default <repository>/docs/eval
  --date <YYYY-MM-DD>   for the file names, default today
  --strict              exit with status 2 if any net did not pass without filling
  --help
`;

export interface ParsedArgs {
  options: Omit<EvalOptions, 'log' | 'fetch' | 'examplesDir' | 'outDir'> & { outDir?: string };
  strict: boolean;
  help: boolean;
}

/** Reads the command line; throws an Error with a message for the person on bad input. */
export function parseArgs(
  argv: readonly string[],
  env: Record<string, string | undefined> = {},
): ParsedArgs {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--') continue;
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument "${arg}"`);
    const name = arg.slice(2);
    if (name === 'help' || name === 'strict') {
      flags.add(name);
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--'))
      throw new Error(`Option --${name} needs a value`);
    values.set(name, value);
    i += 1;
  }
  const known = new Set([
    'base-url',
    'model',
    'api-key',
    'json-mode',
    'temperature',
    'rounds',
    'timeout',
    'examples',
    'out-dir',
    'date',
  ]);
  for (const name of values.keys())
    if (!known.has(name)) throw new Error(`Unknown option --${name}`);

  const number = (name: string): number | undefined => {
    const raw = values.get(name);
    if (raw === undefined) return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`--${name} needs a number, not "${raw}"`);
    return n;
  };
  const help = flags.has('help');
  const baseUrl = values.get('base-url') ?? '';
  const model = values.get('model') ?? '';
  if (!help && (baseUrl === '' || model === '')) {
    throw new Error('--base-url and --model are required (see --help)');
  }
  const jsonMode = values.get('json-mode');
  if (jsonMode !== undefined && !['auto', 'schema', 'object', 'none'].includes(jsonMode)) {
    throw new Error(`--json-mode must be auto, schema, object or none, not "${jsonMode}"`);
  }
  const apiKey = values.get('api-key') ?? env['PNM_LLM_API_KEY'];
  const timeout = number('timeout');
  const temperature = number('temperature');
  const rounds = number('rounds');
  const date = values.get('date');
  const outDir = values.get('out-dir');
  return {
    help,
    strict: flags.has('strict'),
    options: {
      baseUrl,
      model,
      examples: (values.get('examples') ?? DEFAULT_EXAMPLES.join(','))
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id !== ''),
      ...(apiKey ? { apiKey } : {}),
      ...(jsonMode ? { jsonMode: jsonMode as JsonMode } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(rounds !== undefined ? { maxRounds: rounds } : {}),
      ...(timeout !== undefined ? { timeoutMs: timeout * 1000 } : {}),
      ...(date ? { date } : {}),
      ...(outDir ? { outDir } : {}),
    },
  };
}

/** The repository root, found from the location of this file. */
export function repositoryRoot(): string {
  return resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
}

function fileSafe(text: string): string {
  return text.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'model';
}

function loadExampleNet(dir: string, id: string): PetriNet {
  const net = parseNetText(readFileSync(join(dir, `${id}.pn.json`), 'utf8'));
  // The stored view is the expected answer; the model never sees it.
  const { domainView: _view, domainViewGeneration: _generation, ...rest } = net;
  return rest;
}

function countErrors(round: { diagnostics: Array<{ severity: string }> }): number {
  return round.diagnostics.filter((d) => d.severity === 'error').length;
}

function rowOf(example: string, net: PetriNet, result: GenerateResult): EvalRow {
  const last = result.rounds.at(-1);
  const filledNonArcs = result.filled.filter((p) => !p.startsWith('arcs.')).length;
  const tokens = result.rounds.reduce(
    (sum, r) => sum + (r.usage ? r.usage.prompt + r.usage.completion : 0),
    0,
  );
  const seconds = (Date.parse(result.finishedAt) - Date.parse(result.startedAt)) / 1000;
  return {
    example,
    netName: net.name,
    passed:
      !result.fellBack &&
      last !== undefined &&
      countErrors(last) === 0 &&
      filledNonArcs === 0 &&
      result.dropped.length === 0,
    rounds: result.rounds.length,
    errorsPerRound: result.rounds.map(countErrors),
    warningsPerRound: result.rounds.map((r) => r.diagnostics.length - countErrors(r)),
    remainingWarnings: result.diagnostics.length,
    filled: result.filled.length,
    filledNonArcs,
    dropped: result.dropped.length,
    fellBack: result.fellBack,
    seconds: Number.isFinite(seconds) ? seconds : 0,
    tokens,
  };
}

/** The report as a Markdown table with the findings of every round. */
export function renderReport(
  options: Pick<EvalOptions, 'model' | 'baseUrl' | 'temperature' | 'jsonMode' | 'maxRounds'>,
  date: string,
  rows: readonly EvalRow[],
  details: ReadonlyMap<string, GenerateResult>,
): string {
  const lines: string[] = [
    `# LLM generation of the domain view: ${options.model}`,
    '',
    `Date: ${date} · Server: ${options.baseUrl} · Temperature: ${options.temperature ?? 0.2} · JSON mode: ${options.jsonMode ?? 'auto'} · At most ${options.maxRounds ?? 3} rounds`,
    '',
    'Acceptance A6: the view of the model passes the rules V1 to V8 (no errors) after at most three rounds, without the tool having to fill in or drop entries. "Filled" counts generic entries including arcs that the model left out; "filled (not arcs)" counts places and transitions only.',
    '',
    '| Net | Result | Rounds | Errors per round | Warnings (final) | Filled | Filled (not arcs) | Dropped | Seconds | Tokens |',
    '| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const row of rows) {
    const result = row.error
      ? `ERROR: ${row.error.replace(/\|/g, '/')}`
      : row.passed
        ? 'PASS'
        : row.fellBack
          ? 'FALLBACK'
          : 'FILLED';
    lines.push(
      `| ${row.netName} | ${result} | ${row.rounds} | ${row.errorsPerRound.join(' → ') || '–'} | ${row.remainingWarnings} | ${row.filled} | ${row.filledNonArcs} | ${row.dropped} | ${row.seconds.toFixed(1)} | ${row.tokens || '–'} |`,
    );
  }
  for (const row of rows) {
    const result = details.get(row.example);
    if (!result) continue;
    lines.push('', `## ${row.netName}`, '');
    if (row.viewFile) lines.push(`View: \`${row.viewFile}\``, '');
    for (const round of result.rounds) {
      const errors = countErrors(round);
      lines.push(
        `- Round ${round.round} (${round.kind}, JSON mode ${round.mode}, ${(round.durationMs / 1000).toFixed(1)} s): ${errors} errors, ${round.diagnostics.length - errors} warnings${round.error ? `, failed: ${round.error}` : ''}`,
      );
      for (const d of round.diagnostics.slice(0, 12)) {
        lines.push(`  - ${d.rule} ${d.severity} \`${d.path}\`: ${d.message}`);
      }
      if (round.diagnostics.length > 12)
        lines.push(`  - … and ${round.diagnostics.length - 12} more`);
    }
    if (result.filled.length > 0) lines.push(`- Filled generically: ${result.filled.join(', ')}`);
    if (result.dropped.length > 0) lines.push(`- Dropped as invalid: ${result.dropped.join(', ')}`);
    for (const note of result.notes) lines.push(`- Note: ${note}`);
  }
  lines.push('');
  return lines.join('\n');
}

/** Generates the views, prints the findings per round and writes the report and the views. */
export async function runEval(options: EvalOptions): Promise<EvalOutcome> {
  const date = options.date ?? new Date().toISOString().slice(0, 10);
  const provider = createProvider({
    baseUrl: options.baseUrl,
    model: options.model,
    ...(options.apiKey ? { apiKey: options.apiKey } : {}),
    ...(options.jsonMode ? { jsonMode: options.jsonMode } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  mkdirSync(options.outDir, { recursive: true });
  const stem = `llm-${fileSafe(options.model)}-${date}`;
  const rows: EvalRow[] = [];
  const details = new Map<string, GenerateResult>();
  const files: string[] = [];

  for (const id of options.examples) {
    const net = loadExampleNet(options.examplesDir, id);
    const description = `${net.name}. ${EXAMPLE_SENTENCES[id] ?? FALLBACK_SENTENCE}`;
    options.log(`\n== ${net.name} (${id})`);
    try {
      const result = await generateDomainView(net, provider, {
        description,
        ...(options.maxRounds !== undefined ? { maxRounds: options.maxRounds } : {}),
        onProgress: (p) => {
          if (p.phase === 'waiting') options.log(`  round ${p.round}: waiting for the model ...`);
        },
      });
      for (const round of result.rounds) {
        const errors = countErrors(round);
        options.log(
          `  round ${round.round} (${round.kind}, mode ${round.mode}, ${(round.durationMs / 1000).toFixed(1)} s): ${errors} errors, ${round.diagnostics.length - errors} warnings${round.error ? ` [${round.error}]` : ''}`,
        );
        for (const d of round.diagnostics.slice(0, 10)) {
          options.log(`    ${d.rule} ${d.severity} ${d.path}: ${d.message}`);
        }
        if (round.diagnostics.length > 10) {
          options.log(`    ... and ${round.diagnostics.length - 10} more`);
        }
      }
      const viewFile = `${stem}-${id}.json`;
      writeFileSync(join(options.outDir, viewFile), `${JSON.stringify(result.view, null, 2)}\n`);
      files.push(join(options.outDir, viewFile));
      const row = { ...rowOf(id, net, result), viewFile };
      rows.push(row);
      details.set(id, result);
      options.log(
        `  => ${row.passed ? 'PASS' : row.fellBack ? 'FALLBACK' : 'FILLED'}: ${row.errorsPerRound.at(-1) ?? 0} errors left in round ${row.rounds}, ${result.diagnostics.length} warnings, ${row.filled} filled (${row.filledNonArcs} not arcs), ${row.dropped} dropped, ${row.seconds.toFixed(1)} s`,
      );
    } catch (error) {
      const message = errorMessage(error);
      options.log(`  => ERROR: ${message}`);
      rows.push({
        example: id,
        netName: net.name,
        passed: false,
        rounds: 0,
        errorsPerRound: [],
        warningsPerRound: [],
        remainingWarnings: 0,
        filled: 0,
        filledNonArcs: 0,
        dropped: 0,
        fellBack: false,
        seconds: 0,
        tokens: 0,
        error: message,
      });
    }
  }

  const reportPath = join(options.outDir, `${stem}.md`);
  writeFileSync(reportPath, renderReport(options, date, rows, details));
  files.push(reportPath);
  options.log(`\nReport: ${reportPath}`);
  return { rows, reportPath, files };
}
