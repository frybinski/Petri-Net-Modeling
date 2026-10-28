import type { PetriNet } from '@pnm/core';
import {
  fillArcs,
  fillMissing,
  genericDomainView,
  netHash,
  normalizeDomainView,
  validateDomainView,
  type DomainDiagnostic,
  type DomainView,
  type Provenance,
} from '@pnm/domain';
import { compactNet } from './compact-net';
import {
  emptyCandidate,
  inspect,
  isEmpty,
  mergeAnswer,
  type Candidate,
  type Inspection,
} from './candidate';
import { LlmError, errorMessage, isLlmError } from './errors';
import { defaultExamples } from './examples';
import type { ChatProvider, ChatResult } from './provider';
import {
  answerSchema,
  buildPrompt,
  buildRepairPrompt,
  type Canvas,
  type Prompt,
  type PromptExample,
} from './prompt';
import type { DomainViewGeneration, RoundKind, RoundLog } from './record';
import { publicBaseUrl } from './record';

export const DEFAULT_ROUNDS = 3;

export type GeneratePhase = 'prompt' | 'waiting' | 'validating' | 'repairing' | 'filling' | 'done';

export interface GenerateProgress {
  /** The round that is under way, from 1. */
  round: number;
  phase: GeneratePhase;
  /** For `validating` and `repairing`: the findings so far. */
  diagnostics?: DomainDiagnostic[];
}

export interface GenerateOptions {
  /** What the process is and where it happens, in the words of the person. */
  description: string;
  /** Size of the canvas. Default: the size the generic view would use. */
  canvas?: Canvas;
  /** Requests at most this many times (first answer plus repairs). Default 3. */
  maxRounds?: number;
  /** Worked examples for the prompt. Default: parcel center and smart office. */
  examples?: PromptExample[];
  onProgress?: (progress: GenerateProgress) => void;
  signal?: AbortSignal;
  /** The clock in milliseconds since the epoch (tests). */
  now?: () => number;
}

export interface GenerateResult {
  /** A view that passes the rules V1 to V5 for the net. */
  view: DomainView;
  rounds: RoundLog[];
  /** Paths of the entries that the tool filled in generically. */
  filled: string[];
  /** Paths of entries of the model that were left out because they were invalid. */
  dropped: string[];
  /** The findings that remain on the final view (warnings only). */
  diagnostics: DomainDiagnostic[];
  /** True if the model's answer was not used at all and the view is the generic one. */
  fellBack: boolean;
  /** Remarks for the person, for example a failed round. */
  notes: string[];
  model: string;
  startedAt: string;
  finishedAt: string;
  /** The first request. */
  prompt: Prompt;
  canvas: Canvas;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function aborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new LlmError('aborted', 'Cancelled');
}

function errorsOf(diagnostics: readonly DomainDiagnostic[]): DomainDiagnostic[] {
  return diagnostics.filter((d) => d.severity === 'error');
}

/** Entries of the candidate that are keyed by id, as paths like `places.p1`. */
function candidatePaths(candidate: Candidate): string[] {
  return [
    ...Object.keys(candidate.places).map((key) => `places.${key}`),
    ...Object.keys(candidate.transitions).map((key) => `transitions.${key}`),
    ...Object.keys(candidate.arcs).map((key) => `arcs.${key}`),
  ];
}

/**
 * Asks the model for a domain view of the net, checks the answer with the rules V1 to V8 and sends
 * the findings back as a repair request, at most `maxRounds` times in all. What is still wrong
 * afterwards is left out and filled in generically (`fillMissing`), so that the result always
 * passes the rules V1 to V5. Every entry carries its provenance: `llm` with the model, or `generic`.
 *
 * Throws an `LlmError` if the provider fails in the first round or the caller cancels. A provider
 * error in a later round ends the loop and leads to filling, with a note.
 */
export async function generateDomainView(
  net: PetriNet,
  provider: ChatProvider,
  options: GenerateOptions,
): Promise<GenerateResult> {
  const now = options.now ?? Date.now;
  const maxRounds = Math.max(1, Math.min(10, Math.round(options.maxRounds ?? DEFAULT_ROUNDS)));
  const progress = (
    round: number,
    phase: GeneratePhase,
    diagnostics?: DomainDiagnostic[],
  ): void => {
    options.onProgress?.({ round, phase, ...(diagnostics ? { diagnostics } : {}) });
  };

  const startedMs = now();
  const startedAt = iso(startedMs);
  const canvas = options.canvas ?? genericDomainView(net, { at: startedAt }).meta.canvas;
  aborted(options.signal);
  progress(1, 'prompt');
  const first = buildPrompt({
    net,
    description: options.description,
    canvas,
    examples: options.examples ?? defaultExamples(),
    schema: answerSchema(),
  });
  const compact = compactNet(net);

  const rounds: RoundLog[] = [];
  const notes: string[] = [];
  let candidate: Candidate = emptyCandidate();
  let diagnostics: DomainDiagnostic[] = [];
  let inspection: Inspection | null = null;
  let model = '';
  let request: Prompt = first;
  let kind: RoundKind = 'generate';
  // The provenance only matters for the final view; the checks of the rounds do not look at it.
  const llmStamp = (): Provenance => ({ source: 'llm', model, at: startedAt });

  for (let round = 1; round <= maxRounds; round += 1) {
    aborted(options.signal);
    progress(round, 'waiting');
    const roundStart = now();
    let answer: ChatResult;
    try {
      answer = await provider.chat({
        system: request.system,
        user: request.user,
        ...(kind === 'generate' ? { schema: answerSchema() } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (error) {
      if (isLlmError(error) && error.kind === 'aborted') throw error;
      if (round === 1) throw error;
      const message = errorMessage(error);
      rounds.push({
        round,
        kind,
        mode: 'none',
        diagnostics,
        durationMs: now() - roundStart,
        error: message,
      });
      notes.push(`Round ${round} failed (${message}); the rest was filled in generically.`);
      break;
    }
    if (model === '') model = answer.model;

    progress(round, 'validating');
    const merged = mergeAnswer(candidate, answer.json, kind === 'generate');
    let error: string | undefined;
    if (merged.usable) {
      candidate = merged.candidate;
    } else {
      error =
        answer.json === undefined
          ? 'The answer contains no JSON'
          : 'The answer is a JSON value without places, transitions or other parts of a view';
    }
    inspection = inspect(net, candidate, llmStamp(), canvas);
    diagnostics = isEmpty(candidate)
      ? [{ rule: 'V1', severity: 'error', path: '(root)', message: error ?? 'The answer is empty' }]
      : inspection.diagnostics;
    rounds.push({
      round,
      kind,
      mode: answer.mode,
      ...(answer.usage ? { usage: answer.usage } : {}),
      diagnostics,
      durationMs: now() - roundStart,
      written: merged.written,
      ...(error !== undefined ? { error } : {}),
    });

    if (errorsOf(diagnostics).length === 0 || round === maxRounds) break;
    progress(round, 'repairing', diagnostics);
    if (isEmpty(candidate)) {
      kind = 'generate';
      request = {
        system: first.system,
        user: `${first.user}\n\n## Previous answer\nYour previous answer could not be used: ${error ?? 'it was empty'}. Answer with one JSON object only.`,
      };
    } else {
      kind = 'repair';
      request = buildRepairPrompt({
        previous: candidate,
        diagnostics,
        net: compact,
        canvas,
      });
    }
  }

  // Filling: what is left over after the last round.
  const lastRound = rounds.length;
  progress(lastRound, 'filling', diagnostics);
  const finishedMs = now();
  const finishedAt = iso(finishedMs);
  const final = inspection ?? inspect(net, candidate, llmStamp(), canvas);

  let view: DomainView = fillMissing(net, final.view, { at: finishedAt });
  // Scenery that breaks a rule is dropped: there is nothing generic to put in its place.
  const badDecor = new Set(final.invalidDecor);
  for (const d of validateDomainView(net, view).diagnostics) {
    const index = d.severity === 'error' ? /^decor\[(\d+)\]/.exec(d.path)?.[1] : undefined;
    if (index !== undefined) badDecor.add(Number(index));
  }
  const { decor, ...withoutDecor } = view;
  const keptDecor = (decor ?? []).filter((_, i) => !badDecor.has(i));
  view = keptDecor.length > 0 ? { ...withoutDecor, decor: keptDecor } : withoutDecor;
  view = fillArcs(net, view, { at: finishedAt });

  let check = validateDomainView(net, view);
  if (!check.ok) {
    // Not expected: the steps above remove everything that breaks a rule.
    view = genericDomainView(net, { canvas, at: finishedAt });
    check = validateDomainView(net, view);
    notes.push('The result broke the rules and was replaced by the generic view.');
  }
  view = normalizeDomainView({ ...view, netHash: netHash(net) });
  if (final.metaReplaced && !isEmpty(candidate)) {
    notes.push('The header (meta) of the answer was missing or invalid and was replaced.');
  }

  const kept = new Set(
    Object.entries(view.provenance)
      .filter(([, p]) => p.source === 'llm')
      .map(([key]) => key),
  );
  const filled = Object.entries(view.provenance)
    .filter(([, p]) => p.source === 'generic')
    .map(([key]) => key)
    .sort();
  const dropped = [
    ...candidatePaths(candidate).filter((path) => !kept.has(path)),
    ...[...badDecor].sort((a, b) => a - b).map((i) => `decor[${i}]`),
  ].sort();
  const fellBack = kept.size === 0;

  progress(lastRound, 'done', check.diagnostics);
  return {
    view,
    rounds,
    filled,
    dropped,
    diagnostics: check.diagnostics,
    fellBack,
    notes,
    model: model === '' ? 'unknown' : model,
    startedAt,
    finishedAt,
    prompt: first,
    canvas,
  };
}

/** The record that is stored with the net. The API key is not part of it. */
export function toGenerationRecord(
  result: GenerateResult,
  info: { description: string; baseUrl: string },
): DomainViewGeneration {
  return {
    model: result.model,
    baseUrl: publicBaseUrl(info.baseUrl),
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    description: info.description,
    prompt: result.prompt,
    rounds: result.rounds,
    filled: result.filled,
    dropped: result.dropped,
    ...(result.notes.length > 0 ? { notes: result.notes } : {}),
  };
}
