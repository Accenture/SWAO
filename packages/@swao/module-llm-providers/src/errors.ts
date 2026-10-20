// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module -- shared error types
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// v1.0

/** Thrown when an LLM provider or gateway probe encounters a fatal,
 *  non-retryable connectivity failure so the assessment leg can abort
 *  gracefully instead of recording a malformed WSP finding (#2899).
 *
 *  reason:
 *    'auth'    -- HTTP 401; token expired or invalid
 *    'tls'     -- TLS certificate / handshake failure
 *    'timeout' -- no response within the probe deadline
 */
export class ConnectivityFailureError extends Error {
  readonly reason: 'auth' | 'tls' | 'timeout';
  readonly hint: string;

  constructor(reason: 'auth' | 'tls' | 'timeout', hint: string) {
    super(`Connectivity failure (${reason}): ${hint}`);
    this.name = 'ConnectivityFailureError';
    this.reason = reason;
    this.hint = hint;
  }
}

/** Thrown by a tool-calling chat (completeWithTools / completeWithToolsDetailed)
 *  when the model does not support tool calling (#3311). Detection is from the
 *  API error, not a capability probe:
 *    - ollama:  HTTP 400 whose body says the model "does not support tools";
 *    - bedrock: ValidationException saying the model does not support tool use.
 *  The provider remembers the result, so later calls throw at once without a
 *  round-trip. SWAO Chat catches it and answers without MCP tools. */
export class LlmToolsUnsupportedError extends Error {
  readonly provider: string;
  readonly model: string;

  constructor(provider: string, model: string) {
    super(`Model ${model} (${provider}) does not support tool calling`);
    this.name = 'LlmToolsUnsupportedError';
    this.provider = provider;
    this.model = model;
  }
}
