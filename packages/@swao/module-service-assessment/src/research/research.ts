// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Service assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * `swao service research` orchestration (Pass 24 RESEARCH, Design 103 §6.2, #3086).
 *
 * For each service app (`apps/<id>/.swao.yml` with `assessment.type: service`)
 * hydrates `apps/<id>/wsp/inputs/research/<topic>.md` and writes
 * `confidence.json`. Without `--refresh`, a source block is re-queried only
 * when it is missing, errored, past its TTL, or was built from different
 * inputs; with `--refresh` every block is re-queried. A stub promoted by an
 * analyst (`reviewed_by` or provenance `user-provided`) is never rewritten.
 * `--dry-run` reports the plan without any request or write.
 *
 * Outbound requests carry only vendor name, product name, version, OS
 * product slug, and installer hashes; never app IDs, sites, or other intake data.
 * The four LLM topics (#3289) send vendor name, product name, version, and the
 * INFRA-CAT category to the workspace LLM provider, which scrubs the prompt
 * for egress; they are skipped with `no_llm_configured` when no LLM is set up,
 * and with `skipped_by_user` under `--skip-llm` (#3304), which keeps earlier
 * LLM findings for the same inputs.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { loadInfraCatalogue, type InfraCatalogue } from '../catalog/infra-cat.js';
import { minConfidence, topicConfidence, distribution, type ConfidenceDistribution } from './confidence.js';
import { emptyEolBlock, queryEol } from './eol-client.js';
import { BSI_RSS_URL, KEV_URL, OSV_BASE_URL, cachedFeed, emptyBsiBlock, emptyKevBlock, emptyOsvBlock, matchBsi, matchKev, parseBsiRss, queryOsv } from './feeds.js';
import { RunCache, realClock, type Clock, type FetchLike, type HttpContext } from './http.js';
import { NVD_BASE_URL, REDACTED_VENDOR_MARKER, emptyCveBlock, nvdLimiter, queryNvd } from './nvd-client.js';
import {
  API_TOPICS,
  LLM_SKIP_REASONS,
  LLM_TOPICS,
  RESEARCH_TOPICS,
  STUB_TTL_DAYS,
  ResearchConfidenceFileSchema,
  stubSchemaFor,
  type BsiBlock,
  type CveBlock,
  type EolBlock,
  type KevBlock,
  type LlmBlock,
  type OsvBlock,
  type ResearchConfidence,
  type ResearchTopic,
  type VtBlock,
} from './schema.js';
import { readStub, writeStub } from './stub-file.js';
import { emptyLlmBlock, llmBody, researchTopicWithLlm, type ResearchLlm } from './llm-research.js';
import type { LlmResearchTopic } from './llm-prompts.js';
import { RESEARCH_SIGNALS_FILE, ResearchSignalsFileSchema, researchSignals, type ResearchAppContext } from './signals.js';
import { runBinaryAnalysis } from '../binary/analyse.js';
import { VT_BASE_URL, emptyVtBlock, queryVirusTotal, readBinaryHash, vtLimiter } from './vt-client.js';

export interface ResearchBaseUrls { nvd: string; eol: string; kev: string; bsi: string; osv: string; vt: string }

export const DEFAULT_BASE_URLS: ResearchBaseUrls = {
  nvd: NVD_BASE_URL,
  eol: 'https://endoflife.date/api',
  kev: KEV_URL,
  bsi: BSI_RSS_URL,
  osv: OSV_BASE_URL,
  vt: VT_BASE_URL,
};

export interface ServiceResearchOptions {
  workspacePath: string;
  appId?: string;
  refresh?: boolean;
  dryRun?: boolean;
  nvdApiKey?: string | null;
  vtApiKey?: string | null;
  now?: Date;
  fetch?: FetchLike;
  clock?: Clock;
  baseUrls?: Partial<ResearchBaseUrls>;
  rateLimits?: { nvd?: { max: number; windowMs: number }; vt?: { max: number; windowMs: number } };
  onProgress?: (line: string) => void;
  builtinCatalogueDir?: string | null;
  userAgent?: string;
  /**
   * Workspace LLM provider for the four LLM topics (#3289), built by the host
   * with the @swao/module-llm-providers factory. Absent or null: the topics
   * are skipped with `llmSkipReason`.
   */
  llm?: ResearchLlm | null;
  /** skipped_reason when `llm` is absent (default `no_llm_configured`; the host uses `llm_unavailable`). */
  llmSkipReason?: string;
  /** Detail for the note of a skipped LLM topic, e.g. the provider construction error. */
  llmSkipDetail?: string;
  /**
   * #3304 (`--skip-llm`): skip the four LLM topics with `skipped_by_user`, even
   * when `llm` is set. Earlier LLM findings for the same inputs are kept.
   */
  skipLlm?: boolean;
}

export type TopicAction = 'created' | 'refreshed' | 'unchanged' | 'protected';

export interface AppResearchResult {
  appId: string;
  topics: Record<ResearchTopic, TopicAction>;
  composite: ResearchConfidence | null;
  topicConfidence: Record<ResearchTopic, ResearchConfidence | null>;
  /** RESEARCH.* signals written to `wsp/signals/research-signals.json`; null on a dry run (#3154). */
  signalCount: number | null;
}

export interface ServiceResearchResult {
  apps: AppResearchResult[];
  /** The four LLM-augmented topics (Design 103 §6.2.4, #3289). */
  llmTopics: readonly ResearchTopic[];
  /** Provider and model used for the LLM topics; null when they were skipped (`llmSkipReason`). */
  llm: { provider: string; model: string } | null;
  /** Why the LLM topics were skipped; null when an LLM was used. */
  llmSkipReason: string | null;
  /** Composite confidence per app (the minimum over its topics). */
  distribution: ConfidenceDistribution;
  /** Confidence per API topic (#3168): the composite alone hides which topic is weak. */
  topicDistribution: Record<string, ConfidenceDistribution>;
  dryRun: boolean;
}

export class ResearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResearchError';
  }
}

/** Fields research needs from an app `.swao.yml`, read leniently (analyst-added keys never block research). */
export interface ResearchAppInput {
  appId: string;
  appName: string | null;
  vendor: string | null;
  version: string | null;
  os: string | null;
  osClass: string | null;
  infraCategory: string | null;
  /**
   * #3308: regulatory context from the app `data` block, used only to gate the
   * conditional LLM signals (Design 103 §6.2.4). Never placed in a prompt.
   */
  context?: ResearchAppContext;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

export function readServiceApp(appDir: string, appId: string): ResearchAppInput | null {
  const p = join(appDir, '.swao.yml');
  if (!existsSync(p)) return null;
  let doc: Record<string, unknown>;
  try {
    doc = (load(readFileSync(p, 'utf-8')) ?? {}) as Record<string, unknown>;
  } catch {
    return null;
  }
  if ((doc['assessment'] as { type?: unknown } | undefined)?.type !== 'service') return null;
  const vendor = (doc['vendor'] ?? {}) as Record<string, unknown>;
  const platform = (doc['platform'] ?? {}) as Record<string, unknown>;
  const vendorName = str(vendor['name']);
  const data = (doc['data'] ?? {}) as Record<string, unknown>;
  const flag = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
  const regulatory = Array.isArray(data['regulatory']) ? data['regulatory'].filter((r): r is string => typeof r === 'string') : [];
  return {
    appId,
    appName: str(doc['app_name']),
    vendor: vendorName === REDACTED_VENDOR_MARKER ? null : vendorName,
    version: str(vendor['version']),
    os: str(platform['os']),
    osClass: str(doc['os_class']),
    infraCategory: str(doc['infra_category']),
    context: { regulatory, healthData: flag(data['health_data']), gdprArt9: flag(data['gdpr_art9']) },
  };
}

export function discoverServiceApps(workspacePath: string): ResearchAppInput[] {
  const appsDir = join(workspacePath, 'apps');
  if (!existsSync(appsDir)) return [];
  return readdirSync(appsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => readServiceApp(join(appsDir, d.name), d.name))
    .filter((a): a is ResearchAppInput => a !== null)
    .sort((a, b) => a.appId.localeCompare(b.appId));
}

function isFresh(block: { fetched_at: string | null; error?: string } | undefined, ttlDays: number, now: Date, refresh: boolean): boolean {
  if (refresh || !block?.fetched_at || block.error) return false;
  const t = Date.parse(block.fetched_at);
  return Number.isFinite(t) && now.getTime() - t < ttlDays * 24 * 60 * 60 * 1000;
}

function sameInputs(front: Record<string, unknown> | undefined, app: ResearchAppInput): boolean {
  return !!front && front['vendor_name'] === app.vendor && front['product_name'] === app.appName && front['version'] === app.version;
}

const isProtected = (front: Record<string, unknown> | undefined): boolean =>
  !!front && (typeof front['reviewed_by'] === 'string' || front['provenance'] === 'user-provided');

function stubHeader(topic: ResearchTopic, app: ResearchAppInput) {
  return { topic, app_id: app.appId, vendor_name: app.vendor, product_name: app.appName, version: app.version };
}

function cveBody(cve: CveBlock, kev: KevBlock, bsi: BsiBlock, osv: OsvBlock): string {
  const lines = ['## CVE summary', ''];
  if (cve.note || cve.error) lines.push(`NVD: not queried or failed (${cve.note ?? cve.error}).`);
  else lines.push(`NVD keyword "${cve.query}": ${cve.count} CVE(s); critical ${cve.critical_count}, high ${cve.high_count}, medium ${cve.medium_count}, low ${cve.low_count}.`);
  for (const t of cve.top.slice(0, 5)) lines.push(`- ${t.id} (${t.severity ?? 'n/a'} ${t.score ?? ''}) ${t.url}`);
  lines.push('', `CISA KEV: ${kev.skipped_reason ? `skipped (${kev.skipped_reason})` : `${kev.matches.length} known-exploited match(es)`}.`);
  lines.push(`BSI CERT-Bund: ${bsi.alert_count === null || bsi.error ? `not matched (${bsi.note ?? bsi.error ?? 'not queried'})` : `${bsi.alert_count} recent advisory match(es)`}.`);
  lines.push(`OSV.dev: ${osv.skipped_reason ? `skipped (${osv.skipped_reason})` : osv.error ? `failed (${osv.error})` : `${osv.vuln_count} vulnerability record(s)`}.`);
  return lines.join('\n');
}

function eolBody(eol: EolBlock): string {
  if (!eol.date) return `## End-of-life status\n\nNo end-of-life date resolved (${eol.note ?? eol.error ?? 'unknown'}).`;
  return `## End-of-life status\n\n${eol.product} ${eol.cycle}: end of support ${eol.date}${eol.is_eol ? ' (already past)' : ` (${eol.months_until_eol} months remaining)`}. Source: ${eol.evidence_url}`;
}

/** Body of a stub that had nothing to look up (#3168). */
function skippedBody(what: string, missing: readonly string[]): string {
  return `## ${what}\n\nSkipped: nothing to look up. Missing in the intake: ${missing.join(', ')}. Add the value to the app's .swao.yml or the intake workbook and run research again.`;
}

function vtBody(vt: VtBlock): string {
  if (vt.skipped_reason) return `## VirusTotal\n\nSkipped: ${vt.skipped_reason}.`;
  return `## VirusTotal\n\n${vt.detection_ratio ? `Detection ratio ${vt.detection_ratio}` : vt.note ?? vt.error ?? 'no result'}. ${vt.permalink ?? ''}`.trimEnd();
}

/** A source block that was queried and answered (not skipped, not failed, not a no-query note). */
const answered = (b: { fetched_at: string | null; error?: string; skipped_reason?: string; note?: string; source: string }): boolean =>
  !!b.fetched_at && !b.error && !b.skipped_reason && !(b.source === 'nvd' && b.note) && !(b.source === 'bsi-cert-bund' && b.note?.startsWith('no_'));

/** Note of an LLM topic skipped because no LLM is configured or available (#3289). */
export function llmSkippedNote(reason: string, detail?: string): string {
  if (reason === LLM_SKIP_REASONS.byUser) {
    return 'Not researched: LLM research was skipped for this run (--skip-llm, or the choice in the service assessment screen). ' +
      'Run swao service research without --skip-llm to research this topic, ' +
      'or add the findings to this file manually and set reviewed_by / reviewed_at to mark them as user-provided.';
  }
  const why = reason === LLM_SKIP_REASONS.unavailable
    ? `an LLM provider is configured but could not be used${detail ? ` (${detail})` : ''}`
    : 'no LLM provider is configured for this workspace';
  return `Not researched: ${why}. LLM-augmented research (Design 103 §6.2.4) is available in every licence tier; ` +
    'configure providers.llm.primary in the workspace .swao.yml (or run swao setup) and run swao service research again, ' +
    'or add the findings to this file manually and set reviewed_by / reviewed_at to mark them as user-provided.';
}

/** Note of an LLM topic whose call failed or returned an unusable answer; the next run retries. */
function llmFailedNote(reason: string, error: string | undefined): string {
  const what = reason === LLM_SKIP_REASONS.malformed ? 'the model did not answer in the expected JSON format' : 'the LLM call failed';
  return `Not researched: ${what}${error ? ` (${error})` : ''}. The next swao service research run retries this topic.`;
}

export async function runServiceResearch(opts: ServiceResearchOptions): Promise<ServiceResearchResult> {
  const now = opts.now ?? new Date();
  const refresh = opts.refresh ?? false;
  const dryRun = opts.dryRun ?? false;
  const progress = opts.onProgress ?? (() => {});
  const urls: ResearchBaseUrls = { ...DEFAULT_BASE_URLS, ...(opts.baseUrls ?? {}) };
  const clock = opts.clock ?? realClock;
  const ctx: HttpContext = { fetch: opts.fetch ?? (globalThis.fetch as unknown as FetchLike), clock, userAgent: opts.userAgent ?? 'SWAO-service-research' };
  const cache = new RunCache();
  const nvdLim = nvdLimiter(Boolean(opts.nvdApiKey), clock, opts.rateLimits?.nvd);
  const vtLim = vtLimiter(clock, opts.rateLimits?.vt);
  // #3304: --skip-llm wins over a configured provider; no LLM call is made.
  const llm = opts.skipLlm ? null : opts.llm ?? null;
  const llmSkipReason = opts.skipLlm ? LLM_SKIP_REASONS.byUser : llm ? null : opts.llmSkipReason ?? LLM_SKIP_REASONS.noLlm;

  let apps = discoverServiceApps(opts.workspacePath);
  if (opts.appId) {
    apps = apps.filter((a) => a.appId === opts.appId);
    if (apps.length === 0) throw new ResearchError(`no service app "${opts.appId}" in this workspace (apps/${opts.appId}/.swao.yml with assessment.type: service)`);
  }
  if (apps.length === 0) throw new ResearchError('no service apps in this workspace; run swao service init first');

  const catalogue: InfraCatalogue = loadInfraCatalogue({
    workspacePath: opts.workspacePath,
    ...(opts.builtinCatalogueDir !== undefined ? { builtinDir: opts.builtinCatalogueDir } : {}),
  });
  const service = (id: string | null) => (id ? catalogue.services.find((s) => s.id === id) : undefined);

  let bsiItems: ReturnType<typeof parseBsiRss> | null = null;
  let bsiError: string | null = null;
  const loadBsi = async () => {
    if (bsiItems || bsiError) return;
    try {
      bsiItems = parseBsiRss(await cachedFeed(ctx, { workspacePath: opts.workspacePath, name: 'bsi-cert-bund.rss', url: urls.bsi, now, cache, refresh }));
    } catch (e) {
      bsiError = (e as Error).message;
    }
  };

  progress(`Researching ${apps.length} app(s)...${dryRun ? ' (dry run: no requests, no writes)' : ''}`);
  const results: AppResearchResult[] = [];

  for (const [i, app] of apps.entries()) {
    const dir = join(opts.workspacePath, 'apps', app.appId, 'wsp', 'inputs', 'research');
    const topics = {} as Record<ResearchTopic, TopicAction>;
    const conf = {} as Record<ResearchTopic, ResearchConfidence | null>;
    const existing = Object.fromEntries(RESEARCH_TOPICS.map((t) => [t, readStub(join(dir, `${t}.md`))])) as Record<ResearchTopic, ReturnType<typeof readStub>>;
    if (!dryRun) mkdirSync(dir, { recursive: true });
    // #3289: LLM topics run concurrently per app; the provider's max_concurrency limiter caps in-flight calls.
    const llmTasks: Promise<void>[] = [];

    for (const topic of RESEARCH_TOPICS) {
      const prev = existing[topic];
      const front = prev?.front;
      if (isProtected(front)) {
        topics[topic] = 'protected';
        conf[topic] = (front?.['confidence'] as ResearchConfidence | null) ?? null;
        continue;
      }
      const inputsChanged = !sameInputs(front, app);
      const path = join(dir, `${topic}.md`);
      const action: TopicAction = prev ? 'refreshed' : 'created';

      if (LLM_TOPICS.includes(topic)) {
        const llmTopic = topic as LlmResearchTopic;
        const old = (front as { llm?: LlmBlock } | undefined)?.llm;
        const missing = !app.vendor && !app.appName;
        const skipNow = missing ? 'no_input' : llmSkipReason;
        const fresh = skipNow
          ? front?.['skipped_reason'] === skipNow
          : front?.['status'] === 'researched' && isFresh(old, STUB_TTL_DAYS.llm, now, refresh);
        if (prev && !inputsChanged && fresh) {
          topics[topic] = 'unchanged';
          conf[topic] = skipNow ? null : old?.confidence ?? null;
          continue;
        }
        // A run without an LLM (no provider in this shell, gateway down, --skip-llm) keeps
        // earlier LLM findings for the same inputs instead of replacing them with a skip stub.
        if (prev && !inputsChanged && skipNow && !missing && front?.['status'] === 'researched' && old?.provenance === 'LLM-researched') {
          topics[topic] = 'unchanged';
          conf[topic] = old.confidence ?? null;
          continue;
        }
        // Rewritten: missing, stale, failed last time, inputs changed, or written by an
        // earlier build (`pending`, or `not_implemented` before #3289).
        topics[topic] = action;
        conf[topic] = null;
        if (dryRun) continue;
        if (skipNow) {
          // #3168 / #3289: nothing to look up, or no LLM: skipped with the reason, never a low-confidence result.
          if (missing) {
            writeStub(path, {
              ...stubHeader(topic, app), status: 'skipped', retrieved_at: now.toISOString(), confidence: null, provenance: null,
              skipped_reason: skipNow, missing_inputs: ['vendor_name', 'product_name'], llm: emptyLlmBlock(),
            }, skippedBody(`${llmTopic} research`, ['vendor name', 'product name']), prev?.body ?? null);
          } else {
            const note = llmSkippedNote(skipNow, opts.llmSkipDetail);
            writeStub(path, {
              ...stubHeader(topic, app), status: 'skipped', retrieved_at: null, confidence: null, provenance: null,
              skipped_reason: skipNow, note, llm: emptyLlmBlock(),
            }, llmBody(llmTopic, emptyLlmBlock(), note), prev?.body ?? null);
          }
          continue;
        }
        const model = llm as ResearchLlm;
        llmTasks.push((async () => {
          const out = await researchTopicWithLlm(model, llmTopic, { vendor: app.vendor, product: app.appName, version: app.version, infraCategory: app.infraCategory }, now);
          if (out.skippedReason) {
            const note = llmFailedNote(out.skippedReason, out.block.error);
            writeStub(path, {
              ...stubHeader(topic, app), status: 'skipped', retrieved_at: now.toISOString(), confidence: null, provenance: null,
              skipped_reason: out.skippedReason, note, llm: out.block,
            }, llmBody(llmTopic, out.block, note), prev?.body ?? null);
            return;
          }
          conf[topic] = out.block.confidence;
          writeStub(path, {
            ...stubHeader(topic, app), status: 'researched', retrieved_at: now.toISOString(), confidence: out.block.confidence,
            provenance: 'LLM-researched', llm: out.block,
          }, llmBody(llmTopic, out.block, null), prev?.body ?? null);
        })());
        continue;
      }

      if (topic === 'cve-summary') {
        const old = front as { cve?: CveBlock; kev?: KevBlock; osv?: OsvBlock; bsi?: BsiBlock } | undefined;
        const svc = service(app.infraCategory);
        const osvPkg = (svc as { osv_package?: { name: string; ecosystem: string } } | undefined)?.osv_package ?? null;
        const cveFresh = !inputsChanged && isFresh(old?.cve, STUB_TTL_DAYS.nvd, now, refresh);
        const osvFresh = !inputsChanged && (osvPkg ? isFresh(old?.osv, STUB_TTL_DAYS.osv, now, refresh) : !!old?.osv?.skipped_reason);
        const kevFresh = cveFresh && isFresh(old?.kev, STUB_TTL_DAYS['cisa-kev'], now, refresh);
        const bsiFresh = !inputsChanged && isFresh(old?.bsi, STUB_TTL_DAYS['bsi-cert-bund'], now, refresh);
        if (prev && cveFresh && osvFresh && kevFresh && bsiFresh) {
          topics[topic] = 'unchanged';
          conf[topic] = (front?.['confidence'] as ResearchConfidence | null) ?? null;
          continue;
        }
        topics[topic] = action;
        if (dryRun) { conf[topic] = null; continue; }

        // #3168: nothing to look up (no vendor, no product name, no OSV package) is
        // reported as skipped with the missing inputs, not as "researched, low".
        if (!app.vendor && !app.appName && !osvPkg) {
          conf[topic] = null;
          writeStub(path, {
            ...stubHeader(topic, app), status: 'skipped', retrieved_at: now.toISOString(), confidence: null, provenance: null,
            skipped_reason: 'no_input', missing_inputs: ['vendor_name', 'product_name'],
            cve: { ...emptyCveBlock(), note: 'no_input' }, kev: { ...emptyKevBlock(), skipped_reason: 'no_input' },
            osv: { ...emptyOsvBlock(), skipped_reason: 'no_input' }, bsi: { ...emptyBsiBlock(), note: 'no_input' },
          }, skippedBody('CVE research', ['vendor name', 'product name']), prev?.body ?? null);
          continue;
        }

        const cve = cveFresh && old?.cve ? old.cve : await cache.get(`nvd:${app.vendor}|${app.appName}|${app.version}`, () =>
          queryNvd(ctx, { vendor: app.vendor, product: app.appName, version: app.version }, { limiter: nvdLim, apiKey: opts.nvdApiKey ?? null, baseUrl: urls.nvd, now }));
        let kev: KevBlock;
        if (kevFresh && old?.kev) kev = old.kev;
        else if (cve.cve_ids.length === 0) kev = { ...emptyKevBlock(), skipped_reason: cve.error || cve.note ? 'no_nvd_result' : 'no_cve_ids' };
        else {
          try {
            kev = matchKev(await cachedFeed(ctx, { workspacePath: opts.workspacePath, name: 'cisa-kev.json', url: urls.kev, now, cache, refresh }), cve.cve_ids, now);
          } catch (e) {
            kev = { ...emptyKevBlock(), fetched_at: now.toISOString(), confidence: 'low', error: (e as Error).message };
          }
        }
        let bsi: BsiBlock;
        if (bsiFresh && old?.bsi) bsi = old.bsi;
        else if (!app.vendor && !app.appName) bsi = { ...emptyBsiBlock(), fetched_at: now.toISOString(), confidence: 'low', note: 'no_vendor_or_product_name' };
        else {
          // #3154: match the advisory subject on vendor or product (the feed is matched locally; nothing is sent).
          await loadBsi();
          bsi = bsiItems ? matchBsi(bsiItems, [app.vendor, app.appName], now) : { ...emptyBsiBlock(), fetched_at: now.toISOString(), confidence: 'low', error: bsiError ?? 'feed unavailable' };
          // A product label without a vendor is a weaker match.
          if (!app.vendor && bsi.alert_count !== null) bsi = { ...bsi, confidence: 'low' };
        }
        const osv = osvFresh && old?.osv ? old.osv : await queryOsv(ctx, { pkg: osvPkg, version: app.version }, { baseUrl: urls.osv, now, cache });
        // #3154: provenance per source block; the stub is API-verified when any source answered.
        const cveOut: CveBlock = { ...cve, kev_match: kev.matches.length > 0, cve_ids: cve.cve_ids.slice(0, 200), provenance: answered(cve) ? 'API-verified' : null };
        const kevOut: KevBlock = { ...kev, provenance: answered(kev) ? 'API-verified' : null };
        const bsiOut: BsiBlock = { ...bsi, provenance: answered(bsi) && bsi.alert_count !== null ? 'API-verified' : null };
        const osvOut: OsvBlock = { ...osv, provenance: answered(osv) ? 'API-verified' : null };
        const topicConf = topicConfidence([cveOut, osvOut]);
        conf[topic] = topicConf;
        const anyAnswered = [cveOut, kevOut, bsiOut, osvOut].some((b) => b.provenance === 'API-verified');
        writeStub(path, {
          ...stubHeader(topic, app), status: 'researched', retrieved_at: now.toISOString(), confidence: topicConf,
          provenance: anyAnswered ? 'API-verified' : null,
          cve: cveOut, kev: kevOut, osv: osvOut, bsi: bsiOut,
        }, cveBody(cveOut, kevOut, bsiOut, osvOut), prev?.body ?? null);
        continue;
      }

      if (topic === 'eol-status') {
        const old = (front as { eol?: EolBlock } | undefined)?.eol;
        const fresh = !inputsChanged && front?.['os'] === app.os && isFresh(old, STUB_TTL_DAYS['endoflife.date'], now, refresh);
        if (prev && fresh) { topics[topic] = 'unchanged'; conf[topic] = old?.confidence ?? null; continue; }
        topics[topic] = action;
        if (dryRun) { conf[topic] = null; continue; }
        // #3168: without an OS value there is nothing to look up.
        if (!app.os) {
          conf[topic] = null;
          writeStub(path, {
            ...stubHeader(topic, app), os: null, status: 'skipped', retrieved_at: now.toISOString(), confidence: null, provenance: null,
            skipped_reason: 'no_input', missing_inputs: ['os'], eol: { ...emptyEolBlock(), note: 'no_os_value' },
          }, skippedBody('End-of-life research', ['operating system']), prev?.body ?? null);
          continue;
        }
        const productIds =(service(app.osClass) as { eol_product_ids?: string[] } | undefined)?.eol_product_ids ?? [];
        const eol = productIds.length === 0 && app.os
          ? { ...emptyEolBlock(), fetched_at: now.toISOString(), confidence: 'low' as const, note: 'no_slug_for_category' }
          : await queryEol(ctx, { os: app.os, productIds }, { baseUrl: urls.eol, now, cache });
        conf[topic] = eol.confidence;
        writeStub(path, {
          ...stubHeader(topic, app), os: app.os, status: 'researched', retrieved_at: now.toISOString(), confidence: eol.confidence,
          provenance: eol.date ? 'API-verified' : null, eol: { ...eol, provenance: eol.date ? 'API-verified' : null },
        }, eolBody(eol), prev?.body ?? null);
        continue;
      }

      // virustotal: Pass 25 runs first so the installer hash is available (offline, idempotent).
      if (!dryRun) {
        try { runBinaryAnalysis(opts.workspacePath, app.appId, { now }); } catch { /* unreadable inputs: VT reports no_binary_hash */ }
      }
      const sha = readBinaryHash(join(opts.workspacePath, 'apps', app.appId, 'wsp', 'inputs', 'binary', 'binary-analysis.json'));
      const old = (front as { vt?: VtBlock } | undefined)?.vt;
      const skipNow = !opts.vtApiKey ? 'no_api_key' : !sha ? 'no_binary_hash' : null;
      const fresh = skipNow ? old?.skipped_reason === skipNow : old?.sha256 === sha && isFresh(old, STUB_TTL_DAYS.virustotal, now, refresh);
      if (prev && fresh && !inputsChanged) { topics[topic] = 'unchanged'; conf[topic] = old?.skipped_reason ? null : old?.confidence ?? null; continue; }
      topics[topic] = action;
      if (dryRun) { conf[topic] = null; continue; }
      const vt = skipNow ? { ...emptyVtBlock(), skipped_reason: skipNow } : await queryVirusTotal(ctx, { apiKey: opts.vtApiKey ?? null, sha256: sha }, { limiter: vtLim, baseUrl: urls.vt, now });
      conf[topic] = vt.skipped_reason ? null : vt.confidence;
      writeStub(path, {
        ...stubHeader(topic, app), status: vt.skipped_reason ? 'skipped' : 'researched', retrieved_at: now.toISOString(),
        confidence: conf[topic], provenance: vt.detection_ratio ? 'API-verified' : null, vt: { ...vt, provenance: vt.detection_ratio ? 'API-verified' : null },
      }, vtBody(vt), prev?.body ?? null);
    }

    await Promise.all(llmTasks);
    const composite = minConfidence(Object.values(conf));
    let signalCount: number | null = null;
    if (!dryRun) {
      const file = ResearchConfidenceFileSchema.parse({ app_id: app.appId, generated_at: now.toISOString(), composite, topics: conf });
      writeFileSync(join(dir, 'confidence.json'), `${JSON.stringify(file, null, 2)}\n`, 'utf-8');
      // #3154: RESEARCH.* signals from the final stubs (fresh, unchanged, or analyst-promoted).
      const signals = researchSignals(dir, app.context);
      const sigDir = join(opts.workspacePath, 'apps', app.appId, 'wsp', 'signals');
      mkdirSync(sigDir, { recursive: true });
      const sigFile = ResearchSignalsFileSchema.parse({ generated_at: now.toISOString(), app_id: app.appId, signals });
      writeFileSync(join(sigDir, RESEARCH_SIGNALS_FILE), `${JSON.stringify(sigFile, null, 2)}\n`, 'utf-8');
      signalCount = signals.length;
    }
    results.push({ appId: app.appId, topics, composite, topicConfidence: conf, signalCount });
    const shown = llm ? RESEARCH_TOPICS : API_TOPICS;
    const summary = shown.map((t) => `${t.split('-')[0]} ${topics[t]}${conf[t] ? `/${conf[t]}` : ''}`).join(', ');
    progress(`[${i + 1}/${apps.length}] ${app.appId}: ${summary}; composite ${composite ?? 'none'}${signalCount !== null ? `; ${signalCount} RESEARCH signal(s)` : ''}`);
  }

  // #3289: the LLM topics get a distribution line only when an LLM researched them.
  const topicDistribution = Object.fromEntries((llm ? RESEARCH_TOPICS : API_TOPICS).map((t) => [t, distribution(results.map((r) => r.topicConfidence[t] ?? null))]));
  return {
    apps: results, llmTopics: LLM_TOPICS, llm: llm ? { provider: llm.name, model: llm.model } : null, llmSkipReason,
    distribution: distribution(results.map((r) => r.composite)), topicDistribution, dryRun,
  };
}

/** Validate a stub file against its topic schema (used by tests and the research-cache probe). */
export function validateStub(topic: ResearchTopic, front: unknown): boolean {
  return stubSchemaFor(topic).safeParse(front).success;
}
