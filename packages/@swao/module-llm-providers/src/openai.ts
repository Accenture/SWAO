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

import type { LlmProvider, LlmUsage, LlmTrace } from './types.js';
import { openaiCostUsd } from './types.js';
import { redactPreLlm, recordRedaction, logPortfolio } from '@swao/core';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_MAX_TOKENS = 32768;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 3000; // 3 s, 6 s, 12 s (matches Anthropic driver)

function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.message === 'fetch failed' || /ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up/i.test(err.message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class OpenAiLlmProvider implements LlmProvider {
  readonly name = 'openai' as const;
  readonly model: string;
  private readonly apiKey: string;
  private readonly temperature: number;
  private readonly seed: number | undefined;
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
   */
  constructor(apiKey?: string, model?: string, temperature?: number, seed?: number) {
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
  }

  getLastUsage(): LlmUsage | undefined {
    return this.lastUsage;
  }

  getLastTrace(): LlmTrace | undefined {
    return this._lastTrace;
  }

  async completeVision(prompt: string, images: Buffer[]): Promise<string> {
    // Vision path (#1802): OpenAI chat/completions with image_url content blocks.
    // Images are NOT redacted -- sovereignty warning emitted by assess.ts at run start.
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
          content: [...imageBlocks, { type: 'text', text: prompt }],
        },
      ],
      temperature: this.temperature ?? 0,
      ...(this.seed !== undefined && { seed: this.seed }),
    });
    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI vision request failed: ${response.status} ${text.slice(0, 300)}`);
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const rawText = data.choices?.[0]?.message?.content ?? '';
    const inputTokens = data.usage?.prompt_tokens ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;
    this.lastUsage = { input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: openaiCostUsd(this.model, inputTokens, outputTokens) };
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

    let lastError: Error = new Error('unreachable');
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delayMs = RETRY_BASE_MS * Math.pow(2, attempt - 1);
        console.error(`[warn] OpenAI fetch failed (attempt ${attempt}/${MAX_RETRIES}) -- retrying in ${delayMs / 1000}s...`);
        await sleep(delayMs);
      }

      // #0398 (sprint-040): structured log so operators can prove the
      // OpenAI call actually went out (without inspecting wireshark or
      // their OpenAI dashboard for delayed billing data). One line per
      // attempt at info; failure lines at error with status + tail of
      // the body.
      const attemptStartedAt = Date.now();
      logPortfolio('info', 'provider.llm.openai.attempt', `OpenAI ${this.model} call attempt ${attempt + 1}/${MAX_RETRIES + 1}`, {
        context: {
          provider: 'openai',
          model: this.model,
          endpoint: OPENAI_API_URL,
          attempt: attempt + 1,
          max_attempts: MAX_RETRIES + 1,
          prompt_chars: scrubbedPrompt.length,
          api_key_suffix: this.apiKey.slice(-4),
        },
      });

      try {
        const response = await fetch(OPENAI_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body,
        });

        if (!response.ok) {
          const text = await response.text();
          // 429 = rate limit; 500/502/503/504 = transient server errors
          const isTransient = response.status === 429 || (response.status >= 500 && response.status < 600);
          logPortfolio(isTransient ? 'warn' : 'error', 'provider.llm.openai.http-error',
            `OpenAI HTTP ${response.status} on attempt ${attempt + 1}`, {
            context: {
              provider: 'openai',
              model: this.model,
              http_status: response.status,
              latency_ms: Date.now() - attemptStartedAt,
              body_excerpt: text.slice(0, 200),
              transient: isTransient,
            },
          });
          if (isTransient && attempt < MAX_RETRIES) {
            lastError = new Error(`OpenAI request failed: ${response.status} ${text.slice(0, 200)}`);
            continue;
          }
          throw new Error(`OpenAI request failed: ${response.status} ${text.slice(0, 200)}`);
        }

        const data = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };

        const rawText = data.choices?.[0]?.message?.content;
        if (!rawText) {
          throw new Error('OpenAI response missing choices[0].message.content');
        }

        const inputTokens = data.usage?.prompt_tokens ?? 0;
        const outputTokens = data.usage?.completion_tokens ?? 0;
        this.lastUsage = {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cost_usd: openaiCostUsd(this.model, inputTokens, outputTokens),
        };

        // #0398: structured success log -- one line per OpenAI HTTP 200.
        logPortfolio('info', 'provider.llm.openai.ok', `OpenAI ${this.model} -> ${response.status} in ${Date.now() - attemptStartedAt}ms`, {
          context: {
            provider: 'openai',
            model: this.model,
            http_status: response.status,
            latency_ms: Date.now() - attemptStartedAt,
            tokens_in: inputTokens,
            tokens_out: outputTokens,
            cost_usd: this.lastUsage.cost_usd,
          },
        });

        // Strip markdown code fences (any language tag: json, yaml, etc.)
        // (response_format: json_object should prevent this; defensive).
        const fenced = rawText.match(/```(?:\w+)?\s*([\s\S]*?)```/);
        const responseText = fenced ? fenced[1].trim() : rawText;
        // #1709: capture post-redaction prompt + response for trace writing.
        this._lastTrace = { scrubbedPrompt, response: responseText };
        return responseText;
      } catch (err) {
        if (isRetryable(err) && attempt < MAX_RETRIES) {
          lastError = err as Error;
          continue;
        }
        throw err;
      }
    }

    throw lastError;
  }
}
