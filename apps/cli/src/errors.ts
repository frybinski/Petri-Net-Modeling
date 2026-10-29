/** The command line was used wrongly: unknown command or option, missing argument. Exit status 2. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

/** A command could not do its job: unreadable file, invalid net, failed run. Exit status 1. */
export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandError';
  }
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
