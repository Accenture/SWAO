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

import type { LlmProvider } from './types.js';
import { OllamaLlmProvider } from './ollama.js';
import { AnthropicLlmProvider } from './anthropic.js';
import { OpenAiLlmProvider } from './openai.js';
import { OpenLlmProvider } from './open-llm-provider.js';
import { createLlmProvider, type LlmProviderConfig } from './factory.js';

/**
 * Open LLM interface (#0569).
 *
 * Instead of forcing the operator to name a provider, SWAO accepts a single
 * connection string and auto-detects the provider from its shape:
 *
 *   - `https://api.anthropic.com/...`  -> anthropic
 *   - `https://api.openai.com/...`     -> openai
 *   - `http://localhost:11434` (or any host on the Ollama port) -> ollama
 *   - provider-prefixed `anthropic:claude-opus-4-8`             -> that provider + model
 *   - bare model name (`claude-...`, `gpt-...`, `llama-...`)    -> the matching provider
 *
 * An unrecognised string resolves to `provider: null`; the caller decides
 * whether to prompt (interactive) or fail (non-interactive / CI / MCP).
 *
 * The parser holds NO I/O and NO host dependency. Interactive prompting is
 * injected by the host via `fromConnectionString`'s `promptFn`, so this module
 * stays a leaf on the `swao -> modules -> core` DAG.
 */

export type DetectedProvider = 'anthropic' | 'openai' | 'ollama' | 'open-llm-provider';

export interface ParsedConnection {
  /** Detected provider, or null when the string could not be classified. */
  provider: DetectedProvider | null;
  /** Explicit model, when the string carried one. */
  model?: string;
  /** Custom endpoint URL. */
  baseUrl?: string;
  /** Inline API key, when the string carried one (`anthropic:sk-...`). */
  apiKey?: string;
  /** Path prefix for open-llm-provider path-prefix routing (Design 082 §4.9). */
  modelPrefix?: string;
}

const OLLAMA_PORT = '11434';

/** Classify a bare model name to a provider by its well-known prefix. */
function providerForModel(model: string): DetectedProvider | null {
  const m = model.toLowerCase();
  if (m.startsWith('claude')) return 'anthropic';
  if (m.startsWith('gpt') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')) return 'openai';
  if (
    m.startsWith('llama') ||
    m.startsWith('mistral') ||
    m.startsWith('mixtral') ||
    m.startsWith('qwen') ||
    m.startsWith('gemma') ||
    m.startsWith('phi') ||
    m.startsWith('deepseek')
  ) {
    return 'ollama';
  }
  return null;
}

/**
 * Parse a connection string into a normalised {@link ParsedConnection}.
 * Pure + synchronous; never throws (an unparseable string yields
 * `provider: null` so the caller can choose how to recover).
 */
export function parseConnectionString(raw: string): ParsedConnection {
  // Bound the input before any prefix/URL matching: a connection string is
  // short, so capping keeps classification constant-time (CodeQL
  // js/polynomial-redos hygiene, consistent with the #52-#56 fixes).
  const s = (raw ?? '').trim().slice(0, 4096);
  if (s.length === 0) return { provider: null };

  // 1. provider-prefixed form: `anthropic:<rest>` / `openai:<rest>` / `ollama:<rest>`
  //    / `open-llm-provider:<url>` (Design 082 §4.9).
  //    `<rest>` is a model (anthropic/openai), an api key (`sk-...`), or a URL (ollama /
  //    open-llm-provider).

  // open-llm-provider prefix: `open-llm-provider:https://host/ModelPrefix`
  // Parse: host -> baseUrl, path -> modelPrefix, last segment -> model.
  const openLlmPrefixMatch = /^open-llm-provider:(https?:\/\/.+)$/i.exec(s);
  if (openLlmPrefixMatch) {
    const rest = openLlmPrefixMatch[1].trim();
    try {
      const u = new URL(rest);
      const baseUrl = `${u.protocol}//${u.host}`;
      const pathStr = u.pathname === '/' ? '' : u.pathname;
      const modelPrefix = pathStr;
      const lastSegment = pathStr.split('/').filter(Boolean).pop();
      return {
        provider: 'open-llm-provider',
        baseUrl,
        modelPrefix,
        ...(lastSegment ? { model: lastSegment } : {}),
      };
    } catch {
      // Unparseable URL -- fall through to null
      return { provider: null };
    }
  }

  const prefixMatch = /^(anthropic|openai|ollama):(.+)$/i.exec(s);
  if (prefixMatch) {
    const provider = prefixMatch[1].toLowerCase() as DetectedProvider;
    const rest = prefixMatch[2].trim();
    if (provider === 'ollama' && /^https?:\/\//i.test(rest)) {
      return { provider, baseUrl: stripUrlPath(rest) };
    }
    if (/^sk-/.test(rest)) return { provider, apiKey: rest };
    return { provider, model: rest };
  }

  // 2. URL forms.
  if (/^https?:\/\//i.test(s)) {
    if (/^https:\/\/api\.anthropic\.com/i.test(s)) return { provider: 'anthropic' };
    if (/^https:\/\/api\.openai\.com/i.test(s)) return { provider: 'openai' };
    // Any URL on the Ollama port (localhost or a remote host) is Ollama.
    if (new RegExp(`:${OLLAMA_PORT}(/|$)`).test(s)) return { provider: 'ollama', baseUrl: stripUrlPath(s) };
    if (/^https?:\/\/localhost(:|\/|$)/i.test(s)) return { provider: 'ollama', baseUrl: stripUrlPath(s) };
    // Unrecognised HTTPS URL -> treat as a generic open-llm-provider endpoint
    // (Design 082 §4.9).  Callers that relied on provider: null for this case
    // must now handle 'open-llm-provider' instead.
    return { provider: 'open-llm-provider', baseUrl: stripUrlPath(s) };
  }

  // 3. bare model name.
  const provider = providerForModel(s);
  if (provider) return { provider, model: s };

  return { provider: null };
}

/** Strip the path/query off a URL, keeping scheme + host (+ port). */
function stripUrlPath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return url;
  }
}

export interface FromConnectionStringOpts {
  /**
   * When false (default for CI / MCP / `--non-interactive`), the parser never
   * prompts: an unclassifiable string or a missing key fails with a clear
   * error instead of blocking on stdin.
   */
  interactive?: boolean;
  /**
   * Host-injected prompt callback used only when `interactive` is true. Returns
   * the operator's answer (empty string = no answer). The host wires a
   * readline/TUI implementation; the module owns none.
   */
  promptFn?: (question: string) => Promise<string>;
  /** Extra config merged onto the parsed result (temperature, seed). */
  config?: Pick<LlmProviderConfig, 'temperature' | 'seed'>;
}

/**
 * Build an {@link LlmProvider} from a single connection string, auto-detecting
 * the provider. In interactive mode, missing fields are prompted via
 * `promptFn`; in non-interactive mode they fail fast with an actionable error.
 */
export async function fromConnectionString(
  raw: string,
  opts: FromConnectionStringOpts = {},
): Promise<LlmProvider> {
  const interactive = opts.interactive ?? false;
  let parsed = parseConnectionString(raw);

  // Resolve an undetected provider.
  if (parsed.provider === null) {
    if (interactive && opts.promptFn) {
      const answer = (
        await opts.promptFn(
          'Could not detect the LLM provider. Enter provider [anthropic|openai|ollama|open-llm-provider]:',
        )
      )
        .trim()
        .toLowerCase();
      if (
        answer === 'anthropic' ||
        answer === 'openai' ||
        answer === 'ollama' ||
        answer === 'open-llm-provider'
      ) {
        parsed = { ...parsed, provider: answer as DetectedProvider };
      } else {
        throw new Error(
          `Unknown LLM provider '${answer}'. Expected anthropic, openai, ollama, or open-llm-provider.`,
        );
      }
    } else {
      throw new Error(
        `Could not detect an LLM provider from connection string '${raw}'. ` +
        `Use a provider-prefixed form (e.g. 'anthropic:claude-opus-4-8'), a known API URL, ` +
        `or run interactively to be prompted. (non-interactive mode does not prompt.)`,
      );
    }
  }

  const provider = parsed.provider as DetectedProvider;

  // Resolve a missing API key for the cloud providers.
  if (provider === 'anthropic' || provider === 'openai') {
    const envKey =
      provider === 'anthropic'
        ? process.env['SWAO_ANTHROPIC_API_KEY'] ?? process.env['ANTHROPIC_API_KEY']
        : process.env['SWAO_OPENAI_API_KEY'] ?? process.env['OPENAI_API_KEY'];
    if (!parsed.apiKey && !envKey && interactive && opts.promptFn) {
      const key = (await opts.promptFn(`Enter API key for ${provider}:`)).trim();
      if (key.length > 0) parsed = { ...parsed, apiKey: key };
    }
    // When still no key and non-interactive, the provider constructor throws
    // its own clear "no API key" error -- we do not duplicate it here.
  }

  const temperature = opts.config?.temperature;
  const seed = opts.config?.seed;

  switch (provider) {
    case 'ollama':
      return new OllamaLlmProvider(parsed.model, parsed.baseUrl, temperature, seed);
    case 'anthropic':
      return new AnthropicLlmProvider(parsed.apiKey, parsed.model, temperature);
    case 'openai':
      return new OpenAiLlmProvider(parsed.apiKey, parsed.model, temperature, seed);
    case 'open-llm-provider':
      // apiKey falls through to OpenLlmProvider's own credential resolution when undefined.
      return new OpenLlmProvider(
        parsed.apiKey,
        parsed.model,
        parsed.baseUrl,
        parsed.modelPrefix,
        temperature,
        seed,
      );
  }
}

/**
 * Convenience namespace satisfying the #0569 surface
 * (`LlmFactory.fromConnectionString(...)`). `create` delegates to the existing
 * config/env-driven {@link createLlmProvider}.
 */
export const LlmFactory = {
  fromConnectionString,
  create: createLlmProvider,
} as const;
