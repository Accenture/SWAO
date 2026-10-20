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

// #3284: text and vision calls run through the shared request helper
// (llm-request.ts): one retry policy (6 attempts), idle watchdog, concurrency
// limiter and the provider.llm.ollama.* event set. The wire format
// (non-streaming /api/generate) is unchanged.
// #3311: tool-calling chat (SWAO Chat MCP tools) uses non-streaming /api/chat
// through the same helper.

import type { LlmProvider, LlmUsage, LlmTrace, LlmCompletion, LlmToolChatParams } from './types.js';
import { scrubForEgress } from './egress-redaction.js';
import { LlmToolsUnsupportedError } from './errors.js';
import { requestLlmWithRetry, LlmHttpStatusError, type AttemptWatchdog } from './llm-request.js';
import { llmLimiterKey, getLlmConcurrencyLimit } from './concurrency.js';

const DEFAULT_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3';

type GenerateResponse = {
  response?: string;
  prompt_eval_count?: number;
  eval_count?: number;
};

/** Non-streaming /api/chat response (#3311). */
type ChatResponse = {
  message?: {
    role?: string;
    content?: string;
    tool_calls?: Array<{ function?: { name?: string; arguments?: unknown } }>;
  };
  prompt_eval_count?: number;
  eval_count?: number;
};

export class OllamaLlmProvider implements LlmProvider {
  readonly name = 'ollama' as const;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly temperature: number;
  private readonly seed: number | undefined;
  private readonly costPerToken: { inputPerMillion: number; outputPerMillion: number } | undefined;
  private readonly appId: string | undefined;
  /** Concurrency limiter key (#3284): provider + endpoint origin. */
  readonly concurrencyKey: string;
  private lastUsage: LlmUsage | undefined;
  private _lastTrace: LlmTrace | undefined;
  /** Set once the model rejected tools (#3311); later tool chats fail fast. */
  private toolsUnsupported = false;

  /**
   * @param model        Optional model name. Falls back to SWAO_OLLAMA_MODEL env
   *                     var, then DEFAULT_MODEL. See #0217 for the rationale.
   * @param baseUrl      Optional endpoint URL.
   * @param temperature  Optional sampling temperature; defaults to 0 for deterministic output.
   * @param seed         Optional seed for reproducibility (supported by Ollama).
   * @param costPerToken Optional billing config for GPU chargeback (Design 082 D-05).
   *                     When absent, cost_usd is always 0.
   * @param appId        Optional app id; events are also written to the app log (#3284).
   */
  constructor(
    model?: string,
    baseUrl?: string,
    temperature?: number,
    seed?: number,
    costPerToken?: { inputPerMillion: number; outputPerMillion: number },
    appId?: string,
  ) {
    this.baseUrl = baseUrl ?? process.env['SWAO_OLLAMA_URL'] ?? DEFAULT_URL;
    this.model = model ?? process.env['SWAO_OLLAMA_MODEL'] ?? DEFAULT_MODEL;
    this.temperature = temperature ?? 0;
    this.seed = seed;
    this.costPerToken = costPerToken;
    this.appId = appId;
    this.concurrencyKey = llmLimiterKey(this.name, this.baseUrl);
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

  private costOf(inputTokens: number, outputTokens: number): number {
    // Cost is 0 unless costPerToken is configured (Design 082 D-05).
    return this.costPerToken
      ? (inputTokens * this.costPerToken.inputPerMillion + outputTokens * this.costPerToken.outputPerMillion) / 1_000_000
      : 0;
  }

  /** One /api/generate request through the shared helper. */
  private generate(kind: 'text' | 'vision', body: string, promptChars: number, imageCount?: number): Promise<{ text: string; usage: LlmUsage }> {
    const url = `${this.baseUrl}/api/generate`;
    const kindLabel = kind === 'vision' ? ' vision' : '';
    return requestLlmWithRetry<{ text: string; usage: LlmUsage }>({
      provider: 'ollama',
      label: 'Ollama',
      model: this.model,
      kind,
      endpoint: url,
      limiterKey: this.concurrencyKey,
      streaming: false,
      promptChars,
      imageCount,
      appId: this.appId,
      run: async (wd: AttemptWatchdog) => {
        const response = await wd.race(fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: wd.signal,
        }));
        wd.setPhase('body');
        wd.touch(0);
        if (!response.ok) {
          throw new LlmHttpStatusError(`Ollama${kindLabel} request failed: ${response.status} ${response.statusText}`, response.status, {
            bodyExcerpt: response.statusText ?? '',
          });
        }
        const data = (await wd.race(response.json())) as GenerateResponse;
        if (typeof data.response !== 'string') {
          throw new Error(`Ollama${kindLabel} response missing "response" field`);
        }
        const inputTokens = data.prompt_eval_count ?? 0;
        const outputTokens = data.eval_count ?? 0;
        const costUsd = this.costOf(inputTokens, outputTokens);
        const usage: LlmUsage = { input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: costUsd };
        this.lastUsage = usage;
        return {
          value: { text: data.response, usage },
          status: response.status,
          okContext: { tokens_in: inputTokens, tokens_out: outputTokens, cost_usd: costUsd },
        };
      },
    });
  }

  async completeVision(prompt: string, images: Buffer[]): Promise<string> {
    return (await this.completeVisionDetailed(prompt, images)).text;
  }

  /** completeVision() with the call's own usage and trace (#3301). */
  async completeVisionDetailed(prompt: string, images: Buffer[]): Promise<LlmCompletion> {
    // Vision path (#1802): Ollama /api/generate accepts images: [base64] for multimodal models.
    // The text prompt is redacted (#3157); images are not text and are sent as-is.
    const scrubbedPrompt = scrubForEgress(prompt, this.name, this.model);
    const body = JSON.stringify({
      model: this.model,
      prompt: scrubbedPrompt,
      images: images.map((img) => img.toString('base64')),
      stream: false,
      options: { temperature: this.temperature ?? 0, ...(this.seed !== undefined && { seed: this.seed }) },
    });
    const res = await this.generate('vision', body, scrubbedPrompt.length, images.length);
    const text = res.text.trim();
    const trace: LlmTrace = { scrubbedPrompt: `[vision prompt ${images.length} image(s)]`, response: text };
    this._lastTrace = trace;
    return { text, usage: res.usage, trace };
  }

  async complete(prompt: string): Promise<string> {
    return (await this.completeDetailed(prompt)).text;
  }

  /** complete() with the call's own usage and trace (#3301). */
  async completeDetailed(prompt: string): Promise<LlmCompletion> {
    // Pre-LLM egress redaction (#3157 / #0354 / CLAUDE.md §5.7): the prompt is
    // scrubbed before the HTTP body is constructed, on both the legacy
    // `type: ollama` path and the gateway `protocol: ollama` path.
    const scrubbedPrompt = scrubForEgress(prompt, this.name, this.model);
    const body = JSON.stringify({
      model: this.model,
      system:
        'You are a static code and configuration analysis tool. Respond ONLY with valid JSON. No markdown, no code fences, no explanations, no conversation.',
      prompt: scrubbedPrompt,
      stream: false,
      format: 'json',
      options: {
        temperature: this.temperature ?? 0,
        ...(this.seed !== undefined && { seed: this.seed }),
      },
    });

    // Strip markdown code fences (any language tag: json, yaml, etc.)
    const res = await this.generate('text', body, scrubbedPrompt.length);
    const text = res.text.trim();
    const fenced = text.match(/```(?:\w+)?\s*([\s\S]*?)```/);
    const responseText = fenced ? fenced[1].trim() : text;
    // #1709 parity: post-redaction prompt + response for the trace sample.
    const trace: LlmTrace = { scrubbedPrompt, response: responseText };
    this._lastTrace = trace;
    return { text: responseText, usage: res.usage, trace };
  }

  async completeWithTools(params: LlmToolChatParams): Promise<string> {
    return (await this.completeWithToolsDetailed(params)).text;
  }

  /**
   * Tool-calling chat over /api/chat (#3311): tools in the OpenAI function
   * format, the model's `message.tool_calls` executed via onToolCall, results
   * fed back as `role: 'tool'` messages until the model answers without tool
   * calls or maxIterations is reached. Each iteration's request runs through
   * the shared request helper (kind 'tools'); usage is summed over iterations.
   *
   * A model without tool support answers HTTP 400 "... does not support
   * tools": that raises LlmToolsUnsupportedError (no retry) and is remembered,
   * so later calls throw at once. A failing onToolCall is passed to the model
   * as `[Tool error: ...]` like the Anthropic path (#3312).
   *
   * Egress redaction (#3157 / CLAUDE.md section 5.7): the system prompt, every
   * history message and every tool result are scrubbed before they enter a
   * request body; events carry sizes and counts only.
   */
  async completeWithToolsDetailed(params: LlmToolChatParams): Promise<LlmCompletion> {
    const { system, messages, tools, onToolCall, maxIterations = 10 } = params;
    if (this.toolsUnsupported) throw new LlmToolsUnsupportedError(this.name, this.model);

    const url = `${this.baseUrl}/api/chat`;
    const ollamaTools = tools.map(t => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }));
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
        tools: ollamaTools,
        stream: false,
        options: { temperature: this.temperature ?? 0, ...(this.seed !== undefined && { seed: this.seed }) },
      });
      const data = await requestLlmWithRetry<ChatResponse>({
        provider: 'ollama',
        label: 'Ollama',
        model: this.model,
        kind: 'tools',
        endpoint: url,
        limiterKey: this.concurrencyKey,
        streaming: false,
        promptChars: body.length,
        appId: this.appId,
        attemptContext: { iteration: i + 1, max_iterations: maxIterations, tool_count: tools.length },
        run: async (wd: AttemptWatchdog) => {
          const response = await wd.race(fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            signal: wd.signal,
          }));
          wd.setPhase('body');
          wd.touch(0);
          if (!response.ok) {
            // The error body is the API's own message (never the request).
            let errText = '';
            try { errText = await wd.race(response.text()); } catch { /* body unreadable */ }
            const excerpt = errText.slice(0, 200);
            if (response.status === 400 && OLLAMA_NO_TOOLS_RE.test(errText)) {
              this.toolsUnsupported = true;
              throw new LlmHttpStatusError(`Ollama tool-call failed: ${response.status} ${excerpt}`, response.status, {
                bodyExcerpt: excerpt,
                throwAs: new LlmToolsUnsupportedError(this.name, this.model),
                context: { tools_unsupported: true },
              });
            }
            throw new LlmHttpStatusError(`Ollama tool-call failed: ${response.status} ${excerpt || response.statusText}`, response.status, {
              bodyExcerpt: excerpt || (response.statusText ?? ''),
            });
          }
          const json = (await wd.race(response.json())) as ChatResponse;
          if (!json.message) throw new Error('Ollama chat response missing "message" field');
          const inTok = json.prompt_eval_count ?? 0;
          const outTok = json.eval_count ?? 0;
          return {
            value: json,
            status: response.status,
            okContext: { tokens_in: inTok, tokens_out: outTok, cost_usd: this.costOf(inTok, outTok) },
          };
        },
      });

      inTotal += data.prompt_eval_count ?? 0;
      outTotal += data.eval_count ?? 0;
      usage = { input_tokens: inTotal, output_tokens: outTotal, cost_usd: this.costOf(inTotal, outTotal) };
      this.lastUsage = usage;

      const message = data.message ?? {};
      const toolCalls = message.tool_calls ?? [];
      const assistantEntry: Record<string, unknown> = { role: 'assistant', content: message.content ?? '' };
      if (toolCalls.length > 0) assistantEntry['tool_calls'] = toolCalls;
      chatMessages.push(assistantEntry);

      if (toolCalls.length === 0) {
        const text = message.content ?? '';
        const trace: LlmTrace = { scrubbedPrompt: `[tool-call chat, ${i + 1} iterations]`, response: text };
        this._lastTrace = trace;
        return { text, usage, trace };
      }

      // No limiter slot is held while the tools run.
      const results = await Promise.all(toolCalls.map(async tc => {
        const name = tc.function?.name ?? '';
        let result: string;
        try {
          result = await onToolCall(name, parseToolArguments(tc.function?.arguments));
        } catch (e) {
          result = `[Tool error: ${String(e instanceof Error ? e.message : e)}]`;
        }
        return { role: 'tool', tool_name: name, content: scrubForEgress(result, this.name, this.model) };
      }));
      chatMessages.push(...results);
    }

    const trace: LlmTrace = { scrubbedPrompt: `[tool-call chat, max ${maxIterations} iterations]`, response: '' };
    this._lastTrace = trace;
    return { text: '[tool-calling loop exceeded max iterations]', usage, trace };
  }
}

/** Ollama's 400 body for a model without tool support, e.g.
 *  `{"error":"registry.ollama.ai/library/gemma:2b does not support tools"}`. */
const OLLAMA_NO_TOOLS_RE = /does not support tools|tools? (?:are|is) not supported/i;

/** Ollama sends tool arguments as an object; some builds send a JSON string. */
function parseToolArguments(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch { /* not JSON */ }
  }
  return {};
}
