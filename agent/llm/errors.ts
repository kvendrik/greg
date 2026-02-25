/**
 * Maps Claude API error types to user-friendly messages.
 * Canonical list: https://docs.anthropic.com/en/api/errors (HTTP errors section).
 * Error shape: { type: "error", error: { type: "<error_type>", message: "..." } }.
 */

export function getErrorMessageForType(errorType: string): string {
  return CLAUDE_ERROR_MESSAGES[errorType] ?? '';
}

export function getErrorMessage(err: unknown): string {
  const body = err as { error?: { type?: string; error?: { type?: string } } };
  if (body && typeof body === 'object' && body.error && typeof body.error === 'object') {
    const innerType = body.error.error?.type ?? body.error.type;
    if (typeof innerType === 'string') {
      const friendly = getErrorMessageForType(innerType);
      if (friendly) return friendly;
    }
  }
  return err instanceof Error ? err.message : String(err);
}

/** Doc-listed types (529/500/429/413/404/403/401/400) plus SDK/API extras. */
const CLAUDE_ERROR_MESSAGES: Record<string, string> = {
  overloaded_error:
    'The API is temporarily overloaded. Try again in a moment.',
  api_error:
    'An unexpected error has occurred internal to Anthropic’s systems. Try again in a moment.',
  rate_limit_error:
    'Your account has hit a rate limit. Slow down or try again shortly.',
  request_too_large:
    'Request exceeds the maximum allowed size (32 MB for standard API endpoints).',
  not_found_error:
    'The requested resource was not found.',
  permission_error:
    'Your API key does not have permission to use the specified resource.',
  authentication_error:
    'There’s an issue with your API key. Check ANTHROPIC_API_KEY.',
  invalid_request_error:
    'There was an issue with the format or content of your request.',
  timeout_error:
    'The request timed out. Try again.',
  billing_error:
    'Billing issue with your account. Check your Anthropic billing settings.',
};
