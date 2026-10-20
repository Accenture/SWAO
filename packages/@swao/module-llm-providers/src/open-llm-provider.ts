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

import type { LlmProvider, LlmUsage, LlmTrace, LlmCompletion, LlmToolChatParams, EmbeddingProvider, EmbeddingResult } from './types.js';
import { CredentialStore, logPortfolio, logApp } from '@swao/core';
import { scrubForEgress } from './egress-redaction.js';
import { ConnectivityFailureError } from './errors.js';
import { fetch as undiciFetch, Agent, ProxyAgent } from 'undici';
import {
  requestLlmWithRetry,
  LlmConnectivityError,
  LlmHttpStatusError,
  LLM_MAX_ATTEMPTS,
  type AttemptWatchdog,
  type LlmCallKind,
} from './llm-request.js';
import { llmLimiterKey, getLlmConcurrencyLimit } from './concurrency.js';

// #3284: every call (text, vision, tools) runs through the shared request
// helper (llm-request.ts): one retry policy (6 attempts), idle watchdog,
// concurrency limiter and the provider.llm.open-llm-provider.* event set.
// The wire format (non-streaming OpenAI chat/completions) is unchanged.

const DEFAULT_MAX_TOKENS = 32768;

/** #2584: strip known PII fields from provider error bodies before any sink
 *  (event body_excerpt, thrown messages). OpenRouter error JSON can carry a
 *  user_id that identifies the account. */
function sanitiseErrorBody(text: string): string {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    delete parsed['user_id'];
    delete parsed['user'];
    delete parsed['email'];
    return JSON.stringify(parsed);
  } catch {
    return text; // not JSON -- use raw text as-is
  }
}

type ChatCompletion = {
  choices?: Array<{
    message?: {
      content?: string | null;
      /** Reasoning-model fallback: deepseek-R1 / deepseek-v4-flash-latest return
       *  content=null with output in reasoning_content (#1689). */
      reasoning_content?: string | null;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    /** OpenAI/OpenRouter breakdown; reasoning tokens are INCLUDED in
     *  completion_tokens, so cost already counts them (#1397). */
    completion_tokens_details?: { reasoning_tokens?: number };
  };
};

/**
 * #2944: honour NO_PROXY / no_proxy env var so internal endpoints (e.g. an
 * enterprise GenAI hub on 10.x.x.x) bypass the corporate proxy while external endpoints still route
 * through it.  Matches exact hostname, .suffix, and *.suffix patterns; does NOT
 * match IP-range CIDR notation (not needed for current deployments).
 */
function resolveEffectiveProxy(targetBaseUrl: string | undefined): string | undefined {
  const proxyUrl = process.env['HTTPS_PROXY'] ?? process.env['HTTP_PROXY'];
  if (!proxyUrl || !targetBaseUrl) return proxyUrl;
  const noProxy = process.env['NO_PROXY'] ?? process.env['no_proxy'] ?? '';
  if (!noProxy) return proxyUrl;
  let targetHost: string;
  try {
    targetHost = new URL(targetBaseUrl.replace(/\/$/, '')).hostname.toLowerCase();
  } catch {
    return proxyUrl;
  }
  const bypassed = noProxy.split(',').some(raw => {
    const p = raw.trim().toLowerCase();
    if (!p) return false;
    const suffix = p.startsWith('*.') ? p.slice(1) : p.startsWith('.') ? p : `.${p}`;
    return targetHost === p || targetHost.endsWith(suffix);
  });
  return bypassed ? undefined : proxyUrl;
}

/**
 * #2894 Part B: build a scoped undici Agent or ProxyAgent for TLS bypass.
 * Exported so packages that can't directly import undici (pnpm strict isolation)
 * can obtain a correctly typed dispatcher without a direct undici dep.
 *
 * Returns `undefined` when no override is needed, or a scoped Agent/ProxyAgent
 * that disables cert validation for that one connector's fetch calls only --
 * does NOT affect any other outbound request in the process.
 * #2944: pass targetUrl to respect NO_PROXY for internal endpoints.
 */
export function buildFetchDispatcher(opts: { rejectUnauthorized?: boolean; targetUrl?: string }): unknown {
  const proxyUrl = resolveEffectiveProxy(opts.targetUrl);
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
  /** Concurrency limiter key (#3284): provider + endpoint origin, so every
   *  model behind one gateway shares the gateway's slot pool. */
  readonly concurrencyKey: string;
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
    const tlsRejectUnauthorized = gatewayOpts?.rejectUnauthorized;
    // #2894 Part B: build a scoped undici dispatcher that combines proxy and TLS options.
    // Also honour NODE_TLS_REJECT_UNAUTHORIZED=0 for proxy tunnels: undici's ProxyAgent
    // uses its own TLS stack and does NOT read that env var unless we pass it explicitly.
    // This matters for corporate MITM proxies whose CA is not in Node.js's default bundle.
    // #2944: resolve proxy honouring NO_PROXY so internal endpoints bypass the corporate proxy.
    const proxyUrl = resolveEffectiveProxy(baseUrl ?? process.env['SWAO_OPEN_LLM_URL']);
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
    // '/Llama-3.3-70B...' (common in enterprise GenAI hub catalogues) does not
    // produce a double slash in the path (#2892).
    const modelSegment = '/' + this.model.replace(/^\/+/, '');
    // effectivePrefix = modelPrefix ?? modelSegment
    // Using ?? (not ||) so that an empty string disables path routing.
    const effectivePrefix = modelPrefix ?? modelSegment;
    this.completionsUrl = `${this.baseUrl}${effectivePrefix}/v1/chat/completions`;
    this.concurrencyKey = llmLimiterKey(this.name, this.completionsUrl);

    this.temperature = temperature ?? 0;
    this.seed = seed;
    this.costPerToken = costPerToken;
    logPortfolio('info', 'provider.open-llm.init', 'OpenLlmProvider initialised', {
      context: { model: this.model, hasProxy: Boolean(proxyUrl), tlsSkip },
    });
  }

  /** In-flight limit of this provider's endpoint (#3284, D-14). */
  get maxConcurrency(): number {
    return getLlmConcurrencyLimit(this.concurrencyKey);
  }

  /** @deprecated #3301: shared state; read `usage` from the `*Detailed()` result. */
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

  private costOf(inputTokens: number, outputTokens: number): number {
    return this.costPerToken
      ? (inputTokens * this.costPerToken.inputPerMillion + outputTokens * this.costPerToken.outputPerMillion) / 1_000_000
      : 0;
  }

  /**
   * One chat/completions call through the shared request helper (#3284).
   * `failPrefix` keeps each entry point's historical error message shape.
   * HTTP 401 triggers the one-shot token refresh (#2743) when configured,
   * otherwise a typed ConnectivityFailureError (#2899).
   */
  private async chat(opts: {
    kind: LlmCallKind;
    body: () => string;
    promptChars: number;
    imageCount?: number;
    failPrefix: string;
    attemptContext?: Record<string, unknown>;
  }): Promise<{ data: ChatCompletion; status: number }> {
    let tokenRefreshed = false;
    const authHeaderName = this.gateway.authHeader ?? 'Authorization';
    return requestLlmWithRetry<{ data: ChatCompletion; status: number }>({
      provider: 'open-llm-provider',
      label: 'open-llm-provider',
      model: this.model,
      kind: opts.kind,
      endpoint: this.completionsUrl,
      limiterKey: this.concurrencyKey,
      streaming: false,
      promptChars: opts.promptChars,
      imageCount: opts.imageCount,
      appId: this.gateway.appId,
      // #1896: HTTP errors from LLM providers are configuration or provider
      // issues, not SWAO defects; warn so monitors do not report crashes.
      httpErrorLevel: 'warn',
      attemptContext: {
        api_key_suffix: this.apiKey ? this.apiKey.slice(-4) : '(none)',
        ...(opts.attemptContext ?? {}),
      },
      exhaustedError: (lastError, attempts) => this.exhausted(lastError, attempts),
      run: async (wd: AttemptWatchdog) => {
        // Gateway auth parameterisation (#1397): connector-defined header name
        // and scheme; static connector headers merged (non-secret enforced at
        // connector parse time). Defaults reproduce pre-gateway behaviour.
        const authValue = this.gateway.authScheme === 'raw' ? this.apiKey : `Bearer ${this.apiKey}`;
        // #2944: undici's own fetch so the dispatcher (Agent/ProxyAgent) is
        // always recognised -- globalThis.fetch in Node.js 20+ uses a different
        // undici instance than the npm package and would ignore it silently.
        const response = await wd.race(undiciFetch(this.completionsUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.gateway.headers ?? {}),
            ...(this.apiKey ? { [authHeaderName]: authValue } : {}),
          },
          body: opts.body(),
          signal: wd.signal,
          ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
        }));
        wd.setPhase('body');
        wd.touch(0);

        if (!response.ok) {
          if (response.status === 401) {
            // #2743: one-shot token refresh, re-sent at once without consuming
            // an attempt. The refreshed token is never logged.
            if (this.gateway.tokenRefresh && !tokenRefreshed) {
              const fresh = this.gateway.tokenRefresh();
              if (fresh) {
                this.apiKey = fresh;
                tokenRefreshed = true;
                throw new LlmHttpStatusError(`${opts.failPrefix} 401 (token refreshed)`, 401, {
                  retryNow: true, context: { token_refreshed: true },
                });
              }
            }
            // #2899: 401 means the token is wrong or expired -- not transient.
            throw new LlmHttpStatusError(`${opts.failPrefix} 401`, 401, {
              throwAs: new ConnectivityFailureError(
                'auth',
                `HTTP 401 from ${this.completionsUrl} -- ADFS/API token may be expired or invalid. ` +
                `Re-authenticate (swao setup or update SWAO_ADFS_TOKEN) and retry.`,
              ),
            });
          }
          const sanitizedText = sanitiseErrorBody(await wd.race(response.text()));
          throw new LlmHttpStatusError(`${opts.failPrefix} ${response.status} ${sanitizedText.slice(0, 200)}`, response.status, {
            bodyExcerpt: sanitizedText.slice(0, 200),
          });
        }

        const data = (await wd.race(response.json())) as ChatCompletion;
        const inputTokens = data.usage?.prompt_tokens ?? 0;
        const outputTokens = data.usage?.completion_tokens ?? 0;
        return {
          value: { data, status: response.status },
          status: response.status,
          okContext: {
            tokens_in: inputTokens,
            tokens_out: outputTokens,
            // Reasoning-token visibility (#1397): part of tokens_out on the
            // wire; surfaced separately for benchmark cost analysis.
            tokens_reasoning: data.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
            cost_usd: this.costOf(inputTokens, outputTokens),
            // #1690: which response field carried the output.
            content_source: data.choices?.[0]?.message?.content
              ? 'content'
              : data.choices?.[0]?.message?.reasoning_content ? 'reasoning_content' : undefined,
          },
        };
      },
    });
  }

  /** LlmConnectivityError after every attempt failed. #2944: the cause code
   *  stays in the message so gateway-probe classifyPingFailure can match TLS /
   *  protocol error codes (EPROTO, ERR_TLS_*, ...). */
  private exhausted(lastError: Error, attempts: number = LLM_MAX_ATTEMPTS): Error {
    if (lastError instanceof LlmHttpStatusError) {
      return new LlmConnectivityError(
        `open-llm-provider: HTTP ${lastError.status} after ${attempts} attempts: ${lastError.bodyExcerpt}`,
      );
    }
    const e = lastError as Error & { cause?: Error & { code?: string } };
    if (process.env['SWAO_DEBUG_GATEWAY']) {
      const causeDetail = e.cause ? ` cause.code=${e.cause.code ?? '?'} cause.msg=${e.cause.message}` : '';
      console.error(`[debug] open-llm-provider final: ${e.message}${causeDetail} | url=${this.completionsUrl} | dispatcher=${this.dispatcher?.constructor?.name ?? 'none'}`);
    }
    const causeCode = e.cause?.code;
    const causeMsg = causeCode ? `: ${causeCode} (${e.cause!.message})` : '';
    return new LlmConnectivityError(
      `open-llm-provider: network error after ${attempts} attempts: ${e.message}${causeMsg}`,
    );
  }

  /** Usage of one response (#3301); also kept as the deprecated last usage. */
  private recordUsage(data: ChatCompletion): LlmUsage {
    const inputTokens = data.usage?.prompt_tokens ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;
    const usage: LlmUsage = { input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: this.costOf(inputTokens, outputTokens) };
    this.lastUsage = usage;
    return usage;
  }

  async completeVision(prompt: string, images: Buffer[]): Promise<string> {
    return (await this.completeVisionDetailed(prompt, images)).text;
  }

  /** completeVision() with the call's own usage and trace (#3301). */
  async completeVisionDetailed(prompt: string, images: Buffer[]): Promise<LlmCompletion> {
    // Vision path (#1802): OpenAI-compatible image_url content blocks.
    // Images are NOT redacted -- sovereignty warning emitted by assess.ts at run start.
    // The text prompt IS redacted (#3157 / CLAUDE.md §5.7).
    const scrubbedPrompt = scrubForEgress(prompt, this.name, this.model);
    const imageBlocks = images.map((img) => ({
      type: 'image_url' as const,
      image_url: { url: `data:image/jpeg;base64,${img.toString('base64')}` },
    }));
    const body = JSON.stringify({
      model: this.model,
      max_completion_tokens: this.gateway.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: [
        { role: 'user', content: [...imageBlocks, { type: 'text', text: scrubbedPrompt }] },
      ],
      temperature: this.temperature ?? 0,
      ...(this.seed !== undefined && { seed: this.seed }),
    });
    const { data } = await this.chat({
      kind: 'vision',
      body: () => body,
      promptChars: scrubbedPrompt.length,
      imageCount: images.length,
      failPrefix: 'OpenLlmProvider vision request failed:',
    });
    const usage = this.recordUsage(data);
    const rawText = data.choices?.[0]?.message?.content ?? '';
    const trace: LlmTrace = { scrubbedPrompt: `[vision prompt ${images.length} image(s)]`, response: rawText };
    this._lastTrace = trace;
    return { text: rawText, usage, trace };
  }

  // #2952: OpenAI-compatible tool-calling loop (Design 082 SS6.2).
  // Converts SWAO/Anthropic input_schema to OpenAI function.parameters format,
  // loops up to maxIterations executing tool calls via onToolCall, returns
  // final text response. #3284: each iteration's request runs through the
  // shared request helper (retries, watchdog, limiter, events with kind 'tools').
  async completeWithTools(params: LlmToolChatParams): Promise<string> {
    return (await this.completeWithToolsDetailed(params)).text;
  }

  /** completeWithTools() with the usage summed over every iteration (#3301). */
  async completeWithToolsDetailed(params: LlmToolChatParams): Promise<LlmCompletion> {
    const { system, messages, tools, onToolCall, maxIterations = 10 } = params;

    const openAiTools = tools.map(t => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }));

    // Egress redaction (#3157 / CLAUDE.md §5.7): system prompt (workspace
    // context), every history message and every tool result are scrubbed
    // before they are placed into a request body.
    const chatMessages: Array<Record<string, unknown>> = [
      { role: 'system', content: scrubForEgress(system, this.name, this.model) },
      ...messages.map(m => ({ role: m.role, content: scrubForEgress(m.content, this.name, this.model) })),
    ];

    let inTotal = 0;
    let outTotal = 0;
    let usage: LlmUsage | undefined;
    for (let i = 0; i < maxIterations; i++) {
      const body = JSON.stringify({
        model: this.model,
        messages: chatMessages,
        tools: openAiTools,
        tool_choice: 'auto',
        max_completion_tokens: this.gateway.maxTokens ?? DEFAULT_MAX_TOKENS,
      });
      const { data: json } = await this.chat({
        kind: 'tools',
        body: () => body,
        promptChars: body.length,
        failPrefix: 'completeWithTools: HTTP',
        attemptContext: { iteration: i + 1, max_iterations: maxIterations, tool_count: tools.length },
      });
      inTotal += json.usage?.prompt_tokens ?? 0;
      outTotal += json.usage?.completion_tokens ?? 0;
      usage = { input_tokens: inTotal, output_tokens: outTotal, cost_usd: this.costOf(inTotal, outTotal) };
      this.lastUsage = usage;

      const choice = json.choices?.[0];
      if (!choice?.message) return { text: '', usage };
      const { message } = choice;

      const assistantEntry: Record<string, unknown> = { role: 'assistant', content: message.content ?? '' };
      if (message.tool_calls && message.tool_calls.length > 0) assistantEntry['tool_calls'] = message.tool_calls;
      chatMessages.push(assistantEntry);

      if (!message.tool_calls || message.tool_calls.length === 0) {
        const trace: LlmTrace = { scrubbedPrompt: `[tool-call chat, ${i + 1} iterations]`, response: message.content ?? '' };
        this._lastTrace = trace;
        return { text: message.content ?? '', usage, trace };
      }

      // No limiter slot is held while the tools run.
      const toolResults = await Promise.all(
        message.tool_calls.map(async tc => {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(tc.function.arguments) as Record<string, unknown>; } catch { /* noop */ }
          // #3312: a failing tool (timeout, MCP error) is reported to the
          // model like the Anthropic path instead of failing the whole turn.
          let result: string;
          try {
            result = await onToolCall(tc.function.name, args);
          } catch (e) {
            result = `[Tool error: ${String(e instanceof Error ? e.message : e)}]`;
          }
          return { tool_call_id: tc.id, role: 'tool' as const, content: scrubForEgress(result, this.name, this.model) };
        }),
      );
      chatMessages.push(...toolResults);
    }

    return { text: '[tool-calling loop exceeded max iterations]', usage };
  }

  async complete(prompt: string): Promise<string> {
    return (await this.completeDetailed(prompt)).text;
  }

  /** complete() with the call's own usage and trace (#3301). */
  async completeDetailed(prompt: string): Promise<LlmCompletion> {
    const scrubbedPrompt = scrubForEgress(prompt, this.name, this.model);

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

    const { data } = await this.chat({
      kind: 'text',
      body: () => body,
      promptChars: scrubbedPrompt.length,
      failPrefix: 'open-llm-provider request failed:',
    });

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
      // #2488: warn, not error -- the throw below propagates to the caller.
      const ctx = { provider: 'open-llm-provider', model: this.model, completion_tokens: completionTokens, hint };
      logPortfolio('warn', 'provider.llm.open-llm-provider.empty-response',
        `open-llm-provider missing content: ${hint}`, { context: ctx });
      if (this.gateway.appId) {
        logApp(this.gateway.appId, 'warn', 'provider.llm.open-llm-provider.empty-response',
          `open-llm-provider missing content: ${hint}`, { context: ctx });
      }
      throw new Error(`open-llm-provider response missing content (#1541): ${hint}`);
    }

    const usage = this.recordUsage(data);

    // Strip markdown code fences if present (any language tag: json, yaml, etc.).
    const fenced = rawText.match(/```(?:\w+)?\s*([\s\S]*?)```/);
    const responseText = fenced ? fenced[1].trim() : rawText;
    // #1709: capture post-redaction prompt + response for trace writing.
    const trace: LlmTrace = { scrubbedPrompt, response: responseText };
    this._lastTrace = trace;
    return { text: responseText, usage, trace };
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
    // #2944: honour NO_PROXY and use undici fetch so dispatcher is recognised.
    const proxyUrl = resolveEffectiveProxy(this.embedUrl);
    const proxyAgent = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
    const response = await undiciFetch(
      this.embedUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        // #3157: embedding input is egress to a model endpoint; redact it too.
        body: JSON.stringify({ inputs: scrubForEgress(text, this.name, this.model) }),
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
