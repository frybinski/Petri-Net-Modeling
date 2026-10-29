import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';
import { UsageError } from './errors';

export interface Parsed<O extends ParseArgsOptionsConfig> {
  values: ReturnType<typeof parseArgs<{ options: O; allowPositionals: true }>>['values'];
  positionals: string[];
}

/** Reads the arguments of a command; turns the errors of `parseArgs` into `UsageError`s. */
export function parseCommandArgs<const O extends ParseArgsOptionsConfig>(
  args: readonly string[],
  options: O,
): Parsed<O> {
  try {
    const result = parseArgs({
      args: [...args],
      options: { help: { type: 'boolean', short: 'h' }, ...options },
      allowPositionals: true,
      allowNegative: true,
      strict: true,
    });
    return { values: result.values as Parsed<O>['values'], positionals: result.positionals };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Node's messages end with a hint about "--" that does not apply here.
    throw new UsageError(message.replace(/\. To specify a positional argument.*$/s, '.'));
  }
}

/** The one positional argument that is required, else a usage error. */
export function requireOne(positionals: readonly string[], what: string): string {
  const [first, ...rest] = positionals;
  if (first === undefined) throw new UsageError(`Missing ${what}.`);
  if (rest.length > 0) throw new UsageError(`Unexpected argument "${rest[0] ?? ''}".`);
  return first;
}

/** A number option; throws a usage error for anything that is not a finite number. */
export function numberOption(
  value: string | undefined,
  name: string,
  check: (n: number) => boolean = () => true,
  expected = 'a number',
): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (value.trim() === '' || !Number.isFinite(n) || !check(n)) {
    throw new UsageError(`--${name} must be ${expected} (got "${value}").`);
  }
  return n;
}

/** An option with a fixed set of values. */
export function choiceOption<T extends string>(
  value: string | undefined,
  name: string,
  choices: readonly T[],
): T | undefined {
  if (value === undefined) return undefined;
  const found = choices.find((choice) => choice === value);
  if (found === undefined) {
    throw new UsageError(`--${name} must be one of ${choices.join(', ')} (got "${value}").`);
  }
  return found;
}
