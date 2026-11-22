// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3572: the `otc` live driver (Design 120 sections 6.3, 6.4, 7.1 to 7.3).
// Driver 1 by owner decision Q-09; coded against the published OTC API
// reference and the partner hackathon recording of 2026-10-28 (Design 120
// section 3, a design reference only, Q-14). Every request goes through
// `ctx.http.fetch` (read-only allow-list, endpoint seam, recorder).
//
// Status rules per (region, service), Design 120 section 5.3:
// - endpoint of the service in the token catalogue of the region project
//   -> `enabled` (api evidence; inventory and price evidence added when seen)
// - no endpoint, but the Config / RMS provider directory or the price list
//   names the service in the region -> `unknown` (offered, not usable from
//   this project: open question in #3572, never guessed)
// - no endpoint and inventory or price list not collected -> `unknown`
// - absent from all three -> `not_offered`
// - token for the region refused -> `unknown` with the HTTP status
//
// Privacy (Design 120 section 6.4): resource names, user names, source IPs
// and request bodies are never copied into the scan; activity is aggregated
// counts only; raw responses exist only in the recording directory (outside
// the WSP, SWAO_LZ_RECORD).

import { providerLabel } from '@swao/core';
import type { LzLiveEvidence, LzLiveFactSource, LzLivePostureInput, LzLiveRegion, LzLiveRegionStatus, LzLiveScan, LzLiveService } from '@swao/core';
import type { ActivityWindow, LiveLzDriver, ReadOnlyProbe, ScopeCtx } from '../types.js';
import { LiveAuthError, LiveSourceUnavailableError } from '../errors.js';
import { LiveTokenRejectedError } from '../http.js';
import { flattenAttributes } from '../attributes.js';
import { OTC_DEFAULT_IAM, OTC_PROVIDER, OtcHttpError, iamBase, otcDomainToken, otcEndpoint, otcGet, otcToken, trimTrailingSlashes } from './otc-client.js';
import type { OtcToken } from './otc-client.js';
import { analyseRoles, probeFromRoles } from './otc-probe.js';
import { apigInTransit, backupFacts, elbInTransit, evsEncryption, exposureFacts, identityFacts, ingressRules, loggingTrails, rdsEncryption } from './otc-posture.js';
import type { RmsResource } from './otc-posture.js';
import { OTC_DEFAULT_EPS, listOtcHierarchy } from './otc-hierarchy.js';
import { OBS_ROUTE, obsAclPublic, obsDocument, obsEncryptionOf, obsGet, obsPolicyPublic, traceRetention } from './otc-obs.js';
import type { ObsSubresource } from './otc-obs.js';
import type { OtcRole } from './otc-probe.js';
import { OTC_DEFAULT_REGIONS, OTC_REGION_COUNTRY, OTC_SERVICES } from './otc-services.js';

type Estate = LzLiveScan['estate'];

export const OTC_DRIVER_VERSION = '0.1.0';
export const OTC_DEFAULT_PRICE = 'https://calculator.otc-service.com/en/open-telekom-price-api';
const MAX_PAGES = 100;

const now = (): string => new Date().toISOString();

function httpStatusOf(err: unknown): number | undefined {
  if (err instanceof OtcHttpError) return err.status;
  if (err instanceof LiveAuthError) return err.httpStatus;
  if (err instanceof LiveSourceUnavailableError) return err.httpStatus;
  return undefined;
}

/** Regions of the scope: `.swao.yml` regions, else the OTC default regions. */
export function otcRegions(ctx: ScopeCtx): string[] {
  return ctx.regions.length > 0 ? [...ctx.regions] : [...OTC_DEFAULT_REGIONS];
}

/** Project of a region: the scope target for an application scope, else the region project. */
function projectOf(ctx: ScopeCtx, region: string): string {
  return ctx.target['project'] ?? region;
}

/** First region whose token is issued; used for the tenant-wide calls (IAM, RMS). */
async function anyToken(ctx: ScopeCtx): Promise<OtcToken> {
  let last: unknown;
  for (const r of otcRegions(ctx)) {
    try {
      return await otcToken(ctx, projectOf(ctx, r));
    } catch (err) {
      if (!(err instanceof LiveAuthError)) throw err;
      last = err;
    }
  }
  throw last ?? new LiveAuthError(OTC_PROVIDER, 401, 'no region to authenticate against');
}

/**
 * #3750: a token refused on a read (http.ts LiveTokenRejectedError) is never a
 * per-source gap; it stops the run (Design 120 section 6.2). Token issue
 * failures stay per region (they are LiveAuthError from otcToken, not this).
 */
function failFast(err: unknown): void {
  if (err instanceof LiveTokenRejectedError) throw err;
}

function recordSource(ctx: ScopeCtx, name: string, err: unknown): void {
  failFast(err);
  const http = httpStatusOf(err);
  ctx.sources.push(http !== undefined
    ? { name, status: 'not_collected', http_status: http }
    : { name, status: 'not_collected', reason: err instanceof Error ? err.message : String(err) });
}

// ---------------------------------------------------------------------------
// Cached tenant-wide sources: RMS provider directory and public price list
// ---------------------------------------------------------------------------

type Collected<T> = { ok: true; value: T } | { ok: false; http?: number };

interface RmsProviders {
  resource_providers?: { provider?: string; resource_types?: { name?: string; global?: boolean; regions?: unknown[] }[] }[];
}

interface PriceRecord {
  key: string;
  id?: string;
  productName?: string;
  unit?: string;
  region?: string;
  priceAmount?: string;
  currency?: string;
}

const providerCache = new WeakMap<ScopeCtx, Promise<Collected<Map<string, Set<string>>>>>();
const priceCache = new WeakMap<ScopeCtx, Promise<Collected<PriceRecord[]>>>();

function cached<T>(cache: WeakMap<ScopeCtx, Promise<T>>, ctx: ScopeCtx, load: () => Promise<T>): Promise<T> {
  let p = cache.get(ctx);
  if (!p) {
    p = load();
    cache.set(ctx, p);
  }
  return p;
}

/** Config / RMS provider directory: provider -> regions (`*` = global type). */
function rmsProviders(ctx: ScopeCtx): Promise<Collected<Map<string, Set<string>>>> {
  return cached(providerCache, ctx, async () => {
    try {
      const token = await anyToken(ctx);
      const rms = otcEndpoint(token, ['rms'], otcRegions(ctx)[0] as string);
      if (!rms) throw new LiveSourceUnavailableError('inventory:providers', undefined, 'no Config (rms) endpoint in the token catalogue');
      // The global path /resource-manager/providers returns 404 on OTC; the
      // domain path is the working one (handover 03, "Inventory").
      const doc = await otcGet<RmsProviders>(ctx, token, `${rms}/resource-manager/domains/${token.domainId}/providers?locale=en-us`, '/v1/resource-manager/domains/{domain_id}/providers');
      const byCode = new Map<string, Set<string>>();
      for (const prov of doc.resource_providers ?? []) {
        if (!prov.provider) continue;
        const set = byCode.get(prov.provider) ?? new Set<string>();
        for (const t of prov.resource_types ?? []) {
          if (t.global === true) set.add('*');
          for (const r of t.regions ?? []) if (typeof r === 'string') set.add(r);
        }
        byCode.set(prov.provider, set);
      }
      ctx.sources.push({ name: 'inventory:providers', status: 'ok' });
      return { ok: true, value: byCode };
    } catch (err) {
      if (err instanceof LiveAuthError) throw err;
      recordSource(ctx, 'inventory:providers', err);
      return { ok: false, http: httpStatusOf(err) };
    }
  });
}

/** "0.051175 EUR" (en) or "0,051175 EUR" (de) -> 0.051175 (handover 03, price list). */
export function parseOtcAmount(text: string | undefined): number | undefined {
  const num = String(text ?? '').trim().split(/\s+/)[0] ?? '';
  const norm = num.includes(',') ? num.replace(/\./g, '').replace(',', '.') : num;
  const v = Number(norm);
  return norm !== '' && Number.isFinite(v) ? v : undefined;
}

/** Public price list (no login): `response.result` keyed by product key. */
function priceList(ctx: ScopeCtx): Promise<Collected<PriceRecord[]>> {
  return cached(priceCache, ctx, async () => {
    try {
      const base = trimTrailingSlashes(ctx.http.baseUrls['price'] ?? OTC_DEFAULT_PRICE);
      const res = await ctx.http.fetch(`${base}/?limitMax=10000`, { method: 'GET', headers: { accept: 'application/json' } });
      const text = await res.text();
      if (!res.ok) throw new OtcHttpError(res.status, '/open-telekom-price-api/');
      const doc = JSON.parse(text) as { response?: { result?: Record<string, unknown> } };
      const records: PriceRecord[] = [];
      for (const [key, list] of Object.entries(doc.response?.result ?? {})) {
        for (const r of Array.isArray(list) ? list as Omit<PriceRecord, 'key'>[] : []) records.push({ ...r, key });
      }
      ctx.sources.push({ name: 'price', status: 'ok' });
      return { ok: true, value: records };
    } catch (err) {
      recordSource(ctx, 'price', err);
      return { ok: false, http: httpStatusOf(err) };
    }
  });
}

// ---------------------------------------------------------------------------
// probeReadOnly
// ---------------------------------------------------------------------------

function unverifiable(token: OtcToken, reason: string, identity?: string): ReadOnlyProbe {
  return {
    read_only: 'unverifiable',
    identity: identity ?? `roles: ${token.roles.join(', ') || 'none'}`,
    reason,
    write_actions_allowed: [],
    coverage: { readable: [], unreadable: [] },
  };
}

async function probeReadOnly(ctx: ScopeCtx): Promise<ReadOnlyProbe> {
  // IAM permission queries need a domain-scoped token (otc-client.ts).
  const token = await otcDomainToken(ctx);
  const iam = iamBase(ctx);
  // #3685: an AK/SK session knows its user only for a permanent key
  // (OS-CREDENTIAL lookup); a temporary key has no lookup, so the role set
  // cannot be read and the probe says so.
  if (token.userId === '') {
    return unverifiable(token, 'the user of the access key cannot be resolved (a temporary AK/SK has no credential lookup); the role assignments are not readable', 'access key');
  }
  let groups: { id?: string; name?: string }[];
  try {
    groups = (await otcGet<{ groups?: { id?: string; name?: string }[] }>(ctx, token, `${iam}/users/${token.userId}/groups`, '/v3/users/{user_id}/groups')).groups ?? [];
  } catch (err) {
    failFast(err);
    return unverifiable(token, `the identity cannot read its own user groups (HTTP ${httpStatusOf(err) ?? 'error'})`);
  }
  // Group names, never the user name, label the identity (Design 120 section 6.4).
  const identity = groups.length > 0 ? `groups: ${groups.map((g) => g.name ?? g.id ?? '?').join(', ')}` : `roles: ${token.roles.join(', ') || 'none'}`;
  const projectIds = new Set<string>();
  for (const r of otcRegions(ctx)) {
    try {
      const id = (await otcToken(ctx, projectOf(ctx, r))).projectId;
      if (id !== '') projectIds.add(id);
    } catch (err) {
      if (!(err instanceof LiveAuthError)) throw err;
    }
  }
  const roles: OtcRole[] = [];
  for (const g of groups) {
    if (!g.id) continue;
    const queries: [string, string][] = [
      [`${iam}/domains/${token.domainId}/groups/${g.id}/roles`, '/v3/domains/{domain_id}/groups/{group_id}/roles'],
      [`${iam}/OS-INHERIT/domains/${token.domainId}/groups/${g.id}/roles/inherited_to_projects`, '/v3/OS-INHERIT/domains/{domain_id}/groups/{group_id}/roles/inherited_to_projects'],
      ...[...projectIds].map((pid): [string, string] => [`${iam}/projects/${pid}/groups/${g.id}/roles`, '/v3/projects/{project_id}/groups/{group_id}/roles']),
    ];
    for (const [url, route] of queries) {
      try {
        roles.push(...((await otcGet<{ roles?: OtcRole[] }>(ctx, token, url, route)).roles ?? []));
      } catch (err) {
        failFast(err);
        return unverifiable(token, `the role assignments of the user groups are not readable (HTTP ${httpStatusOf(err) ?? 'error'} on ${route}); the ${providerLabel('otc', 'full')} role queries need the Security Administrator permission`, identity);
      }
    }
  }
  return probeFromRoles(identity, roles);
}

// ---------------------------------------------------------------------------
// Offering
// ---------------------------------------------------------------------------

async function listRegions(ctx: ScopeCtx): Promise<LzLiveRegion[]> {
  const out: LzLiveRegion[] = [];
  let lastAuth: LiveAuthError | undefined;
  let authFailures = 0;
  for (const id of otcRegions(ctx)) {
    const country = OTC_REGION_COUNTRY[id];
    let token: OtcToken;
    try {
      token = await otcToken(ctx, projectOf(ctx, id));
    } catch (err) {
      if (!(err instanceof LiveAuthError)) throw err;
      authFailures++;
      lastAuth = err;
      recordSource(ctx, `token:${id}`, err);
      out.push({ id, ...(country ? { country } : {}), azs: [], status: 'unknown' });
      continue;
    }
    const azs: LzLiveRegion['azs'] = [];
    const compute = otcEndpoint(token, ['compute'], id);
    if (compute) {
      try {
        const doc = await otcGet<{ availabilityZoneInfo?: { zoneName?: string; zoneState?: { available?: boolean } }[] }>(ctx, token, `${compute}/os-availability-zone`, '/v2.1/{project_id}/os-availability-zone');
        for (const z of doc.availabilityZoneInfo ?? []) if (z.zoneName) azs.push({ name: z.zoneName, available: z.zoneState?.available === true });
      } catch (err) {
        recordSource(ctx, `azs:${id}`, err);
      }
    } else {
      ctx.sources.push({ name: `azs:${id}`, status: 'not_collected', reason: 'no compute endpoint in the token catalogue' });
    }
    out.push({ id, ...(country ? { country } : {}), azs, status: 'enabled' });
  }
  // Every region refused the login: the credential itself is wrong, stop.
  if (lastAuth && authFailures === out.length) throw lastAuth;
  return out;
}

async function listServices(ctx: ScopeCtx, region: string): Promise<LzLiveService[]> {
  const observed_at = now();
  let token: OtcToken | undefined;
  let tokenStatus: number | undefined;
  try {
    token = await otcToken(ctx, projectOf(ctx, region));
  } catch (err) {
    if (!(err instanceof LiveAuthError)) throw err;
    tokenStatus = err.httpStatus;
  }
  const inventory: Collected<Map<string, Set<string>>> = token ? await rmsProviders(ctx) : { ok: false };
  const prices: Collected<PriceRecord[]> = token ? await priceList(ctx) : { ok: false };
  return OTC_SERVICES.map((s): LzLiveService => {
    let st: LzLiveRegionStatus;
    if (!token) {
      st = { status: 'unknown', evidence: [{ source: 'api', ref: 'iam:/v3/auth/tokens', ...(tokenStatus !== undefined ? { http_status: tokenStatus } : {}) }], observed_at };
    } else {
      const evidence: LzLiveEvidence[] = [];
      const t = token;
      const type = s.catalogTypes.find((ct) => otcEndpoint(t, [ct], region) !== undefined);
      if (type) evidence.push({ source: 'api', ref: `token-catalogue:${type}` });
      if (inventory.ok) {
        const regions = inventory.value.get(s.code);
        if (regions && (regions.has(region) || regions.has('*'))) evidence.push({ source: 'inventory', ref: `rms-providers:${s.code}` });
      }
      if (prices.ok && prices.value.some((r) => s.priceKeys.includes(r.key) && r.region === region)) {
        evidence.push({ source: 'price', ref: `price-list:${s.priceKeys.join('|')}` });
      }
      if (type) {
        st = { status: 'enabled', evidence, observed_at };
      } else if (evidence.length > 0) {
        st = { status: 'unknown', evidence, observed_at };
      } else if (!inventory.ok || !prices.ok) {
        const gaps: LzLiveEvidence[] = [];
        if (!inventory.ok) gaps.push({ source: 'inventory', ref: 'rms-providers', ...(inventory.http !== undefined ? { http_status: inventory.http } : {}) });
        if (!prices.ok) gaps.push({ source: 'price', ref: 'price-list', ...(prices.http !== undefined ? { http_status: prices.http } : {}) });
        st = { status: 'unknown', evidence: gaps, observed_at };
      } else {
        st = { status: 'not_offered', evidence: [{ source: 'api', ref: `token-catalogue:${region}` }], observed_at };
      }
    }
    return {
      code: s.code,
      name: s.catalogueCode,
      capability_tags: [...s.tags],
      catalogue_code: s.catalogueCode,
      regions: { [region]: st },
      frameworks: {},
    };
  });
}

// ---------------------------------------------------------------------------
// Estate
// ---------------------------------------------------------------------------

interface RmsResourcesPage {
  resources?: RmsResource[];
  page_info?: { next_marker?: string | null };
}

/** RMS resource fields mapped into normalised fields (the rest goes into `attributes`, #3886). */
export const OTC_RMS_NORMALISED_KEYS: readonly string[] = ['id', 'provider', 'type', 'region_id', 'tags', 'created'];

/** RMS `all-resources` of the scope, read once per scope run and shared by the inventory and the posture (#3865). */
interface RmsRead { resources: RmsResource[]; truncated: boolean }
const rmsCache = new WeakMap<ScopeCtx, Promise<RmsRead>>();

function rmsResources(ctx: ScopeCtx): Promise<RmsRead> {
  return cached(rmsCache, ctx, async () => {
    const token = await anyToken(ctx);
    const rms = otcEndpoint(token, ['rms'], otcRegions(ctx)[0] as string);
    if (!rms) throw new LiveSourceUnavailableError('inventory:resources', undefined, 'no Config (rms) endpoint in the token catalogue');
    const appProject = ctx.target['project'] !== undefined && ctx.target['project'] !== '' ? token.projectId : undefined;
    const out: RmsResource[] = [];
    let marker: string | null | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = `${rms}/resource-manager/domains/${token.domainId}/all-resources?limit=200${marker ? `&marker=${encodeURIComponent(marker)}` : ''}`;
      let doc: RmsResourcesPage;
      try {
        doc = await otcGet<RmsResourcesPage>(ctx, token, url, '/v1/resource-manager/domains/{domain_id}/all-resources');
      } catch (err) {
        failFast(err);
        throw new LiveSourceUnavailableError('inventory:resources', httpStatusOf(err));
      }
      for (const r of doc.resources ?? []) {
        if (!r.id || !r.provider || !r.type) continue;
        // #3752: RMS lists the whole account. An application scope (target.project)
        // keeps the resources of its project only (every RMS resource carries
        // project_id, empty for global ones; live 2026-11-04), so the scope merge
        // marks them seen by the platform and the application scope.
        if (appProject !== undefined && r.project_id !== appProject) continue;
        out.push(r);
      }
      marker = doc.page_info?.next_marker;
      if (!marker) return { resources: out, truncated: false };
    }
    return { resources: out, truncated: true };
  });
}

async function listResources(ctx: ScopeCtx): Promise<Estate['resources']> {
  const read = await rmsResources(ctx);
  if (read.truncated) ctx.sources.push({ name: 'inventory:resources', status: 'not_collected', reason: `stopped after ${MAX_PAGES} pages` });
  return read.resources.map((r) => {
    const tags = r.tags !== null && typeof r.tags === 'object'
      ? Object.fromEntries(Object.entries(r.tags as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
      : {};
    // #3886 (Design 123 section 5.7): every other returned property (RMS
    // top-level fields and the service `properties` object) goes into
    // `attributes`. Names, people, free text and secret-shaped keys (IAM
    // user `credentials` hold access key ids, handover 03 "Inventory") are
    // handled by the one privacy filter in the scan assembler (scan.ts).
    const attributes = flattenAttributes(r, { omit: OTC_RMS_NORMALISED_KEYS });
    return {
      id: r.id as string,
      type: `${r.provider}.${r.type}`,
      service_code: r.provider as string,
      ...(r.region_id ? { region: r.region_id } : {}),
      ...(Object.keys(tags).length > 0 ? { tags } : {}),
      ...(typeof r.created === 'string' && r.created !== '' ? { created_at: r.created } : {}),
      ...(attributes ? { attributes } : {}),
    };
  });
}

interface CtsTracker {
  tracker_name?: string;
  tracker_type?: string;
  status?: string;
  is_support_validate?: boolean;
  is_lts_enabled?: boolean;
  lts?: { is_lts_enabled?: boolean };
}

/** Run `fn` with the token and CTS endpoint of every region; returns the number of regions collected. */
async function eachCtsRegion(ctx: ScopeCtx, sourcePrefix: string, fn: (token: OtcToken, cts: string, region: string) => Promise<void>): Promise<{ collected: number; lastErr: unknown }> {
  let collected = 0;
  let lastErr: unknown;
  for (const region of otcRegions(ctx)) {
    let token: OtcToken;
    try {
      token = await otcToken(ctx, projectOf(ctx, region));
    } catch (err) {
      if (!(err instanceof LiveAuthError)) throw err;
      lastErr = err;
      continue;
    }
    const cts = otcEndpoint(token, ['ctsv3'], region);
    if (!cts) {
      ctx.sources.push({ name: `${sourcePrefix}:${region}`, status: 'not_collected', reason: 'no ctsv3 endpoint in the token catalogue' });
      continue;
    }
    try {
      await fn(token, cts, region);
      collected++;
    } catch (err) {
      lastErr = err;
      recordSource(ctx, `${sourcePrefix}:${region}`, err);
    }
  }
  return { collected, lastErr };
}

async function listGuardrails(ctx: ScopeCtx): Promise<Estate['guardrails']> {
  const out: Estate['guardrails'] = [];
  const r = await eachCtsRegion(ctx, 'guardrails:cts', async (token, cts, region) => {
    const doc = await otcGet<{ trackers?: CtsTracker[] }>(ctx, token, `${cts}/trackers`, '/v3/{project_id}/trackers');
    const system = (doc.trackers ?? []).filter((t) => t.tracker_type === 'system');
    if (system.length === 0) out.push({ type: 'cts-tracker', id: region, status: 'fail', detail: 'no system tracker' });
    for (const t of system) {
      const lts = t.lts?.is_lts_enabled === true || t.is_lts_enabled === true;
      out.push({
        type: 'cts-tracker',
        id: `${region}/${t.tracker_name ?? 'system'}`,
        status: t.status === 'enabled' ? 'pass' : 'fail',
        detail: `status ${t.status ?? 'unknown'}, integrity check ${t.is_support_validate === true ? 'on' : 'off'}, forwarded to LTS ${lts ? 'yes' : 'no'}`,
      });
    }
  });
  if (r.collected === 0) throw new LiveSourceUnavailableError('guardrails', httpStatusOf(r.lastErr), r.lastErr === undefined ? 'no region with a ctsv3 endpoint' : undefined);
  return out;
}

async function listQuotas(_ctx: ScopeCtx, region: string): Promise<Estate['quotas']> {
  throw new LiveSourceUnavailableError(`quotas:${region}`, undefined, `no ${providerLabel('otc', 'full')} quota API verified yet (open question in #3572)`);
}

/** Trace classification of the partner reference (handover 03, "Audit trail"). */
export function classifyTrace(action: string | undefined, readOnly: unknown): string {
  const a = (action ?? '').toLowerCase();
  if (a.includes('login') || a === 'logout') return 'login';
  if (readOnly === true || /^(list|get|query|show|describe|head)/.test(a)) return 'read';
  if (/^(create|add|put|post|register|attach|bind|associate|import|upload|set)/.test(a)) return 'create';
  if (/^(delete|remove|detach|unbind|disassociate|unregister)/.test(a)) return 'delete';
  return 'change';
}

interface CtsTracesPage {
  traces?: { trace_name?: string; read_only?: unknown }[];
  meta_data?: { marker?: string | null };
}

async function listActivity(ctx: ScopeCtx, window: ActivityWindow): Promise<NonNullable<Estate['activity_summary']>> {
  const to = Date.now();
  const from = to - window.days * 86_400_000;
  const by_kind: Record<string, number> = {};
  let total = 0;
  const r = await eachCtsRegion(ctx, 'activity', async (token, cts) => {
    let marker: string | null | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      // Epoch milliseconds; paging via meta_data.marker -> next (handover 03).
      const url = `${cts}/traces?trace_type=system&limit=200&from=${from}&to=${to}${marker ? `&next=${encodeURIComponent(marker)}` : ''}`;
      const doc = await otcGet<CtsTracesPage>(ctx, token, url, '/v3/{project_id}/traces');
      // Counted only: user, source_ip, request and response stay out (section 6.4).
      for (const t of doc.traces ?? []) {
        const kind = classifyTrace(t.trace_name, t.read_only);
        by_kind[kind] = (by_kind[kind] ?? 0) + 1;
        total++;
      }
      marker = doc.meta_data?.marker;
      if (!marker) return;
    }
  });
  if (r.collected === 0) throw new LiveSourceUnavailableError('activity', httpStatusOf(r.lastErr), r.lastErr === undefined ? 'no region with a ctsv3 endpoint' : undefined);
  return { window_days: window.days, events_total: total, by_kind };
}

export interface OtcPrice {
  key: string;
  sku?: string;
  name?: string;
  unit?: string;
  amount?: number;
  currency?: string;
}

async function listPrices(ctx: ScopeCtx, region: string): Promise<OtcPrice[]> {
  const list = await priceList(ctx);
  if (!list.ok) throw new LiveSourceUnavailableError('price', list.http);
  return list.value.filter((r) => r.region === region).map((r) => {
    const amount = parseOtcAmount(r.priceAmount);
    return {
      key: r.key,
      ...(r.id ? { sku: r.id } : {}),
      ...(r.productName ? { name: r.productName } : {}),
      ...(r.unit ? { unit: r.unit } : {}),
      ...(amount !== undefined ? { amount } : {}),
      ...(r.currency ? { currency: r.currency } : {}),
    };
  });
}

// ---------------------------------------------------------------------------
// #3865: posture (Design 123 section 5.4, OTC table; estate.posture of #3864)
// ---------------------------------------------------------------------------

export const OTC_POSTURE_ROUTES = {
  rms: '/v1/resource-manager/domains/{domain_id}/all-resources',
  rds: '/v3/{project_id}/instances',
  elb: '/v3/{project_id}/elb/listeners',
  trackers: '/v3/{project_id}/trackers',
  vaults: '/v3/{project_id}/vaults',
  policies: '/v3/{project_id}/policies',
  // #3954: API Gateway (dedicated instance) API groups and APIs.
  apigGroups: '/v2/{project_id}/apigw/instances/{instance_id}/api-groups',
  apigApis: '/v2/{project_id}/apigw/instances/{instance_id}/apis',
  domainRoles: '/v3/domains/{domain_id}/groups/{group_id}/roles',
  inheritedRoles: '/v3/OS-INHERIT/domains/{domain_id}/groups/{group_id}/roles/inherited_to_projects',
} as const;

type Doc = Record<string, unknown>;
type ExposureItem = NonNullable<LzLivePostureInput['exposure']>['items'] extends (infer T)[] | undefined ? T : never;

const obsBase = (b: RmsResource): { resource_id: string; type: string; service_code: string; region?: string } => ({
  resource_id: b.id as string,
  type: 'obs.buckets',
  service_code: 'obs',
  ...(b.region_id ? { region: b.region_id } : {}),
});

/** The first failure of the OBS reads as an error for another block's source. */
function obsFailure(reads: BlockReads): Error {
  return reads.http !== undefined ? new OtcHttpError(reads.http, OBS_ROUTE) : new Error(reads.reason ?? 'OBS bucket reads not collected');
}

/** Outcome of one block's reads: the calls made, whether a part failed, and the first failure. */
class BlockReads {
  readonly calls = new Set<string>();
  ok = 0;
  failed = 0;
  http: number | undefined;
  reason: string | undefined;
  success(route: string): void {
    this.calls.add(route);
    this.ok++;
  }
  failure(route: string, err: unknown): void {
    failFast(err);
    this.calls.add(route);
    this.failed++;
    if (this.http === undefined && this.reason === undefined) {
      this.http = httpStatusOf(err);
      if (this.http === undefined) this.reason = err instanceof Error ? err.message : String(err);
    }
  }
  gap(route: string, reason: string): void {
    this.calls.add(route);
    this.failed++;
    if (this.http === undefined && this.reason === undefined) this.reason = reason;
  }
  source(): LzLiveFactSource {
    const calls = [...this.calls].sort();
    if (this.ok === 0) return { calls: calls.length > 0 ? calls : ['none'], partial: false, status: 'not_collected', ...(this.http !== undefined ? { http_status: this.http } : { reason: this.reason ?? 'not collected' }) };
    return { calls, partial: this.failed > 0, status: 'ok' };
  }
}

/** Run `fetchAll` with the token and endpoint of every region project; a region that fails is a partial read. */
async function eachRegionList(
  ctx: ScopeCtx,
  types: readonly string[],
  route: string,
  reads: BlockReads,
  fetchAll: (token: OtcToken, base: string, region: string) => Promise<void>,
): Promise<void> {
  for (const region of otcRegions(ctx)) {
    let token: OtcToken;
    try {
      token = await otcToken(ctx, projectOf(ctx, region));
    } catch (err) {
      if (!(err instanceof LiveAuthError)) throw err;
      reads.failure(route, err);
      continue;
    }
    const base = otcEndpoint(token, types, region);
    if (!base) {
      reads.gap(route, `no ${types.join(' / ')} endpoint in the token catalogue of ${region}`);
      continue;
    }
    try {
      await fetchAll(token, base, region);
      reads.success(route);
    } catch (err) {
      reads.failure(route, err);
    }
  }
}

const docList = (v: unknown): Doc[] => (Array.isArray(v) ? v.filter((x): x is Doc => x !== null && typeof x === 'object') : []);
const rmsGap = (r: BlockReads): LiveSourceUnavailableError => new LiveSourceUnavailableError('inventory:resources', r.http, r.reason);

async function listPosture(ctx: ScopeCtx): Promise<LzLivePostureInput> {
  const R = OTC_POSTURE_ROUTES;
  // RMS: EVS encryption, exposure, ingress rules, IAM users and the stateful resources (one shared read).
  const rmsReads = new BlockReads();
  let resources: RmsResource[] = [];
  try {
    const read = await rmsResources(ctx);
    resources = read.resources;
    rmsReads.success(R.rms);
    if (read.truncated) rmsReads.gap(R.rms, `stopped after ${MAX_PAGES} pages`);
  } catch (err) {
    rmsReads.failure(R.rms, err);
  }
  const rmsOk = rmsReads.ok > 0;
  const withRms = (reads: BlockReads): void => {
    if (rmsOk) reads.success(R.rms);
    else reads.failure(R.rms, rmsGap(rmsReads));
  };

  // Encryption: EVS (RMS), RDS v3 instances (at rest), ELB v3 listeners (in transit).
  const enc = new BlockReads();
  withRms(enc);
  const encryption = [...evsEncryption(resources)];
  await eachRegionList(ctx, ['rdsv3'], R.rds, enc, async (token, base, region) => {
    for (let page = 0, offset = 0; page < MAX_PAGES; page++) {
      const doc = await otcGet<{ instances?: unknown; total_count?: number }>(ctx, token, `${base}/instances?offset=${offset}&limit=100`, R.rds);
      const list = docList(doc.instances);
      encryption.push(...rdsEncryption(list, region));
      offset += list.length;
      if (list.length === 0 || offset >= (doc.total_count ?? 0)) return;
    }
  });
  await eachRegionList(ctx, ['elbv3'], R.elb, enc, async (token, base, region) => {
    let marker: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const doc = await otcGet<{ listeners?: unknown; page_info?: { next_marker?: string | null } }>(ctx, token, `${base}/elb/listeners?limit=200${marker ? `&marker=${encodeURIComponent(marker)}` : ''}`, R.elb);
      encryption.push(...elbInTransit(docList(doc.listeners), region));
      marker = doc.page_info?.next_marker ?? undefined;
      if (!marker) return;
    }
  });

  // #3954: API Gateway dedicated instances (RMS `apig.instances`): APIs and API groups of each instance.
  const gateways = resources.filter((r) => r.provider === 'apig' && r.type === 'instances' && typeof r.id === 'string');
  for (const gw of gateways) {
    const region = gw.region_id ?? otcRegions(ctx)[0] ?? 'eu-de';
    try {
      const token = await otcToken(ctx, projectOf(ctx, region));
      const base = otcEndpoint(token, ['apigv2', 'apig'], region);
      if (!base) {
        enc.gap(R.apigApis, `no apigv2 endpoint in the token catalogue of ${region}`);
        continue;
      }
      const inst = `${base}/apigw/instances/${encodeURIComponent(gw.id as string)}`;
      const list = async (path: string, key: string, route: string): Promise<Doc[]> => {
        const out: Doc[] = [];
        for (let page = 0, offset = 0; page < MAX_PAGES; page++) {
          const doc = await otcGet<Record<string, unknown>>(ctx, token, `${inst}/${path}?offset=${offset}&limit=500`, route);
          const items = docList(doc[key]);
          out.push(...items);
          offset += items.length;
          const total = typeof doc['total'] === 'number' ? doc['total'] : 0;
          if (items.length === 0 || offset >= total) break;
        }
        return out;
      };
      const groups = await list('api-groups', 'groups', R.apigGroups);
      enc.success(R.apigGroups);
      const apis = await list('apis', 'apis', R.apigApis);
      enc.success(R.apigApis);
      encryption.push(...apigInTransit(apis, groups, region, { id: gw.id as string }));
    } catch (err) {
      enc.failure(R.apigApis, err);
    }
  }

  // Identity: IAM users from RMS; privileged groups from the domain role queries
  // (they need the Security Administrator permission, ROLES.md).
  const idReads = new BlockReads();
  withRms(idReads);
  let privilegedGroups: Set<string> | undefined;
  if (rmsOk) {
    const groupIds = new Set<string>();
    for (const r of resources) {
      if (r.provider !== 'iam') continue;
      if (r.type === 'groups' && typeof r.id === 'string') groupIds.add(r.id);
      const gl = (r.properties as { group_list?: unknown } | undefined)?.group_list;
      if (r.type === 'users' && Array.isArray(gl)) for (const g of gl) if (typeof g === 'string') groupIds.add(g);
    }
    try {
      const token = await otcDomainToken(ctx);
      const iam = iamBase(ctx);
      const found = new Set<string>();
      for (const g of [...groupIds].sort()) {
        const roles: OtcRole[] = [];
        for (const [url, route] of [
          [`${iam}/domains/${token.domainId}/groups/${g}/roles`, R.domainRoles],
          [`${iam}/OS-INHERIT/domains/${token.domainId}/groups/${g}/roles/inherited_to_projects`, R.inheritedRoles],
        ] as const) {
          roles.push(...((await otcGet<{ roles?: OtcRole[] }>(ctx, token, url, route)).roles ?? []));
          idReads.calls.add(route);
        }
        if (analyseRoles(roles).writeActions.length > 0) found.add(g);
      }
      privilegedGroups = found;
    } catch (err) {
      idReads.failure(R.domainRoles, err);
    }
  }

  // Logging: CTS trackers per region (the guardrail read; here with the OBS transfer lifecycle).
  const logReads = new BlockReads();
  const trails: NonNullable<NonNullable<LzLivePostureInput['logging']>['trails']> = [];
  const traceBuckets: { trail: number; bucket: string; prefix?: string }[] = [];
  await eachRegionList(ctx, ['ctsv3'], R.trackers, logReads, async (token, base, region) => {
    const doc = await otcGet<{ trackers?: unknown }>(ctx, token, `${base}/trackers`, R.trackers);
    const list = docList(doc.trackers);
    list.forEach((t, i) => {
      const obs = (t['obs_info'] ?? {}) as Doc;
      const bucket = obs['bucket_name'];
      const prefix = obs['file_prefix_name'];
      if (typeof bucket === 'string' && bucket !== '') {
        traceBuckets.push({ trail: trails.length + i, bucket, ...(typeof prefix === 'string' && prefix !== '' ? { prefix } : {}) });
      }
    });
    trails.push(...loggingTrails(list, region));
  });

  // #3951 OBS: bucket encryption and public access of every RMS bucket, the lifecycle of the trace buckets.
  const obsReads = new BlockReads();
  const storage: ExposureItem[] = [];
  const firstRegion = otcRegions(ctx)[0] ?? 'eu-de';
  const buckets = resources.filter((r) => r.provider === 'obs' && r.type === 'buckets' && typeof r.id === 'string');
  // The RMS name of a bucket is the bucket name (live 2026-11-06: id and name equal for all 19 buckets).
  const bucketName = (b: RmsResource): string => (typeof b['name'] === 'string' && b['name'] !== '' ? b['name'] : b.id as string);
  const regionOfBucket = new Map(buckets.map((b) => [bucketName(b), b.region_id ?? firstRegion] as const));
  const obsRead = async (bucket: string, sub: ObsSubresource): Promise<string | null | undefined> => {
    const region = regionOfBucket.get(bucket) ?? firstRegion;
    try {
      const doc = obsDocument(sub, await obsGet(ctx, await otcToken(ctx, projectOf(ctx, region)), region, bucket, sub));
      if (doc instanceof OtcHttpError) throw doc;
      obsReads.success(OBS_ROUTE);
      return doc;
    } catch (err) {
      obsReads.failure(OBS_ROUTE, err);
      return undefined;
    }
  };
  for (const b of buckets) {
    const id = bucketName(b);
    const sse = await obsRead(id, 'encryption');
    if (sse !== undefined) {
      const e = obsEncryptionOf(sse);
      encryption.push({ ...obsBase(b), layer: 'at_rest', encrypted: e.encrypted, ...(e.keyId ? { key_id: e.keyId } : {}), ...(e.algorithm ? { attributes: { sse_algorithm: e.algorithm } } : {}) });
    }
    const acl = await obsRead(id, 'acl');
    const policy = acl === undefined ? undefined : await obsRead(id, 'policy');
    const policyPublic = policy === undefined ? undefined : obsPolicyPublic(policy);
    if (acl !== undefined && acl !== null && policyPublic !== undefined) {
      const aclPublic = obsAclPublic(acl);
      storage.push({ ...obsBase(b), exposure: 'public_storage', public: aclPublic || policyPublic, attributes: { public_acl: aclPublic, public_policy: policyPublic } });
    }
  }
  for (const t of traceBuckets) {
    const trail = trails[t.trail];
    if (!regionOfBucket.has(t.bucket)) regionOfBucket.set(t.bucket, trail?.region ?? firstRegion);
    const lifecycle = await obsRead(t.bucket, 'lifecycle');
    if (lifecycle === undefined) {
      logReads.failure(OBS_ROUTE, obsFailure(obsReads));
      continue;
    }
    logReads.calls.add(OBS_ROUTE);
    if (trail === undefined || trail.retention_days !== undefined) continue;
    const r = traceRetention(lifecycle, t.prefix);
    if (r.days !== undefined) trail.retention_days = r.days;
    else trail.attributes = { ...(trail.attributes ?? {}), log_retention: 'never_expires' };
  }
  // A bucket read refused leaves the bucket uncovered (a named gap) and the block partial.
  if (buckets.length > 0) {
    if (obsReads.ok > 0) enc.success(OBS_ROUTE);
    if (obsReads.failed > 0) enc.failure(OBS_ROUTE, obsFailure(obsReads));
  }

  // Backup: CBR vaults and policies per region; the stateful resources from RMS.
  const bkReads = new BlockReads();
  const vaults: Doc[] = [];
  const policies: Doc[] = [];
  await eachRegionList(ctx, ['cbr'], R.vaults, bkReads, async (token, base) => {
    for (let page = 0, offset = 0; page < MAX_PAGES; page++) {
      const doc = await otcGet<{ vaults?: unknown; count?: number }>(ctx, token, `${base}/vaults?offset=${offset}&limit=1000`, R.vaults);
      const list = docList(doc.vaults);
      vaults.push(...list);
      offset += list.length;
      if (list.length === 0 || offset >= (doc.count ?? 0)) return;
    }
  });
  await eachRegionList(ctx, ['cbr'], R.policies, bkReads, async (token, base) => {
    const doc = await otcGet<{ policies?: unknown }>(ctx, token, `${base}/policies`, R.policies);
    policies.push(...docList(doc.policies));
  });
  // CBR not readable at all: the block says so with CBR's status, whatever RMS answered.
  const cbrSource = bkReads.ok > 0 ? undefined : bkReads.source();
  withRms(bkReads);

  const rmsSource = rmsReads.source();
  // #3951: the bucket reads join the exposure source; a refused bucket read makes it partial.
  const expReads = new BlockReads();
  withRms(expReads);
  if (buckets.length > 0) {
    if (storage.length > 0) expReads.success(OBS_ROUTE);
    if (storage.length < buckets.length) expReads.failure(OBS_ROUTE, obsFailure(obsReads));
  }
  return {
    encryption: { source: enc.source(), items: encryption },
    exposure: { source: rmsOk ? expReads.source() : rmsSource, items: [...exposureFacts(resources), ...storage] },
    ingress_rules: { source: rmsSource, items: ingressRules(resources) },
    identity: { source: idReads.source(), ...identityFacts({ users: resources, privilegedGroups, now: Date.now() }) },
    logging: { source: logReads.source(), trails },
    backup: { source: cbrSource ?? bkReads.source(), items: cbrSource === undefined ? backupFacts(resources, vaults, policies) : [] },
  };
}

export const otcDriver: LiveLzDriver = {
  provider: OTC_PROVIDER,
  driverVersion: OTC_DRIVER_VERSION,
  // #3685: `aksk` signs every request with the access key (otc-sign.ts); an
  // optional `session-token` makes it a temporary key (X-Security-Token).
  authMethods: [
    { id: 'iam-password-token', required: ['username', 'password', 'domain'], optional: [], unattended: true },
    { id: 'aksk', required: ['access-key-id', 'secret-access-key'], optional: ['session-token'], unattended: true },
  ],
  // #3881: `eps` is the Enterprise Project service, read with the domain-scoped token; its host is regional (eu-de, live 2026-11-05).
  defaultBaseUrls: { iam: OTC_DEFAULT_IAM, price: OTC_DEFAULT_PRICE, eps: OTC_DEFAULT_EPS },
  readAllowList: [
    { method: 'POST', path: /\/v3\/auth\/tokens$/, reason: 'IAM token request; issues a token and creates nothing in the tenant' },
    // #3951: OBS accepts AK/SK signatures only; a password login gets one temporary AK/SK per scope run (token method, 900 s, held in memory).
    { method: 'POST', path: /^\/v3\.0\/OS-CREDENTIAL\/securitytokens$/, reason: 'IAM temporary AK/SK request with the login token for the OBS reads; issues a 15-minute credential and creates nothing persistent in the tenant' },
  ],
  routeTemplates: [
    '/v3/auth/tokens',
    // #3685: the AK/SK session reads (otc-client.ts akskSession).
    '/v3/auth/domains',
    '/v3/auth/projects',
    '/v3/auth/catalog',
    '/v3.0/OS-CREDENTIAL/credentials/{access_key}',
    '/v3/users/{user_id}/groups',
    '/v3/domains/{domain_id}/groups/{group_id}/roles',
    '/v3/projects/{project_id}/groups/{group_id}/roles',
    '/v3/OS-INHERIT/domains/{domain_id}/groups/{group_id}/roles/inherited_to_projects',
    '/v1/resource-manager/domains/{domain_id}/providers',
    '/v1/resource-manager/domains/{domain_id}/all-resources',
    '/v2.1/{project_id}/os-availability-zone',
    '/v3/{project_id}/trackers',
    '/v3/{project_id}/traces',
    // #3865: posture reads (otc-posture.ts; Design 123 section 5.4).
    '/v3/{project_id}/instances',
    '/v3/{project_id}/elb/listeners',
    '/v3/{project_id}/vaults',
    '/v3/{project_id}/policies',
    // #3951: OBS bucket sub-resources (virtual-hosted live, so the path is `/`; path style on the loopback mock) and the temporary AK/SK.
    '/{bucket}',
    '/v3.0/OS-CREDENTIAL/securitytokens',
    // #3954: API Gateway API groups and APIs.
    '/v2/{project_id}/apigw/instances/{instance_id}/api-groups',
    '/v2/{project_id}/apigw/instances/{instance_id}/apis',
    // #3597: public price list (API `price`); listed so the recorder names the
    // route and the mock route parity gate covers it.
    '/en/open-telekom-price-api/',
    // #3881: tenant hierarchy (otc-hierarchy.ts OTC_HIERARCHY_ROUTES).
    '/v3/projects',
    '/v1.0/enterprise-projects',
  ],
  probeReadOnly,
  listRegions,
  listServices,
  listGuardrails,
  listResources,
  listQuotas,
  listActivity,
  listPrices,
  listPosture,
  // #3881 (Design 123 section 5.6): domain, region projects, sub-projects, enterprise projects.
  listHierarchy: listOtcHierarchy,
  // #3831 (Q-21, owner decision 2026-11-04): registered for release on the
  // live evidence of the operator / Reader runs; minimal role set unverified (ROLES.md).
  liveVerified: true,
};
