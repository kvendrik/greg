import type { ErrorType } from '../../utilities/errors';
import { getMessageForErrorType } from '../../utilities/errors';

/**
 * Maps OpenAI API error types to internal ErrorType.
 */
const PROVIDER_ERROR_TYPES: { [providerErrorType: string]: ErrorType } = {
  overloaded: 'overloaded',
  server_error: 'server_error',
  rate_limit_exceeded: 'rate_limit',
  context_length_exceeded: 'context_length_exceeded',
  invalid_request_error: 'invalid_request',
  authentication_error: 'authentication',
  timeout: 'timeout',
};

export function getErrorMessageForType(providerErrorType: string): string {
  const internalType = PROVIDER_ERROR_TYPES[providerErrorType];
  if (!internalType) return '';
  return getMessageForErrorType(internalType);
}

/** Extract ErrorType from a raw provider error, or null if unknown. */
export function getErrorType(err: unknown): ErrorType | null {
  const body = err as { error?: { type?: string; code?: string } };
  if (body && typeof body === 'object' && body.error && typeof body.error === 'object') {
    const type = body.error.type ?? body.error.code;
    if (typeof type === 'string') {
      const internalType = PROVIDER_ERROR_TYPES[type];
      if (internalType) return internalType;
    }
  }
  return null;
}

export function getErrorMessage(err: unknown): string {
  const errorType = getErrorType(err);
  if (errorType) return getMessageForErrorType(errorType);
  return err instanceof Error ? err.message : String(err);
}
