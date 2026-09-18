// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module -- SWAO LLM-Gateway resolution
//  (Design 090 Section 6.2, #1397 #1398 #1399)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { CredentialStore, logPortfolio } from '@swao/core';
import type { LlmProvider } from '../types.js';
import { AnthropicLlmProvider } from '../anthropic.js';
import { BedrockLlmProvider } from '../bedrock.js';
import { OllamaLlmProvider } from '../ollama.js';
import { OpenLlmProvider } from '../open-llm-provider.js';
import type { LoadedConnector } from './connector-loader.js';
import type { Connector } from './connector-schema.js';

/** Provenance recorded in run-manifest (#1401): which file, which bytes,
 *  which model actually served the run. */
export interface ConnectorProvenance {
  connector_id: string;
  connector_path: string;
  connector_sha256: string;
  connector_origin: 'workspace' | 'bundled';
  protocol: string;
  base_url: string;
  model: string;
}

export interface ResolvedGatewayProvider {
  provider: LlmProvider;
  provenance: ConnectorProvenance;
}

/** Effective connection after applying the selected environment overlay. */
interface EffectiveConnection {
  baseUrl: string;
  pathPrefix: string;
  headers: Record<string, string> | undefined;
  defaultModel: string;
}

function applyEnvironment(connector: Connector, envName?: string): EffectiveConnection {
  const base: EffectiveConnection = {
    baseUrl: connector.base_url,
    pathPrefix: connector.path_prefix,
    headers: connector.headers,
    defaultModel: connector.models.default,
  };
  if (!connector.environments) return base;
  const active = envName ?? process.env['SWAO_LLM_ENV'] ?? connector.active_env ?? 'prod';
  const env = connector.environments[active];
  if (!env) {
    throw new Error(
      `Connector '${connector.id}': environment '${active}' not defined. ` +
      `Available: ${Object.keys(connector.environments).join(', ')}.`,
    );
  }
  return {
    baseUrl: env.base_url ?? base.baseUrl,
    pathPrefix: env.path_prefix ?? base.pathPrefix,
    headers: { ...(base.headers ?? {}), ...(env.headers ?? {}) },
    defaultModel: env.models?.default ?? base.defaultModel,
  };
}

/** Credential resolution (#1399): store entry -> env var -> undefined.
 *  Key NAMES only ever appear in logs and errors, never values. */
function resolveCredential(connector: Connector): string | undefined {
  const { credential_key, env_var } = connector.auth;
  if (credential_key) {
    try {
      const store = new CredentialStore().loadSync();
      if (credential_key in store && store[credential_key]) return store[credential_key];
    } catch { /* store unavailable -- fall through */ }
  }
  if (env_var) {
    const v = process.env[env_var];
    if (v) return v;
  }
  return undefined;
}

/** Per-model cost resolution: catalogue entry -> connector cost_per_token -> undefined. */
function resolveCost(connector: Connector, model: string):
  { inputPerMillion: number; outputPerMillion: number } | undefined {
  const entry = connector.models.catalogue?.find(m => m.id === model);
  if (entry?.cost) {
    return { inputPerMillion: entry.cost.input_per_million, outputPerMillion: entry.cost.output_per_million };
  }
  if (connector.cost_per_token) {
    return {
      inputPerMillion: connector.cost_per_token.input_per_million,
      outputPerMillion: connector.cost_per_token.output_per_million,
    };
  }
  return undefined;
}

/**
 * Build an LlmProvider from a loaded connector file.
 *
 * Model handling: an explicit model outside the static catalogue is a WARNING,
 * not an error -- aggregators expose open-ended model sets (Design 090 goal:
 * agnostic model choice) and the catalogue is a picker aid, not an allowlist.
 */
export function createProviderFromConnector(
  loaded: LoadedConnector,
  opts?: { model?: string; env?: string; appId?: string },
): ResolvedGatewayProvider {
  const connector = loaded.file.connector;
  const conn = applyEnvironment(connector, opts?.env);
  const model = opts?.model ?? conn.defaultModel;

  const catalogue = connector.models.catalogue ?? [];
  if (opts?.model && catalogue.length > 0 && !catalogue.some(m => m.id === opts.model)) {
    logPortfolio(
      'warn',
      'provider.llm.gateway.model-not-in-catalogue',
      `Model '${opts.model}' is not in connector '${connector.id}' catalogue -- proceeding (catalogue is advisory)`,
      { context: { connector: connector.id, model: opts.model, catalogue: catalogue.map(m => m.id) } },
    );
  }

  const apiKey = resolveCredential(connector);
  const cost = resolveCost(connector, model);
  const temperature = connector.defaults?.temperature;
  const seed = connector.defaults?.seed;
  const maxTokens = connector.defaults?.max_tokens;

  // #2748: apply connector-level TLS overrides before making any network call.
  // ca_bundle: PEM path injected via NODE_EXTRA_CA_CERTS so pkg-bundled Node.js
  // trusts enterprise internal CAs without requiring the env var in the shell.
  // reject_unauthorized: false -- SWAO does not write NODE_TLS_REJECT_UNAUTHORIZED
  // itself; the operator must set it in their shell environment before launching SWAO.
  // This avoids a global-state side-effect and keeps the security boundary explicit.
  const tls = connector.tls;
  if (tls) {
    if (tls.reject_unauthorized === false) {
      const currentVal = process.env['NODE_TLS_REJECT_UNAUTHORIZED'];
      if (currentVal === '0') {
        logPortfolio('warn', 'provider.llm.gateway.tls-reject-unauthorized-disabled',
          `Connector '${connector.id}': TLS certificate verification disabled ` +
          `(reject_unauthorized: false + NODE_TLS_REJECT_UNAUTHORIZED=0 in shell).`,
          { context: { connector: connector.id } });
      } else {
        logPortfolio('warn', 'provider.llm.gateway.tls-reject-unauthorized-hint',
          `Connector '${connector.id}': reject_unauthorized: false is set but ` +
          `NODE_TLS_REJECT_UNAUTHORIZED is not 0. ` +
          `To bypass TLS verification, set NODE_TLS_REJECT_UNAUTHORIZED=0 in ` +
          `your shell before launching SWAO.`,
          { context: { connector: connector.id } });
      }
    }
    if (tls.ca_bundle) {
      if (!existsSync(tls.ca_bundle)) {
        logPortfolio('warn', 'provider.llm.gateway.tls-ca-bundle-not-found',
          `Connector '${connector.id}': tls.ca_bundle path not found: ${tls.ca_bundle}`,
          { context: { connector: connector.id, path: tls.ca_bundle } });
      } else {
        process.env['NODE_EXTRA_CA_CERTS'] = tls.ca_bundle;
      }
    }
  }

  let provider: LlmProvider;
  switch (connector.protocol) {
    case 'openai-chat':
      provider = new OpenLlmProvider(
        apiKey ?? '',
        model,
        conn.baseUrl,
        conn.pathPrefix, // '' (schema default) disables vLLM model-path routing
        temperature,
        seed,
        cost,
        {
          headers: conn.headers,
          authHeader: connector.auth.header,
          authScheme: connector.auth.scheme,
          requestOverrides: connector.request_overrides,
          maxTokens,
          // #1691: thread appId for dual-logging to app-events.
          appId: opts?.appId,
        },
      );
      break;
    case 'anthropic-messages':
      provider = new AnthropicLlmProvider(apiKey, model, temperature, maxTokens, conn.baseUrl);
      break;
    case 'ollama':
      provider = new OllamaLlmProvider(model, conn.baseUrl, temperature, seed, cost);
      break;
    case 'bedrock':
      provider = new BedrockLlmProvider(model, conn.baseUrl, temperature, maxTokens, cost);
      break;
    default: {
      // Exhaustiveness guard -- the schema enum prevents this at parse time.
      const never: never = connector.protocol;
      throw new Error(`Unsupported connector protocol: ${String(never)}`);
    }
  }

  let sha256 = '';
  try {
    sha256 = createHash('sha256').update(readFileSync(loaded.path)).digest('hex');
  } catch { /* provenance hash is best-effort */ }

  return {
    provider,
    provenance: {
      connector_id: connector.id,
      connector_path: loaded.path,
      connector_sha256: sha256,
      connector_origin: loaded.origin,
      protocol: connector.protocol,
      base_url: conn.baseUrl,
      model,
    },
  };
}
