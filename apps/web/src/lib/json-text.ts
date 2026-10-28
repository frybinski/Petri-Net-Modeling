/** A range in a text, as character offsets. */
export interface TextRange {
  from: number;
  to: number;
}

export type JsonParse =
  { ok: true; value: unknown } | { ok: false; message: string; range: TextRange };

/** Extracts the offset from an engine's JSON error message, which comes in several wordings. */
function errorOffset(message: string, text: string): number | undefined {
  const position = /position (\d+)/.exec(message);
  if (position?.[1] !== undefined) return Number(position[1]);
  const lineColumn = /line (\d+) column (\d+)/.exec(message);
  if (lineColumn?.[1] !== undefined && lineColumn[2] !== undefined) {
    const lines = text.split('\n');
    const line = Number(lineColumn[1]) - 1;
    let offset = 0;
    for (let i = 0; i < line && i < lines.length; i += 1) offset += (lines[i]?.length ?? 0) + 1;
    return offset + Number(lineColumn[2]) - 1;
  }
  return undefined;
}

/** Parses JSON text and, on failure, tells where the problem is. */
export function parseJson(text: string): JsonParse {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    // Keep the wording short: drop the quoted source text some engines append.
    const message = raw.replace(/,? ".*" is not valid JSON$/s, '').replace(/ \(line .*\)$/, '');
    const offset = errorOffset(raw, text);
    const at = Math.min(Math.max(0, offset ?? text.length - 1), Math.max(0, text.length - 1));
    return {
      ok: false,
      message: message || 'Unexpected input',
      range: { from: at, to: Math.min(text.length, at + 1) },
    };
  }
}

/** Compact for short values, indented otherwise. */
export function formatJson(value: unknown): string {
  const compact = JSON.stringify(value);
  if (compact !== undefined && compact.length <= 40) return compact;
  return JSON.stringify(value, null, 2) ?? '';
}
