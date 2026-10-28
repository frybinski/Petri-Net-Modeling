/** What went wrong when talking to the provider. */
export type LlmErrorKind =
  /** The server could not be reached (offline, DNS, CORS, refused). */
  | 'network'
  /** HTTP 401 or 403: the key is missing, wrong or not allowed. */
  | 'auth'
  /** HTTP 429: too many requests or quota used up. */
  | 'rate-limit'
  /** No answer within the time limit. */
  | 'timeout'
  /** The server answered, but not with a usable chat completion (HTTP errors, wrong shape). */
  | 'bad-response'
  /** The answer is not JSON. */
  | 'parse'
  /** The caller cancelled the request. */
  | 'aborted';

export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  /** HTTP status, if the server answered. */
  readonly status: number | undefined;

  constructor(kind: LlmErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'LlmError';
    this.kind = kind;
    this.status = status;
  }
}

export function isLlmError(value: unknown): value is LlmError {
  return value instanceof LlmError;
}

/** The message of any thrown value. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
