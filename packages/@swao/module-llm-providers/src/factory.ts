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
import { logPortfolio } from '@swao/core';
import { getConnector, listConnectors } from './gateway/connector-loader.js';
import { createProviderFromConnector, type ConnectorProvenance } from './gateway/resolve.js';

/** Subset of .swao.yml's `providers.llm.primary` block. */
export interface LlmProviderConfig {
  /** SWAO LLM-Gateway connector id (Design 090). When set, the provider is
   *  built from the discovered connector file and `type` is ignored. */
  connector?: string;
  /** Gateway environment name (connector.environments key). */
  env?: string;
  /** Workspace root for workspace-connector discovery; host-injected. */
  workspaceRoot?: string;
  /** 'anthropic' | 'openai' | 'ollama' | 'open-llm-provider'
   *  (or unset -> resolved from SWAO_LLM_PROVIDER env) */
  type?: string;
  /** Explicit model name. Resolution precedence:
   *  1. config.model (from .swao.yml)
   *  2. SWAO_<PROVIDER>_MODEL env var
   *  3. provider's hard-coded default
   *  Recording the actually-used model in run-manifest is #0217. */
  model?: string;
  /** default 0 -- deterministic assessment output */
  temperature?: number;
  /** supported by OpenAI + Ollama; ignored by Anthropic */
  seed?: number;
  /** override provider default max output tokens (Anthropic default: 8192) */
  max_tokens?: number;
  /** Custom base URL -- required for open-llm-provider (Design 082 §4.3). */
  baseUrl?: string;
  /** Path prefix between baseUrl and /v1/chat/completions.
   *  Defaults to '/${model}' when absent (vLLM path-prefix routing).
   *  Set to '' to disable path routing (body model field only). */
  modelPrefix?: string;
  /** Optional cost config for on-prem / third-party billing (Design 082 §4.3, D-05).
   *  When absent, cost_usd is always 0. */
  costPerToken?: {
    inputPerMillion: number;
    outputPerMillion: number;
  };
  /** Named environment configs (Design 082 §4.4).
   *  Active env resolved via SWAO_LLM_ENV -> activeEnv -> 'prod'. */
  environments?: Record<string, LlmProviderConfig>;
  /** Default environment name when SWAO_LLM_ENV is not set. */
  activeEnv?: string;
}

const VALID_PROVIDERS = ['anthropic', 'openai', 'ollama', 'open-llm-provider'] as const;

/**
 * Resolve the active environment config when an `environments` map is present
 * (Design 082 §4.4).  Returns the config unchanged when no environments map
 * is defined (single-env / existing path).
 */
function resolveEnvConfig(config: LlmProviderConfig): LlmProviderConfig {
  if (!config.environments) return config;
  const activeEnv = process.env['SWAO_LLM_ENV'] ?? config.activeEnv ?? 'prod';
  const envCfg = config.environments[activeEnv];
  if (!envCfg) {
    throw new Error(
      `SWAO_LLM_ENV='${activeEnv}' not found in providers.llm.environments. ` +
      `Available: ${Object.keys(config.environments).join(', ')}.`,
    );
  }
  return { ...config, ...envCfg };
}

/**
 * Build an LlmProvider from a config block / env var.
 *
 * Resolution order: `config.type` -> `SWAO_LLM_PROVIDER` env -> throws.
 *
 * Per #0325, an unrecognised provider name throws a clear error rather
 * than silently substituting any fixture provider. Per #0473, the stub
 * provider is deleted from production code; use cassette replay
 * (LlmCacheLayer) or FixedLlmProvider in tests instead.
 */
/** Provenance of the most recent gateway-path createLlmProvider call, for
 *  run-manifest recording (#1401). Undefined when the legacy path was used. */
let _lastGatewayProvenance: ConnectorProvenance | undefined;
export function getLastGatewayProvenance(): ConnectorProvenance | undefined {
  return _lastGatewayProvenance;
}

export function createLlmProvider(
  _appId?: string,
  _passName?: string,
  config?: LlmProviderConfig,
): LlmProvider {
  _lastGatewayProvenance = undefined;

  // SWAO LLM-Gateway path (Design 090, #1398): a connector id resolves through
  // the file-based gateway. The legacy `type` switch below stays byte-for-byte
  // so every pre-gateway .swao.yml and env-var configuration behaves as in
  // v0.9.9; migration to connector files is opt-in.
  const connectorId = config?.connector ?? process.env['SWAO_LLM_CONNECTOR'];
  if (connectorId) {
    const loaded = getConnector(connectorId, { workspaceRoot: config?.workspaceRoot });
    if (!loaded) {
      const available = listConnectors({ workspaceRoot: config?.workspaceRoot })
        .connectors.map(c => c.file.connector.id);
      throw new Error(
        `Unknown LLM connector '${connectorId}'. Available connectors: ${available.join(', ') || '(none discovered)'}. ` +
        `Add a connector file under wsp/inputs/llm-gateway/ or pick a bundled one.`,
      );
    }
    // #1409: SWAO_LLM_MODEL carries the model across process boundaries
    // (TUI parent -> spawned assess child) when no yaml config is readable.
    const resolved = createProviderFromConnector(loaded, {
      model: config?.model ?? process.env['SWAO_LLM_MODEL'],
      env: config?.env,
      // #1691: propagate appId for dual-logging to app-events.
      appId: _appId,
    });
    _lastGatewayProvenance = resolved.provenance;
    return resolved.provider;
  }

  // Resolve multi-env config first (Design 082 §4.4).
  const resolvedConfig = config ? resolveEnvConfig(config) : config;
  const provider = resolvedConfig?.type ?? process.env['SWAO_LLM_PROVIDER'];
  if (!provider) {
    throw new Error(
      'No LLM provider configured. Set providers.llm.primary.type in .swao.yml ' +
      'or export SWAO_LLM_PROVIDER=anthropic|openai|ollama. ' +
      'For tests: use FixedLlmProvider or LlmCacheLayer with seed cassettes.',
    );
  }

  switch (provider) {
    case 'ollama':
      return new OllamaLlmProvider(
        resolvedConfig?.model,
        undefined,
        resolvedConfig?.temperature,
        resolvedConfig?.seed,
        resolvedConfig?.costPerToken,
      );
    case 'anthropic':
      return new AnthropicLlmProvider(
        undefined,
        resolvedConfig?.model,
        resolvedConfig?.temperature,
        resolvedConfig?.max_tokens,
        undefined,
        _appId,
      );
    case 'openai':
      return new OpenAiLlmProvider(
        undefined,
        resolvedConfig?.model,
        resolvedConfig?.temperature,
        resolvedConfig?.seed,
      );
    case 'open-llm-provider':
      return new OpenLlmProvider(
        undefined,
        resolvedConfig?.model,
        resolvedConfig?.baseUrl,
        resolvedConfig?.modelPrefix,
        resolvedConfig?.temperature,
        resolvedConfig?.seed,
        resolvedConfig?.costPerToken,
      );
    default:
      logPortfolio(
        'error',
        'provider.llm.unknown',
        `Unknown LLM provider '${provider}'; valid options: ${VALID_PROVIDERS.join(', ')}`,
        { context: { requested: provider, valid_options: VALID_PROVIDERS } },
      );
      throw new Error(
        `Unknown LLM provider '${provider}'. Valid options: ${VALID_PROVIDERS.join(', ')}. ` +
        `Set providers.llm.primary.type in .swao.yml or SWAO_LLM_PROVIDER env.`,
      );
  }
}
