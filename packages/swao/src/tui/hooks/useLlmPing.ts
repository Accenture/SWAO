// useLlmPing -- shared LLM connectivity ping hook (#2375, sprint-130).
// Extracted from SetupWizard.tsx runTest() which contained the same fetch-based
// ping logic duplicated across CredentialsStep and LlmAssessmentScreen (#2388).
//
// Split into two layers so the pure fetch-request builder is unit-testable
// without React:
//   buildPingRequest -- pure function: target -> { url, method, headers, body }
//   useLlmPing       -- React hook: manages running/ok/fail state + cleanup

import { useState, useEffect, useRef } from 'react';

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
        const resp = await fetch(req.url, {
          method: req.method,
          headers: req.headers,
          body: req.body,
          signal: controller.signal,
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
        update({
          status: 'fail',
          message: isAbort ? `no response after ${timeoutMs / 1000}s` : (err as Error).message.slice(0, 80),
          permanent: false,
        });
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
