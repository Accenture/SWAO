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
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { appKind, credentialStore, FEATURE_GATES, findWorkspace, LicenseGuard, LicenseInvalidError, LicenseTierError, logPortfolioAt, type LicenseTier } from '@swao/core';
import { selfSpawnCommand } from '@swao/core';
import { createLlmProvider, createProxyAwareFetch } from '@swao/module-llm-providers';
import {
  buildPortfolioSummary,
  recordPortfolioDelta,
  formatDistribution,
  runServiceInit,
  runServiceResearch,
  resolveServiceIntake,
  copyIntakeTemplate,
  IntakeLocationError,
  rankServiceAppsDetailed,
  emptyServiceRankMessage,
  missingFromSummaryNote,
  readAssessTopN,
  isNotAssessed,
  NOT_ASSESSED_MARK,
  type RankedServiceApp,
  type ServiceRankDetail,
  type ResolvedIntake,
  type ServiceInitResult,
  type ResearchLlm,
  type ServiceResearchResult,
} from '@swao/module-service-assessment';
import { SWAO_VERSION } from '../branding.js';
import { printLicenseGateError } from '../lib/license-gate-error.js';
import { buildWorkspaceSwaoYml, runWorkspaceScaffolders } from './init.js';
import { readLlmPrimaryConfig } from './assess.js';
import { readStoredServiceIntake } from '../setup/defaults.js';
import { latestServiceRun, logResearchEstimate, researchPrepareLog, serviceRunLlmFields, ServiceAssessBatchLog } from './service-batch-log.js';
import { writeServicePortfolioBlock } from '../setup/branches/service-checks.js';
import { serviceRunFrameworks } from './framework-selection.js';
import { unknownServiceFrameworks, unknownServiceFrameworksMessage } from '../tui/screens/service-frameworks.js';
// #4400: re-exported for the callers of the service command module.
export { serviceRunFrameworks };

export interface ServiceInitCliOptions {
  /** Intake workbook; default: the single .xlsx in wsp/inputs/service-intake/ (#3211). */
  from?: string;
  mapping?: string;
  workspace?: string;
  refresh?: boolean;
  /** #3521: park the service apps of an earlier, different intake workbook (moved to parked-apps/<stamp>/). */
  replace?: boolean;
  /** #3521: add the new apps next to those of an earlier, different intake workbook. */
  keep?: boolean;
  clusterThreshold?: string;
  json?: boolean;
  /** #4225: copy the blank intake workbook template into wsp/inputs/service-intake/ and stop (no scaffold). */
  template?: boolean;
}

/** The hint the "no intake workbook" error carries (#4225, CLI parity with the Setup Intake step). */
export const INTAKE_TEMPLATE_CLI_HINT = 'or run swao service init --template to copy a blank intake template there and fill it in';

export interface ServiceTemplateCliResult {
  workspacePath: string;
  workspaceCreated: boolean;
  /** Absolute path of the template. */
  templatePath: string;
  /** False when a file of that name was there already (kept). */
  created: boolean;
  /** The service_portfolio block is present (written now or before). */
  serviceWorkspace: boolean;
}

/**
 * #4225 (owner decision D-3, CLI parity with the Setup Service branch): make
 * the workspace a service workspace (the `service_portfolio` block with the
 * intake folder) and copy the blank intake workbook template into
 * wsp/inputs/service-intake/. An existing template is never overwritten.
 * No prompt (CI-safe).
 */
export async function runServiceTemplateCli(opts: Pick<ServiceInitCliOptions, 'workspace'>): Promise<ServiceTemplateCliResult> {
  const ws = ensureServiceWorkspace(opts.workspace);
  const serviceWorkspace = writeServicePortfolioBlock(ws.path);
  const copy = await copyIntakeTemplate(ws.path);
  return { workspacePath: ws.path, workspaceCreated: ws.created, templatePath: copy.path, created: copy.created, serviceWorkspace };
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
    switch (result.reason) {
      case 'duplicate_ids':
        lines.push(`[error] Scaffold halted: ${result.duplicateIds.length} duplicate app ID(s); no folders were written.`);
        for (const id of result.duplicateIds) lines.push(`  - ${id}`);
        lines.push('Make the IDs unique in the intake workbook, then re-run swao service init.');
        return lines.join('\n');
      case 'other_intake_source': {
        // #3521: two workbooks describing the same servers scaffold every service twice.
        const ids = result.conflict.appIds;
        lines.push(`[error] Scaffold halted: the workspace already holds ${ids.length} service app(s) from another intake workbook (${result.conflict.sources.join(', ')}); ${result.source.name} would add ${result.plannedAppCount} app(s). Nothing was written.`);
        lines.push(`  Apps from the other workbook: ${ids.slice(0, 5).join(', ')}${ids.length > 5 ? `, +${ids.length - 5} more` : ''}`);
        lines.push('  Two workbooks that describe the same servers scaffold every service twice. Choose one:');
        lines.push('    --replace   move the apps of the other workbook to parked-apps/<timestamp>/ and scaffold this one');
        lines.push('    --keep      add the apps of this workbook next to the existing ones');
        lines.push('    or scaffold into a new workspace (--workspace <dir>)');
        return lines.join('\n');
      }
      default: {
        const never: never = result;
        return String(never);
      }
    }
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
  if (result.parked && result.parked.appIds.length > 0) {
    lines.push(`  [info] ${result.parked.appIds.length} service app(s) of the earlier intake workbook moved to ${result.parked.dir}/ (--replace).`);
  }
  if ((result.keptOtherSource ?? []).length > 0) {
    lines.push(`  [warn] ${(result.keptOtherSource ?? []).length} service app(s) of another intake workbook were kept (--keep); check swao service rank for services listed twice.`);
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
  // #4198 (Design 125 section 5.7): before the folder scan, the workbook and
  // mapping the Service setup stored (service_portfolio.intake / .mapping).
  const stored = opts.from ? {} : readStoredServiceIntake(target);
  let located: ResolvedIntake | null = null;
  try {
    located = opts.from ? null
      : stored.intake ? { intakePath: stored.intake, mappingPath: stored.mapping ?? null }
        : resolveServiceIntake(target);
  } catch (e) {
    // #4225: name the blank template when the intake folder holds no workbook.
    if (e instanceof IntakeLocationError && /no intake workbook found/.test(e.message)) throw new IntakeLocationError(`${e.message}, ${INTAKE_TEMPLATE_CLI_HINT}`);
    throw e;
  }
  const intakePath = opts.from ? resolve(opts.from) : (located as ResolvedIntake).intakePath;
  if (!existsSync(intakePath)) throw new Error(`intake file not found: ${opts.from}`);
  const mappingPath = opts.mapping ? resolve(opts.mapping) : located?.mappingPath ?? undefined;
  if (mappingPath && !existsSync(mappingPath)) throw new Error(`mapping file not found: ${opts.mapping}`);
  if (opts.replace && opts.keep) throw new Error('--replace and --keep exclude each other');
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
    otherSource: opts.replace ? 'replace' : opts.keep ? 'keep' : 'refuse',
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
  /** #4236: model for the four LLM research topics (default: service_portfolio.research_model, else the primary model). */
  model?: string;
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
/** #4236: `service_portfolio.research_model` of the workspace .swao.yml, when set. */
export function readResearchModelSetting(raw: unknown): string | undefined {
  const sp = raw && typeof raw === 'object' ? (raw as Record<string, unknown>)['service_portfolio'] : undefined;
  const m = sp && typeof sp === 'object' ? (sp as Record<string, unknown>)['research_model'] : undefined;
  return typeof m === 'string' && m.trim() ? m.trim() : undefined;
}

export function resolveResearchLlm(workspacePath: string, factory: typeof createLlmProvider = createLlmProvider, modelOverride?: string): ResearchLlmResolution {
  let cfg: ReturnType<typeof readLlmPrimaryConfig>;
  let researchModel: string | undefined;
  try {
    const raw = loadYaml(readFileSync(join(workspacePath, '.swao.yml'), 'utf-8'));
    cfg = raw && typeof raw === 'object' ? readLlmPrimaryConfig(raw as Record<string, unknown>) : undefined;
    researchModel = readResearchModelSetting(raw);
  } catch {
    cfg = undefined; // unreadable .swao.yml: other commands report it; the env vars may still configure an LLM
  }
  // #4236: a cheaper research model (the --model option, else service_portfolio.research_model).
  const model = modelOverride?.trim() || researchModel;
  if (cfg && model) cfg = { ...cfg, model };
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
    // #4270 / #4238: why a topic had nothing to look up, per reason (no_api_key is a setup gap).
    const reasons = Object.entries(result.skippedReasons ?? {}).filter(([, byReason]) => Object.keys(byReason).length > 0);
    if (reasons.length > 0) {
      lines.push(`  Skipped topics: ${reasons.map(([topic, byReason]) => `${topic} ${Object.entries(byReason).map(([r, n]) => `${r} ${n}`).join(', ')}`).join('; ')}`);
    }
    if ((result.failed ?? []).length > 0) {
      const f = result.failed ?? [];
      lines.push(`  [warn] Research failed for ${f.length} app(s): ${f.slice(0, 10).map((x) => `${x.appId} (${x.reason})`).join('; ')}${f.length > 10 ? `; +${f.length - 10} more` : ''}`);
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
  const prepareStartedAt = Date.now();
  const workspacePath = opts.workspace ? resolve(opts.workspace) : findWorkspace(process.cwd());
  // #4485: the first line of the research child, before any preparation step,
  // then one phase line per step with its duration (prepare.complete follows in runServiceResearch).
  const prep = researchPrepareLog(workspacePath, opts.app ?? null);
  prep.start();
  try {
    LicenseGuard.load().requireFeature('service-assessment');
  } catch (e) {
    if (!(e instanceof LicenseInvalidError)) throw e;
  }
  if (!workspacePath || !existsSync(join(workspacePath, '.swao.yml'))) throw new Error('no SWAO workspace found; run swao service init first');
  prep.phase('check the licence and the workspace');
  // #3289: no tier gate; the LLM topics need only a configured workspace LLM.
  // #3304: with --skip-llm the provider is not built at all (no warning, no LLM call).
  const llm: ResearchLlmResolution = opts.skipLlm ? { llm: null } : resolveResearchLlm(workspacePath, createLlmProvider, opts.model);
  if (llm.skipReason) onProgress(`[warn] LLM research skipped: ${llm.detail ?? llm.skipReason}`);
  prep.phase('build the LLM provider');
  // #4270: the expected LLM calls and cost, logged before the batch starts.
  if (llm.llm && !opts.dryRun) {
    logResearchEstimate(workspacePath, { model: llm.llm.model ?? null, ...(opts.app ? { appId: opts.app } : {}) });
    prep.phase('estimate the research calls');
  }
  return runServiceResearch({
    prepareStartedAt,
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
/**
 * #4457: start and complete (or failed) events of a step of a service child
 * process that can run for minutes without a line: `<code>.start`, then
 * `<code>.complete` with `duration_ms` and the context `done` returns, or
 * `<code>.failed` with the error. Portfolio log of the workspace, never mirrored
 * to the console (the step prints its own result line). Best effort.
 */
export async function timedServiceStep<T>(workspace: string, code: string, label: string, run: () => T | Promise<T>, done: (r: T) => Record<string, unknown> = () => ({})): Promise<T> {
  const log = (level: 'info' | 'warn', c: string, message: string, context: Record<string, unknown>): void => {
    try { logPortfolioAt(workspace, level, c, message, { context, mirror: false }); } catch { /* logging never stops a run */ }
  };
  const t0 = Date.now();
  log('info', `${code}.start`, `${label} started`, {});
  try {
    const r = await run();
    const ms = Date.now() - t0;
    log('info', `${code}.complete`, `${label} complete (${Math.round(ms / 100) / 10} s)`, { duration_ms: ms, ...done(r) });
    return r;
  } catch (e) {
    log('warn', `${code}.failed`, `${label} failed: ${(e as Error).message}`, { duration_ms: Date.now() - t0 });
    throw e;
  }
}

export async function runServiceExportCli(
  opts: ServiceExportCliOptions,
  runExport: RunServiceExport = serviceExportUnavailable,
): Promise<ServiceExportResult & { workspacePath: string }> {
  const guard = LicenseGuard.load();
  guard.requireFeature('service-excel');
  guard.requireFeature('bi-export');
  const workspacePath = opts.workspace ? resolve(opts.workspace) : findWorkspace(process.cwd());
  if (!workspacePath || !existsSync(join(workspacePath, '.swao.yml'))) throw new Error('no SWAO workspace found; run swao service init first');
  // #4457: the export (portfolio summary, star schema, workbook) runs for minutes in a large workspace.
  const result = await timedServiceStep(workspacePath, 'service.export', 'Portfolio export (workbook and star schema)', () => runExport(workspacePath),
    (r) => ({ app_count: r.appCount, star_schema_tables: r.starSchema.length }));
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
export function runServiceRankCli(opts: ServiceRankCliOptions): { workspacePath: string; apps: RankedServiceApp[]; detail: ServiceRankDetail } {
  const workspacePath = opts.workspace ? resolve(opts.workspace) : findWorkspace(process.cwd());
  if (!workspacePath || !existsSync(join(workspacePath, '.swao.yml'))) throw new Error('no SWAO workspace found; run swao service init first');
  const top = opts.top !== undefined ? Number.parseInt(opts.top, 10) : undefined;
  if (top !== undefined && (!Number.isInteger(top) || top < 1)) throw new Error('--top must be a positive integer');
  // #4389: the detail names why apps are missing or the list is empty.
  const detail = rankServiceAppsDetailed(workspacePath, top !== undefined ? { top } : {});
  return { workspacePath, apps: detail.apps, detail };
}

export interface ServiceAssessCliOptions {
  top?: string;
  /** #4400: one service app instead of the top N (the TUI "One service" scope). */
  app?: string;
  /** #4400: comma-separated frameworks for this run; SWAO_APM is always added. */
  regimes?: string;
  workspace?: string;
  dryRun?: boolean;
}

/** Runs `swao <args>` for one app and returns its exit code; injectable for tests. */
export type ServiceAssessRunner = (args: string[]) => number;

/**
 * #3520: one `swao assess --app <id> --type service` per app, as the TUI runs it.
 * #4400: `regimes` (the framework step, `swao service assess --regimes`) becomes
 * `--regimes SWAO_APM,<added>`, which the assess command adds to each app's default
 * frameworks (owner decision 2026-11-15); without it the app default applies and
 * the assess command adds SWAO_APM when the default lacks it.
 */
export function serviceAssessArgs(workspace: string, appId: string, regimes?: readonly string[]): string[] {
  return ['assess', '--app', appId, '--type', 'service', '--workspace', workspace, ...(regimes ? ['--regimes', serviceRunFrameworks(regimes).join(',')] : [])];
}

/** #4400: the id of a service app (`assessment.type: service`) under apps/, or an error naming the problem. */
export function requireServiceApp(workspacePath: string, appId: string): void {
  const dir = join(workspacePath, 'apps', appId);
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(appId) || !existsSync(join(dir, '.swao.yml'))) throw new Error(`no app "${appId}" under apps/ of ${workspacePath}; swao service rank lists the service apps`);
  if (appKind(dir) !== 'service') throw new Error(`app "${appId}" is an application, not a service app; assess it with swao assess --app ${appId}`);
}

/** Default runner: this SWAO binary (or node + script) as a child, output inherited. */
export const spawnSwaoChild: ServiceAssessRunner = (args) => {
  // #4241: central self-spawn helper (pkg binary and node dist).
  const selfCmd = selfSpawnCommand(args);
  const r = spawnSync(selfCmd.command, selfCmd.args, {
    stdio: 'inherit',
    windowsHide: true,
    env: selfCmd.env,
  });
  return r.status ?? 1;
};

/**
 * #3520: `swao service assess --top <n>`, the CLI path of the TUI's "Top N by
 * risk": the first n apps of `swao service rank`, assessed one after another.
 * N defaults to `service_portfolio.assess_top_n` (20 when unset).
 */
export function runServiceAssessCli(
  opts: ServiceAssessCliOptions,
  run: ServiceAssessRunner = spawnSwaoChild,
  log: (line: string) => void = console.log,
): { workspacePath: string; apps: string[]; failed: string[] } {
  const workspacePath = opts.workspace ? resolve(opts.workspace) : findWorkspace(process.cwd());
  if (!workspacePath || !existsSync(join(workspacePath, '.swao.yml'))) throw new Error('no SWAO workspace found; run swao service init first');
  // #4400: --regimes adds frameworks to SWAO_APM and each app's defaults for every assessed app.
  const regimes = opts.regimes !== undefined ? opts.regimes.split(',').map((r) => r.trim()).filter((r) => r !== '' && r !== 'none') : undefined;
  // #4456: only SWAO_APM and the frameworks installed in the workspace can be added (TUI parity).
  const unknown = regimes ? unknownServiceFrameworks(workspacePath, regimes) : [];
  if (unknown.length > 0) throw new Error(unknownServiceFrameworksMessage(unknown));
  // #4400: --app assesses one service app (the TUI "One service" scope); --top the first n by risk.
  if (opts.app !== undefined) {
    if (opts.top !== undefined) throw new Error('--app and --top exclude each other: --app assesses one service app, --top the first n by risk');
    const id = opts.app.trim();
    requireServiceApp(workspacePath, id);
    log(`Assessing the service app ${id} (frameworks: ${serviceRunFrameworks(regimes).join(', ')}${regimes ? '' : ' and the app default'})`);
    if (opts.dryRun) return { workspacePath, apps: [id], failed: [] };
    const batch = new ServiceAssessBatchLog(workspacePath, [id], { selection: 'one service app', caller: 'cli.service.assess' });
    const before = latestServiceRun(workspacePath, id);
    const t0 = Date.now();
    const code = run(serviceAssessArgs(workspacePath, id, regimes));
    const after = latestServiceRun(workspacePath, id);
    batch.progress({
      appId: id, status: code === 0 ? 'ok' : 'failed', exitCode: code, durationMs: Date.now() - t0,
      ...serviceRunLlmFields(workspacePath, id, before, after), // #4457: cost, LLM calls, model
      ...(code !== 0 ? { reason: `swao assess exited with code ${code}` } : {}),
    });
    batch.complete();
    log(code === 0 ? `Service app ${id} assessed.` : `The assessment of ${id} failed (exit code ${code}).`);
    return { workspacePath, apps: [id], failed: code === 0 ? [] : [id] };
  }
  const top = opts.top !== undefined ? Number(opts.top) : readAssessTopN(workspacePath);
  if (!Number.isInteger(top) || top < 1) throw new Error('--top must be a positive integer');
  const detail = rankServiceAppsDetailed(workspacePath, { top });
  const apps = detail.apps.map((a) => a.id);
  if (apps.length === 0) {
    // #4389: name the cause (none scaffolded, or all left out by status).
    log(emptyServiceRankMessage(detail));
    return { workspacePath, apps, failed: [] };
  }
  log(`Assessing the top ${apps.length} service app(s) by risk${apps.length < top ? ` (${top} requested)` : ''}: ${apps.join(', ')}`);
  const note = missingFromSummaryNote(detail);
  if (note) log(note);
  if (opts.dryRun) return { workspacePath, apps, failed: [] };
  const failed: string[] = [];
  // #4273: batch start, one progress line per app, batch complete (portfolio log).
  const batch = new ServiceAssessBatchLog(workspacePath, apps, { selection: `top ${top} by risk`, caller: 'cli.service.assess' });
  apps.forEach((id, i) => {
    log(`[${i + 1}/${apps.length}] ${id}`);
    const before = latestServiceRun(workspacePath, id);
    const t0 = Date.now();
    const code = run(serviceAssessArgs(workspacePath, id, regimes));
    const after = latestServiceRun(workspacePath, id);
    if (code !== 0) failed.push(id);
    batch.progress({
      appId: id, status: code === 0 ? 'ok' : 'failed', exitCode: code, durationMs: Date.now() - t0,
      ...serviceRunLlmFields(workspacePath, id, before, after), // #4457: cost, LLM calls, model
      ...(code !== 0 ? { reason: `swao assess exited with code ${code}` } : {}),
    });
  });
  batch.complete();
  log(failed.length === 0 ? `All ${apps.length} app(s) assessed.` : `${failed.length} of ${apps.length} app(s) failed: ${failed.join(', ')}`);
  return { workspacePath, apps, failed };
}

/**
 * #4389: `detail` (from rankServiceAppsDetailed) names the cause of an empty list
 * and notes the service apps the portfolio summary does not list yet.
 */
export function formatServiceRank(apps: readonly RankedServiceApp[], detail?: Pick<ServiceRankDetail, 'scaffolded' | 'excludedByStatus' | 'missingFromSummary'>): string {
  if (apps.length === 0) return detail ? emptyServiceRankMessage(detail) : 'No service apps to assess (none scaffolded, or all decommissioned, unused or inactive).';
  const lines = [`Service apps by priority (${apps.length}): highest SWAO_APM risk first, then integration fan-in`];
  // #3290 (Design 110 D-24): apps without a service assessment run keep their rank but are marked.
  apps.forEach((a, i) => lines.push(`  ${String(i + 1).padStart(3)}. ${a.id}  risk ${a.risk_score ?? 'n/a'}  fan-in ${a.fan_in}  TIME ${a.time_quadrant ?? 'n/a'}${isNotAssessed(a) ? `  [${NOT_ASSESSED_MARK}]` : ''}`));
  const unassessed = apps.filter((a) => isNotAssessed(a)).length;
  if (unassessed > 0) lines.push('', `${unassessed} app(s) marked [${NOT_ASSESSED_MARK}]: no service assessment run yet, so risk and TIME come from intake and research only.`);
  // #4389: service apps added from apps/ because the summary predates service init.
  const note = detail ? missingFromSummaryNote(detail) : null;
  if (note) lines.push('', note);
  lines.push('');
  lines.push('Assess one: swao service assess --app <id>');
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
    .option('--replace', 'If the workspace holds service apps from another intake workbook: move them to parked-apps/<timestamp>/ and scaffold this workbook')
    .option('--keep', 'If the workspace holds service apps from another intake workbook: add the apps of this workbook next to them')
    .option('--cluster-threshold <n>', 'Minimum identical rows that form a cluster (default: 3, or service_portfolio.cluster_threshold)')
    .option('--json', 'Print the result as JSON (no PII values are included)')
    .option('--template', 'Copy a blank intake workbook template (the recognised columns, no rows) into wsp/inputs/service-intake/ and stop; an existing template is kept')
    .action(async (opts: ServiceInitCliOptions) => {
      try {
        if (opts.template) {
          const t = await runServiceTemplateCli(opts);
          if (opts.json) {
            console.log(JSON.stringify({ ok: true, workspace: t.workspacePath, template: t.templatePath, created: t.created, service_workspace: t.serviceWorkspace }, null, 2));
          } else {
            if (t.workspaceCreated) console.log(`Created workspace .swao.yml at ${t.workspacePath}`);
            console.log(t.created ? `Blank intake template copied to ${t.templatePath}` : `Intake template already there, kept: ${t.templatePath}`);
            if (!t.serviceWorkspace) console.log('  [warn] Could not write the service_portfolio block to the workspace .swao.yml.');
            console.log('Next: fill in one row per service or server, save the workbook, then run swao service init');
          }
          return;
        }
        const { result, workspacePath: ws, workspaceCreated } = await runServiceInitCli(opts);
        if (workspaceCreated && !opts.json) console.log(`Created workspace .swao.yml at ${ws}`);
        if (opts.json) {
          console.log(JSON.stringify(result.ok
            ? { ok: true, workspace: ws, apps: result.apps.map((a) => ({ app_id: a.appId, infra_category: a.config.infra_category, cluster_members: a.members.length })), write: result.write, signal_count: result.signals.length, unknown: result.unknownAppIds, warnings: result.warnings, source: result.source.name, parked: result.parked, kept_other_source: result.keptOtherSource }
            : result.reason === 'duplicate_ids'
              ? { ok: false, reason: result.reason, duplicate_ids: result.duplicateIds }
              : { ok: false, reason: result.reason, message: formatServiceInitSummary(result, ws), other_source: { app_count: result.conflict.appIds.length, app_ids: result.conflict.appIds, sources: result.conflict.sources }, planned_app_count: result.plannedAppCount, options: ['--replace', '--keep', '--workspace <new dir>'] }, null, 2));
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
    .option('--model <id>', 'Model for the four LLM topics, for example a cheaper one than the primary (default: service_portfolio.research_model, else providers.llm.primary.model)')
    .option('--json', 'Print the result as JSON')
    .action(async (opts: ServiceResearchCliOptions) => {
      try {
        const result = await runServiceResearchCli(opts, opts.json ? () => {} : (line) => console.log(line));
        console.log(opts.json ? JSON.stringify(result, null, 2) : formatServiceResearchSummary(result));
        // #4270: the batch continues past a failed app; the exit code still reports it.
        if ((result.failed ?? []).length > 0) process.exitCode = 1;
        if (!result.dryRun && !opts.json) {
          try {
            const ws = opts.workspace ? resolve(opts.workspace) : findWorkspace(process.cwd());
            if (ws) {
              // #4457: the rebuild after research (the silence between service.research.complete
              // and the next step) logs start and complete with the phase times of #4412.
              let stats: Record<string, unknown> = {};
              const s = await timedServiceStep(ws, 'service.research.portfolio_summary', 'SWAO_APM portfolio summary rebuild after research',
                () => buildPortfolioSummary(ws, { onStats: (st) => { stats = { ...st }; } }), () => stats);
              // #3241: headline figures cover assessed apps only; say so.
              console.log(`  SWAO_APM: portfolio risk ${s.portfolio_risk_score ?? 'n/a'}; TIME ${Object.entries(s.time_distribution).filter(([, n]) => n > 0).map(([q, n]) => `${q} ${n}`).join(', ') || 'none'} (over ${s.assessed_count ?? 0} assessed of ${s.app_count} apps)  ->  wsp/portfolio-summary.json`);
              const hubs = [...s.apps].filter((a) => (a.fan_in ?? 0) > 0).sort((a, b) => (b.fan_in ?? 0) - (a.fan_in ?? 0)).slice(0, 5);
              // #3290: the hub ranking marks apps without a service assessment run.
              if (hubs.length > 0) console.log(`  Integration hubs: ${hubs.map((h) => `${h.id} (${h.fan_in} dependents${isNotAssessed(h) ? `, ${NOT_ASSESSED_MARK}` : ''})`).join(', ')}`);
              const delta = await timedServiceStep(ws, 'service.research.portfolio_delta', 'Portfolio delta report', () => recordPortfolioDelta(ws, s), (d) => ({ changes: d.items.length }));
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
    .command('assess')
    .description('Assess the top N service apps by risk, one after another (same order as swao service rank; the TUI "Top N by risk" path), or one service app with --app (the TUI "One service" scope)')
    .option('--top <n>', 'Number of apps (default: service_portfolio.assess_top_n in .swao.yml, else 20)')
    .option('--app <id>', 'Assess this one service app instead of the top N (not with --top)')
    .option('--regimes <ids>', 'Comma-separated community frameworks added to SWAO_APM and each app default for this run; SWAO_APM is always evaluated (default: the app default)')
    .option('--workspace <dir>', 'Workspace root (default: nearest .swao.yml above the current directory)')
    .option('--dry-run', 'List the apps that would be assessed, without assessing')
    .action((opts: ServiceAssessCliOptions) => {
      try {
        const r = runServiceAssessCli(opts);
        if (r.failed.length > 0) process.exitCode = 1;
      } catch (e) {
        console.error(`[error] ${(e as Error).message}`);
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
        console.log(opts.json ? JSON.stringify({ ok: true, apps: r.apps, missing_from_summary: r.detail.missingFromSummary }, null, 2) : formatServiceRank(r.apps, r.detail));
      } catch (e) {
        console.error(`[error] ${(e as Error).message}`);
        process.exitCode = 1;
      }
    });
}
