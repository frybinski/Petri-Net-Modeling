import { LlmError } from './errors';

/** Reasoning models put their thoughts in `<think>` blocks in front of the answer. */
function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*<\/think>/i, '');
}

function tryParse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/** The end index (exclusive) of the JSON object that starts at `start`, or -1. */
function objectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Reads JSON out of the text of a model answer: plain JSON, JSON in a Markdown code block, or the
 * first complete JSON object somewhere in the text. Throws an `LlmError` of kind `parse` if there
 * is none.
 */
export function parseJsonLoose(text: string): unknown {
  const cleaned = stripThinking(text).trim();
  const plain = tryParse(cleaned);
  if (plain.ok) return plain.value;

  for (const match of cleaned.matchAll(/```[a-zA-Z]*\s*([\s\S]*?)```/g)) {
    const block = tryParse((match[1] ?? '').trim());
    if (block.ok) return block.value;
  }

  let start = cleaned.indexOf('{');
  while (start >= 0) {
    const end = objectEnd(cleaned, start);
    if (end < 0) break;
    const found = tryParse(cleaned.slice(start, end));
    if (found.ok) return found.value;
    start = cleaned.indexOf('{', start + 1);
  }
  throw new LlmError(
    'parse',
    cleaned === '' ? 'The answer is empty' : 'The answer does not contain a JSON object',
  );
}
