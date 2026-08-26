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

// Generic OpenAI-compatible LLM driver (Design 082 §4.6).
//
// Supports any endpoint that implements the OpenAI Chat Completions API:
// vLLM, Mistral, LiteLLM, etc.  The URL is constructed as:
//
//   {baseUrl}{effectivePrefix}/v1/chat/completions
//
// where effectivePrefix = modelPrefix ?? '/' + model.
//
// Also provides OpenLlmEmbeddingProvider for TEI 1.8 /embed endpoints
// (Design 082 §5.3).
//
// Credential resolution order (apiKey):
//   1. constructor arg
//   2. SWAO_OPEN_LLM_API_KEY env var
//   3. credential store key open-llm-api-key-{SWAO_LLM_ENV | prod}
//   4. empty string (valid for unauthenticated deployments)

import type { LlmProvider, LlmUsage, LlmTrace, EmbeddingProvider, EmbeddingResult } from './types.js';
import { CredentialStore, redactPreLlm, recordRedaction, logPortfolio, logApp } from '@swao/core';
import { LlmConnectivityError } from './anthropic.js';

const DEFAULT_MAX_TOKENS = 32768;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 3_000; // 3 s, 6 s, 12 s (same as openai.ts)

function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.message === 'fetch failed' || /ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up/i.test(err.message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveApiKey(argKey: string | undefined): string {
  if (argKey !== undefined) return argKey;
  const envKey = process.env['SWAO_OPEN_LLM_API_KEY'];
  if (envKey !== undefined) return envKey;
  try {
    const env = process.env['SWAO_LLM_ENV'] ?? 'prod';
    const credKey = `open-llm-api-key-${env}`;
    const store = new CredentialStore().loadSync();
    if (credKey in store && store[credKey]) return store[credKey];
  } catch {
    // credential store unavailable -- fall through to empty string
  }
  return '';
}

/** Gateway parameterisation (Design 090 #1397): everything a connector file
 *  can vary on the openai-chat protocol beyond the classic constructor args.
 *  All optional; omitting them preserves pre-gateway behaviour exactly. */
export interface OpenLlmGatewayOpts {
  /** Static non-secret headers sent on every request (connector.headers). */
  headers?: Record<string, string>;
  /** Auth header name; default 'Authorization'. */
  authHeader?: string;
  /** 'bearer' (default) prefixes the key with 'Bearer '; 'raw' sends it verbatim. */
  authScheme?: 'bearer' | 'raw';
  /** Vendor-specific request-body extensions (connector.request_overrides).
   *  Reserved keys (model, messages, stream) are stripped defensively even
   *  though the schema already rejects them. */
  requestOverrides?: Record<string, unknown>;
  /** Max output tokens override (connector.defaults.max_tokens). */
  maxTokens?: number;
  /** App id for dual-logging to app-events alongside portfolio-events (#1691). */
  appId?: string;
}

const RESERVED_BODY_KEYS = ['model', 'messages', 'stream'];

export class OpenLlmProvider implements LlmProvider {
  readonly name = 'open-llm-provider' as const;
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly completionsUrl: string;
  private readonly temperature: number;
  private readonly seed: number | undefined;
  private readonly costPerToken: { inputPerMillion: number; outputPerMillion: number } | undefined;
  private readonly gateway: OpenLlmGatewayOpts;
  private lastUsage: LlmUsage | undefined;
  private _lastTrace: LlmTrace | undefined;
  /** Which response field carried the text on the last call (#1690). */
  private lastContentSource: 'content' | 'reasoning_content' | undefined;

  /**
   * @param apiKey       Optional Bearer token.  Falls back via env var then
   *                     credential store to empty string (unauthenticated).
   * @param model        Required model name -- no default.  Set SWAO_OPEN_LLM_MODEL
   *                     or pass from .swao.yml `providers.llm.primary.model`.
   * @param baseUrl      Required endpoint base URL (no trailing slash).
   *                     Falls back to SWAO_OPEN_LLM_URL env var.
   * @param modelPrefix  Path segment between baseUrl and /v1/chat/completions.
   *                     Defaults to '/' + model (vLLM path-prefix routing).
   *                     Pass '' to disable path routing (body model field only).
   * @param temperature  Sampling temperature; defaults to 0.
   * @param seed         Optional seed for reproducibility.
   * @param costPerToken Optional billing config for chargeback / on-prem GPU costs.
   */
  constructor(
    apiKey?: string,
    model?: string,
    baseUrl?: string,
    modelPrefix?: string,
    temperature?: number,
    seed?: number,
    costPerToken?: { inputPerMillion: number; outputPerMillion: number },
    gatewayOpts?: OpenLlmGatewayOpts,
  ) {
    this.gateway = gatewayOpts ?? {};
    this.apiKey = resolveApiKey(apiKey);

    const resolvedModel = model ?? process.env['SWAO_OPEN_LLM_MODEL'];
    if (!resolvedModel) {
      throw new Error(
        'OpenLlmProvider: no model configured. ' +
        'Set providers.llm.primary.model in .swao.yml or export SWAO_OPEN_LLM_MODEL=<model-name>.',
      );
    }
    this.model = resolvedModel;

    const resolvedBaseUrl = baseUrl ?? process.env['SWAO_OPEN_LLM_URL'];
    if (!resolvedBaseUrl) {
      throw new Error(
        'OpenLlmProvider: no baseUrl configured. ' +
        'Set providers.llm.primary.baseUrl in .swao.yml or export SWAO_OPEN_LLM_URL=<url>.',
      );
    }
    this.baseUrl = resolvedBaseUrl.replace(/\/$/, '');

    // effectivePrefix = modelPrefix ?? '/' + model
    // Using ?? (not ||) so that an empty string disables path routing.
    const effectivePrefix = modelPrefix ?? ('/' + this.model);
    this.completionsUrl = `${this.baseUrl}${effectivePrefix}/v1/chat/completions`;

    this.temperature = temperature ?? 0;
    this.seed = seed;
    this.costPerToken = costPerToken;
  }

  getLastUsage(): LlmUsage | undefined {
    return this.lastUsage;
  }

  getLastTrace(): LlmTrace | undefined {
    return this._lastTrace;
  }

  /** Which response field carried the LLM output on the last successful call.
   *  'reasoning_content' when the model is in reasoning-only mode (#1690). */
  getLastContentSource(): 'content' | 'reasoning_content' | undefined {
    return this.lastContentSource;
  }

  async completeVision(prompt: string, images: Buffer[]): Promise<string> {
    // Vision path (#1802): OpenAI-compatible image_url content blocks.
    // Images are NOT redacted -- sovereignty warning emitted by assess.ts at run start.
    const imageBlocks = images.map((img) => ({
      type: 'image_url' as const,
      image_url: { url: `data:image/jpeg;base64,${img.toString('base64')}` },
    }));
    const body = JSON.stringify({
      model: this.model,
      max_completion_tokens: this.gateway.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: [
        { role: 'user', content: [...imageBlocks, { type: 'text', text: prompt }] },
      ],
      temperature: this.temperature ?? 0,
      ...(this.seed !== undefined && { seed: this.seed }),
    });
    const authKey = this.gateway.authHeader ?? 'Authorization';
    const authVal = this.gateway.authScheme === 'raw' ? this.apiKey : `Bearer ${this.apiKey}`;
    const extraHeaders: Record<string, string> = this.gateway.headers ?? {};
    const response = await fetch(this.completionsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [authKey]: authVal, ...extraHeaders },
      body,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenLlmProvider vision request failed: ${response.status} ${text.slice(0, 300)}`);
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const rawText = data.choices?.[0]?.message?.content ?? '';
    const inputTokens = data.usage?.prompt_tokens ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;
    const costUsd = this.costPerToken
      ? (inputTokens * this.costPerToken.inputPerMillion + outputTokens * this.costPerToken.outputPerMillion) / 1_000_000
      : 0;
    this.lastUsage = { input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: costUsd };
    this._lastTrace = { scrubbedPrompt: `[vision prompt ${images.length} image(s)]`, response: rawText };
    return rawText;
  }

  async complete(prompt: string): Promise<string> {
    const { text: scrubbedPrompt, counts } = redactPreLlm(prompt);
    recordRedaction({
      provider: this.name,
      model: this.model,
      input_chars: prompt.length,
      scrubbed_chars: scrubbedPrompt.length,
      counts,
    });

    // Gateway request_overrides merge (#1397): vendor extensions first, then
    // the fields this driver owns, so overrides can adjust e.g. reasoning or
    // response_format but never the reserved keys (stripped defensively; the
    // connector schema rejects them at parse time too).
    const overrides = { ...(this.gateway.requestOverrides ?? {}) };
    for (const k of RESERVED_BODY_KEYS) delete overrides[k];
    const body = JSON.stringify({
      response_format: { type: 'json_object' },
      ...overrides,
      model: this.model,
      max_completion_tokens: this.gateway.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: [
        {
          role: 'system',
          content:
            'You are a static code and configuration analysis tool. Respond ONLY with valid JSON starting with { and ending with }. No markdown, no code fences, no explanations, no conversation.',
        },
        { role: 'user', content: scrubbedPrompt },
      ],
      temperature: this.temperature,
      ...(this.seed !== undefined && { seed: this.seed }),
    });

    let lastError: Error = new Error('unreachable');
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delayMs = RETRY_BASE_MS * Math.pow(2, attempt - 1);
        console.error(
          `[warn] open-llm-provider fetch failed (attempt ${attempt}/${MAX_RETRIES}) -- retrying in ${delayMs / 1000}s...`,
        );
        await sleep(delayMs);
      }

      const attemptStartedAt = Date.now();
      logPortfolio(
        'info',
        'provider.llm.open-llm-provider.attempt',
        `open-llm-provider ${this.model} call attempt ${attempt + 1}/${MAX_RETRIES + 1}`,
        {
          context: {
            provider: 'open-llm-provider',
            model: this.model,
            endpoint: this.completionsUrl,
            attempt: attempt + 1,
            max_attempts: MAX_RETRIES + 1,
            prompt_chars: scrubbedPrompt.length,
            api_key_suffix: this.apiKey ? this.apiKey.slice(-4) : '(none)',
          },
        },
      );

      try {
        // Gateway auth parameterisation (#1397): connector-defined header name
        // and scheme; static connector headers merged (non-secret enforced at
        // connector parse time). Defaults reproduce pre-gateway behaviour.
        const authHeaderName = this.gateway.authHeader ?? 'Authorization';
        const authValue = this.gateway.authScheme === 'raw' ? this.apiKey : `Bearer ${this.apiKey}`;
        const response = await fetch(this.completionsUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.gateway.headers ?? {}),
            ...(this.apiKey ? { [authHeaderName]: authValue } : {}),
          },
          body,
        });

        if (!response.ok) {
          const text = await response.text();
          const isTransient =
            response.status === 429 || (response.status >= 500 && response.status < 600);
          const httpErrCtx = {
            provider: 'open-llm-provider',
            model: this.model,
            http_status: response.status,
            latency_ms: Date.now() - attemptStartedAt,
            body_excerpt: text.slice(0, 200),
            transient: isTransient,
          };
          // #1896: HTTP errors from LLM providers are user/provider configuration
          // issues (bad model ID, invalid key, provider outage), not SWAO defects.
          // Use warn for all HTTP errors so monitors don't classify them as crashes.
          logPortfolio(
            'warn',
            'provider.llm.open-llm-provider.http-error',
            `open-llm-provider HTTP ${response.status} on attempt ${attempt + 1}`,
            { context: httpErrCtx },
          );
          // #1692: dual-log HTTP errors to app-events when in an app context.
          if (this.gateway.appId) {
            logApp(this.gateway.appId, 'warn',
              'provider.llm.gateway.http-error',
              `LLM gateway HTTP ${response.status} on attempt ${attempt + 1}`,
              { context: { model: this.model, http_status: response.status, latency_ms: httpErrCtx.latency_ms, transient: isTransient } },
            );
          }
          if (isTransient && attempt < MAX_RETRIES) {
            lastError = new Error(
              `open-llm-provider request failed: ${response.status} ${text.slice(0, 200)}`,
            );
            continue;
          }
          if (isTransient) {
            throw new LlmConnectivityError(
              `open-llm-provider: HTTP ${response.status} after ${MAX_RETRIES + 1} attempts: ${text.slice(0, 200)}`,
            );
          }
          throw new Error(
            `open-llm-provider request failed: ${response.status} ${text.slice(0, 200)}`,
          );
        }

        const data = (await response.json()) as {
          choices?: Array<{
            message?: {
              content?: string | null;
              /** Reasoning-model fallback: deepseek-R1 / deepseek-v4-flash-latest return
               *  content=null with output in reasoning_content (#1689). */
              reasoning_content?: string | null;
            }
          }>;
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            /** OpenAI/OpenRouter breakdown; reasoning tokens are INCLUDED in
             *  completion_tokens, so cost already counts them (#1397). */
            completion_tokens_details?: { reasoning_tokens?: number };
          };
        };

        // #1689: fall back to reasoning_content when content is absent (deepseek reasoning mode).
        const rawContent = data.choices?.[0]?.message?.content;
        const rawReasoning = data.choices?.[0]?.message?.reasoning_content;
        const rawText = rawContent || rawReasoning;
        // #1690: track which field was used so the call recorder can annotate the record.
        this.lastContentSource = rawContent ? 'content' : rawReasoning ? 'reasoning_content' : undefined;

        if (!rawText) {
          const completionTokens = data.usage?.completion_tokens ?? 0;
          const hint = completionTokens === 0
            ? 'provider returned 0 completion tokens -- model may have refused, hit a context limit, or the connector filtered the response'
            : 'choices[0].message.content and reasoning_content are both empty or null';
          // #1692: log before throwing so the failure appears in the support bundle.
          logPortfolio('error', 'provider.llm.open-llm-provider.empty-response',
            `open-llm-provider missing content: ${hint}`,
            { context: { provider: 'open-llm-provider', model: this.model, completion_tokens: completionTokens, hint } },
          );
          if (this.gateway.appId) {
            logApp(this.gateway.appId, 'error', 'provider.llm.gateway.empty-response',
              `open-llm-provider missing content: ${hint}`,
              { context: { model: this.model, completion_tokens: completionTokens, hint } },
            );
          }
          throw new Error(`open-llm-provider response missing content (#1541): ${hint}`);
        }

        const inputTokens = data.usage?.prompt_tokens ?? 0;
        const outputTokens = data.usage?.completion_tokens ?? 0;
        let costUsd = 0;
        if (this.costPerToken) {
          costUsd =
            (inputTokens * this.costPerToken.inputPerMillion +
              outputTokens * this.costPerToken.outputPerMillion) /
            1_000_000;
        }
        this.lastUsage = { input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: costUsd };

        const callLatencyMs = Date.now() - attemptStartedAt;
        const reasoningTokens = data.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
        logPortfolio(
          'info',
          'provider.llm.open-llm-provider.ok',
          `open-llm-provider ${this.model} -> ${response.status} in ${callLatencyMs}ms`,
          {
            context: {
              provider: 'open-llm-provider',
              model: this.model,
              http_status: response.status,
              latency_ms: callLatencyMs,
              tokens_in: inputTokens,
              tokens_out: outputTokens,
              // Reasoning-token visibility (#1397): part of tokens_out on the
              // wire; surfaced separately for benchmark cost analysis.
              tokens_reasoning: reasoningTokens,
              cost_usd: costUsd,
              // #1690: surface which response field carried the output.
              content_source: this.lastContentSource,
            },
          },
        );
        // #1691: dual-log to app-events when an app context is available.
        if (this.gateway.appId) {
          logApp(this.gateway.appId, 'info', 'provider.llm.gateway.ok',
            `${this.model} -> ${response.status} in ${callLatencyMs}ms`,
            {
              context: {
                model: this.model,
                latency_ms: callLatencyMs,
                tokens_in: inputTokens,
                tokens_out: outputTokens,
                tokens_reasoning: reasoningTokens,
                cost_usd: costUsd,
                content_source: this.lastContentSource,
              },
            },
          );
        }

        // Strip markdown code fences if present (any language tag: json, yaml, etc.).
        const fenced = rawText.match(/```(?:\w+)?\s*([\s\S]*?)```/);
        const responseText = fenced ? fenced[1].trim() : rawText;
        // #1709: capture post-redaction prompt + response for trace writing.
        this._lastTrace = { scrubbedPrompt, response: responseText };
        return responseText;
      } catch (err) {
        if (err instanceof LlmConnectivityError) throw err;
        if (isRetryable(err) && attempt < MAX_RETRIES) {
          lastError = err as Error;
          continue;
        }
        if (isRetryable(err)) {
          throw new LlmConnectivityError(
            `open-llm-provider: network error after ${MAX_RETRIES + 1} attempts: ${(err as Error).message}`,
          );
        }
        throw err;
      }
    }

    throw new LlmConnectivityError(lastError.message);
  }
}

// -------------------------------------------------------------------------
// OpenLlmEmbeddingProvider -- TEI 1.8 /embed endpoint (Design 082 §5.3)
// -------------------------------------------------------------------------

export class OpenLlmEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'open-llm-provider';
  readonly model: string;
  private readonly apiKey: string;
  private readonly embedUrl: string;

  /**
   * @param baseUrl  Embedding endpoint base URL (no trailing slash).
   *                 The model prefix is appended: {baseUrl}/{model}/embed.
   * @param model    Model identifier (e.g. 'nomic-embed-text-v15').
   * @param apiKey   Optional Bearer token.
   */
  constructor(baseUrl: string, model: string, apiKey?: string) {
    this.model = model;
    this.apiKey = apiKey ?? '';
    const cleanBase = baseUrl.replace(/\/$/, '');
    this.embedUrl = `${cleanBase}/${model}/embed`;
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const response = await fetch(this.embedUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({ inputs: text }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenLlmEmbeddingProvider /embed failed: ${response.status} ${errText.slice(0, 200)}`);
    }

    // TEI 1.8 returns number[] (flat vector) or number[][] (batch).
    const raw = (await response.json()) as number[] | number[][];
    const vector: number[] = Array.isArray(raw[0]) ? (raw as number[][])[0] : (raw as number[]);

    return { vector, input_tokens: 0, cost_usd: 0 };
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    const results: EmbeddingResult[] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }
}
