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
  type ContentBlock,
  type ConverseCommandOutput,
  type Message,
  type ToolInputSchema,
} from '@aws-sdk/client-bedrock-runtime';
import type { LlmProvider, LlmUsage, LlmTrace, LlmCompletion, LlmToolChatParams } from './types.js';
import { anthropicCostUsd } from './types.js';
import { scrubForEgress } from './egress-redaction.js';
import { LlmToolsUnsupportedError } from './errors.js';
import { requestLlmWithRetry } from './llm-request.js';
import { llmLimiterKey, getLlmConcurrencyLimit } from './concurrency.js';

// #3284: Bedrock uses the AWS SDK, not fetch, but every Converse call still
// runs through the shared request helper (llm-request.ts): one retry policy
// (6 attempts), idle watchdog (the SDK call is aborted via abortSignal),
// concurrency limiter and the provider.llm.bedrock.* event set. This replaces
// the former provider.bedrock.retry event.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_TOKENS = 8192;

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

/** Bedrock SDK exceptions that are worth another attempt. */
function isBedrockRetryable(err: Error): boolean {
  return (
    err.name === 'ThrottlingException' ||
    err.name === 'ServiceUnavailableException' ||
    err.name === 'ModelTimeoutException'
  );
}

/** A model without tool use (#3311): ValidationException such as "This model
 *  doesn't support tool use." The wording varies, so the match is loose. */
export function isBedrockToolsUnsupported(err: unknown): boolean {
  if (!(err instanceof Error) || err.name !== 'ValidationException') return false;
  // CodeQL #127 (js/polynomial-redos): plain substring checks instead of a regex
  // with a greedy wildcard over the provider message.
  const m = err.message.toLowerCase();
  const support = m.indexOf('support tool');
  if (support > 0 && /(?:doesn't|doesnt|does not|don't|not) $/.test(m.slice(Math.max(0, support - 9), support))) return true;
  if (m.includes('tool use not supported') || m.includes('tool use is not supported')) return true;
  const tu = m.indexOf('tool use') >= 0 ? m.indexOf('tool use') : m.indexOf('tooluse');
  return tu >= 0 && m.indexOf('unsupported', tu) > tu;
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
  private readonly baseUrl: string;
  private readonly appId: string | undefined;
  /** Concurrency limiter key (#3284): provider + endpoint origin. */
  readonly concurrencyKey: string;

  private lastUsage: LlmUsage | undefined;
  private _lastTrace: LlmTrace | undefined;
  /** Set once the model rejected tool use (#3311); later tool chats fail fast. */
  private toolsUnsupported = false;

  constructor(
    model: string,
    baseUrl: string,
    temperature = 0,
    maxTokens = DEFAULT_MAX_TOKENS,
    costConfig?: { inputPerMillion: number; outputPerMillion: number },
    appId?: string,
  ) {
    this.model = model;
    this.temperature = temperature;
    this.maxTokens = maxTokens;
    this.costConfig = costConfig;
    this.baseUrl = baseUrl;
    this.appId = appId;
    this.concurrencyKey = llmLimiterKey(this.name, baseUrl);
    this.client = new BedrockRuntimeClient({ region: regionFromBaseUrl(baseUrl) });
  }

  /** In-flight limit of this provider's endpoint (#3284, D-14). */
  get maxConcurrency(): number {
    return getLlmConcurrencyLimit(this.concurrencyKey);
  }

  async complete(prompt: string): Promise<string> {
    return (await this.completeDetailed(prompt)).text;
  }

  /** complete() with the call's own usage and trace (#3301). */
  async completeDetailed(prompt: string): Promise<LlmCompletion> {
    // Redact PII / secrets before sending to the cloud provider (#0354).
    const scrubbedPrompt = scrubForEgress(prompt, this.name, this.model);

    const messages: Message[] = [
      { role: 'user', content: [{ text: scrubbedPrompt }] },
    ];

    try {
      const { text, usage } = await requestLlmWithRetry<{ text: string; usage: LlmUsage }>({
        provider: 'bedrock',
        label: 'Bedrock',
        model: this.model,
        kind: 'text',
        endpoint: this.baseUrl,
        limiterKey: this.concurrencyKey,
        streaming: false,
        promptChars: scrubbedPrompt.length,
        appId: this.appId,
        isRetryableError: isBedrockRetryable,
        exhaustedError: (lastError) => new BedrockConnectivityError(String(lastError)),
        run: async (wd) => {
          const resp = await wd.race(this.client.send(
            new ConverseCommand({
              modelId: this.model,
              messages,
              inferenceConfig: {
                temperature: this.temperature,
                maxTokens: this.maxTokens,
              },
            }),
            { abortSignal: wd.signal },
          ));

          const out = resp.output?.message?.content?.[0]?.text ?? '';
          const inputTok = resp.usage?.inputTokens ?? 0;
          const outputTok = resp.usage?.outputTokens ?? 0;

          // Cost: prefer explicit connector catalogue cost, fall back to the
          // shared Anthropic price table (strips cross-region prefix like
          // "eu.anthropic." so the model id matches table keys).
          const cost = this.costOf(inputTok, outputTok);

          const usage: LlmUsage = {
            input_tokens: inputTok,
            output_tokens: outputTok,
            cost_usd: cost,
          };
          this.lastUsage = usage;
          return {
            value: { text: out, usage },
            status: resp.$metadata?.httpStatusCode ?? 200,
            okContext: { tokens_in: inputTok, tokens_out: outputTok, cost_usd: cost },
          };
        },
      });
      const trace: LlmTrace = { scrubbedPrompt, response: text };
      this._lastTrace = trace;
      return { text, usage, trace };
    } catch (err) {
      // Historical contract: every Bedrock failure surfaces as BedrockConnectivityError.
      if (err instanceof BedrockConnectivityError) throw err;
      throw new BedrockConnectivityError(String(err));
    }
  }

  async completeWithTools(params: LlmToolChatParams): Promise<string> {
    return (await this.completeWithToolsDetailed(params)).text;
  }

  /**
   * Tool-calling chat over the Converse API (#3311): `toolConfig.tools` with
   * the MCP input schemas, `toolUse` blocks executed via onToolCall, results
   * fed back as `toolResult` blocks in a user message until stopReason is not
   * 'tool_use' or maxIterations is reached. Each iteration runs through the
   * shared request helper (kind 'tools'); usage is summed over iterations.
   *
   * A model without tool use answers ValidationException "... doesn't support
   * tool use": that raises LlmToolsUnsupportedError and is remembered, so
   * later calls throw at once. Any other final failure is a
   * BedrockConnectivityError, as on the text path. A failing onToolCall is
   * passed to the model as `[Tool error: ...]` with status 'error' (#3312).
   *
   * Egress redaction (#0354 / #3157 / CLAUDE.md section 5.7): system prompt,
   * history and tool results are scrubbed before they enter a request.
   */
  async completeWithToolsDetailed(params: LlmToolChatParams): Promise<LlmCompletion> {
    const { system, messages: history, tools, onToolCall, maxIterations = 10 } = params;
    if (this.toolsUnsupported) throw new LlmToolsUnsupportedError(this.name, this.model);

    const scrubbedSystem = scrubForEgress(system, this.name, this.model);
    const toolConfig = {
      tools: tools.map(t => ({
        toolSpec: {
          name: t.name,
          description: t.description,
          inputSchema: { json: t.input_schema as ToolInputSchema.JsonMember['json'] },
        },
      })),
    };
    // Converse rejects blank text blocks and requires alternating roles, so a
    // blank turn keeps its place with a placeholder text.
    const messages: Message[] = history.map(m => ({
      role: m.role,
      content: [{ text: m.content.trim().length > 0 ? scrubForEgress(m.content, this.name, this.model) : '(no text)' }],
    }));

    let inTotal = 0;
    let outTotal = 0;
    let usage: LlmUsage | undefined;
    let lastText = '';
    for (let i = 0; i < maxIterations; i++) {
      const requestChars = scrubbedSystem.length + JSON.stringify(messages).length;
      let resp: ConverseCommandOutput;
      try {
        resp = await requestLlmWithRetry<ConverseCommandOutput>({
          provider: 'bedrock',
          label: 'Bedrock',
          model: this.model,
          kind: 'tools',
          endpoint: this.baseUrl,
          limiterKey: this.concurrencyKey,
          streaming: false,
          promptChars: requestChars,
          appId: this.appId,
          attemptContext: { iteration: i + 1, max_iterations: maxIterations, tool_count: tools.length },
          isRetryableError: isBedrockRetryable,
          exhaustedError: (lastError) => new BedrockConnectivityError(String(lastError)),
          run: async (wd) => {
            const out = await wd.race(this.client.send(
              new ConverseCommand({
                modelId: this.model,
                system: scrubbedSystem ? [{ text: scrubbedSystem }] : undefined,
                messages,
                toolConfig,
                inferenceConfig: { temperature: this.temperature, maxTokens: this.maxTokens },
              }),
              { abortSignal: wd.signal },
            ));
            const inTok = out.usage?.inputTokens ?? 0;
            const outTok = out.usage?.outputTokens ?? 0;
            return {
              value: out,
              status: out.$metadata?.httpStatusCode ?? 200,
              okContext: { tokens_in: inTok, tokens_out: outTok, cost_usd: this.costOf(inTok, outTok), stop_reason: out.stopReason },
            };
          },
        });
      } catch (err) {
        if (isBedrockToolsUnsupported(err)) {
          this.toolsUnsupported = true;
          throw new LlmToolsUnsupportedError(this.name, this.model);
        }
        if (err instanceof BedrockConnectivityError) throw err;
        throw new BedrockConnectivityError(String(err));
      }

      inTotal += resp.usage?.inputTokens ?? 0;
      outTotal += resp.usage?.outputTokens ?? 0;
      usage = { input_tokens: inTotal, output_tokens: outTotal, cost_usd: this.costOf(inTotal, outTotal) };
      this.lastUsage = usage;

      const content: ContentBlock[] = resp.output?.message?.content ?? [];
      const text = content.map(b => b.text ?? '').join('');
      if (text) lastText = text;

      const toolUses = content.flatMap(b => (b.toolUse ? [b.toolUse] : []));
      if (resp.stopReason !== 'tool_use' || toolUses.length === 0) {
        const trace: LlmTrace = { scrubbedPrompt: `[tool-call chat, ${i + 1} iterations]`, response: lastText };
        this._lastTrace = trace;
        return { text: lastText, usage, trace };
      }

      // Blank text blocks next to toolUse are dropped (Converse rejects them).
      messages.push({ role: 'assistant', content: content.filter(b => b.text === undefined || b.text.trim().length > 0) });

      // No limiter slot is held while the tools run.
      const results: ContentBlock[] = [];
      for (const tu of toolUses) {
        let result: string;
        let failed = false;
        try {
          result = await onToolCall(tu.name ?? '', (tu.input ?? {}) as Record<string, unknown>);
        } catch (e) {
          failed = true;
          result = `[Tool error: ${String(e instanceof Error ? e.message : e)}]`;
        }
        const scrubbed = scrubForEgress(result, this.name, this.model);
        results.push({
          toolResult: {
            toolUseId: tu.toolUseId ?? '',
            // Converse rejects blank text blocks.
            content: [{ text: scrubbed.length > 0 ? scrubbed : '(empty result)' }],
            ...(failed && { status: 'error' as const }),
          },
        });
      }
      messages.push({ role: 'user', content: results });
    }

    const trace: LlmTrace = { scrubbedPrompt: `[tool-call chat, max ${maxIterations} iterations]`, response: lastText };
    this._lastTrace = trace;
    return { text: lastText, usage, trace };
  }

  /** Cost: explicit connector catalogue cost, else the shared Anthropic table. */
  private costOf(inputTok: number, outputTok: number): number {
    return this.costConfig
      ? (inputTok * this.costConfig.inputPerMillion + outputTok * this.costConfig.outputPerMillion) / 1_000_000
      : anthropicCostUsd(this.model.replace(/^(?:[a-z]+\.)?anthropic\./, ''), inputTok, outputTok);
  }

  /** @deprecated #3301: shared state; read `usage` from the `*Detailed()` result. */
  getLastUsage(): LlmUsage | undefined {
    return this.lastUsage;
  }

  getLastTrace(): LlmTrace | undefined {
    return this._lastTrace;
  }
}
