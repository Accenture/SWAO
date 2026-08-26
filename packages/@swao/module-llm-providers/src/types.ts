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

export interface LlmUsage {
  /** Prompt / input tokens consumed by the call. */
  input_tokens: number;
  /** Completion / output tokens produced by the call. */
  output_tokens: number;
  /**
   * Estimated USD cost for this single call, computed by the provider
   * from a model price table (Anthropic / OpenAI). For local models
   * (Ollama) cost_usd is 0.
   */
  cost_usd: number;
}

export type LlmProviderName = 'anthropic' | 'openai' | 'ollama' | 'open-llm-provider' | 'stub';

/** Post-redaction prompt and raw model response captured from one LLM call.
 *  The scrubbedPrompt is ALWAYS post-redaction (#1709 / CLAUDE.md §5.7). */
export interface LlmTrace {
  scrubbedPrompt: string;
  response: string;
}

export interface LlmProvider {
  /** Provider type identifier; recorded in run-manifest.llm.provider. */
  readonly name: LlmProviderName;
  /** Model identifier (e.g. 'claude-opus-4-7', 'llama3', 'stub-fixture');
   *  recorded in run-manifest.llm.model. */
  readonly model: string;
  complete(prompt: string): Promise<string>;
  /**
   * Vision-capable completion (#1802). Sends one or more JPEG image buffers
   * alongside a text prompt. Optional -- providers that do not support vision
   * leave this undefined; callers must check before calling.
   * NOTE: images are NOT redacted. Cloud providers (anthropic, openai) will
   * receive raw screenshot data. Use only when `assessment.vision_analysis: true`
   * is explicitly set in .swao.yml (sovereignty warning shown at run start).
   */
  completeVision?(prompt: string, images: Buffer[]): Promise<string>;
  /**
   * Usage from the most recent `complete()` call. Optional: providers
   * that do not surface usage (e.g. older fixtures or third-party
   * drivers) return undefined. The assess.ts accumulator skips those
   * silently rather than fail.
   */
  getLastUsage?(): LlmUsage | undefined;
  /**
   * Post-redaction prompt + raw response from the most recent successful
   * `complete()` call. Optional -- providers that cannot guarantee the
   * prompt is post-redaction (e.g. stub fixtures) return undefined.
   * Never contains pre-redaction content (#1709 / CLAUDE.md §5.7).
   */
  getLastTrace?(): LlmTrace | undefined;
}

// ---------------------------------------------------------------------
// Anthropic price table (USD per 1M tokens, model -> [input, output])
// Update when Anthropic publishes new pricing.
// ---------------------------------------------------------------------
const ANTHROPIC_PRICING_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-opus-4-7':            { input: 15.00, output: 75.00 },
  'claude-sonnet-4-6':          { input:  3.00, output: 15.00 },
  'claude-haiku-4-5':           { input:  1.00, output:  5.00 },
  'claude-haiku-4-5-20251001':  { input:  1.00, output:  5.00 },
};

export function anthropicCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = ANTHROPIC_PRICING_PER_MTOK[model];
  if (!price) return 0;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

// ---------------------------------------------------------------------
// OpenAI price table (USD per 1M tokens, model -> [input, output])
// Update when OpenAI publishes new pricing. Unknown models yield 0
// (run-manifest still records token counts; cost is best-effort).
// #0330 sprint-036.
// ---------------------------------------------------------------------
const OPENAI_PRICING_PER_MTOK: Record<string, { input: number; output: number }> = {
  // GPT-4o family (legacy but widely available 2025+)
  'gpt-4o':                     { input:  2.50, output: 10.00 },
  'gpt-4o-mini':                { input:  0.15, output:  0.60 },
  // GPT-5 family (current line; pricing snapshot at sprint-036 authoring)
  'gpt-5':                      { input: 10.00, output: 30.00 },
  'gpt-5-mini':                 { input:  0.50, output:  2.00 },
  'gpt-5-nano':                 { input:  0.10, output:  0.40 },
};

export function openaiCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = OPENAI_PRICING_PER_MTOK[model];
  if (!price) return 0;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

// ---------------------------------------------------------------------
// Embedding interfaces (Design 082 §5.2)
// EmbeddingProvider covers any vector-embedding endpoint (TEI 1.8,
// OpenAI embeddings, etc.).  The completions and embedding concerns are
// intentionally separated: a single deployment may expose both via
// different paths / models.
// ---------------------------------------------------------------------

/** Result returned by EmbeddingProvider.embed(). */
export interface EmbeddingResult {
  /** Dense float vector; dimension determined by the model. */
  vector: number[];
  /** Token count for cost/quota tracking; 0 when not surfaced by the endpoint. */
  input_tokens: number;
  /** USD cost; 0 for on-premise models. */
  cost_usd: number;
}

/** Generic embedding provider interface (Design 082 §5.2). */
export interface EmbeddingProvider {
  /** Provider + model identifier for run-manifest recording. */
  readonly name: string;
  /** Model identifier. */
  readonly model: string;
  /** Embed a single text string. */
  embed(text: string): Promise<EmbeddingResult>;
  /**
   * Embed a batch of strings.
   * Default: sequential calls to embed().
   * Implementations may override for true batched HTTP calls.
   */
  embedBatch?(texts: string[]): Promise<EmbeddingResult[]>;
}
