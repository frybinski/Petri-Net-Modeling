/**
 * JSON for prompts: the first `levels` levels of objects and arrays get one entry per line, deeper
 * values stay on one line. Keeps the prompt short and still readable.
 */
export function compactJson(value: unknown, levels = 2, indent = 0): string {
  if (levels <= 0 || typeof value !== 'object' || value === null) return JSON.stringify(value);
  const pad = '  '.repeat(indent + 1);
  const end = '  '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const rows = value.map((item) => `${pad}${compactJson(item, levels - 1, indent + 1)}`);
    return `[\n${rows.join(',\n')}\n${end}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, v]) => v !== undefined,
  );
  if (entries.length === 0) return '{}';
  const rows = entries.map(
    ([key, v]) => `${pad}${JSON.stringify(key)}: ${compactJson(v, levels - 1, indent + 1)}`,
  );
  return `{\n${rows.join(',\n')}\n${end}}`;
}
