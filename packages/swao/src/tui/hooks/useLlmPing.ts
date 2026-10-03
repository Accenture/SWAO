// useLlmPing -- shared LLM connectivity ping hook (#2375, sprint-130).
// Extracted from SetupWizard.tsx runTest() which contained the same fetch-based
// ping logic duplicated across CredentialsStep and LlmAssessmentScreen (#2388).
//
// Split into two layers so the pure fetch-request builder is unit-testable
// without React:
//   buildPingRequest -- pure function: target -> { url, method, headers, body }
//   useLlmPing       -- React hook: manages running/ok/fail state + cleanup

import { useState, useEffect, useRef } from 'react';
import { buildFetchDispatcher } from '@swao/module-llm-providers';

export type LlmPingStatus = 'idle' | 'running' | 'ok' | 'fail';

export interface LlmPingResult {
  status: LlmPingStatus;
  /** Human-readable status message; empty when idle or running. */
  message: string;
  /** True when the failure is permanent (4xx non-rate-limit); no retry will help. */
  permanent: boolean;
}

// Minimal gateway connector shape required for URL/header construction.
export interface PingGatewayConnector {
  protocol: string;
  base_url: string;
  models: { default: string };
  credential_key?: string;
  /** #2894 Part B: when false, cert validation is disabled via a scoped undici Agent. */
  rejectUnauthorized?: boolean;
}

export type LlmPingTarget =
  | { kind: 'anthropic'; apiKey: string; model?: string }
  | { kind: 'openai';    apiKey: string; model?: string }
  | { kind: 'gateway';  connector: PingGatewayConnector; apiKey: string };

export interface PingRequest {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: string;
}

const PING_PROMPT = 'SWAO connectivity check. Reply with the single word: OK';

/** Build the fetch request parameters for a given ping target. Pure function. */
export function buildPingRequest(target: LlmPingTarget): PingRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (target.kind === 'anthropic') {
    const model = target.model ?? 'claude-haiku-4-5-20251001';
    headers['x-api-key'] = target.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    return {
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      headers,
      body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: 'user', content: PING_PROMPT }] }),
    };
  }

  if (target.kind === 'openai') {
    const model = target.model ?? 'gpt-4o-mini';
    headers['Authorization'] = `Bearer ${target.apiKey}`;
    return {
      url: 'https://api.openai.com/v1/chat/completions',
      method: 'POST',
      headers,
      body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: 'user', content: PING_PROMPT }] }),
    };
  }

  // Gateway: protocol-specific URL and auth
  const { connector, apiKey } = target;
  const base = connector.base_url.replace(/\/$/, '');
  const model = connector.models.default;

  if (connector.protocol === 'anthropic-messages') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    return {
      url: `${base}/v1/messages`,
      method: 'POST',
      headers,
      body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: 'user', content: PING_PROMPT }] }),
    };
  }

  if (connector.protocol === 'ollama') {
    // Ollama: no auth header required
    return {
      url: `${base}/api/chat`,
      method: 'POST',
      headers,
      body: JSON.stringify({ model, messages: [{ role: 'user', content: PING_PROMPT }], stream: false }),
    };
  }

  // Default (openai-compatible gateway): Bearer auth
  headers['Authorization'] = `Bearer ${apiKey}`;
  return {
    url: `${base}/v1/chat/completions`,
    method: 'POST',
    headers,
    body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: 'user', content: PING_PROMPT }] }),
  };
}

/** Classify whether a ping failure is permanent (no retry will help). */
export function isPermanentFailure(httpStatus: number): boolean {
  // 4xx excluding 429 (rate-limit) are permanent: wrong key, model removed, forbidden.
  return httpStatus >= 400 && httpStatus < 500 && httpStatus !== 429;
}

const TLS_ERROR_CODES = new Set([
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_GET_CRL',
  'CERT_HAS_EXPIRED',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_INVALID_PROTOCOL_VERSION',
  'ERR_SSL_WRONG_VERSION_NUMBER',
]);

/** #2894 Part A: detect TLS certificate errors thrown by Node.js during TLS handshake.
 *  fetch() wraps these as a TypeError with the TLS error in err.cause -- check both. */
export function isTlsError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: string }).code
    ?? ((err as { cause?: { code?: string } }).cause?.code);
  return TLS_ERROR_CODES.has(code ?? '');
}

export interface UseLlmPingOptions {
  /** Null/undefined disables the hook and keeps status 'idle'. */
  target: LlmPingTarget | null | undefined;
  /** Timeout in ms. Defaults to 15_000. */
  timeoutMs?: number;
  /** Called on every status transition. */
  onChange?: (result: LlmPingResult) => void;
}

const IDLE: LlmPingResult = { status: 'idle', message: '', permanent: false };

export function useLlmPing(options: UseLlmPingOptions): LlmPingResult & { trigger: () => void } {
  const [result, setResult] = useState<LlmPingResult>(IDLE);
  const timeoutMs = options.timeoutMs ?? 15_000;
  const onChangeRef = useRef(options.onChange);
  onChangeRef.current = options.onChange;
  const targetRef = useRef(options.target);
  targetRef.current = options.target;

  // triggerCount drives the effect -- increment to retry.
  const [triggerCount, setTriggerCount] = useState(0);

  // Reset to idle when target is removed.
  useEffect(() => {
    if (!options.target) setResult(IDLE);
  }, [options.target]);

  useEffect(() => {
    const target = targetRef.current;
    if (!target || triggerCount === 0) return;

    let cancelled = false;
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);

    const update = (r: LlmPingResult) => {
      if (cancelled) return;
      setResult(r);
      onChangeRef.current?.(r);
    };

    update({ status: 'running', message: '', permanent: false });

    void (async () => {
      try {
        const req = buildPingRequest(target);
        // #2894 Part B: scoped Agent when the gateway connector disables cert validation.
        const tlsAgent = (target.kind === 'gateway' && target.connector.rejectUnauthorized === false)
          ? buildFetchDispatcher({ rejectUnauthorized: false })
          : undefined;
        const resp = await (fetch as (url: string, init?: RequestInit & { dispatcher?: unknown }) => Promise<Response>)(req.url, {
          method: req.method,
          headers: req.headers,
          body: req.body,
          signal: controller.signal,
          ...(tlsAgent ? { dispatcher: tlsAgent } : {}),
        });
        clearTimeout(tid);
        if (resp.ok) {
          update({ status: 'ok', message: 'Connection verified.', permanent: false });
        } else {
          const errText = await resp.text().catch(() => '');
          update({
            status: 'fail',
            message: `HTTP ${resp.status} -- ${errText.slice(0, 80)}`,
            permanent: isPermanentFailure(resp.status),
          });
        }
      } catch (err) {
        clearTimeout(tid);
        const isAbort = (err as Error).name === 'AbortError';
        if (isTlsError(err)) {
          update({
            status: 'fail',
            // #2894 Part A: surface the TLS cause immediately with actionable guidance.
            message:
              'TLS certificate error -- endpoint is reachable but its cert is not trusted ' +
              'by Node.js. Fix: set NODE_TLS_REJECT_UNAUTHORIZED=0 before launching SWAO, ' +
              'or set tls.reject_unauthorized: false in the connector YAML.',
            permanent: false,
          });
        } else {
          update({
            status: 'fail',
            message: isAbort
              ? `no response after ${timeoutMs / 1000}s`
              : (err as Error).message.slice(0, 120),
            permanent: false,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(tid);
      controller.abort();
    };
  }, [triggerCount, timeoutMs]);

  return { ...result, trigger: () => setTriggerCount((c) => c + 1) };
}
