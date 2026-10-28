import { LlmError, type LlmErrorKind } from '../errors';
import { parseJsonLoose } from '../json';
import type { ChatProvider, ChatRequest, ChatResult, UsedMode } from '../provider';

/** One scripted answer of the fake provider. */
export type FakeStep =
  /** Answers with this JSON value (as text). */
  | { json: unknown; model?: string; mode?: UsedMode }
  /** Answers with this text, for example a code block or broken JSON. */
  | { text: string; model?: string; mode?: UsedMode }
  /** Fails like the real provider does. */
  | { error: LlmErrorKind; message?: string }
  /** Never answers; ends with `aborted` when the caller cancels, else with `timeout` after `afterMs`. */
  | { hang: true; afterMs?: number };

export type FakeScript = Array<FakeStep | ((request: ChatRequest, index: number) => FakeStep)>;

export interface FakeProvider extends ChatProvider {
  /** The requests received so far. */
  readonly calls: ChatRequest[];
}

export const FAKE_MODEL = 'fake-model';

/** Waits until the caller cancels (`aborted`) or the time is up (`timeout`). */
function hang(signal: AbortSignal | undefined, afterMs: number): Promise<never> {
  return new Promise((_resolve, reject) => {
    const cancel = (): void => {
      clearTimeout(timer);
      reject(new LlmError('aborted', 'Cancelled'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', cancel);
      reject(new LlmError('timeout', 'No answer in time'));
    }, afterMs);
    if (signal?.aborted) cancel();
    else signal?.addEventListener('abort', cancel, { once: true });
  });
}

/**
 * A provider that answers from a script, one step per request, so that the generation loop can be
 * tested without a network. When the script is used up, the last step repeats.
 */
export function createFakeProvider(script: FakeScript): FakeProvider {
  const calls: ChatRequest[] = [];
  return {
    calls,
    async chat(request: ChatRequest): Promise<ChatResult> {
      const index = calls.length;
      calls.push(request);
      const entry = script[Math.min(index, script.length - 1)];
      if (entry === undefined)
        throw new LlmError('bad-response', 'The fake provider has no script');
      const step = typeof entry === 'function' ? entry(request, index) : entry;

      if ('error' in step) throw new LlmError(step.error, step.message ?? `fake ${step.error}`);
      if ('hang' in step) await hang(request.signal, step.afterMs ?? 60_000);
      const text = 'json' in step ? JSON.stringify(step.json) : 'text' in step ? step.text : '';
      const result: ChatResult = {
        text,
        model: ('model' in step ? step.model : undefined) ?? FAKE_MODEL,
        mode: ('mode' in step ? step.mode : undefined) ?? 'schema',
        usage: { prompt: request.system.length + request.user.length, completion: text.length },
      };
      if ('json' in step) result.json = step.json;
      else {
        try {
          result.json = parseJsonLoose(text);
        } catch {
          // No JSON in the text: the generation has to cope with that.
        }
      }
      return result;
    },
  };
}
