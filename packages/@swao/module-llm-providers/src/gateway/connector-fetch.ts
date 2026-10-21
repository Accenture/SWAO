// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3381 / #3385: connectivity checks outside the provider (setup wizard) must
// reach the gateway the same way the provider does: undici fetch with the
// connector-scoped dispatcher (tls.reject_unauthorized, HTTPS_PROXY, NO_PROXY).
// The global fetch cannot take that dispatcher across undici versions.

import { fetch as undiciFetch } from 'undici';
import { buildFetchDispatcher } from '../open-llm-provider.js';

/** Remove trailing '/' characters without a regular expression (CodeQL js/polynomial-redos). */
function stripTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47) end--;
  return s.slice(0, end);
}

export interface ConnectorFetchResult {
  ok: boolean;
  status: number;
  /** Response body; read only for non-2xx responses (first 2000 characters). */
  text: string;
}

/** POST a JSON body to a connector endpoint with the connector's TLS and proxy rules. */
export async function connectorPostJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  opts: { rejectUnauthorized?: boolean; signal?: AbortSignal } = {},
): Promise<ConnectorFetchResult> {
  const dispatcher = buildFetchDispatcher({ rejectUnauthorized: opts.rejectUnauthorized, targetUrl: url });
  const init: Record<string, unknown> = { method: 'POST', headers, body: JSON.stringify(body) };
  if (opts.signal) init['signal'] = opts.signal;
  if (dispatcher) init['dispatcher'] = dispatcher;
  const resp = await undiciFetch(url, init as Parameters<typeof undiciFetch>[1]);
  const text = resp.ok ? '' : (await resp.text().catch(() => '')).slice(0, 2000);
  return { ok: resp.ok, status: resp.status, text };
}

/** `{base_url}/v1/chat/completions`, keeping a base_url that already ends in /v1. */
export function openAiChatCompletionsUrl(baseUrl: string): string {
  const base = stripTrailingSlashes(baseUrl);
  return base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}
