/** Machine readable error codes of the HTTP interface. */
export type ErrorCode =
  | 'bad_request'
  | 'misdirected'
  | 'invalid_json'
  | 'unsupported_media_type'
  | 'unauthorized'
  | 'forbidden'
  | 'cross_origin'
  | 'not_found'
  | 'method_not_allowed'
  | 'conflict'
  | 'precondition_required'
  | 'payload_too_large'
  | 'net_format'
  | 'net_invalid'
  | 'unprocessable'
  | 'resource_limit'
  | 'too_many_requests'
  | 'busy'
  | 'internal'
  | 'bad_gateway'
  | 'unavailable'
  | 'timeout';

/**
 * An error that is answered with a status and `{ error: { code, message, details? } }`. Everything
 * else that is thrown becomes a 500 without its text, which may hold paths or credentials.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: unknown;
  /** Extra response headers, for example `Retry-After`. */
  readonly headers: Readonly<Record<string, string>>;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    options: { details?: unknown; headers?: Record<string, string> } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = options.details;
    this.headers = options.headers ?? {};
  }
}

export interface ErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}

export function errorBody(error: ApiError): ErrorBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details !== undefined && { details: error.details }),
    },
  };
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * What may be written to the log about an unexpected error: its kind, the code of the system error
 * behind it (`ECONNREFUSED`, `UNABLE_TO_VERIFY_LEAF_SIGNATURE`) and, for errors of the system (a
 * file, a socket), its message, which holds a path. The message of any other error may quote the
 * text that caused it (a net, a prompt), and the log must not hold content.
 */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return 'non-error value thrown';
  const code = (error as NodeJS.ErrnoException).code;
  if (typeof code === 'string' && /^E[A-Z0-9]+$/.test(code)) {
    return `${error.name} ${code}: ${error.message.slice(0, 200)}`;
  }
  const cause = (error as { cause?: unknown }).cause;
  const causeCode = cause instanceof Error ? (cause as NodeJS.ErrnoException).code : undefined;
  const parts = [error.name];
  if (typeof code === 'string') parts.push(code);
  if (typeof causeCode === 'string') parts.push(`(${causeCode})`);
  return parts.join(' ');
}
