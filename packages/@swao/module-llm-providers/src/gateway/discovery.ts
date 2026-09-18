// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module -- gateway model discovery + pricing capture
//  (Design 090 Section 7.4, #1405)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dump as dumpYaml } from 'js-yaml';
import { CredentialStore } from '@swao/core';
import type { LoadedConnector } from './connector-loader.js';
import type { ConnectorFile, ConnectorModelEntry } from './connector-schema.js';

const DEFAULT_TIMEOUT_MS = 10_000;

export interface DiscoveredModel {
  id: string;
  /** Normalised per-million rates when the platform published prices. */
  cost?: { input_per_million: number; output_per_million: number };
  context_window?: number;
}

export type DiscoverResult =
  | { ok: true; models: DiscoveredModel[] }
  | { ok: false; error: string };

/** OpenAI-style /v1/models response; OpenRouter adds per-token pricing as
 *  decimal STRINGS (USD per single token) plus context_length. */
interface ModelsResponse {
  data?: Array<{
    id?: string;
    context_length?: number;
    pricing?: { prompt?: string | number; completion?: string | number };
  }>;
}

function perTokenToPerMillion(v: string | number | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return parseFloat((n * 1_000_000).toPrecision(6));
}

function resolveKey(loaded: LoadedConnector): string | undefined {
  const { credential_key, env_var } = loaded.file.connector.auth;
  if (credential_key) {
    try {
      const store = new CredentialStore().loadSync();
      if (credential_key in store && store[credential_key]) return store[credential_key];
    } catch { /* fall through */ }
  }
  if (env_var && process.env[env_var]) return process.env[env_var];
  return undefined;
}

/**
 * Fetch the connector's discovery endpoint and normalise ids + pricing.
 * Never throws: failures come back as { ok: false } so pickers can fall
 * back to the static catalogue (air-gapped stays functional).
 */
export async function discoverModels(
  loaded: LoadedConnector,
  opts?: { timeoutMs?: number },
): Promise<DiscoverResult> {
  const connector = loaded.file.connector;
  const endpoint = connector.models.discovery_endpoint;
  if (!endpoint) return { ok: false, error: `connector '${connector.id}' declares no discovery_endpoint` };

  const url = `${connector.base_url.replace(/\/$/, '')}${connector.path_prefix}${endpoint}`;
  const key = resolveKey(loaded);
  const authHeaderName = connector.auth.header;
  const authValue = connector.auth.scheme === 'raw' ? key : (key ? `Bearer ${key}` : undefined);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        ...(connector.headers ?? {}),
        ...(authValue ? { [authHeaderName]: authValue } : {}),
      },
      signal: AbortSignal.timeout(opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, error: `discovery fetch failed for '${connector.id}': ${String(err instanceof Error ? err.message : err)}` };
  }

  if (!response.ok) {
    return { ok: false, error: `discovery for '${connector.id}' returned HTTP ${response.status}` };
  }

  let parsed: ModelsResponse;
  try {
    parsed = (await response.json()) as ModelsResponse;
  } catch {
    return { ok: false, error: `discovery for '${connector.id}' returned non-JSON` };
  }

  const models: DiscoveredModel[] = [];
  for (const entry of parsed.data ?? []) {
    if (!entry.id) continue;
    const input = perTokenToPerMillion(entry.pricing?.prompt);
    const output = perTokenToPerMillion(entry.pricing?.completion);
    // Meta-routing models (e.g. openrouter/auto) return null pricing; inject
    // zero-cost stub so the catalogue schema validator does not flag them (#1836).
    models.push({
      id: entry.id,
      cost: (input !== undefined && output !== undefined)
        ? { input_per_million: input, output_per_million: output }
        : { input_per_million: 0, output_per_million: 0 },
      ...(entry.context_length ? { context_window: entry.context_length } : {}),
    });
  }
  return { ok: true, models };
}

/**
 * Merge discovered models into the connector's catalogue: static entries are
 * NEVER replaced (their curated fields win); discovered entries add new
 * models and fill missing cost/context on existing ones. Result is sorted
 * and deduplicated by id.
 */
export function mergeDiscoveredModels(file: ConnectorFile, discovered: DiscoveredModel[]): ConnectorFile {
  const byId = new Map<string, ConnectorModelEntry>();
  for (const m of file.connector.models.catalogue ?? []) byId.set(m.id, { ...m });
  for (const d of discovered) {
    const existing = byId.get(d.id);
    if (existing) {
      if (!existing.cost && d.cost) existing.cost = d.cost;
      if (!existing.context_window && d.context_window) existing.context_window = d.context_window;
    } else {
      byId.set(d.id, {
        id: d.id,
        cost: d.cost ?? { input_per_million: 0, output_per_million: 0 },
        ...(d.context_window ? { context_window: d.context_window } : {}),
      });
    }
  }
  return {
    ...file,
    connector: {
      ...file.connector,
      models: {
        ...file.connector.models,
        catalogue: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
      },
      meta: {
        ...(file.connector.meta ?? {}),
        fetched_at: new Date().toISOString(),
      },
    },
  };
}

/**
 * Persist a refreshed connector into the WORKSPACE gateway dir (Design 090:
 * bundled seeds are never mutated -- refreshing a bundled connector creates
 * the workspace override copy, which then takes precedence).
 * Returns the written path.
 */
export function writeWorkspaceConnector(workspaceRoot: string, file: ConnectorFile): string {
  const dir = join(workspaceRoot, 'wsp', 'inputs', 'llm-gateway');
  mkdirSync(dir, { recursive: true });
  const outPath = join(dir, `${file.connector.id}.yaml`);
  const withSource: ConnectorFile = {
    ...file,
    connector: { ...file.connector, meta: { ...(file.connector.meta ?? {}), source: 'user' } },
  };
  writeFileSync(outPath, dumpYaml(withSource, { lineWidth: 120 }), 'utf-8');
  return outPath;
}
