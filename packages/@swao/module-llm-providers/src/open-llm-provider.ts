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
// v1.0

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
import { ConnectivityFailureError } from './errors.js';
import { Agent, ProxyAgent } from 'undici';

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

/**
 * #2894 Part B: build a scoped undici Agent or ProxyAgent for TLS bypass.
 * Exported so packages that can't directly import undici (pnpm strict isolation)
 * can obtain a correctly typed dispatcher without a direct undici dep.
 *
 * Returns `undefined` when no override is needed, or a scoped Agent/ProxyAgent
 * that disables cert validation for that one connector's fetch calls only --
 * does NOT affect any other outbound request in the process.
 */
export function buildFetchDispatcher(opts: { rejectUnauthorized?: boolean }): unknown {
  const proxyUrl = process.env['HTTPS_PROXY'] ?? process.env['HTTP_PROXY'];
  const tlsSkip = opts.rejectUnauthorized === false || process.env['NODE_TLS_REJECT_UNAUTHORIZED'] === '0';
  if (tlsSkip) {
    if (proxyUrl) {
      return new ProxyAgent({ uri: proxyUrl, connect: { rejectUnauthorized: false } });
    }
    return new Agent({ connect: { rejectUnauthorized: false } });
  }
  if (proxyUrl) {
    return new ProxyAgent(proxyUrl);
  }
  return undefined;
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
  /** #2894 Part B: when false, TLS cert validation is disabled for this connector
   *  via a scoped undici Agent -- does NOT affect other outbound requests in the process. */
  rejectUnauthorized?: boolean;
  /** #2743: called on HTTP 401 to fetch a fresh ADFS/SSO token; return value replaces
   *  the current apiKey and the request is retried once. When undefined, 401 throws
   *  immediately as before. The returned token must NOT be logged by this function. */
  tokenRefresh?: () => string | undefined;
}

const RESERVED_BODY_KEYS = ['model', 'messages', 'stream'];

export class OpenLlmProvider implements LlmProvider {
  readonly name = 'open-llm-provider' as const;
  readonly model: string;
  private apiKey: string;
  private readonly baseUrl: string;
  private readonly completionsUrl: string;
  private readonly temperature: number;
  private readonly seed: number | undefined;
  private readonly costPerToken: { inputPerMillion: number; outputPerMillion: number } | undefined;
  private readonly gateway: OpenLlmGatewayOpts;
  // #2894: scoped dispatcher (ProxyAgent, Agent with rejectUnauthorized:false, or both combined).
  private readonly dispatcher: ProxyAgent | Agent | undefined;
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
    const proxyUrl = process.env['HTTPS_PROXY'] ?? process.env['HTTP_PROXY'];
    const tlsRejectUnauthorized = gatewayOpts?.rejectUnauthorized;
    // #2894 Part B: build a scoped undici dispatcher that combines proxy and TLS options.
    // Also honour NODE_TLS_REJECT_UNAUTHORIZED=0 for proxy tunnels: undici's ProxyAgent
    // uses its own TLS stack and does NOT read that env var unless we pass it explicitly.
    // This matters for corporate MITM proxies whose CA is not in Node.js's default bundle.
    const tlsSkip = tlsRejectUnauthorized === false || process.env['NODE_TLS_REJECT_UNAUTHORIZED'] === '0';
    if (proxyUrl && tlsSkip) {
      this.dispatcher = new ProxyAgent({ uri: proxyUrl, connect: { rejectUnauthorized: false } });
    } else if (proxyUrl) {
      this.dispatcher = new ProxyAgent(proxyUrl);
    } else if (tlsSkip) {
      this.dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
    } else {
      this.dispatcher = undefined;
    }
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
    // Strip trailing slash and any trailing /v1 so the constructed completionsUrl
    // never produces a double /v1 when the caller already includes it (#2892).
    this.baseUrl = resolvedBaseUrl.replace(/\/$/, '').replace(/\/v1$/, '');

    // Normalise model segment: strip any leading slashes so a model id such as
    // '/Llama-3.3-70B...' (common in PREME PREPROD catalogue entries) does not
    // produce a double slash in the path (#2892).
    const modelSegment = '/' + this.model.replace(/^\/+/, '');
    // effectivePrefix = modelPrefix ?? modelSegment
    // Using ?? (not ||) so that an empty string disables path routing.
    const effectivePrefix = modelPrefix ?? modelSegment;
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
    const response = await (fetch as (url: string, init?: RequestInit & { dispatcher?: unknown }) => Promise<Response>)(
      this.completionsUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [authKey]: authVal, ...extraHeaders },
        body,
        ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
      },
    );
    if (!response.ok) {
      if (response.status === 401) {
        throw new ConnectivityFailureError(
          'auth',
          `HTTP 401 from ${this.completionsUrl} -- ADFS/API token may be expired or invalid.`,
        );
      }
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
    // #2743: one token refresh is allowed per send() call; tracked here so we
    // do not loop endlessly if the refreshed token is also rejected.
    let tokenRefreshed = false;
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
        const response = await (fetch as (url: string, init?: RequestInit & { dispatcher?: unknown }) => Promise<Response>)(
          this.completionsUrl,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(this.gateway.headers ?? {}),
              ...(this.apiKey ? { [authHeaderName]: authValue } : {}),
            },
            body,
            ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
          },
        );

        if (!response.ok) {
          // #2899: 401 means the token is wrong or expired -- not a transient error.
          // Abort immediately with a typed error so the leg can surface a clear hint
          // rather than recording a malformed WSP finding.
          if (response.status === 401) {
            // #2743: try a one-shot token refresh before giving up.
            // Reset attempt to -1 so the loop increments to 0 (no backoff delay
            // between the 401 and the immediate refresh retry).
            if (this.gateway.tokenRefresh && !tokenRefreshed) {
              const fresh = this.gateway.tokenRefresh();
              if (fresh) {
                this.apiKey = fresh;
                tokenRefreshed = true;
                attempt = -1;
                continue;
              }
            }
            throw new ConnectivityFailureError(
              'auth',
              `HTTP 401 from ${this.completionsUrl} -- ADFS/API token may be expired or invalid. ` +
              `Re-authenticate (swao setup or update SWAO_ADFS_TOKEN) and retry.`,
            );
          }
          const text = await response.text();
          // #2584: strip known PII fields from LLM provider error bodies before
          // logging. OpenRouter error JSON can contain a user_id field that
          // identifies the account. Sanitise the raw text once so every downstream
          // sink (body_excerpt, thrown Error messages) is clean.
          let sanitizedText = text;
          try {
            const parsed = JSON.parse(text) as Record<string, unknown>;
            delete parsed['user_id'];
            delete parsed['user'];
            delete parsed['email'];
            sanitizedText = JSON.stringify(parsed);
          } catch { /* not JSON -- use raw text as-is */ }
          const isTransient =
            response.status === 429 || (response.status >= 500 && response.status < 600);
          const httpErrCtx = {
            provider: 'open-llm-provider',
            model: this.model,
            http_status: response.status,
            latency_ms: Date.now() - attemptStartedAt,
            body_excerpt: sanitizedText.slice(0, 200),
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
              `open-llm-provider request failed: ${response.status} ${sanitizedText.slice(0, 200)}`,
            );
            continue;
          }
          if (isTransient) {
            throw new LlmConnectivityError(
              `open-llm-provider: HTTP ${response.status} after ${MAX_RETRIES + 1} attempts: ${sanitizedText.slice(0, 200)}`,
            );
          }
          throw new Error(
            `open-llm-provider request failed: ${response.status} ${sanitizedText.slice(0, 200)}`,
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
          // #2488: downgraded from error to warn -- the throw below propagates to
          // the caller which handles it; error-level triggered false-positive alerts.
          logPortfolio('warn', 'provider.llm.open-llm-provider.empty-response',
            `open-llm-provider missing content: ${hint}`,
            { context: { provider: 'open-llm-provider', model: this.model, completion_tokens: completionTokens, hint } },
          );
          if (this.gateway.appId) {
            logApp(this.gateway.appId, 'warn', 'provider.llm.gateway.empty-response',
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
        if (err instanceof ConnectivityFailureError) throw err;
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
    const proxyUrl = process.env['HTTPS_PROXY'] ?? process.env['HTTP_PROXY'];
    const proxyAgent = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
    const response = await (fetch as (url: string, init?: RequestInit & { dispatcher?: unknown }) => Promise<Response>)(
      this.embedUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({ inputs: text }),
        ...(proxyAgent ? { dispatcher: proxyAgent } : {}),
      },
    );

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
