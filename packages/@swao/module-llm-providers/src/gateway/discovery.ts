// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module -- gateway model discovery + pricing capture
//  (Design 090 Section 7.4, #1405, #4475)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4475: the served models are read live from the platform of a connector,
// one list route per protocol:
//   openai-chat         GET {base}{path_prefix}/v1/models (OpenAI, OpenRouter,
//                       vLLM, open-llm and the hub connectors)
//   anthropic-messages  GET {base}/v1/models (x-api-key + anthropic-version)
//   ollama              GET {base}/api/tags
//   bedrock             ListFoundationModels + ListInferenceProfiles of the
//                       region (read-only, SigV4-signed GET)
// The request carries the credential and the connector headers only, never
// workspace content, and goes through the connector's egress rules (HTTPS_PROXY,
// NO_PROXY, tls.reject_unauthorized) like the calls. `models.discovery: false`
// turns it off. Failures never throw: pickers fall back to the catalogue.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dump as dumpYaml } from 'js-yaml';
import { fetch as undiciFetch } from 'undici';
import { buildFetchDispatcher } from '../open-llm-provider.js';
import type { LoadedConnector } from './connector-loader.js';
import { fileSha256, noteDiscoveryRewrite } from './connector-loader.js';
import { parseConnectorYaml } from './connector-schema.js';
import type { Connector, ConnectorFile, ConnectorModelEntry } from './connector-schema.js';
import { resolveCredential } from './resolve.js';
import { signAwsRequest, type AwsCredentials } from './aws-sigv4.js';

const DEFAULT_TIMEOUT_MS = 10_000;
/** #4475: the pickers and `swao llm models` wait at most this long. */
export const PICKER_DISCOVERY_TIMEOUT_MS = 5_000;
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_PAGES = 10;

export interface DiscoveredModel {
  id: string;
  /** Normalised per-million rates, only when the platform published prices. */
  cost?: { input_per_million: number; output_per_million: number };
  context_window?: number;
}

/** Why a discovery gave no list: the picker words its fallback line from it. */
export type DiscoveryFailure = 'off' | 'auth' | 'timeout' | 'unreachable' | 'http' | 'invalid';

export type DiscoverResult =
  | { ok: true; models: DiscoveredModel[] }
  | { ok: false; error: string; reason: DiscoveryFailure };

/** Injectable AWS credential source (tests; the default reads env, then the SDK chain). */
export type AwsCredentialSource = (region: string) => Promise<AwsCredentials | undefined>;

export interface DiscoverOptions {
  timeoutMs?: number;
  rejectUnauthorized?: boolean;
  awsCredentials?: AwsCredentialSource;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** Remove trailing '/' characters without a regular expression (CodeQL js/polynomial-redos). */
function stripTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47) end--;
  return s.slice(0, end);
}

/** The base URL of the active environment (the overlay of resolve.ts applyEnvironment). */
function effectiveBaseUrl(c: Connector): string {
  const envName = process.env['SWAO_LLM_ENV'] ?? c.active_env ?? 'prod';
  return c.environments?.[envName]?.base_url ?? c.base_url;
}

/** #4475: SWAO_LLM_DISCOVERY=off turns live discovery off on the whole machine
 *  (air-gapped hosts; the swao test setup sets it so no test reaches a platform). */
export function discoveryOffOnMachine(): boolean {
  return process.env['SWAO_LLM_DISCOVERY'] === 'off';
}

/** #4475: true unless the connector turns discovery off (`models.discovery: false`). */
export function discoveryEnabled(c: Connector): boolean {
  return c.models.discovery !== false;
}

/**
 * The list URL of an HTTP protocol (openai-chat, anthropic-messages, ollama):
 * the declared discovery_endpoint, else the protocol's own list route. A base
 * URL that already ends in /v1 does not get a second /v1. Bedrock: undefined
 * (two signed control-plane calls, see discoverBedrock).
 */
export function discoveryUrl(c: Connector): string | undefined {
  let base = stripTrailingSlashes(effectiveBaseUrl(c));
  const prefix = c.path_prefix ?? '';
  switch (c.protocol) {
    case 'openai-chat':
    case 'anthropic-messages': {
      const endpoint = c.models.discovery_endpoint ?? '/v1/models';
      if (endpoint.startsWith('/v1/') && base.endsWith('/v1')) base = base.slice(0, -3);
      return `${base}${c.protocol === 'openai-chat' ? prefix : ''}${endpoint}`;
    }
    case 'ollama':
      return `${base}${c.models.discovery_endpoint ?? '/api/tags'}`;
    case 'bedrock':
      return undefined;
    default: {
      const never: never = c.protocol;
      return String(never);
    }
  }
}

/**
 * #4500 (Design 090 section 7.4): can the chat route SWAO calls serve this id?
 * openai-chat: an OpenRouter batch-only variant (`vendor/model:batch`) serves
 * the batch API only; chat completions answer HTTP 404. Such ids are dropped by
 * the discovery, skipped by the alias resolver and hidden by the pickers. The
 * other protocols list chat models only.
 */
export function isChatServableId(protocol: Connector['protocol'], id: string): boolean {
  switch (protocol) {
    case 'openai-chat': {
      const colon = id.lastIndexOf(':');
      return colon === -1 || id.slice(colon + 1).toLowerCase() !== 'batch';
    }
    case 'anthropic-messages':
    case 'ollama':
    case 'bedrock':
      return true;
    default: {
      const never: never = protocol;
      return String(never) !== '';
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

class HttpStatusError extends Error {
  constructor(readonly status: number) { super(`HTTP ${status}`); }
}

async function getJson(url: string, headers: Record<string, string>, signal: AbortSignal, rejectUnauthorized?: boolean): Promise<unknown> {
  const dispatcher = buildFetchDispatcher({ rejectUnauthorized, targetUrl: url });
  const init: Record<string, unknown> = { method: 'GET', headers, signal };
  if (dispatcher) init['dispatcher'] = dispatcher;
  const resp = await undiciFetch(url, init as Parameters<typeof undiciFetch>[1]);
  if (!resp.ok) {
    await resp.text().catch(() => '');
    throw new HttpStatusError(resp.status);
  }
  return resp.json();
}

function failure(connectorId: string, err: unknown): { ok: false; error: string; reason: DiscoveryFailure } {
  if (err instanceof HttpStatusError) {
    const reason: DiscoveryFailure = err.status === 401 || err.status === 403 ? 'auth' : 'http';
    return { ok: false, error: `discovery for '${connectorId}' returned HTTP ${err.status}`, reason };
  }
  if (err instanceof SyntaxError) {
    return { ok: false, error: `discovery for '${connectorId}' returned non-JSON`, reason: 'invalid' };
  }
  const name = err instanceof Error ? err.name : '';
  const msg = err instanceof Error ? err.message : String(err);
  if (name === 'TimeoutError' || name === 'AbortError' || /timeout|aborted/i.test(msg)) {
    return { ok: false, error: `discovery for '${connectorId}' timed out`, reason: 'timeout' };
  }
  return { ok: false, error: `discovery fetch failed for '${connectorId}': ${msg}`, reason: 'unreachable' };
}

function perTokenToPerMillion(v: string | number | null | undefined): number | undefined {
  if (v === undefined || v === null) return undefined;
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return parseFloat((n * 1_000_000).toPrecision(6));
}

function authHeaders(c: Connector, key: string | undefined): Record<string, string> {
  if (!key) return {};
  const value = c.auth.scheme === 'raw' ? key : `Bearer ${key}`;
  return { [c.auth.header]: value };
}

// ---------------------------------------------------------------------------
// Per protocol
// ---------------------------------------------------------------------------

/** OpenAI-style /v1/models; OpenRouter adds per-token prices as decimal strings and context_length. */
interface OpenAiModelsResponse {
  data?: Array<{
    id?: string;
    context_length?: number;
    pricing?: { prompt?: string | number | null; completion?: string | number | null } | null;
    /** OpenRouter: the modalities; a model without text output cannot answer a chat call. */
    architecture?: { output_modalities?: string[] | null } | null;
  }>;
}

async function discoverOpenAi(c: Connector, key: string | undefined, signal: AbortSignal, tls?: boolean): Promise<DiscoveredModel[]> {
  const url = discoveryUrl(c)!;
  const body = (await getJson(url, { ...(c.headers ?? {}), ...authHeaders(c, key) }, signal, tls)) as OpenAiModelsResponse | OpenAiModelsResponse['data'];
  const list = Array.isArray(body) ? body : (body?.data ?? []);
  const models: DiscoveredModel[] = [];
  for (const entry of list) {
    if (!entry?.id) continue;
    // #4500: batch-only variants and models without text output are not served by chat completions.
    if (!isChatServableId('openai-chat', entry.id)) continue;
    const outputs = entry.architecture?.output_modalities;
    if (Array.isArray(outputs) && outputs.length > 0 && !outputs.includes('text')) continue;
    const input = perTokenToPerMillion(entry.pricing?.prompt);
    const output = perTokenToPerMillion(entry.pricing?.completion);
    let cost: DiscoveredModel['cost'];
    if (input !== undefined && output !== undefined) cost = { input_per_million: input, output_per_million: output };
    // #1836: meta-routing models (openrouter/auto) publish a pricing block
    // without numbers; they get a zero-cost stub. A list without any pricing
    // block (OpenAI, vLLM) gives no cost, so the price tables still apply.
    else if (entry.pricing) cost = { input_per_million: 0, output_per_million: 0 };
    models.push({ id: entry.id, ...(cost ? { cost } : {}), ...(entry.context_length ? { context_window: entry.context_length } : {}) });
  }
  return models;
}

/** Anthropic Models API: paginated with has_more and last_id. */
interface AnthropicModelsResponse {
  data?: Array<{ id?: string }>;
  has_more?: boolean;
  last_id?: string | null;
}

async function discoverAnthropic(c: Connector, key: string | undefined, signal: AbortSignal, tls?: boolean): Promise<DiscoveredModel[]> {
  const base = discoveryUrl(c)!;
  const headers = { 'anthropic-version': ANTHROPIC_VERSION, ...(c.headers ?? {}), ...authHeaders(c, key) };
  const models: DiscoveredModel[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${base}${base.includes('?') ? '&' : '?'}limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ''}`;
    const body = (await getJson(url, headers, signal, tls)) as AnthropicModelsResponse;
    for (const m of body?.data ?? []) if (m?.id) models.push({ id: m.id });
    if (!body?.has_more || !body.last_id) break;
    after = body.last_id;
  }
  return models;
}

/** Ollama /api/tags: { models: [{ name: 'llama3.3:latest', model: ... }] }. */
interface OllamaTagsResponse {
  models?: Array<{ name?: string; model?: string }>;
}

async function discoverOllama(c: Connector, key: string | undefined, signal: AbortSignal, tls?: boolean): Promise<DiscoveredModel[]> {
  const body = (await getJson(discoveryUrl(c)!, { ...(c.headers ?? {}), ...authHeaders(c, key) }, signal, tls)) as OllamaTagsResponse;
  const models: DiscoveredModel[] = [];
  for (const m of body?.models ?? []) {
    const id = m?.name ?? m?.model;
    if (id) models.push({ id });
  }
  return models;
}

/** Region of a Bedrock runtime base URL, else AWS_REGION, AWS_DEFAULT_REGION, eu-central-1 (bedrock.ts rule). */
export function bedrockRegion(baseUrl: string): string {
  const m = /bedrock-runtime\.([a-z0-9-]+)\.amazonaws\.com/.exec(baseUrl);
  if (m?.[1]) return m[1];
  return process.env['AWS_REGION'] ?? process.env['AWS_DEFAULT_REGION'] ?? 'eu-central-1';
}

/** The control-plane origin: bedrock-runtime.<region> becomes bedrock.<region>; any other host stays. */
export function bedrockControlBase(baseUrl: string): string {
  const u = new URL(baseUrl);
  if (u.hostname.startsWith('bedrock-runtime.')) u.hostname = `bedrock.${u.hostname.slice('bedrock-runtime.'.length)}`;
  return u.origin;
}

/** Default credential source: the AWS env vars, else the SDK provider chain (profile, SSO, IMDS). */
const defaultAwsCredentials: AwsCredentialSource = async (region) => {
  const id = process.env['AWS_ACCESS_KEY_ID'];
  const secret = process.env['AWS_SECRET_ACCESS_KEY'];
  if (id && secret) return { accessKeyId: id, secretAccessKey: secret, ...(process.env['AWS_SESSION_TOKEN'] ? { sessionToken: process.env['AWS_SESSION_TOKEN'] } : {}) };
  try {
    const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime');
    const client = new BedrockRuntimeClient({ region });
    const creds = await client.config.credentials();
    client.destroy();
    return creds?.accessKeyId && creds.secretAccessKey
      ? { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey, ...(creds.sessionToken ? { sessionToken: creds.sessionToken } : {}) }
      : undefined;
  } catch {
    return undefined;
  }
};

interface BedrockFoundationModels { modelSummaries?: Array<{ modelId?: string }> }
interface BedrockInferenceProfiles { inferenceProfileSummaries?: Array<{ inferenceProfileId?: string }>; nextToken?: string | null }

async function discoverBedrock(c: Connector, signal: AbortSignal, tls: boolean | undefined, source: AwsCredentialSource): Promise<DiscoveredModel[]> {
  const baseUrl = effectiveBaseUrl(c);
  const region = bedrockRegion(baseUrl);
  const creds = await source(region);
  if (!creds) throw new HttpStatusError(401);
  const origin = bedrockControlBase(baseUrl);
  const signed = (url: string): Record<string, string> =>
    signAwsRequest({ method: 'GET', url, region, service: 'bedrock', credentials: creds, headers: { accept: 'application/json' } });

  const models: DiscoveredModel[] = [];
  const fmUrl = `${origin}/foundation-models`;
  const fm = (await getJson(fmUrl, signed(fmUrl), signal, tls)) as BedrockFoundationModels;
  for (const m of fm?.modelSummaries ?? []) if (m?.modelId) models.push({ id: m.modelId });
  let next: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${origin}/inference-profiles?maxResults=1000${next ? `&nextToken=${encodeURIComponent(next)}` : ''}`;
    const ip = (await getJson(url, signed(url), signal, tls)) as BedrockInferenceProfiles;
    for (const p of ip?.inferenceProfileSummaries ?? []) if (p?.inferenceProfileId) models.push({ id: p.inferenceProfileId });
    if (!ip?.nextToken) break;
    next = ip.nextToken;
  }
  return models;
}

/**
 * Read the served models of a connector from its platform and normalise ids
 * and prices. Never throws: failures come back as { ok: false } with a reason,
 * so pickers fall back to the static catalogue (air-gapped stays functional).
 */
export async function discoverModels(loaded: LoadedConnector, opts?: DiscoverOptions): Promise<DiscoverResult> {
  const c = loaded.file.connector;
  if (!discoveryEnabled(c) || discoveryOffOnMachine()) return { ok: false, error: `connector '${c.id}' has discovery turned off`, reason: 'off' };
  const signal = AbortSignal.timeout(opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const tls = opts?.rejectUnauthorized ?? (c.tls?.reject_unauthorized === false ? false : undefined);
  try {
    let models: DiscoveredModel[];
    switch (c.protocol) {
      case 'openai-chat': models = await discoverOpenAi(c, resolveCredential(c), signal, tls); break;
      case 'anthropic-messages': models = await discoverAnthropic(c, resolveCredential(c), signal, tls); break;
      case 'ollama': models = await discoverOllama(c, resolveCredential(c), signal, tls); break;
      case 'bedrock': models = await discoverBedrock(c, signal, tls, opts?.awsCredentials ?? defaultAwsCredentials); break;
      default: {
        const never: never = c.protocol;
        return { ok: false, error: `unsupported protocol ${String(never)}`, reason: 'off' };
      }
    }
    const seen = new Set<string>();
    return { ok: true, models: models.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true))) };
  } catch (err) {
    return failure(c.id, err);
  }
}

// ---------------------------------------------------------------------------
// Served marking
// ---------------------------------------------------------------------------

function bare(id: string): string {
  let i = 0;
  while (i < id.length && id.charCodeAt(i) === 47) i++;
  return id.slice(i);
}

/**
 * #4475: is a configured model id among the served ids? Tolerant, because a
 * false "not served" mark keeps a valid model from being preselected:
 * exact id; leading slashes ignored (hub ids such as /qwen38-27b-8fp); an
 * Ollama name without tag matches its tags (llama3.3 matches llama3.3:latest);
 * an alias matches its dated snapshots (claude-haiku-4-5 matches
 * claude-haiku-4-5-20251001). A SWAO latest alias (~vendor/family-latest) is
 * never judged: undefined.
 */
export function isModelServed(id: string, served: ReadonlySet<string> | readonly string[]): boolean | undefined {
  if (id.startsWith('~')) return undefined;
  const list = served instanceof Set ? [...served] : (served as readonly string[]);
  const want = bare(id);
  for (const s of list) {
    const got = bare(s);
    if (got === want) return true;
    if (got.startsWith(`${want}:`)) return true;
    if (got.startsWith(`${want}-`) && /^(\d{8}|latest)/.test(got.slice(want.length + 1))) return true;
  }
  return false;
}

function vendorOf(id: string): string {
  const b = bare(id);
  const slash = b.indexOf('/');
  if (slash > 0) return b.slice(0, slash + 1);
  const m = /^[a-z]+(?:\.[a-z]+)*\./i.exec(b); // bedrock: eu.anthropic.
  if (m) return m[0];
  const t = /^[a-z]+/i.exec(b);
  return t ? t[0] : b;
}

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/**
 * #4475: the closest served ids of the same vendor (`anthropic/` for
 * anthropic/claude-sonnet-4, `claude` for claude-sonnet-4-5): the longest
 * common prefix first, then the newer-looking id (descending). Batch and
 * other variant ids (`:batch`) are left out. At most `max` ids.
 */
export function servedAlternatives(model: string, served: readonly string[], max = 3): string[] {
  const vendor = vendorOf(model);
  const want = bare(model);
  return served
    .filter((s) => bare(s) !== want && !s.includes(':batch') && bare(s).startsWith(vendor))
    .sort((a, b) => commonPrefix(bare(b), want) - commonPrefix(bare(a), want) || (a < b ? 1 : a > b ? -1 : 0))
    .slice(0, max);
}

// ---------------------------------------------------------------------------
// Merge and persist
// ---------------------------------------------------------------------------

/**
 * Merge discovered models into the connector's catalogue. Curated entries
 * (written by hand or bundled) are never replaced: their fields win, a
 * missing cost or context window is filled from discovery, and `served`
 * records whether the platform listed them. Entries a previous discovery
 * added (`discovered: true`) are replaced by the new list, so a model the
 * platform stopped serving goes. Curated entries keep their order and come
 * first; discovered entries follow, sorted by id. `models.discovered_at`
 * records the time.
 */
export function mergeDiscoveredModels(file: ConnectorFile, discovered: DiscoveredModel[], now: Date = new Date()): ConnectorFile {
  const servedIds = discovered.map((d) => d.id);
  const byId = new Map(discovered.map((d) => [d.id, d] as const));
  const curated: ConnectorModelEntry[] = [];
  const curatedIds = new Set<string>();
  for (const m of file.connector.models.catalogue ?? []) {
    if (m.discovered) continue;
    const d = byId.get(m.id);
    const entry: ConnectorModelEntry = { ...m };
    if (d) {
      if (!entry.cost && d.cost) entry.cost = d.cost;
      if (!entry.context_window && d.context_window) entry.context_window = d.context_window;
    }
    const served = isModelServed(m.id, servedIds);
    if (served === undefined) delete entry.served;
    else entry.served = served;
    curated.push(entry);
    curatedIds.add(m.id);
  }
  const added: ConnectorModelEntry[] = discovered
    .filter((d) => !curatedIds.has(d.id))
    .map((d) => ({
      id: d.id,
      ...(d.context_window ? { context_window: d.context_window } : {}),
      ...(d.cost ? { cost: d.cost } : {}),
      discovered: true,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const at = now.toISOString();
  return {
    ...file,
    connector: {
      ...file.connector,
      models: {
        ...file.connector.models,
        catalogue: [...curated, ...added],
        discovered_at: at,
      },
      meta: { ...(file.connector.meta ?? {}), fetched_at: at },
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
  // #3438: never drop an existing workspace connector's tls block
  // (reject_unauthorized / ca_bundle) when the refreshed file carries none.
  let tls = file.connector.tls;
  if (!tls && existsSync(outPath)) {
    try {
      const prev = parseConnectorYaml(readFileSync(outPath, 'utf-8'), outPath);
      if (prev.ok && prev.file.connector.tls) tls = prev.file.connector.tls;
    } catch { /* unreadable previous file -- nothing to preserve */ }
  }
  const withSource: ConnectorFile = {
    ...file,
    connector: {
      ...file.connector,
      ...(tls ? { tls } : {}),
      meta: { ...(file.connector.meta ?? {}), source: 'user' },
    },
  };
  writeFileSync(outPath, dumpYaml(withSource, { lineWidth: 120 }), 'utf-8');
  return outPath;
}

// ---------------------------------------------------------------------------
// One refresh for every picker and the CLI
// ---------------------------------------------------------------------------

/** #4475: the outcome of a model refresh, as the pickers and `swao llm models` show it. */
export interface ModelRefresh {
  /** live: read from the platform; catalogue: discovery failed; off: discovery turned off. */
  status: 'live' | 'catalogue' | 'off';
  /** The connector with the merged catalogue (unchanged unless live). */
  loaded: LoadedConnector;
  /** The ids the platform serves (live only). */
  servedIds: string[];
  reason?: DiscoveryFailure;
  error?: string;
  /** The workspace connector file written (live, with a workspace). */
  writtenPath?: string;
}

/**
 * #4475: read the served models of a connector and merge them into the
 * workspace connector file (the single source, no new config file). Never
 * throws. A seed the user has not edited stays updatable by
 * `swao llm-gateway update` (noteDiscoveryRewrite).
 */
export async function refreshConnectorModels(
  loaded: LoadedConnector,
  opts: { workspaceRoot?: string; timeoutMs?: number; awsCredentials?: AwsCredentialSource } = {},
): Promise<ModelRefresh> {
  const c = loaded.file.connector;
  if (!discoveryEnabled(c) || discoveryOffOnMachine()) return { status: 'off', loaded, servedIds: [], reason: 'off' };
  const r = await discoverModels(loaded, { timeoutMs: opts.timeoutMs ?? PICKER_DISCOVERY_TIMEOUT_MS, awsCredentials: opts.awsCredentials });
  if (!r.ok) return { status: 'catalogue', loaded, servedIds: [], reason: r.reason, error: r.error };
  const merged = mergeDiscoveredModels(loaded.file, r.models);
  let writtenPath: string | undefined;
  if (opts.workspaceRoot) {
    try {
      const dir = join(opts.workspaceRoot, 'wsp', 'inputs', 'llm-gateway');
      const target = join(dir, `${c.id}.yaml`);
      const prevHash = existsSync(target) ? fileSha256(target) : undefined;
      writtenPath = writeWorkspaceConnector(opts.workspaceRoot, merged);
      noteDiscoveryRewrite(dir, `${c.id}.yaml`, prevHash, writtenPath);
    } catch { /* unwritable workspace: the picker still shows the served list */ }
  }
  return {
    status: 'live',
    loaded: { ...loaded, file: merged, ...(writtenPath ? { path: writtenPath, origin: 'workspace' as const } : {}) },
    servedIds: r.models.map((m) => m.id),
    ...(writtenPath ? { writtenPath } : {}),
  };
}

/** #4475: the fallback line of a picker or the CLI when the list was not read live. */
export function discoveryFallbackText(refresh: Pick<ModelRefresh, 'status' | 'reason'>): string {
  if (refresh.status === 'off') {
    return discoveryOffOnMachine()
      ? 'Catalogue, not checked live: live discovery is turned off on this machine.'
      : 'Catalogue, not checked live: discovery is turned off for this connector.';
  }
  switch (refresh.reason) {
    case 'auth': return 'Catalogue, not checked live: the platform refused the model list (check the key in Setup).';
    case 'timeout': return 'Catalogue, not checked live: the platform did not answer within 5 seconds.';
    case 'unreachable': return 'Catalogue, not checked live: the platform is not reachable (offline or air-gapped).';
    default: return 'Catalogue, not checked live: the platform gave no model list.';
  }
}
