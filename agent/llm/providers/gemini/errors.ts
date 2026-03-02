import type { ErrorType } from '../../utilities/errors';
import { getMessageForErrorType } from '../../utilities/errors';

export function getErrorType(err: unknown): ErrorType | null {
  if (err != null && typeof err === 'object') {
    const status =
      (err as { status?: number }).status ??
      (err as { statusCode?: number }).statusCode ??
      (err as { code?: number }).code;
    if (typeof status === 'number') {
      if (status === 429) return 'rate_limit';
      if (status === 503) return 'overloaded';
      if (status === 401) return 'authentication';
      if (status === 403) return 'permission';
      if (status === 404) return 'not_found';
      if (status === 408 || status === 504) return 'timeout';
      if (status >= 500) return 'server_error';
      if (status >= 400) return 'invalid_request';
    }
    const message = String(
      (err as { message?: string }).message ??
        (err as { statusMessage?: string }).statusMessage ??
        ''
    );
    if (message.includes('context') && message.toLowerCase().includes('length'))
      return 'context_length_exceeded';
    if (message.includes('quota') || message.includes('rate limit'))
      return 'rate_limit';
    if (err instanceof Error && err.name === 'AbortError') return 'timeout';
  }
  return null;
}

function getErrorMessage(err: unknown): string {
  const errorType = getErrorType(err);
  if (errorType) return getMessageForErrorType(errorType);
  return err instanceof Error ? err.message : String(err);
}
