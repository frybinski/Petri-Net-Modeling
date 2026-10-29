/** Structured logs: one JSON object per line. Never holds network content, prompts or secrets. */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogFields = Record<string, string | number | boolean | null | undefined | string[]>;

export interface Logger {
  log(level: LogLevel, msg: string, fields?: LogFields): void;
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

export interface LoggerOptions {
  /** Where a line goes; default standard output. */
  write?: (line: string) => void;
  /** Lines below this level are dropped; default `info`. */
  level?: LogLevel;
  now?: () => Date;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const threshold = ORDER[options.level ?? 'info'];
  const now = options.now ?? (() => new Date());
  const log = (level: LogLevel, msg: string, fields: LogFields = {}): void => {
    if (ORDER[level] < threshold) return;
    const entry: Record<string, unknown> = { time: now().toISOString(), level, msg };
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) entry[key] = value;
    }
    write(JSON.stringify(entry));
  };
  return {
    log,
    debug: (msg, fields) => {
      log('debug', msg, fields);
    },
    info: (msg, fields) => {
      log('info', msg, fields);
    },
    warn: (msg, fields) => {
      log('warn', msg, fields);
    },
    error: (msg, fields) => {
      log('error', msg, fields);
    },
  };
}

/** A logger that drops everything (tests). */
export const silentLogger: Logger = createLogger({ write: () => undefined });
