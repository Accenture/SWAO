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

import type { LlmProvider, LlmUsage, LlmTrace } from './types.js';
import { anthropicCostUsd } from './types.js';
import { redactPreLlm, recordRedaction, logPortfolio, logApp } from '@swao/core';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_MAX_TOKENS = 32768;
const MAX_RETRIES = 5;
const RETRY_BASE_MS = 3000; // 3 s, 6 s, 12 s, 24 s, 48 s
// #1767: streaming mode -- timeout covers the full stream duration (large-prompt
// passes like pass-12-blocks can take 250+ s on streaming). Corporate proxies
// cut idle connections at ~60 s but streaming keeps data flowing so 60 s is
// not the constraint; the 600 s cap guards against complete stalls.
const FETCH_TIMEOUT_MS = 600000;

/** Thrown when the Anthropic provider exhausts all retry attempts due to network
 *  or transient API connectivity issues. Distinct from programming errors so the
 *  pass runner can catch it and degrade gracefully instead of exiting (#0716). */
export class LlmConnectivityError extends Error {
  constructor(cause: string) {
    super(`LLM connectivity failure: all retries exhausted. Last error: ${cause}`);
    this.name = 'LlmConnectivityError';
  }
}

function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // "fetch failed" = TCP-level failure; "ECONNRESET" / "ETIMEDOUT" = transient.
  // AbortError / TimeoutError arise from AbortSignal.timeout() (#1086).
  // "terminated" = undici/Node.js closes the response body mid-stream (#2016).
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return true;
  return err.message === 'fetch failed'
    || /ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up/i.test(err.message)
    || err.message === 'terminated'
    || err.message.startsWith('Anthropic response suspiciously short')
    || err.message === 'Anthropic response missing text content block'
    || err.message.startsWith('Anthropic response has zero output tokens');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class AnthropicLlmProvider implements LlmProvider {
  readonly name = 'anthropic' as const;
  readonly model: string;
  private readonly apiKey: string;
  private readonly temperature: number;
  private readonly maxTokens: number;
  private readonly messagesUrl: string;
  private readonly appId: string | undefined;
  private lastUsage: LlmUsage | undefined;
  private _lastTrace: LlmTrace | undefined;

  /**
   * @param apiKey      Optional API key; falls back to SWAO_ANTHROPIC_API_KEY
   *                    or ANTHROPIC_API_KEY env vars.
   * @param model       Optional model name (e.g. 'claude-opus-4-7'). When omitted,
   *                    falls back to SWAO_ANTHROPIC_MODEL env var, then DEFAULT_MODEL.
   *                    Pass the value from `.swao.yml` `providers.llm.primary.model`
   *                    so the run-manifest records the model actually configured
   *                    rather than the silent haiku-4-5 default (#0217).
   * @param temperature Optional sampling temperature; defaults to 0 for deterministic output.
   *                    Note: Anthropic does not expose a seed parameter; temperature=0
   *                    reduces but does not fully eliminate variability.
   * @param maxTokens   Optional max output tokens; defaults to DEFAULT_MAX_TOKENS (8192).
   *                    Set via `providers.llm.primary.max_tokens` in .swao.yml to increase
   *                    the budget for large-corpus passes (e.g. pass 03 with 15+ files).
   */
  constructor(apiKey?: string, model?: string, temperature?: number, maxTokens?: number, baseUrl?: string, appId?: string) {
    const key = apiKey ?? process.env['SWAO_ANTHROPIC_API_KEY'] ?? process.env['ANTHROPIC_API_KEY'];
    if (!key) {
      throw new Error(
        'AnthropicLlmProvider: no API key. Set SWAO_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY env var.',
      );
    }
    this.apiKey = key;
    this.model = model ?? process.env['SWAO_ANTHROPIC_MODEL'] ?? DEFAULT_MODEL;
    this.temperature = temperature ?? 0;
    this.maxTokens = maxTokens ?? DEFAULT_MAX_TOKENS;
    // #1397: gateway connectors may point the Anthropic Messages protocol at a
    // different host (aggregators expose /v1/messages too). Default unchanged.
    this.messagesUrl = baseUrl ? `${baseUrl.replace(/\/$/, '')}/v1/messages` : ANTHROPIC_API_URL;
    this.appId = appId;
  }

  getLastUsage(): LlmUsage | undefined {
    return this.lastUsage;
  }

  getLastTrace(): LlmTrace | undefined {
    return this._lastTrace;
  }

  async completeVision(prompt: string, images: Buffer[]): Promise<string> {
    // Vision path (#1802): images are NOT redacted (screenshots cannot be text-scrubbed).
    // Sovereignty warning is emitted by assess.ts at run start when vision_analysis: true.
    const imageBlocks = images.map((img) => ({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: 'image/jpeg' as const,
        data: img.toString('base64'),
      },
    }));
    const body = JSON.stringify({
      model: this.model,
      max_tokens: this.maxTokens,
      stream: false,
      messages: [
        {
          role: 'user',
          content: [
            ...imageBlocks,
            { type: 'text', text: prompt },
          ],
        },
      ],
    });
    const response = await fetch(this.messagesUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic vision request failed: ${response.status} ${text.slice(0, 300)}`);
    }
    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const textBlock = data.content?.find((b) => b.type === 'text');
    const rawText = textBlock?.text ?? '';
    const inputTokens = data.usage?.input_tokens ?? 0;
    const outputTokens = data.usage?.output_tokens ?? 0;
    this.lastUsage = { input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: anthropicCostUsd(this.model, inputTokens, outputTokens) };
    this._lastTrace = { scrubbedPrompt: `[vision prompt ${images.length} image(s)]`, response: rawText };
    return rawText;
  }

  async complete(prompt: string): Promise<string> {
    // Pre-LLM egress redaction (#0354, sprint-038). Every prompt is
    // scrubbed before the HTTP body is constructed. See design 032 §2.
    const { text: scrubbedPrompt, counts } = redactPreLlm(prompt);
    recordRedaction({
      provider: this.name,
      model: this.model,
      input_chars: prompt.length,
      scrubbed_chars: scrubbedPrompt.length,
      counts,
    });

    // #0482: build the request body with or without the temperature field.
    // Claude 4.x models (claude-opus-4-7 and later) have deprecated
    // the temperature parameter and return HTTP 400 when it is present.
    // Omitting it is equivalent to temperature=0 for these models.
    // Non-zero values are still forwarded (operator overrides respected).
    // #1767: stream: true -- SSE keeps data flowing so corporate proxies
    // (which cut idle connections at ~60 s) do not abort large-prompt passes.
    const buildBody = (withTemperature: boolean) => JSON.stringify({
      model: this.model,
      max_tokens: this.maxTokens,
      stream: true,
      ...(withTemperature && this.temperature !== 0 ? { temperature: this.temperature } : {}),
      system:
        'You are a static code and configuration analysis tool. Respond ONLY with valid JSON starting with { and ending with }. No markdown, no code fences, no explanations, no conversation.',
      // No assistant-message prefill: Claude Opus 4.7 and later models
      // reject conversations that end with role=assistant (#0216).
      // Rely on the system prompt instructing JSON-only output instead.
      messages: [
        { role: 'user', content: scrubbedPrompt },
      ],
    });

    // temperature=0 is the API default; omit it to avoid HTTP 400 on models
    // that have deprecated the field (claude-opus-4-7+). Only include it when
    // the operator explicitly configured a non-zero value.
    let body = buildBody(this.temperature !== 0);
    let temperatureDropped = this.temperature === 0; // already omitted on first try
    let lastError: Error = new Error('unreachable');
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delayMs = RETRY_BASE_MS * Math.pow(2, attempt - 1);
        // #1088: include the actual error in the retry log so network-level
        // failures (NordVPN tunnel drop, ECONNRESET, AbortError) are visible
        // in assess.log without requiring --debug mode.
        const causeStr = (lastError.cause instanceof Error)
          ? ` (cause: ${lastError.cause.message})`
          : (lastError.cause ? ` (cause: ${String(lastError.cause)})` : '');
        const retryMsg = `Anthropic fetch failed (attempt ${attempt}/${MAX_RETRIES}, ${lastError.message}${causeStr}) -- retrying in ${delayMs / 1000}s...`;
        logPortfolio('warn', 'provider.llm.anthropic.retry', retryMsg, {
          context: { provider: 'anthropic', model: this.model, attempt, max_retries: MAX_RETRIES, delay_ms: delayMs },
        });
        await sleep(delayMs);
      }

      // #0398 (sprint-040): structured log so operators can prove the
      // Anthropic call actually went out -- mirrors openai.ts.
      const attemptStartedAt = Date.now();
      logPortfolio('info', 'provider.llm.anthropic.attempt', `Anthropic ${this.model} call attempt ${attempt + 1}/${MAX_RETRIES + 1}`, {
        context: {
          provider: 'anthropic',
          model: this.model,
          endpoint: this.messagesUrl,
          attempt: attempt + 1,
          max_attempts: MAX_RETRIES + 1,
          prompt_chars: scrubbedPrompt.length,
          api_key_suffix: this.apiKey.slice(-4),
        },
      });

      try {
        const response = await fetch(this.messagesUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body,
          // #1086: cap each attempt at 45 s so retries fire quickly on
          // connectivity failures instead of waiting for OS TCP timeout (~90 s).
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

        if (!response.ok) {
          const text = await response.text();
          // 429 / 529 = rate limit / overloaded -- retryable
          const isTransient = response.status === 429 || response.status === 529;
          // #0482: 400 + "temperature...deprecated" -- model does not accept the
          // temperature field. Rebuild body without it and retry (once only).
          const isTemperatureDeprecated = response.status === 400
            && !temperatureDropped
            && /temperature.*deprecated|deprecated.*temperature/i.test(text);
          if (!isTransient) {
            const httpErrLatency = Date.now() - attemptStartedAt;
            logPortfolio('error', 'provider.llm.anthropic.http-error',
              `Anthropic HTTP ${response.status} on attempt ${attempt + 1}`, {
              context: {
                provider: 'anthropic',
                model: this.model,
                http_status: response.status,
                latency_ms: httpErrLatency,
                body_excerpt: text.slice(0, 500),
                transient: false,
                temperature_deprecated: isTemperatureDeprecated,
              },
            });
            // #2002: dual-log HTTP errors to app-events when in an app context.
            if (this.appId) {
              logApp(this.appId, 'warn', 'provider.llm.anthropic.http-error',
                `Anthropic HTTP ${response.status} on attempt ${attempt + 1}`,
                { context: { model: this.model, http_status: response.status, latency_ms: httpErrLatency, transient: false } },
              );
            }
          }
          if (isTemperatureDeprecated) {
            body = buildBody(false);
            temperatureDropped = true;
            logPortfolio('info', 'provider.llm.anthropic.temperature-retry',
              `Model ${this.model} rejected temperature field -- retrying without it`, {
              context: { provider: 'anthropic', model: this.model },
            });
            attempt--; // don't consume a retry slot for this API-compat fix
            continue;
          }
          if (isTransient) {
            lastError = new Error(`Anthropic request failed: ${response.status} ${text.slice(0, 500)}`);
            if (attempt < MAX_RETRIES) continue;
            // Transient but all retries exhausted -- fall through to LlmConnectivityError
          } else {
            throw new Error(`Anthropic request failed: ${response.status} ${text.slice(0, 500)}`);
          }
        }

        // #1767: parse the SSE stream.
        // Anthropic SSE events: message_start (input_tokens), content_block_delta
        // (text accumulation), message_delta (output_tokens + stop_reason).
        if (!response.body) {
          throw new Error('Anthropic streaming response has no body');
        }
        const reader = response.body.getReader();
        const dec = new TextDecoder();
        let sseBuf = '';
        let rawText = '';
        let inputTokens = 0;
        let outputTokens = 0;
        let stopReason: string | undefined;
        let streamDone = false;
        while (!streamDone) {
          const { done, value } = await reader.read();
          if (done) break;
          sseBuf += dec.decode(value, { stream: true });
          const lines = sseBuf.split('\n');
          sseBuf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6).trim();
            if (payload === '[DONE]') { streamDone = true; break; }
            try {
              const ev = JSON.parse(payload) as {
                type: string;
                message?: { usage?: { input_tokens?: number } };
                delta?: { type?: string; text?: string; stop_reason?: string };
                usage?: { output_tokens?: number };
              };
              if (ev.type === 'message_start') {
                inputTokens = ev.message?.usage?.input_tokens ?? 0;
              } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
                rawText += ev.delta.text ?? '';
              } else if (ev.type === 'message_delta') {
                outputTokens = ev.usage?.output_tokens ?? 0;
                stopReason = ev.delta?.stop_reason ?? undefined;
              }
            } catch { /* ignore malformed SSE lines */ }
          }
        }

        if (!rawText) {
          throw new Error('Anthropic response missing text content block');
        }

        // Anthropic occasionally returns HTTP 200 with only a few tokens when
        // overloaded -- the response is too short to be valid JSON. Treat as
        // retryable so the retry loop handles it (sprint-096 lesson #1100-P2).
        if (outputTokens > 0 && outputTokens < 20 && scrubbedPrompt.length >= 500) {
          throw new Error(
            `Anthropic response suspiciously short (${outputTokens} tokens, stop_reason=${stopReason ?? 'unknown'}) -- likely transient overload`,
          );
        }
        // #2019: message_delta event sometimes carries output_tokens=0 (malformed SSE
        // from Anthropic under high load). Zero tokens with non-empty text means cost
        // and token counts will be wrong. Treat as retryable -- the next attempt will
        // produce a properly-instrumented response.
        if (outputTokens === 0) {
          throw new Error(
            `Anthropic response has zero output tokens despite text content (stop_reason=${stopReason ?? 'unknown'}) -- malformed SSE`,
          );
        }

        // Capture token usage and compute cost from the model price table.
        this.lastUsage = {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cost_usd: anthropicCostUsd(this.model, inputTokens, outputTokens),
        };

        // #0398: structured success log -- one line per Anthropic HTTP 200.
        const okLatencyMs = Date.now() - attemptStartedAt;
        logPortfolio('info', 'provider.llm.anthropic.ok', `Anthropic ${this.model} -> ${response.status} in ${okLatencyMs}ms`, {
          context: {
            provider: 'anthropic',
            model: this.model,
            http_status: response.status,
            latency_ms: okLatencyMs,
            tokens_in: inputTokens,
            tokens_out: outputTokens,
            cost_usd: this.lastUsage.cost_usd,
          },
        });
        // #2002: dual-log success to app-events when in an app context so the
        // UAT monitor and any app-events consumer can see Anthropic provider calls.
        if (this.appId) {
          logApp(this.appId, 'info', 'provider.llm.anthropic.ok',
            `Anthropic ${this.model} -> ${response.status} in ${okLatencyMs}ms`,
            {
              context: {
                model: this.model,
                latency_ms: okLatencyMs,
                tokens_in: inputTokens,
                tokens_out: outputTokens,
                cost_usd: this.lastUsage.cost_usd,
              },
            },
          );
        }

        // Response is full JSON (no prefill anymore -- see #0216).
        const text = rawText;

        // Strip markdown code fences (any language tag: json, yaml, etc.)
        const fenced = text.match(/```(?:\w+)?\s*([\s\S]*?)```/);
        const responseText = fenced ? fenced[1].trim() : text;
        // #1709: capture post-redaction prompt + response for trace writing.
        this._lastTrace = { scrubbedPrompt, response: responseText };
        return responseText;
      } catch (err) {
        if (!isRetryable(err)) {
          throw err;
        }
        lastError = err as Error;
        if (attempt < MAX_RETRIES) {
          continue;
        }
        // Retryable but all attempts exhausted -- fall through to LlmConnectivityError
      }
    }

    const exhaustedMsg = `All ${MAX_RETRIES} Anthropic retry attempts exhausted for model ${this.model}.`;
    logPortfolio('error', 'provider.llm.anthropic.connectivity-failure', exhaustedMsg, {
      context: { provider: 'anthropic', model: this.model, last_error: lastError.message },
    });
    throw new LlmConnectivityError(lastError.message);
  }
}
