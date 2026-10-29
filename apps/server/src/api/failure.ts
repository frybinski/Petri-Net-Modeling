import { NetFormatError } from '@pnm/core';
import { CommandError, UsageError } from '@pnm/cli/lib';
import { PnmlError } from '@pnm/io';
import { ApiError, messageOf, type ErrorCode } from '../errors';

/** An error as it crosses from a job thread to the main thread: plain data. */
export interface Failure {
  status: number;
  code: ErrorCode;
  message: string;
  details?: unknown;
  /** What happened, for the log only; never sent to a client. */
  internal?: string;
}

/**
 * The failure that an error of a job stands for: wrong options are 400, a net or a log that cannot
 * be used is 422, anything unexpected is 500 and its text stays in the log.
 */
export function failureOf(error: unknown): Failure {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      ...(error.details !== undefined && { details: error.details }),
    };
  }
  if (error instanceof UsageError) {
    return { status: 400, code: 'bad_request', message: error.message };
  }
  if (error instanceof NetFormatError) {
    return {
      status: 422,
      code: 'net_format',
      message: error.message,
      details: { issues: error.issues },
    };
  }
  if (error instanceof PnmlError) {
    return { status: 422, code: 'net_format', message: error.message };
  }
  if (error instanceof CommandError) {
    return { status: 422, code: 'unprocessable', message: error.message };
  }
  return {
    status: 500,
    code: 'internal',
    message: 'The job failed unexpectedly.',
    internal: messageOf(error).slice(0, 500),
  };
}

export function apiErrorOf(failure: Failure): ApiError {
  return new ApiError(failure.status, failure.code, failure.message, {
    ...(failure.details !== undefined && { details: failure.details }),
  });
}
