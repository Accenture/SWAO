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

// OpenAI LLM driver -- mirrors anthropic.ts (#0330, sprint-036 Phase D).
//
// Resolution: API key from constructor arg | SWAO_OPENAI_API_KEY env |
// OPENAI_API_KEY env. Model from constructor arg | SWAO_OPENAI_MODEL env |
// DEFAULT_MODEL (gpt-4o-mini -- balanced cost/quality default for SWAO
// pass-engine workloads). Operator can override via .swao.yml's
// providers.llm.primary.model or SWAO_OPENAI_MODEL.
//
// Closes #0325 Option A (the option B hard-fail shipped in sprint-034).
// Aligned to the same complete() contract as AnthropicLlmProvider so
// `createLlmProvider` can substitute one for the other.
//
// #3284: text and vision calls run through the shared request helper
// (llm-request.ts): one retry policy (6 attempts), idle watchdog, concurrency
// limiter and the provider.llm.openai.* event set. The wire format
// (non-streaming chat/completions) is unchanged.

import type { LlmProvider, LlmUsage, LlmTrace, LlmCompletion } from './types.js';
import { openaiCostUsd } from './types.js';
import { scrubForEgress } from './egress-redaction.js';
import { requestLlmWithRetry, LlmHttpStatusError, type AttemptWatchdog, type LlmAttemptResult } from './llm-request.js';
import { llmLimiterKey, getLlmConcurrencyLimit } from './concurrency.js';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_MAX_TOKENS = 32768;

type ChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export class OpenAiLlmProvider implements LlmProvider {
  readonly name = 'openai' as const;
  readonly model: string;
  private readonly apiKey: string;
  private readonly temperature: number;
  private readonly seed: number | undefined;
  private readonly appId: string | undefined;
  /** Concurrency limiter key (#3284): provider + endpoint origin. */
  readonly concurrencyKey: string;
  private lastUsage: LlmUsage | undefined;
  private _lastTrace: LlmTrace | undefined;

  /**
   * @param apiKey      Optional API key; falls back to SWAO_OPENAI_API_KEY
   *                    or OPENAI_API_KEY env vars. Service-account keys
   *                    (`sk-svcacct-...`) are accepted; their per-project
   *                    rate limits + audit trail are recommended for
   *                    non-personal use.
   * @param model       Optional model name (e.g. 'gpt-4o', 'gpt-4o-mini'). When
   *                    omitted, falls back to SWAO_OPENAI_MODEL env var, then
   *                    DEFAULT_MODEL. Pass the value from `.swao.yml`
   *                    `providers.llm.primary.model` so the run-manifest
   *                    records the model actually configured rather than the
   *                    silent gpt-4o-mini default (mirrors #0217).
   * @param temperature Optional sampling temperature; defaults to 0 for deterministic output.
   * @param seed        Optional seed for reproducibility (supported by OpenAI).
   * @param appId       Optional app id; events are also written to the app log (#3284).
   */
  constructor(apiKey?: string, model?: string, temperature?: number, seed?: number, appId?: string) {
    const key = apiKey ?? process.env['SWAO_OPENAI_API_KEY'] ?? process.env['OPENAI_API_KEY'];
    if (!key) {
      throw new Error(
        'OpenAiLlmProvider: no API key. Set SWAO_OPENAI_API_KEY or OPENAI_API_KEY env var, ' +
        'or run `swao credential set openai-api-key <key>` to load the credential store.',
      );
    }
    this.apiKey = key;
    this.model = model ?? process.env['SWAO_OPENAI_MODEL'] ?? DEFAULT_MODEL;
    this.temperature = temperature ?? 0;
    this.seed = seed;
    this.appId = appId;
    this.concurrencyKey = llmLimiterKey(this.name, OPENAI_API_URL);
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

  /** One non-streaming chat/completions request; usage recorded on success. */
  private async send(wd: AttemptWatchdog, body: string, kindLabel: string): Promise<LlmAttemptResult<ChatResponse>> {
    const response = await wd.race(fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body,
      signal: wd.signal,
    }));
    wd.setPhase('body');
    wd.touch(0);
    if (!response.ok) {
      const text = await wd.race(response.text());
      throw new LlmHttpStatusError(`OpenAI${kindLabel} request failed: ${response.status} ${text.slice(0, 200)}`, response.status, {
        bodyExcerpt: text.slice(0, 200),
      });
    }
    const data = (await wd.race(response.json())) as ChatResponse;
    const inputTokens = data.usage?.prompt_tokens ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;
    const costUsd = openaiCostUsd(this.model, inputTokens, outputTokens);
    return {
      value: data,
      status: response.status,
      okContext: { tokens_in: inputTokens, tokens_out: outputTokens, cost_usd: costUsd },
    };
  }

  /** Usage of one response (#3301); also kept as the deprecated last usage. */
  private recordUsage(data: ChatResponse): LlmUsage {
    const inputTokens = data.usage?.prompt_tokens ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;
    const usage: LlmUsage = { input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: openaiCostUsd(this.model, inputTokens, outputTokens) };
    this.lastUsage = usage;
    return usage;
  }

  async completeVision(prompt: string, images: Buffer[]): Promise<string> {
    return (await this.completeVisionDetailed(prompt, images)).text;
  }

  /** completeVision() with the call's own usage and trace (#3301). */
  async completeVisionDetailed(prompt: string, images: Buffer[]): Promise<LlmCompletion> {
    // Vision path (#1802): OpenAI chat/completions with image_url content blocks.
    // Images are NOT redacted -- sovereignty warning emitted by assess.ts at run start.
    // The text prompt IS redacted (#3157 / CLAUDE.md §5.7).
    const scrubbedPrompt = scrubForEgress(prompt, this.name, this.model);
    const imageBlocks = images.map((img) => ({
      type: 'image_url' as const,
      image_url: { url: `data:image/jpeg;base64,${img.toString('base64')}` },
    }));
    const body = JSON.stringify({
      model: this.model,
      max_completion_tokens: DEFAULT_MAX_TOKENS,
      messages: [
        {
          role: 'user',
          content: [...imageBlocks, { type: 'text', text: scrubbedPrompt }],
        },
      ],
      temperature: this.temperature ?? 0,
      ...(this.seed !== undefined && { seed: this.seed }),
    });
    const data = await requestLlmWithRetry<ChatResponse>({
      ...this.specBase('vision', scrubbedPrompt.length),
      imageCount: images.length,
      run: (wd) => this.send(wd, body, ' vision'),
    });
    const usage = this.recordUsage(data);
    const rawText = data.choices?.[0]?.message?.content ?? '';
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

    const body = JSON.stringify({
      model: this.model,
      max_completion_tokens: DEFAULT_MAX_TOKENS,
      messages: [
        {
          role: 'system',
          content:
            'You are a static code and configuration analysis tool. Respond ONLY with valid JSON starting with { and ending with }. No markdown, no code fences, no explanations, no conversation.',
        },
        { role: 'user', content: scrubbedPrompt },
      ],
      // Force JSON mode -- OpenAI guarantees the response is valid JSON
      // when the system + user prompt explicitly ask for JSON. Saves the
      // fenced-block strip dance the Anthropic driver does.
      response_format: { type: 'json_object' },
      temperature: this.temperature ?? 0,
      ...(this.seed !== undefined && { seed: this.seed }),
    });

    const { text: rawText, usage } = await requestLlmWithRetry<{ text: string; usage: LlmUsage }>({
      ...this.specBase('text', scrubbedPrompt.length),
      run: async (wd) => {
        const res = await this.send(wd, body, '');
        const text = res.value.choices?.[0]?.message?.content;
        if (!text) {
          // Non-retryable: logged once as provider.llm.openai.error.
          throw new Error('OpenAI response missing choices[0].message.content');
        }
        const usage = this.recordUsage(res.value);
        return { ...res, value: { text, usage } };
      },
    });

    // Strip markdown code fences (any language tag: json, yaml, etc.)
    // (response_format: json_object should prevent this; defensive).
    const fenced = rawText.match(/```(?:\w+)?\s*([\s\S]*?)```/);
    const responseText = fenced ? fenced[1].trim() : rawText;
    // #1709: capture post-redaction prompt + response for trace writing.
    const trace: LlmTrace = { scrubbedPrompt, response: responseText };
    this._lastTrace = trace;
    return { text: responseText, usage, trace };
  }

  private specBase(kind: 'text' | 'vision', promptChars: number) {
    return {
      provider: 'openai',
      label: 'OpenAI',
      model: this.model,
      kind,
      endpoint: OPENAI_API_URL,
      limiterKey: this.concurrencyKey,
      streaming: false,
      promptChars,
      appId: this.appId,
      // #3437: no api_key_suffix in the attempt event (key material in logs).
    } as const;
  }
}
