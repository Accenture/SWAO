// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Context budget computation from declared model context window (#2959).
// Replaces the hard-coded CTX_PROMPT_MAX_CHARS ceiling in pass-04-ctx.ts with a
// connector-aware formula so large-window models receive proportionally more context
// without the operator needing to set SWAO_CTX_PROMPT_MAX_CHARS manually.

const CHARS_PER_TOKEN = 4;
const SYSTEM_PROMPT_EST = 5_000;   // chars: base system-prompt overhead
const OUTPUT_HEADROOM = 12_000;    // chars: max output tokens * CHARS_PER_TOKEN
const ABSOLUTE_MAX_CHARS = 400_000; // hard safety ceiling regardless of context window
const LEGACY_DEFAULT_CHARS = 110_000; // fallback when no context_window_k is known

// Reference context windows for well-known models. Used when the connector yaml
// does not declare context_window_k explicitly.
export const KNOWN_CONTEXT_WINDOWS_K: Record<string, number> = {
  // PREME PREPROD models
  '/Llama-3.3-70B-Instruct-FP8-Dynamic': 128,
  '/Mistral-Small-24B-Instruct-2506': 128,
  '/gemma-4': 128,
  '/gemma-4-31b-it': 128,
  '/qwen38-27b-8fp': 32,
  '/llama-guard-3-8b': 8,

  // PREME PROD models
  '/qwen25-vl-7b-instruct': 32,

  // Anthropic
  'claude-opus-5': 200,
  'claude-sonnet-5': 200,
  'claude-haiku-4-5-20251001': 200,

  // OpenAI-compatible
  'gpt-4o': 128,
  'gpt-4o-mini': 128,
};

export interface ConnectorBudgetHints {
  context_window_k?: number;
  model?: string;
}

// Returns 0 for now; future versions will sum active framework control lengths.
function estimateControlsSize(_activeFrameworks?: string[]): number {
  return 0;
}

/**
 * Compute the effective CTX prompt budget in characters for a given connector.
 *
 * Priority:
 * 1. SWAO_CTX_PROMPT_MAX_CHARS env var (if set and > 0)
 * 2. connector.context_window_k (explicit declaration in connector yaml)
 * 3. KNOWN_CONTEXT_WINDOWS_K lookup by connector.model
 * 4. LEGACY_DEFAULT_CHARS (110000) as the conservative fallback
 *
 * The result is always in [10000, ABSOLUTE_MAX_CHARS].
 */
export function computeContextBudget(
  connector: ConnectorBudgetHints,
  activeFrameworks?: string[],
): number {
  const envOverride = parseInt(process.env['SWAO_CTX_PROMPT_MAX_CHARS'] ?? '0', 10);
  if (envOverride > 0) return Math.min(envOverride, ABSOLUTE_MAX_CHARS);

  const windowK = connector.context_window_k ?? KNOWN_CONTEXT_WINDOWS_K[connector.model ?? ''];
  if (!windowK) return LEGACY_DEFAULT_CHARS;

  const windowChars = windowK * 1_000 * CHARS_PER_TOKEN;
  const controlsEst = estimateControlsSize(activeFrameworks);
  const available = windowChars - SYSTEM_PROMPT_EST - controlsEst - OUTPUT_HEADROOM;

  return Math.min(Math.max(available, 10_000), ABSOLUTE_MAX_CHARS);
}
