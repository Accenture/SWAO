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

import type { LlmProvider, LlmUsage, LlmTrace, LlmCompletion, LlmToolChatParams } from './types.js';
import { anthropicCostUsd } from './types.js';
import { logPortfolio } from '@swao/core';
import { scrubForEgress } from './egress-redaction.js';
import {
  requestLlmWithRetry,
  classifyLlmHttpStatus,
  resolveLlmIdleTimeoutMs,
  LlmHttpStatusError,
  type AttemptWatchdog,
  type LlmAttemptResult,
} from './llm-request.js';
import { llmLimiterKey, getLlmConcurrencyLimit } from './concurrency.js';

// #3284: LlmConnectivityError moved to the shared request helper; re-exported
// here because index.ts and existing callers import it from this module.
export { LlmConnectivityError } from './llm-request.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_MAX_TOKENS = 32768;

/** Classify an HTTP status into a short, content-free reason for event logs (#3221).
 *  Kept for existing callers; the shared helper uses classifyLlmHttpStatus. */
export function classifyAnthropicHttpStatus(status: number): string {
  return classifyLlmHttpStatus(status);
}

/** Anthropic-specific retryable responses (on top of the shared network policy). */
function isAnthropicRetryable(err: Error): boolean {
  return err.message.startsWith('Anthropic response suspiciously short')
    || err.message === 'Anthropic response missing text content block'
    || err.message.startsWith('Anthropic response has zero output tokens');
}

const TEMPERATURE_DEPRECATED_RE = /temperature.*deprecated|deprecated.*temperature/i;

/** Which public entry point issued the streaming request. */
type StreamKind = 'text' | 'vision';

/** Text and usage of one streamed response (#3301). */
interface StreamResult {
  text: string;
  usage: LlmUsage;
}

interface StreamRequest {
  kind: StreamKind;
  buildBody: (withTemperature: boolean) => string;
  promptChars: number;
  imageCount?: number;
}

export class AnthropicLlmProvider implements LlmProvider {
  readonly name = 'anthropic' as const;
  readonly model: string;
  private readonly apiKey: string;
  private readonly temperature: number;
  private readonly maxTokens: number;
  private readonly messagesUrl: string;
  private readonly appId: string | undefined;
  private readonly idleTimeoutMs: number;
  /** Concurrency limiter key (#3284): provider + endpoint origin. */
  readonly concurrencyKey: string;
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
    this.idleTimeoutMs = resolveLlmIdleTimeoutMs();
    this.concurrencyKey = llmLimiterKey(this.name, this.messagesUrl);
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

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
    };
  }

  async completeVision(prompt: string, images: Buffer[]): Promise<string> {
    return (await this.completeVisionDetailed(prompt, images)).text;
  }

  /** completeVision() with the call's own usage and trace (#3301). */
  async completeVisionDetailed(prompt: string, images: Buffer[]): Promise<LlmCompletion> {
    // Vision path (#1802): images are NOT redacted (screenshots cannot be text-scrubbed).
    // Sovereignty warning is emitted by assess.ts at run start when vision_analysis: true.
    // The text prompt IS redacted (#3157 / CLAUDE.md §5.7).
    const scrubbedPrompt = scrubForEgress(prompt, this.name, this.model);
    const imageBlocks = images.map((img) => ({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: 'image/jpeg' as const,
        data: img.toString('base64'),
      },
    }));
    // #3221 / #3284: vision goes through the shared request helper, so it emits
    // the full event set and shares the retry policy. #3225: it streams (SSE)
    // so the idle watchdog sees ping events.
    const body = JSON.stringify({
      model: this.model,
      max_tokens: this.maxTokens,
      stream: true,
      messages: [
        {
          role: 'user',
          content: [
            ...imageBlocks,
            { type: 'text', text: scrubbedPrompt },
          ],
        },
      ],
    });
    const { text: rawText, usage } = await this.streamWithRetry({
      kind: 'vision',
      buildBody: () => body,
      promptChars: scrubbedPrompt.length,
      imageCount: images.length,
    });
    const trace: LlmTrace = { scrubbedPrompt: `[vision prompt ${images.length} image(s)]`, response: rawText };
    this._lastTrace = trace;
    return { text: rawText, usage, trace };
  }

  async complete(prompt: string): Promise<string> {
    return (await this.completeDetailed(prompt)).text;
  }

  /** complete() with the call's own usage and trace (#3301). */
  async completeDetailed(prompt: string): Promise<LlmCompletion> {
    // Pre-LLM egress redaction (#0354, sprint-038). Every prompt is
    // scrubbed before the HTTP body is constructed. See design 032 §2.
    const scrubbedPrompt = scrubForEgress(prompt, this.name, this.model);

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

    const { text, usage } = await this.streamWithRetry({
      kind: 'text',
      buildBody,
      promptChars: scrubbedPrompt.length,
    });

    // Strip markdown code fences (any language tag: json, yaml, etc.)
    const fenced = text.match(/```(?:\w+)?\s*([\s\S]*?)```/);
    const responseText = fenced ? fenced[1].trim() : text;
    // #1709: capture post-redaction prompt + response for trace writing.
    const trace: LlmTrace = { scrubbedPrompt, response: responseText };
    this._lastTrace = trace;
    return { text: responseText, usage, trace };
  }

  /**
   * Streaming Messages API call shared by complete() and completeVision(),
   * run through the shared request helper (#3221 / #3225 / #3284).
   */
  private async streamWithRetry(req: StreamRequest): Promise<StreamResult> {
    const { kind, buildBody, promptChars } = req;
    const kindLabel = kind === 'vision' ? ' vision' : '';
    // temperature=0 is the API default; omit it to avoid HTTP 400 on models
    // that have deprecated the field (claude-opus-4-7+). Only include it when
    // the operator explicitly configured a non-zero value.
    let body = buildBody(this.temperature !== 0);
    let temperatureDropped = this.temperature === 0; // already omitted on first try

    return requestLlmWithRetry<StreamResult>({
      provider: 'anthropic',
      label: 'Anthropic',
      model: this.model,
      kind,
      endpoint: this.messagesUrl,
      limiterKey: this.concurrencyKey,
      streaming: true,
      promptChars,
      imageCount: req.imageCount,
      appId: this.appId,
      idleTimeoutMs: this.idleTimeoutMs,
      attemptContext: { api_key_suffix: this.apiKey.slice(-4) },
      isRetryableError: isAnthropicRetryable,
      run: async (wd) => {
        const response = await wd.race(fetch(this.messagesUrl, {
          method: 'POST',
          headers: this.headers(),
          body,
          signal: wd.signal,
        }));
        wd.setPhase('body');
        wd.touch(0);

        if (!response.ok) {
          const text = await wd.race(response.text());
          // #0482: 400 + "temperature...deprecated" -- rebuild the body without
          // the field and re-send once without consuming an attempt.
          if (response.status === 400 && !temperatureDropped && TEMPERATURE_DEPRECATED_RE.test(text)) {
            body = buildBody(false);
            temperatureDropped = true;
            logPortfolio('info', 'provider.llm.anthropic.temperature-retry',
              `Model ${this.model} rejected temperature field -- retrying without it`, {
                context: { provider: 'anthropic', model: this.model },
              });
            throw new LlmHttpStatusError(`Anthropic${kindLabel} request failed: ${response.status} ${text.slice(0, 500)}`, response.status, {
              bodyExcerpt: text, retryNow: true, context: { temperature_deprecated: true },
            });
          }
          throw new LlmHttpStatusError(
            `Anthropic${kindLabel} request failed: ${response.status} ${text.slice(0, 500)}`,
            response.status,
            { bodyExcerpt: text },
          );
        }
        return this.readSse(response, wd, kind, promptChars);
      },
    });
  }

  /** Parse the SSE stream (#1767) and apply the text-path sanity checks. */
  private async readSse(
    response: Response,
    wd: AttemptWatchdog,
    kind: StreamKind,
    promptChars: number,
  ): Promise<LlmAttemptResult<StreamResult>> {
    // Anthropic SSE events: message_start (input_tokens), content_block_delta
    // (text accumulation), message_delta (output_tokens + stop_reason).
    if (!response.body) {
      throw new Error('Anthropic streaming response has no body');
    }
    const reader = response.body.getReader();
    let streamFinished = false;
    try {
      const dec = new TextDecoder();
      let sseBuf = '';
      let rawText = '';
      let inputTokens = 0;
      let outputTokens = 0;
      let stopReason: string | undefined;
      let streamDone = false;
      while (!streamDone) {
        const { done, value } = await wd.race(reader.read());
        if (done) { streamFinished = true; break; }
        // #3225: every raw chunk (including SSE ping events) resets the idle timer.
        wd.touch(value?.byteLength ?? 0);
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

      // Text-path sanity checks. Vision keeps its previous contract: an
      // empty or terse answer is returned as-is rather than retried.
      if (kind === 'text') {
        if (!rawText) {
          throw new Error('Anthropic response missing text content block');
        }
        // Anthropic occasionally returns HTTP 200 with only a few tokens when
        // overloaded -- the response is too short to be valid JSON. Treat as
        // retryable so the retry loop handles it (sprint-096 lesson #1100-P2).
        if (outputTokens > 0 && outputTokens < 20 && promptChars >= 500) {
          throw new Error(
            `Anthropic response suspiciously short (${outputTokens} tokens, stop_reason=${stopReason ?? 'unknown'}) -- likely transient overload`,
          );
        }
      }
      // #2019: message_delta sometimes carries output_tokens=0 (malformed SSE under
      // high load). Zero tokens with non-empty text means cost and token counts
      // would be wrong. Treat as retryable.
      if (rawText && outputTokens === 0) {
        throw new Error(
          `Anthropic response has zero output tokens despite text content (stop_reason=${stopReason ?? 'unknown'}) -- malformed SSE`,
        );
      }

      const costUsd = anthropicCostUsd(this.model, inputTokens, outputTokens);
      const usage: LlmUsage = { input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: costUsd };
      this.lastUsage = usage;
      return {
        value: { text: rawText, usage },
        status: response.status,
        okContext: { tokens_in: inputTokens, tokens_out: outputTokens, cost_usd: costUsd },
      };
    } finally {
      if (!streamFinished) {
        reader.cancel().catch(() => { /* stream already errored or closed */ });
      }
    }
  }

  /**
   * Multi-turn chat with dynamic MCP tool-calling (#2915).
   *
   * Mirrors what Claude Desktop does: passes the full MCP tool manifest to
   * the Anthropic API, detects stop_reason='tool_use', executes each named
   * tool via the onToolCall callback (which calls the MCP server), injects
   * tool_result blocks, and loops until stop_reason='end_turn' or maxIterations.
   * #3284: every iteration's request runs through the shared request helper
   * (retries, idle watchdog, limiter, events with kind 'tools').
   *
   * Egress redaction: the system prompt (built from workspace context), every
   * history message and every tool result are scrubbed through redactPreLlm
   * before reaching the API (#0354 / #3157 / CLAUDE.md §5.7).
   */
  async completeWithTools(params: LlmToolChatParams): Promise<string> {
    return (await this.completeWithToolsDetailed(params)).text;
  }

  /** completeWithTools() with the usage summed over every iteration (#3301). */
  async completeWithToolsDetailed(params: LlmToolChatParams): Promise<LlmCompletion> {
    const { system: rawSystem, messages: initialMessages, tools, onToolCall, maxIterations = 10 } = params;
    // #3157: the system prompt carries workspace context, so it is egress too.
    const system = scrubForEgress(rawSystem, this.name, this.model);

    // Internal API message shape (Anthropic Messages API)
    type ApiContentBlock = {
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
      tool_use_id?: string;
      content?: string;
    };
    type ApiMessage = {
      role: 'user' | 'assistant';
      content: string | ApiContentBlock[];
    };
    type ApiResponse = {
      content: ApiContentBlock[];
      stop_reason: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    // Redact every history message before any LLM call (#0354 / #3157 / CLAUDE.md §5.7).
    // Assistant turns are redacted too: the chat history is caller-supplied text.
    const llmMessages: ApiMessage[] = initialMessages.map(m => ({
      role: m.role,
      content: scrubForEgress(m.content, this.name, this.model),
    }));

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let usage: LlmUsage | undefined;
    let lastTextResponse = '';
    // #0482: omit temperature for models that deprecated it (claude-opus-4-7+)
    let sendTemperature = this.temperature !== 0;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const requestChars = system.length + JSON.stringify(llmMessages).length;
      const data = await requestLlmWithRetry<ApiResponse>({
        provider: 'anthropic',
        label: 'Anthropic',
        model: this.model,
        kind: 'tools',
        endpoint: this.messagesUrl,
        limiterKey: this.concurrencyKey,
        streaming: false,
        promptChars: requestChars,
        appId: this.appId,
        idleTimeoutMs: this.idleTimeoutMs,
        attemptContext: { iteration: iteration + 1, max_iterations: maxIterations, tool_count: tools.length },
        run: async (wd) => {
          const bodyObj: Record<string, unknown> = {
            model: this.model,
            max_tokens: this.maxTokens,
            stream: false,
            system,
            tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
            messages: llmMessages,
          };
          if (sendTemperature) bodyObj['temperature'] = this.temperature;
          const response = await wd.race(fetch(this.messagesUrl, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify(bodyObj),
            signal: wd.signal,
          }));
          wd.setPhase('body');
          wd.touch(0);
          if (!response.ok) {
            const errText = await wd.race(response.text());
            if (response.status === 400 && sendTemperature && TEMPERATURE_DEPRECATED_RE.test(errText)) {
              sendTemperature = false;
              throw new LlmHttpStatusError(`Anthropic tool-call failed: ${response.status} ${errText.slice(0, 300)}`, response.status, {
                bodyExcerpt: errText, retryNow: true, context: { temperature_deprecated: true },
              });
            }
            throw new LlmHttpStatusError(`Anthropic tool-call failed: ${response.status} ${errText.slice(0, 300)}`, response.status, {
              bodyExcerpt: errText,
            });
          }
          const json = await wd.race(response.json()) as ApiResponse;
          const inTok = json.usage?.input_tokens ?? 0;
          const outTok = json.usage?.output_tokens ?? 0;
          return {
            value: json,
            status: response.status,
            okContext: {
              tokens_in: inTok,
              tokens_out: outTok,
              cost_usd: anthropicCostUsd(this.model, inTok, outTok),
              stop_reason: json.stop_reason,
            },
          };
        },
      });

      // Accumulate token usage
      totalInputTokens += data.usage?.input_tokens ?? 0;
      totalOutputTokens += data.usage?.output_tokens ?? 0;
      usage = {
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        cost_usd: anthropicCostUsd(this.model, totalInputTokens, totalOutputTokens),
      };
      this.lastUsage = usage;

      // Collect text blocks from this response
      const textContent = (data.content ?? [])
        .filter(b => b.type === 'text')
        .map(b => b.text ?? '')
        .join('');
      if (textContent) lastTextResponse = textContent;

      if (data.stop_reason !== 'tool_use') {
        const trace: LlmTrace = { scrubbedPrompt: `[tool-call chat, ${iteration + 1} iterations]`, response: lastTextResponse };
        this._lastTrace = trace;
        return { text: lastTextResponse, usage, trace };
      }

      // Add assistant message (including tool_use blocks) to conversation
      llmMessages.push({ role: 'assistant', content: data.content });

      // Execute each tool_use block and collect results. No limiter slot is
      // held here: the helper releases it as soon as the response is read.
      const toolUseBlocks = (data.content ?? []).filter(b => b.type === 'tool_use');
      const toolResultBlocks: ApiContentBlock[] = [];

      for (const block of toolUseBlocks) {
        const toolInput = (block.input ?? {}) as Record<string, unknown>;
        let rawResult = '';
        try {
          rawResult = await onToolCall(block.name ?? '', toolInput);
        } catch (e) {
          rawResult = `[Tool error: ${String(e instanceof Error ? e.message : e)}]`;
        }
        // Redact tool result before feeding back to LLM (#0354 / CLAUDE.md §5.7)
        const scrubbedResult = scrubForEgress(rawResult, this.name, this.model);

        logPortfolio('info', 'provider.llm.anthropic.tool-result',
          `MCP tool '${block.name}' returned ${rawResult.length} chars (${scrubbedResult.length} after redaction)`, {
            context: { tool: block.name, raw_chars: rawResult.length, scrubbed_chars: scrubbedResult.length },
          });

        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: block.id ?? '',
          content: scrubbedResult,
        });
      }

      // Add tool results as next user message and loop
      llmMessages.push({ role: 'user', content: toolResultBlocks });
    }

    // Max iterations reached -- return whatever text we have
    const trace: LlmTrace = { scrubbedPrompt: `[tool-call chat, max ${maxIterations} iterations]`, response: lastTextResponse };
    this._lastTrace = trace;
    return { text: lastTextResponse, usage, trace };
  }

}
