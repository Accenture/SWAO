// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3385: request of the assessment LLM preflight check, built like the provider
// builds it. Kept free of Ink so it is unit-testable.

import type { LocalConnectorInfo } from './types.js';

/** Remove trailing '/' characters without a regular expression (CodeQL js/polynomial-redos). */
function stripTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47) end--;
  return s.slice(0, end);
}

export const PING_PROMPT = 'SWAO connectivity check. Reply with the single word: OK';

export interface PreflightRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  model: string;
}

/**
 * #3385: the preflight request, built like the provider builds it: the run's
 * model (not the connector default) and `{base_url}/v1/chat/completions` for
 * OpenAI-compatible connectors (a base_url already ending in /v1 is kept).
 */
export function buildPreflightRequest(connector: LocalConnectorInfo, apiKey: string): PreflightRequest {
  const model = connector.model || connector.defaultModel;
  const base = stripTrailingSlashes(connector.baseUrl);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (connector.protocol === 'anthropic-messages') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    return { url: `${base}/v1/messages`, headers, body: { model, max_tokens: 16, messages: [{ role: 'user', content: PING_PROMPT }] }, model };
  }
  if (connector.protocol === 'ollama') {
    return { url: `${base}/api/chat`, headers, body: { model, messages: [{ role: 'user', content: PING_PROMPT }], stream: false }, model };
  }
  // openai-chat and bedrock (OpenAI-compatible path)
  headers['Authorization'] = `Bearer ${apiKey}`;
  const url = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
  return { url, headers, body: { model, max_tokens: 16, messages: [{ role: 'user', content: PING_PROMPT }] }, model };
}

