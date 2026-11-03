import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNetText, type PetriNet } from '@pnm/core';
import type { DomainView } from '@pnm/domain';
import {
  PROMPT_VERSION,
  compareViews,
  createProvider,
  errorMessage,
  generateDomainView,
  publicBaseUrl,
  withoutOwnExample,
  type GenerateResult,
  type PromptExample,
  type ViewSimilarity,
} from '../src';
import type { JsonMode } from '../src/provider';

/** The examples of the repository, with the sentence that follows the name of the net. */
export const EXAMPLE_SENTENCES: Record<string, string> = {
  'parcel-center':
    'A parcel sorting center: parcels arrive at the hall, are scanned, sorted and loaded at the docks.',
  'smart-office':
    'An open-plan office: people enter through a turnstile, work at desks, meet in rooms and fetch coffee.',
  'bike-frames':
    'A bicycle frame factory: tubes are cut, welded and powder coated, the frames are inspected, reworked or scrapped and shipped; material, scrap, waste and emissions are counted.',
};
export const DEFAULT_EXAMPLES = ['parcel-center', 'smart-office'];

export interface EvalOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  jsonMode?: JsonMode;
  temperature?: number;
  maxRounds?: number;
  timeoutMs?: number;
  /** Ids of files in the examples folder, without `.pn.json`: the nets that are evaluated. */
  examples: string[];
  /**
   * Ids of the nets whose views are shown to the model as worked examples; `[]` shows none
   * (zero-shot). Default: `DEFAULT_EXAMPLES`. The net that is evaluated is always left out.
   */
  shots?: string[];
  /** Send the editor positions of the nets (default true). */
  positions?: boolean;
  /** The description of the domain per net id; replaces the built-in sentence. */
  descriptions?: Record<string, string>;
  /** A JSON file `{ "<id>": "<text>" }`; the entries of `descriptions` win. */
  descriptionsFile?: string;
  /** How often every net is generated, independently (default 1). */
  repeat?: number;
  /** Write the first request of every net next to the report. */
  savePrompts?: boolean;
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
  /** From 1; the number of the run of this net when `repeat` is above 1. */
  run: number;
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
  /** Against the view stored in the repository; absent if the net has none or the run failed. */
  similarity?: ViewSimilarity;
}

/** What went into the first request of a net, as hashes (identical for every run of the net). */
export interface PromptInfo {
  example: string;
  promptVersion: number;
  systemSha256: string;
  userSha256: string;
  /** Ids of the nets shown as worked examples, the evaluated net itself left out. */
  shots: string[];
  descriptionSource: 'custom' | 'built-in' | 'none';
  description: string;
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
  --examples <ids>      the nets that are evaluated: comma separated ids from examples/,
                        default parcel-center,smart-office
  --shots <ids>|none    the nets whose views are shown to the model as worked examples,
                        default parcel-center,smart-office; none is zero-shot. The net that is
                        evaluated is never shown.
  --no-positions        send no editor positions (and leave out the sentence about them)
  --description <id>=<text>
                        the description of the domain for one net; repeatable. Without it the built-in
                        sentence is used, and "A process called ..." if there is none.
  --descriptions <file> the same as a JSON file { "<id>": "<text>" }; --description wins
  --repeat <n>          generate every net n times, independently; the report lists every run and
                        a summary
  --save-prompts        write the first request (system and user text) of every net next to the report
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
  const descriptionArgs: string[] = [];
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--') continue;
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument "${arg}"`);
    const name = arg.slice(2);
    if (
      name === 'help' ||
      name === 'strict' ||
      name === 'no-positions' ||
      name === 'save-prompts'
    ) {
      flags.add(name);
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--'))
      throw new Error(`Option --${name} needs a value`);
    if (name === 'description') descriptionArgs.push(value);
    else values.set(name, value);
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
    'shots',
    'descriptions',
    'repeat',
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
  const repeat = number('repeat');
  if (repeat !== undefined && (!Number.isInteger(repeat) || repeat < 1 || repeat > MAX_REPEAT)) {
    throw new Error(`--repeat needs a whole number from 1 to ${MAX_REPEAT}, not "${repeat}"`);
  }
  const date = values.get('date');
  const outDir = values.get('out-dir');
  const ids = (text: string): string[] =>
    text
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id !== '');
  const shotsArg = values.get('shots');
  const shots =
    shotsArg === undefined ? undefined : shotsArg.trim() === 'none' ? [] : ids(shotsArg);
  if (shotsArg !== undefined && shots?.length === 0 && shotsArg.trim() !== 'none') {
    throw new Error('--shots needs ids or "none"');
  }
  const descriptions: Record<string, string> = {};
  for (const arg of descriptionArgs) {
    const at = arg.indexOf('=');
    const id = at < 0 ? '' : arg.slice(0, at).trim();
    const text = at < 0 ? '' : arg.slice(at + 1).trim();
    if (id === '' || text === '') {
      throw new Error(`--description needs <id>=<text>, not "${arg}"`);
    }
    if (Object.hasOwn(descriptions, id)) {
      throw new Error(`The description of "${id}" is given twice`);
    }
    descriptions[id] = text;
  }
  const descriptionsFile = values.get('descriptions');
  return {
    help,
    strict: flags.has('strict'),
    options: {
      baseUrl,
      model,
      examples: ids(values.get('examples') ?? DEFAULT_EXAMPLES.join(',')),
      ...(shots ? { shots } : {}),
      ...(flags.has('no-positions') ? { positions: false } : {}),
      ...(descriptionArgs.length > 0 ? { descriptions } : {}),
      ...(descriptionsFile ? { descriptionsFile } : {}),
      ...(repeat !== undefined ? { repeat } : {}),
      ...(flags.has('save-prompts') ? { savePrompts: true } : {}),
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

/** At most this many runs per net. */
export const MAX_REPEAT = 100;

/** The repository root, found from the location of this file. */
export function repositoryRoot(): string {
  return resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
}

function fileSafe(text: string): string {
  return text.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'model';
}

function netFile(dir: string, id: string): string {
  return join(dir, `${id}.pn.json`);
}

/** The example net as the model sees it (without its view) and the stored view, if any. */
function loadExampleNet(dir: string, id: string): { net: PetriNet; reference?: DomainView } {
  const net = parseNetText(readFileSync(netFile(dir, id), 'utf8'));
  // The stored view is the expected answer; the model never sees it.
  const { domainView, domainViewGeneration: _generation, ...rest } = net;
  return { net: rest, ...(domainView ? { reference: domainView as DomainView } : {}) };
}

/** A net with its view as a worked example. */
function loadShot(dir: string, id: string): PromptExample {
  const net = parseNetText(readFileSync(netFile(dir, id), 'utf8'));
  if (!net.domainView)
    throw new Error(`The example "${id}" has no domain view and cannot be a shot`);
  return { net, view: net.domainView as DomainView };
}

function readDescriptionsFile(path: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read the descriptions file ${path}: ${errorMessage(error)}`, {
      cause: error,
    });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`The descriptions file ${path} must be a JSON object { "<id>": "<text>" }`);
  }
  const result: Record<string, string> = {};
  for (const [id, text] of Object.entries(parsed)) {
    if (typeof text !== 'string') {
      throw new Error(`The description of "${id}" in ${path} must be a string`);
    }
    result[id] = text;
  }
  return result;
}

/** The descriptions in force: the file, then the options on top. */
export function resolveDescriptions(options: {
  descriptions?: Record<string, string>;
  descriptionsFile?: string;
}): Record<string, string> {
  return {
    ...(options.descriptionsFile ? readDescriptionsFile(options.descriptionsFile) : {}),
    ...options.descriptions,
  };
}

/** Throws if an id names no example net, or a shot has no view. */
export function checkIds(
  options: Pick<EvalOptions, 'examples' | 'shots' | 'examplesDir'>,
  descriptions: Record<string, string>,
): void {
  const known = (id: string): boolean => existsSync(netFile(options.examplesDir, id));
  const where: Array<[string, string[]]> = [
    ['--examples', options.examples],
    ['--shots', options.shots ?? []],
    ['--description', Object.keys(descriptions)],
  ];
  for (const [option, ids] of where) {
    for (const id of ids) {
      if (!known(id))
        throw new Error(`${option}: there is no example net "${id}" in the examples folder`);
    }
  }
  for (const id of options.shots ?? []) loadShot(options.examplesDir, id);
}

function countErrors(round: { diagnostics: Array<{ severity: string }> }): number {
  return round.diagnostics.filter((d) => d.severity === 'error').length;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function rowOf(
  example: string,
  run: number,
  net: PetriNet,
  result: GenerateResult,
  reference: DomainView | undefined,
): EvalRow {
  const last = result.rounds.at(-1);
  const filledNonArcs = result.filled.filter((p) => !p.startsWith('arcs.')).length;
  const tokens = result.rounds.reduce(
    (sum, r) => sum + (r.usage ? r.usage.prompt + r.usage.completion : 0),
    0,
  );
  const seconds = (Date.parse(result.finishedAt) - Date.parse(result.startedAt)) / 1000;
  return {
    example,
    run,
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
    ...(reference ? { similarity: compareViews(result.view, reference) } : {}),
  };
}

function resultOf(row: EvalRow): string {
  return row.error ? 'ERROR' : row.passed ? 'PASS' : row.fellBack ? 'FALLBACK' : 'FILLED';
}

/** The name of a row; with several runs the number of the run follows. */
export function rowLabel(row: EvalRow, runs: number): string {
  return runs > 1 ? `${row.netName} #${row.run}` : row.netName;
}

/** What was set for the run, so that it can be described exactly in a paper. */
export interface Conditions {
  promptVersion: number;
  model: string;
  baseUrl: string;
  date: string;
  /** The nets shown as worked examples: the setting, before the evaluated net is left out. */
  shots: string[] | 'default';
  positions: boolean;
  temperature: number;
  maxRounds: number;
  jsonMode: JsonMode;
  repeat: number;
}

export type ConditionOptions = Pick<
  EvalOptions,
  'model' | 'baseUrl' | 'temperature' | 'jsonMode' | 'maxRounds' | 'shots' | 'positions' | 'repeat'
>;

export function conditionsOf(options: ConditionOptions, date: string): Conditions {
  return {
    promptVersion: PROMPT_VERSION,
    model: options.model,
    baseUrl: publicBaseUrl(options.baseUrl),
    date,
    shots: options.shots ?? 'default',
    positions: options.positions !== false,
    temperature: options.temperature ?? 0.2,
    maxRounds: options.maxRounds ?? 3,
    jsonMode: options.jsonMode ?? 'auto',
    repeat: options.repeat ?? 1,
  };
}

export interface NetSummary {
  example: string;
  netName: string;
  runs: number;
  passed: number;
  errors: number;
  /** Rounds used, as `{ "<rounds>": <runs> }`, over the runs that were answered. */
  roundsDistribution: Record<string, number>;
  meanSeconds: number;
  tokens: number;
  /** Means over the runs that have a similarity. */
  meanKindPercent: number | null;
  meanDistance: number | null;
  meanAppearancePercent: number | null;
  meanDisplayPercent: number | null;
}

function mean(values: Array<number | null | undefined>): number | null {
  const present = values.filter((v): v is number => typeof v === 'number');
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0) / present.length;
}

/** One summary per net, in the order of first appearance. */
export function summarize(rows: readonly EvalRow[]): NetSummary[] {
  const order = [...new Set(rows.map((r) => r.example))];
  return order.map((example) => {
    const own = rows.filter((r) => r.example === example);
    const answered = own.filter((r) => !r.error);
    const distribution: Record<string, number> = {};
    for (const row of answered) {
      distribution[String(row.rounds)] = (distribution[String(row.rounds)] ?? 0) + 1;
    }
    const sims = answered.map((r) => r.similarity);
    return {
      example,
      netName: own[0]?.netName ?? example,
      runs: own.length,
      passed: own.filter((r) => r.passed).length,
      errors: own.length - answered.length,
      roundsDistribution: Object.fromEntries(
        Object.entries(distribution).sort(([a], [b]) => Number(a) - Number(b)),
      ),
      meanSeconds: mean(answered.map((r) => r.seconds)) ?? 0,
      tokens: answered.reduce((sum, r) => sum + r.tokens, 0),
      meanKindPercent: mean(sims.map((x) => x?.kindPercent)),
      meanDistance: mean(sims.map((x) => x?.meanDistance)),
      meanAppearancePercent: mean(sims.map((x) => x?.appearancePercent)),
      meanDisplayPercent: mean(sims.map((x) => x?.displayPercent)),
    };
  });
}

function pct(value: number | null | undefined): string {
  return typeof value === 'number' ? `${value.toFixed(1)} %` : '–';
}

function dist(value: number | null | undefined): string {
  return typeof value === 'number' ? value.toFixed(3) : '–';
}

function distribution(summary: NetSummary): string {
  const parts = Object.entries(summary.roundsDistribution).map(
    ([rounds, count]) => `${count}× ${rounds}`,
  );
  return parts.length > 0 ? parts.join(', ') : '–';
}

/** The report as a Markdown table with the findings of every round. */
export function renderReport(
  options: ConditionOptions,
  date: string,
  rows: readonly EvalRow[],
  details: ReadonlyMap<string, GenerateResult>,
  prompts: readonly PromptInfo[] = [],
): string {
  const conditions = conditionsOf(options, date);
  const runs = conditions.repeat;
  const lines: string[] = [
    `# LLM generation of the domain view: ${options.model}`,
    '',
    `Date: ${date} · Server: ${conditions.baseUrl} · Temperature: ${conditions.temperature} · JSON mode: ${conditions.jsonMode} · At most ${conditions.maxRounds} rounds · Prompt version: ${PROMPT_VERSION}`,
    '',
    'Acceptance A6: the view of the model passes the rules V1 to V11 (no errors) after at most three rounds, without the tool having to fill in or drop entries. "Filled" counts generic entries including arcs that the model left out; "filled (not arcs)" counts places and transitions only.',
    '',
    '## Conditions',
    '',
    `- Prompt version: ${PROMPT_VERSION}`,
    `- Worked examples (shots): ${conditions.shots === 'default' ? 'default (parcel-center, smart-office)' : conditions.shots.length === 0 ? 'none (zero-shot)' : conditions.shots.join(', ')}; the evaluated net is never among them`,
    `- Editor positions sent: ${conditions.positions ? 'yes' : 'no'}`,
    `- Temperature: ${conditions.temperature} · JSON mode: ${conditions.jsonMode} · At most ${conditions.maxRounds} rounds`,
    `- Runs per net: ${runs}`,
  ];
  for (const info of prompts) {
    lines.push(
      `- Description of ${info.example} (${info.descriptionSource}): ${info.description === '' ? '(none; "A process called ...")' : info.description.replace(/\s+/g, ' ')}`,
    );
  }
  lines.push(
    '',
    '## Results',
    '',
    '| Net | Result | Rounds | Errors per round | Warnings (final) | Filled | Filled (not arcs) | Dropped | Seconds | Tokens |',
    '| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  );
  for (const row of rows) {
    const result = row.error
      ? `ERROR: ${row.error.replace(/\|/g, '/')}`
      : row.passed
        ? 'PASS'
        : row.fellBack
          ? 'FALLBACK'
          : 'FILLED';
    lines.push(
      `| ${rowLabel(row, runs)} | ${result} | ${row.rounds} | ${row.errorsPerRound.join(' → ') || '–'} | ${row.remainingWarnings} | ${row.filled} | ${row.filledNonArcs} | ${row.dropped} | ${row.seconds.toFixed(1)} | ${row.tokens || '–'} |`,
    );
  }

  const summaries = summarize(rows);
  if (runs > 1) {
    lines.push(
      '',
      '## Summary of the runs',
      '',
      '| Net | Runs | Passed | Rounds per run | Mean seconds | Tokens |',
      '| --- | ---: | --- | --- | ---: | ---: |',
    );
    for (const s of summaries) {
      lines.push(
        `| ${s.netName} | ${s.runs} | ${s.passed} of ${s.runs} (${((100 * s.passed) / s.runs).toFixed(0)} %) | ${distribution(s)} | ${s.meanSeconds.toFixed(1)} | ${s.tokens || '–'} |`,
      );
    }
  }

  const compared = rows.filter((r) => r.similarity);
  lines.push(
    '',
    '## Similarity to the reference view',
    '',
    'Against the view stored in the repository for the same net: kind agreement (share of places and transitions with the same kind), mean distance of the element centers divided by the diagonal of the canvas (0 is identical; hidden elements and slots places have no center), and the share of equal appearances and displays among the places where either view has one. Decor, arcs and labels are not compared. A high value shows how close a result is to the reference, not that it is better.',
    '',
  );
  if (compared.length === 0) {
    lines.push('No net of this run has a reference view.');
  } else {
    lines.push(
      '| Net | Kind agreement | Mean distance (of diagonal) | Appearance | Display |',
      '| --- | ---: | ---: | ---: | ---: |',
    );
    for (const row of compared) {
      const sim = row.similarity;
      lines.push(
        `| ${rowLabel(row, runs)} | ${pct(sim?.kindPercent)} | ${dist(sim?.meanDistance)} | ${pct(sim?.appearancePercent)} (${sim?.appearances ?? 0}) | ${pct(sim?.displayPercent)} (${sim?.displays ?? 0}) |`,
      );
    }
    if (runs > 1) {
      lines.push('', 'Means over the runs:', '');
      lines.push(
        '| Net | Kind agreement | Mean distance (of diagonal) | Appearance | Display |',
        '| --- | ---: | ---: | ---: | ---: |',
      );
      for (const s of summaries) {
        lines.push(
          `| ${s.netName} | ${pct(s.meanKindPercent)} | ${dist(s.meanDistance)} | ${pct(s.meanAppearancePercent)} | ${pct(s.meanDisplayPercent)} |`,
        );
      }
    }
  }

  if (prompts.length > 0) {
    lines.push(
      '',
      '## First request',
      '',
      'SHA-256 of the UTF-8 text of the system and the user part of the first request of each net (the same for every run of the net).',
      '',
      '| Net | Prompt version | Worked examples | SHA-256 system | SHA-256 user |',
      '| --- | ---: | --- | --- | --- |',
    );
    for (const info of prompts) {
      lines.push(
        `| ${info.example} | ${info.promptVersion} | ${info.shots.join(', ') || 'none'} | \`${info.systemSha256}\` | \`${info.userSha256}\` |`,
      );
    }
  }

  for (const row of rows) {
    const result = details.get(detailKey(row));
    if (!result) continue;
    lines.push('', `## ${rowLabel(row, runs)}`, '');
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

/** The key of the details of a run. */
export function detailKey(row: Pick<EvalRow, 'example' | 'run'>): string {
  return `${row.example}#${row.run}`;
}

/** The report as data, for further processing. */
export function reportJson(
  options: ConditionOptions,
  date: string,
  rows: readonly EvalRow[],
  prompts: readonly PromptInfo[],
): unknown {
  return {
    conditions: conditionsOf(options, date),
    prompts,
    runs: rows,
    summary: summarize(rows),
  };
}

/** Generates the views, prints the findings per round and writes the report and the views. */
export async function runEval(options: EvalOptions): Promise<EvalOutcome> {
  const date = options.date ?? new Date().toISOString().slice(0, 10);
  const descriptions = resolveDescriptions(options);
  checkIds(options, descriptions);
  const repeat = options.repeat ?? 1;
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > MAX_REPEAT) {
    throw new Error(`repeat must be a whole number from 1 to ${MAX_REPEAT}`);
  }
  const conditionOptions: ConditionOptions = { ...options, repeat };
  const shotList = options.shots ?? DEFAULT_EXAMPLES;
  const shots = shotList.map((id) => ({ id, example: loadShot(options.examplesDir, id) }));

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
  const prompts = new Map<string, PromptInfo>();
  const files: string[] = [];

  for (const id of options.examples) {
    const { net, reference } = loadExampleNet(options.examplesDir, id);
    const custom = descriptions[id];
    const builtIn = EXAMPLE_SENTENCES[id];
    const description =
      custom !== undefined ? custom : builtIn !== undefined ? `${net.name}. ${builtIn}` : '';
    const descriptionSource =
      custom !== undefined ? 'custom' : builtIn !== undefined ? 'built-in' : 'none';
    // The net itself is never a worked example of its own prompt (compared by structure).
    const examples = withoutOwnExample(
      net,
      shots.map((s) => s.example),
    );
    const shownIds = shots.filter((s) => examples.includes(s.example)).map((s) => s.id);
    for (let run = 1; run <= repeat; run += 1) {
      options.log(`\n== ${net.name} (${id})${repeat > 1 ? ` run ${run} of ${repeat}` : ''}`);
      try {
        const result = await generateDomainView(net, provider, {
          description,
          examples,
          ...(options.positions === false ? { positions: false } : {}),
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
        if (!prompts.has(id)) {
          const info: PromptInfo = {
            example: id,
            promptVersion: PROMPT_VERSION,
            systemSha256: sha256(result.prompt.system),
            userSha256: sha256(result.prompt.user),
            shots: shownIds,
            descriptionSource,
            description,
          };
          prompts.set(id, info);
          if (options.savePrompts) {
            for (const [part, text] of [
              ['system', result.prompt.system],
              ['user', result.prompt.user],
            ] as const) {
              const file = join(options.outDir, `${stem}-${id}-prompt-${part}.txt`);
              // Exactly the text that was sent, so that `sha256sum` of the file gives the hash of the report.
              writeFileSync(file, text);
              files.push(file);
            }
          }
        }
        const viewFile = `${stem}-${id}${repeat > 1 ? `-run${run}` : ''}.json`;
        writeFileSync(join(options.outDir, viewFile), `${JSON.stringify(result.view, null, 2)}\n`);
        files.push(join(options.outDir, viewFile));
        const row = { ...rowOf(id, run, net, result, reference), viewFile };
        rows.push(row);
        details.set(detailKey(row), result);
        options.log(
          `  => ${resultOf(row)}: ${row.errorsPerRound.at(-1) ?? 0} errors left in round ${row.rounds}, ${result.diagnostics.length} warnings, ${row.filled} filled (${row.filledNonArcs} not arcs), ${row.dropped} dropped, ${row.seconds.toFixed(1)} s`,
        );
      } catch (error) {
        const message = errorMessage(error);
        options.log(`  => ERROR: ${message}`);
        rows.push({
          example: id,
          run,
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
  }

  const promptList = [...prompts.values()];
  const reportPath = join(options.outDir, `${stem}.md`);
  writeFileSync(reportPath, renderReport(conditionOptions, date, rows, details, promptList));
  files.push(reportPath);
  const jsonPath = join(options.outDir, `${stem}.report.json`);
  writeFileSync(
    jsonPath,
    `${JSON.stringify(reportJson(conditionOptions, date, rows, promptList), null, 2)}\n`,
  );
  files.push(jsonPath);
  options.log(`\nReport: ${reportPath}`);
  return { rows, reportPath, files };
}
