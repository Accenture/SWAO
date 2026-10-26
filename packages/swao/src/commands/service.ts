// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * `swao service` command tree (Design 103 §3.6, ADR-0064, #3075).
 *
 * Service Portfolio Assessment lives entirely under this namespace:
 *   swao service init      scaffold apps from an Excel intake workbook
 *   swao service research  research CVE / end-of-life status (Phase 2, #3086) and,
 *                          through the workspace LLM, vendor profile, certifications,
 *                          data residency, and breach history (#3289, every tier)
 */

import type { Command } from 'commander';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { credentialStore, FEATURE_GATES, findWorkspace, LicenseGuard, LicenseInvalidError, LicenseTierError, type LicenseTier } from '@swao/core';
import { createLlmProvider, createProxyAwareFetch } from '@swao/module-llm-providers';
import {
  buildPortfolioSummary,
  recordPortfolioDelta,
  formatDistribution,
  runServiceInit,
  runServiceResearch,
  resolveServiceIntake,
  rankServiceApps,
  isNotAssessed,
  NOT_ASSESSED_MARK,
  type RankedServiceApp,
  type ResolvedIntake,
  type ServiceInitResult,
  type ResearchLlm,
  type ServiceResearchResult,
} from '@swao/module-service-assessment';
import { SWAO_VERSION } from '../branding.js';
import { printLicenseGateError } from '../lib/license-gate-error.js';
import { buildWorkspaceSwaoYml, runWorkspaceScaffolders } from './init.js';
import { readLlmPrimaryConfig } from './assess.js';

export interface ServiceInitCliOptions {
  /** Intake workbook; default: the single .xlsx in wsp/inputs/service-intake/ (#3211). */
  from?: string;
  mapping?: string;
  workspace?: string;
  refresh?: boolean;
  clusterThreshold?: string;
  json?: boolean;
}

/** Resolve the target workspace, creating a minimal one when the directory has no .swao.yml. */
export function ensureServiceWorkspace(explicit?: string): { path: string; created: boolean } {
  const path = explicit ? resolve(explicit) : findWorkspace(process.cwd()) ?? process.cwd();
  if (existsSync(join(path, '.swao.yml'))) return { path, created: false };
  mkdirSync(path, { recursive: true });
  writeFileSync(
    join(path, '.swao.yml'),
    buildWorkspaceSwaoYml({ name: basename(path), code: '', ownerLead: '', engLead: '', endDate: '' }),
    'utf-8',
  );
  runWorkspaceScaffolders(path);
  return { path, created: true };
}

export function formatServiceInitSummary(result: ServiceInitResult, workspacePath: string): string {
  const lines: string[] = [];
  if (!result.ok) {
    lines.push(`[error] Scaffold halted: ${result.duplicateIds.length} duplicate app ID(s); no folders were written.`);
    for (const id of result.duplicateIds) lines.push(`  - ${id}`);
    lines.push('Make the IDs unique in the intake workbook, then re-run swao service init.');
    return lines.join('\n');
  }
  const clusters = result.apps.filter((a) => a.members.length > 0);
  lines.push(`Service portfolio scaffold: ${workspacePath}`);
  lines.push(`  Rows read        : ${result.rowCount}`);
  lines.push(`  App folders      : ${result.apps.length} (${result.write.created.length} created, ${result.write.refreshed.length} refreshed, ${result.write.skippedExisting.length} unchanged)`);
  if (clusters.length > 0) {
    lines.push(`  Clusters         : ${clusters.map((c) => `${c.appId} (${c.members.length} members)`).join(', ')}`);
  }
  lines.push(`  SCAFFOLD signals : ${result.signals.length} (written to ${result.write.signalsFile})`);
  // #3168: which columns the layout recognised, and research-relevant gaps
  for (const c of result.columns ?? []) {
    const f = c.fields;
    const pairs = Object.entries(f).map(([k, col]) => `${k} ${col}`).sort((x, y) => x.split(' ')[1]!.localeCompare(y.split(' ')[1]!) || x.localeCompare(y));
    lines.push(`  Columns (${c.sheet}, ${c.mapping === 'custom' ? 'column map' : 'header detection'}): ${pairs.length} recognised: ${pairs.join(', ')}`);
    const missing = [
      ...(f['os'] ? [] : ['os (end-of-life research)']),
      ...(f['name'] || f['id_name_combined'] ? [] : ['app name (CVE / advisory research)']),
      ...(f['vendor_name'] ? [] : ['vendor name (CVE research)']),
    ];
    if (missing.length > 0) lines.push(`  [warn] Not in the intake: ${missing.join('; ')}. Add the column (or a column map) for better research, or fill the values in apps/<id>/.swao.yml.`);
  }
  if (result.write.conflicts.length > 0) {
    lines.push(`  [warn] ${result.write.conflicts.length} app folder(s) already hold a non-service app and were left untouched: ${result.write.conflicts.join(', ')}`);
  }
  if ((result.write.notInIntake ?? []).length > 0) {
    const ids = result.write.notInIntake;
    lines.push(`  [warn] ${ids.length} existing service app(s) are not in this intake (rows removed, or IDs changed by a newer SWAO version): ${ids.slice(0, 5).join(', ')}${ids.length > 5 ? `, +${ids.length - 5} more` : ''}`);
    lines.push('         They were left untouched. Delete those app folders, or scaffold into a fresh workspace, so the portfolio holds one generation of apps.');
  }
  if (result.write.skippedExisting.length > 0) {
    lines.push('  Existing service apps were not changed; use --refresh to update them from the intake file.');
  }
  for (const w of result.warnings) lines.push(`  [warn] ${w}`);
  if (result.unknownAppIds.length > 0) {
    lines.push('');
    lines.push(`${result.unknownAppIds.length} app(s) could not be auto-classified. Review and assign infra_category manually:`);
    for (const id of result.unknownAppIds) lines.push(`  - apps/${id}/.swao.yml`);
  }
  lines.push('');
  lines.push('Next: swao service research');
  return lines.join('\n');
}

export async function runServiceInitCli(opts: ServiceInitCliOptions): Promise<{ result: ServiceInitResult; workspacePath: string; workspaceCreated: boolean }> {
  try {
    LicenseGuard.load().requireFeature('service-assessment');
  } catch (e) {
    // Community tier: an unreadable or invalid licence file falls back to Community, which is ungated.
    if (!(e instanceof LicenseInvalidError)) throw e;
  }
  // #3211: without --from, the workbook (and a column map next to it) comes from
  // wsp/inputs/service-intake/ of the target workspace; never a prompt (CI-safe).
  const target = opts.workspace ? resolve(opts.workspace) : findWorkspace(process.cwd()) ?? process.cwd();
  const located = opts.from ? null : resolveServiceIntake(target);
  const intakePath = opts.from ? resolve(opts.from) : (located as ResolvedIntake).intakePath;
  if (!existsSync(intakePath)) throw new Error(`intake file not found: ${opts.from}`);
  const mappingPath = opts.mapping ? resolve(opts.mapping) : located?.mappingPath ?? undefined;
  if (mappingPath && !existsSync(mappingPath)) throw new Error(`mapping file not found: ${opts.mapping}`);
  const threshold = opts.clusterThreshold !== undefined ? Number.parseInt(opts.clusterThreshold, 10) : undefined;
  if (threshold !== undefined && (!Number.isInteger(threshold) || threshold < 2)) {
    throw new Error('--cluster-threshold must be an integer of at least 2');
  }
  const ws = ensureServiceWorkspace(opts.workspace);
  const result = await runServiceInit({
    workspacePath: ws.path,
    intakePath,
    ...(mappingPath ? { mappingPath } : {}),
    refresh: opts.refresh ?? false,
    ...(threshold !== undefined ? { clusterThreshold: threshold } : {}),
  });
  return { result, workspacePath: ws.path, workspaceCreated: ws.created };
}

export interface ServiceResearchCliOptions {
  app?: string;
  workspace?: string;
  refresh?: boolean;
  dryRun?: boolean;
  /** #3304: skip the four LLM topics (`skipped_by_user`); earlier LLM findings are kept. */
  skipLlm?: boolean;
  json?: boolean;
}

/** Credential-store value, else environment variable (credential store wins). */
async function researchKey(name: 'NVD_API_KEY' | 'VT_API_KEY'): Promise<string | null> {
  try {
    const v = await credentialStore.get(name);
    if (v) return v;
  } catch { /* vault unreadable: fall back to the environment */ }
  return process.env[name]?.trim() || null;
}

/** Base URL overrides for air-gapped mirrors and tests, following SWAO_OSV_BASE_URL (pass-05-sbom.ts). */
function researchBaseUrls(): Record<string, string> {
  const map: Record<string, string> = {
    nvd: 'SWAO_NVD_BASE_URL', eol: 'SWAO_EOL_BASE_URL', kev: 'SWAO_KEV_URL', bsi: 'SWAO_BSI_RSS_URL', osv: 'SWAO_OSV_BASE_URL', vt: 'SWAO_VT_BASE_URL',
  };
  return Object.fromEntries(Object.entries(map).flatMap(([k, env]) => (process.env[env] ? [[k, process.env[env] as string]] : [])));
}

/** The workspace LLM for the four LLM research topics (#3289), or why there is none. */
export interface ResearchLlmResolution {
  llm: ResearchLlm | null;
  /** `llm_unavailable` when an LLM is configured but the provider could not be built. */
  skipReason?: string;
  detail?: string;
}

/**
 * Build the workspace LLM provider for `swao service research` (#3289, all
 * tiers). Same configuration and precedence as `swao assess`: the
 * `providers.llm` block of the workspace .swao.yml, then SWAO_LLM_CONNECTOR /
 * SWAO_LLM_PROVIDER. The provider comes from the @swao/module-llm-providers
 * factory, so the shared request helper (events, retries), the
 * `max_concurrency` limiter, and the egress redaction of every driver apply.
 * A configured provider that cannot be built does not abort research: the
 * LLM topics are skipped with `llm_unavailable` (as #2201 does for assess).
 */
export function resolveResearchLlm(workspacePath: string, factory: typeof createLlmProvider = createLlmProvider): ResearchLlmResolution {
  let cfg: ReturnType<typeof readLlmPrimaryConfig>;
  try {
    const raw = loadYaml(readFileSync(join(workspacePath, '.swao.yml'), 'utf-8'));
    cfg = raw && typeof raw === 'object' ? readLlmPrimaryConfig(raw as Record<string, unknown>) : undefined;
  } catch {
    cfg = undefined; // unreadable .swao.yml: other commands report it; the env vars may still configure an LLM
  }
  const configured = Boolean(
    cfg?.connector || process.env['SWAO_LLM_CONNECTOR'] || (cfg?.type ?? process.env['SWAO_LLM_PROVIDER']) || cfg?.environments,
  );
  if (!configured) return { llm: null };
  try {
    return { llm: factory(undefined, 'service-research', { ...(cfg ?? {}), workspaceRoot: workspacePath }) };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').trim();
    return { llm: null, skipReason: 'llm_unavailable', detail: msg.length > 200 ? `${msg.slice(0, 197)}...` : msg };
  }
}

export function formatServiceResearchSummary(result: ServiceResearchResult): string {
  const lines = [`Research ${result.dryRun ? 'plan (dry run)' : 'complete'}: ${result.apps.length} app(s)`];
  if (result.dryRun) {
    for (const a of result.apps) {
      const pending = Object.entries(a.topics).filter(([, v]) => v !== 'unchanged' && v !== 'protected').map(([t, v]) => `${t} ${v === 'created' ? 'create' : 'refresh'}`);
      lines.push(`  ${a.appId}: ${pending.length > 0 ? pending.join(', ') : 'up to date'}`);
    }
  } else {
    lines.push(`  Confidence (composite, weakest topic per app): ${formatDistribution(result.distribution)}`);
    // #3168: per topic, so a low CVE match does not hide a high end-of-life result
    const width = Math.max(12, ...Object.keys(result.topicDistribution ?? {}).map((t) => t.length));
    for (const [topic, d] of Object.entries(result.topicDistribution ?? {})) {
      lines.push(`    ${topic.padEnd(width)} ${formatDistribution(d)}`);
    }
    // #3154: RESEARCH.* signals (KEV, open CVEs, BSI advisories, end of life) per app.
    const counted = result.apps.filter((a) => typeof a.signalCount === 'number');
    if (counted.length > 0) {
      const total = counted.reduce((n, a) => n + (a.signalCount ?? 0), 0);
      lines.push(`  RESEARCH signals: ${total} across ${counted.filter((a) => (a.signalCount ?? 0) > 0).length} app(s) (apps/<id>/wsp/signals/research-signals.json)`);
    }
    // #3289: LLM-augmented topics, in every tier; say which LLM answered, or why none did.
    const llmTopics = result.llmTopics ?? [];
    if (result.llm) {
      lines.push(`  LLM research: ${llmTopics.join(', ')} via ${result.llm.provider} / ${result.llm.model}. Findings and sources are model-cited and unverified until an analyst reviews them (reviewed_by).`);
    } else if (llmTopics.length > 0 && result.apps.length > 0 && result.llmSkipReason === 'skipped_by_user') {
      // #3304: --skip-llm; stubs with earlier LLM findings for the same inputs were kept.
      lines.push(`  Not researched: ${llmTopics.length} LLM topic(s) per app (${llmTopics.join(', ')}), skipped by --skip-llm. Earlier LLM findings were kept; run swao service research without --skip-llm to research them.`);
    } else if (llmTopics.length > 0 && result.apps.length > 0) {
      const why = result.llmSkipReason === 'llm_unavailable' ? 'the configured LLM provider could not be used' : 'no LLM provider is configured';
      lines.push(`  Not researched: ${llmTopics.length} LLM topic(s) per app (${llmTopics.join(', ')}), ${llmTopics.length * result.apps.length} stub(s) in total, because ${why}. LLM-augmented research is available in every licence tier: configure providers.llm.primary in .swao.yml (or run swao setup) and run swao service research again.`);
    }
  }
  return lines.join('\n');
}

export async function runServiceResearchCli(opts: ServiceResearchCliOptions, onProgress: (line: string) => void): Promise<ServiceResearchResult> {
  try {
    LicenseGuard.load().requireFeature('service-assessment');
  } catch (e) {
    if (!(e instanceof LicenseInvalidError)) throw e;
  }
  const workspacePath = opts.workspace ? resolve(opts.workspace) : findWorkspace(process.cwd());
  if (!workspacePath || !existsSync(join(workspacePath, '.swao.yml'))) throw new Error('no SWAO workspace found; run swao service init first');
  // #3289: no tier gate; the LLM topics need only a configured workspace LLM.
  // #3304: with --skip-llm the provider is not built at all (no warning, no LLM call).
  const llm: ResearchLlmResolution = opts.skipLlm ? { llm: null } : resolveResearchLlm(workspacePath);
  if (llm.skipReason) onProgress(`[warn] LLM research skipped: ${llm.detail ?? llm.skipReason}`);
  return runServiceResearch({
    workspacePath,
    llm: llm.llm,
    ...(opts.skipLlm ? { skipLlm: true } : {}),
    ...(llm.skipReason ? { llmSkipReason: llm.skipReason } : {}),
    ...(llm.detail ? { llmSkipDetail: llm.detail } : {}),
    ...(opts.app ? { appId: opts.app } : {}),
    refresh: opts.refresh ?? false,
    dryRun: opts.dryRun ?? false,
    nvdApiKey: await researchKey('NVD_API_KEY'),
    vtApiKey: await researchKey('VT_API_KEY'),
    baseUrls: researchBaseUrls(),
    userAgent: `SWAO/${SWAO_VERSION}`,
    // #3369: route the research feeds (NVD, KEV, OSV, endoflife.date) through
    // HTTPS_PROXY/NO_PROXY and the corporate TLS settings; the pkg runtime's
    // global fetch does not apply the proxy env on a corporate network.
    fetch: createProxyAwareFetch(),
    onProgress,
  });
}

export interface ServiceExportCliOptions {
  workspace?: string;
  json?: boolean;
}

/** What the Enterprise portfolio export wrote (#3116, #3117). */
export interface ServiceExportResult {
  workbook: string;
  starSchema: string[];
  appCount: number;
}

/**
 * Writes the portfolio workbook and star schema for a workspace. #3353: the
 * implementation (runPortfolioExport) lives in the private
 * premium module @swao/module-service-export, which only the Enterprise
 * entry (src/index.ts) imports and injects; the Community and Consultant
 * entries inject serviceExportUnavailable, so their bundles carry no export code.
 */
export type RunServiceExport = (workspacePath: string) => Promise<ServiceExportResult>;

/** Tier slot injected into registerService by the per-tier entry (bootstrap.ts). */
export interface ServiceDeps {
  runExport: RunServiceExport;
}

/**
 * Gated stub for bundles without @swao/module-service-export (Community,
 * Consultant). Unreachable on the normal path: runServiceExportCli checks
 * `service-excel` and `bi-export` first, and the Community / Consultant
 * binaries cap the tier below Enterprise. If that gate is ever bypassed, the
 * command still answers with the same [LICENSE] message and exit 1.
 */
export const serviceExportUnavailable: RunServiceExport = async () => {
  let current: LicenseTier = 'community';
  try { current = LicenseGuard.load().state.tier; } catch { /* unreadable licence counts as Community */ }
  throw new LicenseTierError(FEATURE_GATES['service-excel'], current, 'service-excel');
};

/**
 * Enterprise portfolio exports (Design 103 §8.3, §19.1, #3116, #3117): the
 * multi-sheet workbook (`service-excel`) and the portfolio star schema
 * (`bi-export`). An unreadable licence counts as Community, so it is refused.
 * The gate runs here, before the injected runExport, on every tier.
 */
export async function runServiceExportCli(
  opts: ServiceExportCliOptions,
  runExport: RunServiceExport = serviceExportUnavailable,
): Promise<ServiceExportResult & { workspacePath: string }> {
  const guard = LicenseGuard.load();
  guard.requireFeature('service-excel');
  guard.requireFeature('bi-export');
  const workspacePath = opts.workspace ? resolve(opts.workspace) : findWorkspace(process.cwd());
  if (!workspacePath || !existsSync(join(workspacePath, '.swao.yml'))) throw new Error('no SWAO workspace found; run swao service init first');
  const result = await runExport(workspacePath);
  if (result.appCount === 0) throw new Error('no service apps in this workspace; run swao service init first');
  return { ...result, workspacePath };
}

export interface ServiceRankCliOptions {
  top?: string;
  workspace?: string;
  json?: boolean;
}

/**
 * Read-only selection of the apps to assess first (#3165): the same ranking
 * the TUI uses for "top N", so CI can loop `swao assess --app <id> --type service`.
 */
export function runServiceRankCli(opts: ServiceRankCliOptions): { workspacePath: string; apps: RankedServiceApp[] } {
  const workspacePath = opts.workspace ? resolve(opts.workspace) : findWorkspace(process.cwd());
  if (!workspacePath || !existsSync(join(workspacePath, '.swao.yml'))) throw new Error('no SWAO workspace found; run swao service init first');
  const top = opts.top !== undefined ? Number.parseInt(opts.top, 10) : undefined;
  if (top !== undefined && (!Number.isInteger(top) || top < 1)) throw new Error('--top must be a positive integer');
  return { workspacePath, apps: rankServiceApps(workspacePath, top !== undefined ? { top } : {}) };
}

export function formatServiceRank(apps: readonly RankedServiceApp[]): string {
  if (apps.length === 0) return 'No service apps to assess (none scaffolded, or all decommissioned / unused / inactive).';
  const lines = [`Service apps by priority (${apps.length}): highest SWAO_APM risk first, then integration fan-in`];
  // #3290 (Design 110 D-24): apps without a service assessment run keep their rank but are marked.
  apps.forEach((a, i) => lines.push(`  ${String(i + 1).padStart(3)}. ${a.id}  risk ${a.risk_score ?? 'n/a'}  fan-in ${a.fan_in}  TIME ${a.time_quadrant ?? 'n/a'}${isNotAssessed(a) ? `  [${NOT_ASSESSED_MARK}]` : ''}`));
  const unassessed = apps.filter((a) => isNotAssessed(a)).length;
  if (unassessed > 0) lines.push('', `${unassessed} app(s) marked [${NOT_ASSESSED_MARK}]: no service assessment run yet, so risk and TIME come from intake and research only.`);
  lines.push('');
  lines.push('Assess one: swao assess --app <id> --type service');
  return lines.join('\n');
}

export function registerService(program: Command, deps: ServiceDeps = { runExport: serviceExportUnavailable }): void {
  const service = program
    .command('service')
    .description('Service Portfolio Assessment: assess third-party, SaaS, and COTS apps from an Excel intake (no source code required)');

  service
    .command('init')
    .description('Scaffold one app per intake row: parse the workbook, scrub PII columns, classify against SWAO-INFRA-CAT, detect clusters')
    .option('--from <xlsx>', 'Intake Excel workbook (.xlsx); default: the single .xlsx in wsp/inputs/service-intake/ of the workspace')
    .option('--mapping <yaml>', 'Column-map YAML for a non-standard workbook layout (Design 103 §21.1); default: a *column-map*.yaml next to the workbook in wsp/inputs/service-intake/, else header detection')
    .option('--workspace <dir>', 'Workspace root (default: nearest .swao.yml above the current directory, else the current directory)')
    .option('--refresh', 'Update existing service apps from the intake file; only keys listed in generated_fields are rewritten')
    .option('--cluster-threshold <n>', 'Minimum identical rows that form a cluster (default: 3, or service_portfolio.cluster_threshold)')
    .option('--json', 'Print the result as JSON (no PII values are included)')
    .action(async (opts: ServiceInitCliOptions) => {
      try {
        const { result, workspacePath: ws, workspaceCreated } = await runServiceInitCli(opts);
        if (workspaceCreated && !opts.json) console.log(`Created workspace .swao.yml at ${ws}`);
        if (opts.json) {
          console.log(JSON.stringify(result.ok
            ? { ok: true, workspace: ws, apps: result.apps.map((a) => ({ app_id: a.appId, infra_category: a.config.infra_category, cluster_members: a.members.length })), write: result.write, signal_count: result.signals.length, unknown: result.unknownAppIds, warnings: result.warnings }
            : { ok: false, reason: result.reason, duplicate_ids: result.duplicateIds }, null, 2));
        } else {
          console.log(formatServiceInitSummary(result, ws));
        }
        if (!result.ok) process.exitCode = 1;
      } catch (e) {
        console.error(`[error] ${(e as Error).message}`);
        process.exitCode = 1;
      }
    });

  service
    .command('research')
    .description('Research CVE, end-of-life, and VirusTotal status from public APIs and, with a workspace LLM, vendor profile, certifications, data residency, and breach history (Pass 24 RESEARCH)')
    .option('--app <id>', 'Research one app (default: all service apps in the workspace)')
    .option('--workspace <dir>', 'Workspace root (default: nearest .swao.yml above the current directory)')
    .option('--refresh', 'Re-query every source even when stubs are within their cache period (reviewed stubs are never rewritten)')
    .option('--dry-run', 'Print which stubs would be created or refreshed; no requests, no writes')
    .option('--skip-llm', 'Skip the four LLM topics (vendor profile, certifications, data residency, breach history); earlier LLM findings are kept')
    .option('--json', 'Print the result as JSON')
    .action(async (opts: ServiceResearchCliOptions) => {
      try {
        const result = await runServiceResearchCli(opts, opts.json ? () => {} : (line) => console.log(line));
        console.log(opts.json ? JSON.stringify(result, null, 2) : formatServiceResearchSummary(result));
        if (!result.dryRun && !opts.json) {
          try {
            const ws = opts.workspace ? resolve(opts.workspace) : findWorkspace(process.cwd());
            if (ws) {
              const s = buildPortfolioSummary(ws);
              // #3241: headline figures cover assessed apps only; say so.
              console.log(`  SWAO_APM: portfolio risk ${s.portfolio_risk_score ?? 'n/a'}; TIME ${Object.entries(s.time_distribution).filter(([, n]) => n > 0).map(([q, n]) => `${q} ${n}`).join(', ') || 'none'} (over ${s.assessed_count ?? 0} assessed of ${s.app_count} apps)  ->  wsp/portfolio-summary.json`);
              const hubs = [...s.apps].filter((a) => (a.fan_in ?? 0) > 0).sort((a, b) => (b.fan_in ?? 0) - (a.fan_in ?? 0)).slice(0, 5);
              // #3290: the hub ranking marks apps without a service assessment run.
              if (hubs.length > 0) console.log(`  Integration hubs: ${hubs.map((h) => `${h.id} (${h.fan_in} dependents${isNotAssessed(h) ? `, ${NOT_ASSESSED_MARK}` : ''})`).join(', ')}`);
              const delta = recordPortfolioDelta(ws, s);
              console.log(`  Delta: ${delta.baseline ? 'baseline established' : `${delta.items.length} change(s)`}  ->  ${delta.reportPath}`);
            }
          } catch (e) {
            console.warn(`[warn] SWAO_APM portfolio summary not updated: ${(e as Error).message}`);
          }
        }
      } catch (e) {
        console.error(`[error] ${(e as Error).message}`);
        process.exitCode = 1;
      }
    });

  service
    .command('export')
    .description('Enterprise: write the portfolio workbook (wsp/reports/swao-portfolio-YYYYMMDD.xlsx) and star schema (wsp/star-schema/portfolio-*.json)')
    .option('--workspace <dir>', 'Workspace root (default: nearest .swao.yml above the current directory)')
    .option('--json', 'Print the written paths as JSON')
    .action(async (opts: ServiceExportCliOptions) => {
      try {
        const r = await runServiceExportCli(opts, deps.runExport);
        if (opts.json) {
          console.log(JSON.stringify({ ok: true, workbook: r.workbook, star_schema: r.starSchema, app_count: r.appCount }, null, 2));
        } else {
          console.log(`[ok]  Portfolio workbook (${r.appCount} apps)  ->  ${r.workbook}`);
          console.log(`[ok]  Star schema: ${r.starSchema.length} tables  ->  ${join(r.workspacePath, 'wsp', 'star-schema')}`);
        }
      } catch (e) {
        if (e instanceof LicenseTierError) printLicenseGateError(e.feature ?? 'swao service export', e.required, e.current);
        else console.error(`[error] ${(e as Error).message}`);
        process.exitCode = 1;
      }
    });

  service
    .command('rank')
    .description('List service apps in assessment priority order (highest SWAO_APM risk first; decommissioned, unused, inactive left out), for "top N" runs and CI loops')
    .option('--top <n>', 'Only the first n apps')
    .option('--workspace <dir>', 'Workspace root (default: nearest .swao.yml above the current directory)')
    .option('--json', 'Print the ranked apps as JSON')
    .action((opts: ServiceRankCliOptions) => {
      try {
        const r = runServiceRankCli(opts);
        console.log(opts.json ? JSON.stringify({ ok: true, apps: r.apps }, null, 2) : formatServiceRank(r.apps));
      } catch (e) {
        console.error(`[error] ${(e as Error).message}`);
        process.exitCode = 1;
      }
    });
}
