// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module -- Amazon Bedrock provider
//  (Design 090 Section 6.2, #922)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
} from '@aws-sdk/client-bedrock-runtime';
import type { LlmProvider, LlmUsage, LlmTrace } from './types.js';
import { anthropicCostUsd } from './types.js';
import { redactPreLlm, recordRedaction, logPortfolio } from '@swao/core';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_TOKENS = 8192;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 2000; // 2 s, 4 s, 6 s

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Thrown when the Bedrock provider exhausts all retry attempts. */
export class BedrockConnectivityError extends Error {
  constructor(cause: string) {
    super(`Bedrock LLM connectivity failure: all retries exhausted. Last error: ${cause}`);
    this.name = 'BedrockConnectivityError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === 'AbortError' ||
    err.name === 'TimeoutError' ||
    err.name === 'ThrottlingException' ||
    err.name === 'ServiceUnavailableException' ||
    err.name === 'ModelTimeoutException' ||
    /ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up/i.test(err.message)
  );
}

/**
 * Parse the AWS region from a Bedrock runtime base_url.
 * e.g. https://bedrock-runtime.eu-central-1.amazonaws.com → eu-central-1
 * Falls back to AWS_REGION / AWS_DEFAULT_REGION env vars, then eu-central-1.
 */
function regionFromBaseUrl(baseUrl: string): string {
  const m = baseUrl.match(/bedrock-runtime\.([a-z0-9-]+)\.amazonaws\.com/);
  if (m?.[1]) return m[1];
  return (
    process.env['AWS_REGION'] ??
    process.env['AWS_DEFAULT_REGION'] ??
    'eu-central-1'
  );
}

// ---------------------------------------------------------------------------
// BedrockLlmProvider
// ---------------------------------------------------------------------------

/**
 * LLM provider backed by Amazon Bedrock Converse API.
 *
 * Credentials are resolved by the AWS SDK default credential chain:
 *   1. AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_SESSION_TOKEN (env)
 *   2. AWS_PROFILE / ~/.aws/credentials (SSO or static)
 *   3. EC2 / ECS / Lambda instance metadata
 *
 * No credentials are stored in this class or the connector YAML.
 * The connector auth.env_var (AWS_ACCESS_KEY_ID) is used only as a
 * presence-check signal for swao doctor probe 14.
 */
export class BedrockLlmProvider implements LlmProvider {
  readonly name = 'bedrock' as const;
  readonly model: string;

  private readonly client: BedrockRuntimeClient;
  private readonly temperature: number;
  private readonly maxTokens: number;
  private readonly costConfig: { inputPerMillion: number; outputPerMillion: number } | undefined;

  private lastUsage: LlmUsage | undefined;
  private _lastTrace: LlmTrace | undefined;

  constructor(
    model: string,
    baseUrl: string,
    temperature = 0,
    maxTokens = DEFAULT_MAX_TOKENS,
    costConfig?: { inputPerMillion: number; outputPerMillion: number },
  ) {
    this.model = model;
    this.temperature = temperature;
    this.maxTokens = maxTokens;
    this.costConfig = costConfig;
    this.client = new BedrockRuntimeClient({ region: regionFromBaseUrl(baseUrl) });
  }

  async complete(prompt: string): Promise<string> {
    // Redact PII / secrets before sending to the cloud provider (#0354).
    const { text: scrubbedPrompt, counts } = redactPreLlm(prompt);
    recordRedaction({
      provider: this.name,
      model: this.model,
      input_chars: prompt.length,
      scrubbed_chars: scrubbedPrompt.length,
      counts,
    });

    const messages: Message[] = [
      { role: 'user', content: [{ text: scrubbedPrompt }] },
    ];

    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) await sleep(RETRY_BASE_MS * attempt);
      try {
        const resp = await this.client.send(
          new ConverseCommand({
            modelId: this.model,
            messages,
            inferenceConfig: {
              temperature: this.temperature,
              maxTokens: this.maxTokens,
            },
          }),
        );

        const text = resp.output?.message?.content?.[0]?.text ?? '';
        const inputTok = resp.usage?.inputTokens ?? 0;
        const outputTok = resp.usage?.outputTokens ?? 0;

        // Cost: prefer explicit connector catalogue cost, fall back to the
        // shared Anthropic price table (strips cross-region prefix like
        // "eu.anthropic." so the model id matches table keys).
        const cost = this.costConfig
          ? (inputTok * this.costConfig.inputPerMillion +
              outputTok * this.costConfig.outputPerMillion) /
            1_000_000
          : anthropicCostUsd(
              this.model.replace(/^(?:[a-z]+\.)?anthropic\./, ''),
              inputTok,
              outputTok,
            );

        this.lastUsage = {
          input_tokens: inputTok,
          output_tokens: outputTok,
          cost_usd: cost,
        };
        this._lastTrace = { scrubbedPrompt, response: text };
        return text;
      } catch (err) {
        lastError = err;
        if (!isRetryable(err)) break;
        logPortfolio(
          'warn',
          'provider.bedrock.retry',
          `Bedrock attempt ${attempt + 1}/${MAX_RETRIES + 1} failed — retrying`,
          { context: { model: this.model, error: String(err) } },
        );
      }
    }
    throw new BedrockConnectivityError(String(lastError));
  }

  getLastUsage(): LlmUsage | undefined {
    return this.lastUsage;
  }

  getLastTrace(): LlmTrace | undefined {
    return this._lastTrace;
  }
}
