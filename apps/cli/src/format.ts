/** Text output: plain tables, no colors unless the output is a terminal. */

export interface Style {
  bold(text: string): string;
  red(text: string): string;
  yellow(text: string): string;
  green(text: string): string;
  dim(text: string): string;
}

export function makeStyle(color: boolean): Style {
  const wrap =
    (open: number, close: number) =>
    (text: string): string =>
      color ? `\u001b[${open}m${text}\u001b[${close}m` : text;
  return {
    bold: wrap(1, 22),
    red: wrap(31, 39),
    yellow: wrap(33, 39),
    green: wrap(32, 39),
    dim: wrap(2, 22),
  };
}

export type Align = 'left' | 'right';

export interface Column {
  header: string;
  align?: Align;
}

/** Visible length of a string without the color codes. */
function visibleLength(text: string): number {
  // eslint-disable-next-line no-control-regex -- the escape character starts a color code
  return text.replace(/\u001b\[\d+m/g, '').length;
}

function pad(text: string, width: number, align: Align): string {
  const gap = ' '.repeat(Math.max(0, width - visibleLength(text)));
  return align === 'right' ? gap + text : text + gap;
}

/** A table with a header row, columns separated by two spaces, no trailing blanks. */
export function table(columns: readonly Column[], rows: ReadonlyArray<readonly string[]>): string {
  const widths = columns.map((column, i) =>
    Math.max(visibleLength(column.header), ...rows.map((row) => visibleLength(row[i] ?? ''))),
  );
  const line = (cells: readonly string[]): string =>
    columns
      .map((column, i) => pad(cells[i] ?? '', widths[i] ?? 0, column.align ?? 'left'))
      .join('  ')
      .trimEnd();
  return `${[line(columns.map((c) => c.header)), ...rows.map(line)].join('\n')}\n`;
}

/** Seconds as `2 h 03 min`, `4 min 05 s` or `12.5 s`. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '-';
  if (seconds < 60) return `${Math.round(seconds * 10) / 10} s`;
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, '0')} min`;
  return `${minutes} min ${String(rest).padStart(2, '0')} s`;
}

export function formatNumber(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return '-';
  return String(Math.round(value * 10 ** digits) / 10 ** digits);
}

export function plural(n: number, noun: string, many = `${noun}s`): string {
  return `${n} ${n === 1 ? noun : many}`;
}
