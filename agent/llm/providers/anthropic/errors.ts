import type { ErrorType } from '../../utilities/errors';
import { getMessageForErrorType } from '../../utilities/errors';

/**
 * Maps Claude API error types to internal ErrorType.
 * Canonical list: https://docs.anthropic.com/en/api/errors (HTTP errors section).
 * Error shape: { type: "error", error: { type: "<error_type>", message: "..." } }.
 */
const PROVIDER_ERROR_TYPES: { [providerErrorType: string]: ErrorType } = {
  overloaded_error: 'overloaded',
  api_error: 'server_error',
  rate_limit_error: 'rate_limit',
  request_too_large: 'request_too_large',
  not_found_error: 'not_found',
  permission_error: 'permission',
  authentication_error: 'authentication',
  invalid_request_error: 'invalid_request',
  timeout_error: 'timeout',
  billing_error: 'billing',
};

export function getErrorMessageForType(providerErrorType: string): string {
  const internalType = PROVIDER_ERROR_TYPES[providerErrorType];
  if (!internalType) return '';
  return getMessageForErrorType(internalType);
}

/** Extract ErrorType from a raw provider error, or null if unknown. */
export function getErrorType(err: unknown): ErrorType | null {
  const body = err as { error?: { type?: string; error?: { type?: string } } };
  if (body && typeof body === 'object' && body.error && typeof body.error === 'object') {
    const innerType = body.error.error?.type ?? body.error.type;
    if (typeof innerType === 'string') {
      const internalType = PROVIDER_ERROR_TYPES[innerType];
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
