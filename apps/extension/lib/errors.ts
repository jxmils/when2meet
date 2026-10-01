export type AppErrorCode =
  | 'reconnect'
  | 'consent'
  | 'not-configured'
  | 'cancelled'
  | 'needs-scope'
  | 'invalid'
  | 'failed';

/** An error with a code the UI can act on; survives the trip through extension messaging. */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly detail: Record<string, string> | undefined;

  constructor(code: AppErrorCode, message: string, detail?: Record<string, string>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.detail = detail;
  }
}

export interface SerializedError {
  message: string;
  code: AppErrorCode;
  detail?: Record<string, string>;
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof AppError) {
    return {
      message: error.message,
      code: error.code,
      ...(error.detail ? { detail: error.detail } : {}),
    };
  }
  return { message: error instanceof Error ? error.message : String(error), code: 'failed' };
}

export function reviveError(error: SerializedError): AppError {
  return new AppError(error.code, error.message, error.detail);
}
