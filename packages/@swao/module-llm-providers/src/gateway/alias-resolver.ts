// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module -- model alias resolution (#1817)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// `~vendor/family-latest` aliases in .swao.yml are resolved to concrete
// model IDs by querying the connector's discovery_endpoint at startup.
// Stale aliases (retired model IDs) 404 on OpenRouter and were previously
// misclassified as auth failures (#1816); this resolver surfaces them early
// with an actionable error.

import { logPortfolio } from '@swao/core';
import type { Connector } from './connector-schema.js';

/** True when a model id is a SWAO alias (starts with ~). */
export function isAlias(model: string): boolean {
  return model.startsWith('~');
}

/** Discovery response model entry from OpenAI-compatible /v1/models. */
interface DiscoveryModel {
  id: string;
}
interface DiscoveryResponse {
  data?: DiscoveryModel[];
  // Some providers return the array at the root level.
  [key: string]: unknown;
}

/** Fetch the model list from the connector's discovery_endpoint.
 *  Returns null on any failure (network, auth) -- alias resolution
 *  then falls back to the literal alias with a clear error. */
async function fetchDiscoveryModels(
  connector: Connector,
  apiKey: string | undefined,
  discoveryEndpoint: string,
  timeoutMs = 15_000,
): Promise<string[] | null> {
  const url = connector.base_url.replace(/\/$/, '') + discoveryEndpoint;
  const authHeader = connector.auth.header ?? 'Authorization';
  const authValue = connector.auth.scheme === 'raw'
    ? (apiKey ?? '')
    : `Bearer ${apiKey ?? ''}`;
  try {
    const resp = await Promise.race([
      fetch(url, {
        method: 'GET',
        headers: {
          ...(connector.headers ?? {}),
          ...(apiKey ? { [authHeader]: authValue } : {}),
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`discovery timeout after ${timeoutMs}ms`)), timeoutMs).unref?.(),
      ),
    ]);
    if (!resp.ok) return null;
    const body = (await resp.json()) as DiscoveryResponse;
    const list: DiscoveryModel[] = Array.isArray(body) ? body : (body.data ?? []) as DiscoveryModel[];
    return list.map((m) => m.id).filter((id) => typeof id === 'string');
  } catch {
    return null;
  }
}

/** Strip the `~` prefix and the `-latest` (or `-latest-*`) suffix to get
 *  the family base used for matching (e.g. `~deepseek/deepseek-v4-flash-latest`
 *  -> `deepseek/deepseek-v4-flash`). */
function aliasBase(alias: string): string {
  const bare = alias.startsWith('~') ? alias.slice(1) : alias;
  // Flatten nested quantifier (?:-[a-z0-9]+)* to a single char-class * so the
  // engine cannot backtrack exponentially on adversarial input (CodeQL #84).
  return bare.replace(/-latest[a-z0-9-]*$/i, '');
}

/** Select the best model from the discovered list for an alias.
 *  Strategy: find all models whose ID starts with the alias base (same
 *  vendor/family), then pick the last one alphabetically (highest version
 *  in most naming conventions). Returns null when no match. */
function pickBestModel(alias: string, discoveredIds: string[]): string | null {
  const base = aliasBase(alias);
  const candidates = discoveredIds
    .filter((id) => id.startsWith(base))
    .sort();
  return candidates.length > 0 ? candidates[candidates.length - 1]! : null;
}

/** Resolve a `~vendor/family-latest` alias to a concrete model ID.
 *
 * - If the model does not start with `~`, it is returned unchanged.
 * - If the connector has no `discovery_endpoint`, logs an error and returns
 *   the alias stripped of its `~` prefix (best-effort).
 * - If discovery fails (network, auth), logs a warn and returns the base
 *   (stripped alias) as a best-effort fallback.
 * - If no matching model is found, logs an error and returns the stripped
 *   alias so the caller gets a useful error from the platform rather than
 *   a silent empty-model error.
 */
export async function resolveModelAlias(
  alias: string,
  connector: Connector,
  apiKey: string | undefined,
): Promise<string> {
  if (!isAlias(alias)) return alias;

  const discoveryEndpoint = connector.models.discovery_endpoint;
  const base = aliasBase(alias);

  if (!discoveryEndpoint) {
    // Connector configuration issue, not a product defect -- log at warn.
    logPortfolio(
      'warn',
      'provider.llm.gateway.alias-no-discovery',
      `Model alias '${alias}' cannot be resolved: connector '${connector.id}' has no discovery_endpoint -- using base id '${base}'`,
      { context: { alias, connector: connector.id } },
    );
    return base;
  }

  const discovered = await fetchDiscoveryModels(connector, apiKey, discoveryEndpoint);
  if (discovered === null) {
    logPortfolio(
      'warn',
      'provider.llm.gateway.alias-discovery-failed',
      `Model alias '${alias}': discovery endpoint '${discoveryEndpoint}' unreachable -- using base id '${base}' (may 404 on the platform)`,
      { context: { alias, connector: connector.id, discovery_endpoint: discoveryEndpoint } },
    );
    return base;
  }

  const resolved = pickBestModel(alias, discovered);
  if (!resolved) {
    // #1895: alias-no-match is a user configuration issue (stale/invalid alias),
    // not a product defect -- log at warn so monitors don't treat it as a crash.
    logPortfolio(
      'warn',
      'provider.llm.gateway.alias-no-match',
      `Model alias '${alias}' could not be resolved: no active model matching '${base}' in connector '${connector.id}' discovery -- select a model manually`,
      { context: { alias, base, connector: connector.id, discovery_count: discovered.length } },
    );
    return base;
  }

  if (resolved !== base) {
    logPortfolio(
      'warn',
      'provider.llm.gateway.alias-resolved',
      `Model alias '${alias}' resolved to '${resolved}' via connector '${connector.id}' discovery`,
      { context: { alias, resolved, connector: connector.id } },
    );
  }

  return resolved;
}
