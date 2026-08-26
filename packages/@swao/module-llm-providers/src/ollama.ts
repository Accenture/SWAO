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

import type { LlmProvider, LlmUsage } from './types.js';

const DEFAULT_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3';

export class OllamaLlmProvider implements LlmProvider {
  readonly name = 'ollama' as const;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly temperature: number;
  private readonly seed: number | undefined;
  private readonly costPerToken: { inputPerMillion: number; outputPerMillion: number } | undefined;
  private lastUsage: LlmUsage | undefined;

  /**
   * @param model        Optional model name. Falls back to SWAO_OLLAMA_MODEL env
   *                     var, then DEFAULT_MODEL. See #0217 for the rationale.
   * @param baseUrl      Optional endpoint URL.
   * @param temperature  Optional sampling temperature; defaults to 0 for deterministic output.
   * @param seed         Optional seed for reproducibility (supported by Ollama).
   * @param costPerToken Optional billing config for GPU chargeback (Design 082 D-05).
   *                     When absent, cost_usd is always 0.
   */
  constructor(
    model?: string,
    baseUrl?: string,
    temperature?: number,
    seed?: number,
    costPerToken?: { inputPerMillion: number; outputPerMillion: number },
  ) {
    this.baseUrl = baseUrl ?? process.env['SWAO_OLLAMA_URL'] ?? DEFAULT_URL;
    this.model = model ?? process.env['SWAO_OLLAMA_MODEL'] ?? DEFAULT_MODEL;
    this.temperature = temperature ?? 0;
    this.seed = seed;
    this.costPerToken = costPerToken;
  }

  getLastUsage(): LlmUsage | undefined {
    return this.lastUsage;
  }

  async completeVision(prompt: string, images: Buffer[]): Promise<string> {
    // Vision path (#1802): Ollama /api/generate accepts images: [base64] for multimodal models.
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt,
        images: images.map((img) => img.toString('base64')),
        stream: false,
        options: { temperature: this.temperature ?? 0, ...(this.seed !== undefined && { seed: this.seed }) },
      }),
    });
    if (!response.ok) {
      throw new Error(`Ollama vision request failed: ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as {
      response?: string;
      prompt_eval_count?: number;
      eval_count?: number;
    };
    if (typeof data.response !== 'string') throw new Error('Ollama vision response missing "response" field');
    const inputTokens = data.prompt_eval_count ?? 0;
    const outputTokens = data.eval_count ?? 0;
    const costUsd = this.costPerToken
      ? (inputTokens * this.costPerToken.inputPerMillion + outputTokens * this.costPerToken.outputPerMillion) / 1_000_000
      : 0;
    this.lastUsage = { input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: costUsd };
    return data.response.trim();
  }

  async complete(prompt: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        system:
          'You are a static code and configuration analysis tool. Respond ONLY with valid JSON. No markdown, no code fences, no explanations, no conversation.',
        prompt,
        stream: false,
        format: 'json',
        options: {
          temperature: this.temperature ?? 0,
          ...(this.seed !== undefined && { seed: this.seed }),
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      response?: string;
      prompt_eval_count?: number;
      eval_count?: number;
    };
    if (typeof data.response !== 'string') {
      throw new Error('Ollama response missing "response" field');
    }

    // Capture usage; cost is 0 unless costPerToken is configured (Design 082 D-05).
    const inputTokens = data.prompt_eval_count ?? 0;
    const outputTokens = data.eval_count ?? 0;
    let costUsd = 0;
    if (this.costPerToken) {
      costUsd =
        (inputTokens * this.costPerToken.inputPerMillion +
          outputTokens * this.costPerToken.outputPerMillion) /
        1_000_000;
    }
    this.lastUsage = {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: costUsd,
    };

    // Strip markdown code fences (any language tag: json, yaml, etc.)
    const text = data.response.trim();
    const fenced = text.match(/```(?:\w+)?\s*([\s\S]*?)```/);
    if (fenced) return fenced[1].trim();

    return text;
  }
}
