export type ErrorType =
  | 'overloaded'
  | 'server_error'
  | 'rate_limit'
  | 'request_too_large'
  | 'not_found'
  | 'permission'
  | 'authentication'
  | 'invalid_request'
  | 'timeout'
  | 'billing'
  | 'context_length_exceeded';

const ERROR_MESSAGES: { [K in ErrorType]: string } = {
  overloaded: 'The API is temporarily overloaded. Try again in a moment.',
  server_error: 'An unexpected error has occurred. Try again in a moment.',
  rate_limit:
    'Your account has hit a rate limit. Slow down or try again shortly.',
  request_too_large:
    'Request exceeds the maximum allowed size (32 MB for standard API endpoints).',
  not_found: 'The requested resource was not found.',
  permission:
    'Your API key does not have permission to use the specified resource.',
  authentication:
    "There's an issue with your API key. Check your provider API key in the environment.",
  invalid_request:
    'There was an issue with the format or content of your request.',
  timeout: 'The request timed out. Try again.',
  billing:
    'Billing issue with your account. Check your provider billing settings.',
  context_length_exceeded:
    'Request exceeds the maximum context length. Try a shorter conversation.',
};

export function getMessageForErrorType(errorType: ErrorType): string {
  return ERROR_MESSAGES[errorType];
}

/** Resolve a user-facing message for an ErrorType. Use this from callers that have an ErrorType. */
export function getErrorMessage(errorType: ErrorType): string {
  return ERROR_MESSAGES[errorType];
}
