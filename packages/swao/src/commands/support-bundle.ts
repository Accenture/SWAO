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

// `swao support-bundle` -- collect a PII-free diagnostic bundle of SWAO event
// logs and environment info for support hand-off (#1515, #1599).
//
// Bundle v2.3 contents (#2965):
//   manifest.json            -- SWAO version, OS, Node, license tier, pii_attestation, prior_bundles
//   execution-trace.ndjson   -- event codes + timestamps + PII-redacted message and context (#2421)
//   environment.json         -- platform, arch, node_version, swao_env_vars, runtime_mode,
//                               cwd_depth, node_env, binary_signature (no hostname, no paths)
//   error-context.json       -- error-level events with PII-redacted context + message_redacted
//   workspace-config.json    -- sanitised .swao.yml with secrets redacted
//   workspace-structure.json -- wsp/apps directory tree (metadata only, no file content)
//   run-manifests.json       -- latest run-manifest.json per app + false_positive_detail +
//                               lz_challenge + ctx_diagnostics (#2965)
//   licence-state.json       -- binary_tier + license_tier + effective_tier + counts + expiry (#2422)
//   lz-catalogue-meta.json   -- catalogue version + provider list
//   health-check.json        -- fresh health-check snapshot (--json mode)
//   pass-inventory.json      -- (v2.1) passes completed in latest run per app + pass_summary
//                               for LLM-driven passes 03/04/11 (#2965)
//   llm-legs-summary.json    -- (v2.1) LLM leg/pass status + latency; score_complete flag (#2965)
//   frameworks-used.json     -- (v2.1) community framework IDs configured per app
//   challenge-agents.json    -- (v2.1) challenge agent inventory + last-run presence per app
//   chat-transcripts.ndjson  -- (v2.2) merged + redacted chat turns from wsp/chat/*.ndjson (#2771)
//   agent-runs-index.json    -- (v2.2) index of wsp/agent-runs/ entries (#2771)
//   chat-session-stats.json  -- (v2.2) session count, turn counts, model usage, per-session
//                               breakdown with suspicious flag (#2965)
//   connector-meta.json      -- (v2.3) connector yaml metadata without credentials (#2965)
//
// Explicitly excluded from every file: prompt content, document text, API keys,
// engagement name, email addresses, absolute filesystem paths, username, hostname,
// base_url (partner-identifying endpoint).

import type { Command } from 'commander';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { homedir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { spawnSync } from 'node:child_process';
import { load as loadYaml } from 'js-yaml';
import type { LogEntry } from '@swao/core';
import { LicenseGuard, logPortfolio, resolveWorkspaceRoot, _paths as licencePaths } from '@swao/core';
import { resolveLzCataloguesDir, loadLzCatalogueIndex } from '@swao/module-landing-zone';
import { SWAO_VERSION } from '../branding.js';
import { buildTar } from '../util/tar-write.js';
import { emptyCounts, redactPiiValue } from '../util/redact-pii.js';

export const BUNDLE_VERSION = '2.3';

function listLogFiles(workspaceRoot: string): string[] {
  const out: string[] = [];
  const portfolioDir = join(workspaceRoot, 'wsp', 'logs');
  if (existsSync(portfolioDir)) {
    for (const f of readdirSync(portfolioDir).sort()) {
      if (f.startsWith('portfolio-events-') && f.endsWith('.ndjson')) {
        out.push(join(portfolioDir, f));
      }
    }
  }
  const appsDir = join(workspaceRoot, 'apps');
  if (existsSync(appsDir)) {
    for (const entry of readdirSync(appsDir)) {
      const candidate = join(appsDir, entry);
      let isDir = false;
      try { isDir = statSync(candidate).isDirectory(); } catch { continue; }
      if (!isDir) continue;
      const logsDir = join(candidate, 'wsp', 'logs');
      if (!existsSync(logsDir)) continue;
      for (const f of readdirSync(logsDir).sort()) {
        if (f.startsWith('app-events-') && f.endsWith('.ndjson')) {
          out.push(join(logsDir, f));
        }
      }
    }
  }
  // #2398: include LLM Assessment per-run logs (llm-assessments/swao/*/log.ndjson).
  // These are written by orchestrator.ts and contain leg-level timing + error events.
  const llmRoot = join(workspaceRoot, 'llm-assessments', 'swao');
  if (existsSync(llmRoot)) {
    let runDirs: string[];
    try { runDirs = readdirSync(llmRoot); } catch { runDirs = []; }
    for (const d of runDirs) {
      const logPath = join(llmRoot, d, 'log.ndjson');
      if (existsSync(logPath)) out.push(logPath);
    }
  }
  return out;
}

function readLogEntries(filePath: string): LogEntry[] {
  const entries: LogEntry[] = [];
  let raw: string;
  try { raw = readFileSync(filePath, 'utf-8'); } catch { return entries; }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line) as LogEntry); } catch { /* skip malformed */ }
  }
  return entries;
}

interface SafeTraceEntry {
  ts: string;
  level: string;
  code: string;
  scope: string;
  app_id?: string;
  run_id?: string;
  // #2421: include PII-redacted message and context so support engineers can diagnose failures.
  message?: string;
  context?: Record<string, unknown>;
}

interface SafeErrorEntry extends SafeTraceEntry {
  message_redacted?: string;
  context?: Record<string, unknown>;
}

// ---- v2.0 artefact builders ----

function buildWorkspaceConfig(workspaceRoot: string, counts: ReturnType<typeof emptyCounts>): unknown {
  const swaoYmlPath = join(workspaceRoot, '.swao.yml');
  if (!existsSync(swaoYmlPath)) return null;
  try {
    const raw = loadYaml(readFileSync(swaoYmlPath, 'utf-8'));
    const config = redactPiiValue(raw, counts);
    // Explicitly redact engagement fields not caught by PII pattern matching
    // (names and codes are arbitrary strings, not email/token shaped).
    if (config !== null && typeof config === 'object' && !Array.isArray(config)) {
      const configObj = config as Record<string, unknown>;
      const engagement = configObj['engagement'];
      if (engagement !== null && typeof engagement === 'object' && !Array.isArray(engagement)) {
        const eng = engagement as Record<string, unknown>;
        if (eng['name'] !== undefined) eng['name'] = '[REDACTED]';
        if (eng['client_code'] !== undefined) eng['client_code'] = '[REDACTED]';
        if (eng['engagement_lead'] !== undefined) eng['engagement_lead'] = '[REDACTED]';
      }
    }
    return config;
  } catch { return null; }
}

interface WspEntry {
  path: string;
  type: 'dir' | 'file';
  size_bytes?: number;
}

function walkDir(dir: string, base: string, depth: number, maxDepth: number, out: WspEntry[]): void {
  if (depth > maxDepth) return;
  let names: string[];
  try { names = readdirSync(dir); } catch { return; }
  for (const name of names) {
    const full = join(dir, name);
    const rel = join(base, name);
    let st: ReturnType<typeof statSync> | undefined;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      out.push({ path: rel, type: 'dir' });
      walkDir(full, rel, depth + 1, maxDepth, out);
    } else if (st.isFile()) {
      out.push({ path: rel, type: 'file', size_bytes: st.size });
    }
  }
}

function buildWorkspaceStructure(workspaceRoot: string): { wsp: WspEntry[]; apps: WspEntry[] } {
  const wsp: WspEntry[] = [];
  const apps: WspEntry[] = [];
  const wspDir = join(workspaceRoot, 'wsp');
  if (existsSync(wspDir)) walkDir(wspDir, 'wsp', 0, 4, wsp);
  const appsDir = join(workspaceRoot, 'apps');
  if (existsSync(appsDir)) {
    for (const app of readdirSync(appsDir)) {
      const appWspDir = join(appsDir, app, 'wsp');
      let isDir = false;
      try { isDir = statSync(join(appsDir, app)).isDirectory(); } catch { continue; }
      if (!isDir || !existsSync(appWspDir)) continue;
      walkDir(appWspDir, join('apps', app, 'wsp'), 0, 3, apps);
    }
  }
  return { wsp, apps };
}

function loadLatestRunManifest(wspDir: string): unknown | null {
  const latestFile = join(wspDir, 'latest.txt');
  if (existsSync(latestFile)) {
    try {
      const ptr = readFileSync(latestFile, 'utf-8').trim();
      const mPath = join(wspDir, ptr, 'run-manifest.json');
      if (existsSync(mPath)) return JSON.parse(readFileSync(mPath, 'utf-8'));
    } catch { /* fall through */ }
  }
  const flat = join(wspDir, 'run-manifest.json');
  if (existsSync(flat)) {
    try { return JSON.parse(readFileSync(flat, 'utf-8')); } catch { /* noop */ }
  }
  return null;
}

function buildRunManifests(workspaceRoot: string): { app_id: string; manifest: unknown }[] {
  const result: { app_id: string; manifest: unknown }[] = [];
  const appsDir = join(workspaceRoot, 'apps');
  if (!existsSync(appsDir)) return result;
  for (const app of readdirSync(appsDir)) {
    let isDir = false;
    try { isDir = statSync(join(appsDir, app)).isDirectory(); } catch { continue; }
    if (!isDir) continue;
    const m = loadLatestRunManifest(join(appsDir, app, 'wsp'));
    if (m) result.push({ app_id: app, manifest: m });
  }
  return result;
}

function buildLicenceState(machineFingerprint: string): Record<string, unknown> {
  // #2422: capture binary_tier, license_tier, and effective_tier separately so a support
  // engineer can immediately see "Consultant license + Community binary -> upgrade binary".
  const binaryTier = process.env['SWAO_BINARY_TIER'] ?? 'community';
  // #2569: raw installed license tier -- read from the platform-specific AppData path
  // set by Batch-1 (#2588). Fallback to legacy ~/.swao-license.json for operators
  // who have not yet had the migration run.
  let licenseTierRaw: string = 'community';
  try {
    const lf = JSON.parse(readFileSync(licencePaths.licensePath, 'utf-8')) as { tier?: string };
    if (typeof lf.tier === 'string' && lf.tier) licenseTierRaw = lf.tier;
  } catch {
    try {
      const lf = JSON.parse(readFileSync(join(homedir(), '.swao-license.json'), 'utf-8')) as { tier?: string };
      if (typeof lf.tier === 'string' && lf.tier) licenseTierRaw = lf.tier;
    } catch { /* no license file or unreadable -- keep default */ }
  }
  try {
    const st = LicenseGuard.load().state;
    return {
      binary_tier: binaryTier,
      license_tier: licenseTierRaw,
      effective_tier: st.tier,
      assessment_count: st.assessmentCount,
      days_elapsed: st.daysElapsed,
      assessment_limit: st.assessmentLimit ?? null,
      expires_at: st.exp ?? null,
      machine_fingerprint: machineFingerprint,
    };
  } catch {
    return { binary_tier: binaryTier, license_tier: licenseTierRaw, effective_tier: 'community', machine_fingerprint: machineFingerprint, error: 'load-failed' };
  }
}

function buildLzCatalogueMeta(workspaceRoot: string): Record<string, unknown> {
  try {
    const dir = resolveLzCataloguesDir(undefined, workspaceRoot);
    if (!dir) return { error: 'no-catalogue-dir' };
    const index = loadLzCatalogueIndex(dir);
    const isWorkspaceOverride = dir.includes(join('wsp', 'inputs', 'catalogs', 'lz-catalogues'));
    return {
      is_workspace_override: isWorkspaceOverride,
      catalogues: index.catalogues.map(c => ({
        provider: c.provider,
        name: c.name,
        last_updated: c.last_updated,
        source: c.source,
        confidence: c.confidence,
      })),
      coming_soon: index.coming_soon,
    };
  } catch { return { error: 'catalogue-load-failed' }; }
}

// ---- v2.1 artefact builders ----

function computeBinarySignature(): { sha256_prefix: string; size_bytes: number | null } {
  try {
    const st = statSync(process.execPath);
    const hash = createHash('sha256')
      .update(SWAO_VERSION + process.platform + process.arch + String(st.size))
      .digest('hex').slice(0, 16);
    return { sha256_prefix: hash, size_bytes: st.size };
  } catch {
    return { sha256_prefix: 'unavailable', size_bytes: null };
  }
}

interface PassInventoryResult {
  passes: Record<string, unknown>;
  false_positive_detail: Record<string, Array<{ signal_id: string; reason: string }>>;
  ctx_diagnostics: Record<string, Record<string, unknown>>;
}

function buildPassInventory(workspaceRoot: string): PassInventoryResult {
  const result: Record<string, unknown> = {};
  const fpDetail: Record<string, Array<{ signal_id: string; reason: string }>> = {};
  const ctxDiag: Record<string, Record<string, unknown>> = {};
  const appsDir = join(workspaceRoot, 'apps');
  if (!existsSync(appsDir)) return { passes: result, false_positive_detail: fpDetail, ctx_diagnostics: ctxDiag };
  let appNames: string[];
  try { appNames = readdirSync(appsDir); } catch { return { passes: result, false_positive_detail: fpDetail, ctx_diagnostics: ctxDiag }; }

  for (const app of appNames) {
    let isDir = false;
    try { isDir = statSync(join(appsDir, app)).isDirectory(); } catch { continue; }
    if (!isDir) continue;
    const appWspDir = join(appsDir, app, 'wsp');

    let runRef = '';
    const latestFile = join(appWspDir, 'latest.txt');
    if (existsSync(latestFile)) {
      try { runRef = readFileSync(latestFile, 'utf-8').trim(); } catch { continue; }
    }

    // Accept passes/ and pass-results/ under both wsp/<ptr> and wsp/runs/<ts>
    const candidateDirs = [
      join(appWspDir, runRef, 'passes'),
      join(appWspDir, runRef, 'pass-results'),
      join(appWspDir, 'runs', runRef, 'passes'),
      join(appWspDir, 'runs', runRef, 'pass-results'),
    ];
    let passesDir = '';
    for (const d of candidateDirs) {
      if (existsSync(d)) { passesDir = d; break; }
    }
    if (!passesDir) {
      const runsDir = join(appWspDir, 'runs');
      if (existsSync(runsDir)) {
        let dirs: string[];
        try { dirs = readdirSync(runsDir).filter(d => /^\d{4}/.test(d)).sort(); } catch { continue; }
        const latest = dirs[dirs.length - 1];
        if (latest) {
          for (const subDir of ['passes', 'pass-results']) {
            const d = join(runsDir, latest, subDir);
            if (existsSync(d)) { passesDir = d; runRef = `runs/${latest}`; break; }
          }
        }
      }
    }
    if (!passesDir) continue;

    // Cross-reference wall_clock_ms from the run manifest by pass name
    const wallClockByPass = new Map<string, number>();
    const runManifest = loadLatestRunManifest(appWspDir) as Record<string, unknown> | null;
    if (runManifest && Array.isArray(runManifest['pass_stats'])) {
      for (const ps of runManifest['pass_stats'] as Array<Record<string, unknown>>) {
        const passName = typeof ps['pass'] === 'string' ? ps['pass'] : null;
        const wc = typeof ps['wall_clock_ms'] === 'number' ? ps['wall_clock_ms'] : null;
        if (passName !== null && wc !== null) wallClockByPass.set(passName, wc);
      }
    }

    const passes: Array<{
      pass_id: string;
      duration_ms?: number;
      signals_emitted?: number;
      exit_status?: string;
      size_bytes: number;
      pass_summary?: Record<string, unknown>;
    }> = [];
    const appFpDetail: Array<{ signal_id: string; reason: string }> = [];
    const appCtxDangling: Array<{ signal_id: string; unresolved_ref: string }> = [];
    const LLM_PASS_PREFIXES = ['03', '04', '11'];
    let passFiles: string[];
    try { passFiles = readdirSync(passesDir); } catch { continue; }
    for (const f of passFiles) {
      if (!f.endsWith('.yaml') && !f.endsWith('.yml')) continue;
      const passId = f.replace(/\.ya?ml$/, '');
      try {
        const st = statSync(join(passesDir, f));
        let duration_ms: number | undefined = wallClockByPass.get(passId);
        let signals_emitted: number | undefined;
        let exit_status: string | undefined;
        let pass_summary: Record<string, unknown> | undefined;
        try {
          const passData = loadYaml(readFileSync(join(passesDir, f), 'utf-8')) as Record<string, unknown>;
          const signals = passData['signals'];
          if (Array.isArray(signals)) signals_emitted = signals.length;
          const passHeader = passData['pass'] as Record<string, unknown> | undefined;
          if (passHeader && typeof passHeader['status'] === 'string') exit_status = passHeader['status'];
          if (duration_ms === undefined && typeof passData['duration_ms'] === 'number') {
            duration_ms = passData['duration_ms'];
          }
          if (Array.isArray(signals)) {
            for (const sig of signals as Array<Record<string, unknown>>) {
              // Gap 1: collect signals flagged as false positives
              if (sig['false_positive_flag'] === true) {
                const sigId = typeof sig['id'] === 'string' ? sig['id'] : 'unknown';
                appFpDetail.push({ signal_id: sigId, reason: 'evidence-not-found' });
              }
              // Gap 7: collect context gaps from pass-04
              if (passId.startsWith('04')) {
                const gaps = sig['context_gaps'];
                if (Array.isArray(gaps) && typeof sig['id'] === 'string') {
                  for (const gap of gaps as Array<Record<string, unknown>>) {
                    const ref = typeof gap['file'] === 'string' ? gap['file'] : null;
                    if (ref) appCtxDangling.push({ signal_id: sig['id'] as string, unresolved_ref: ref });
                  }
                }
              }
            }
            // Gap 3: pass_summary for LLM-driven passes 03, 04, 11
            if (LLM_PASS_PREFIXES.some(p => passId.startsWith(p))) {
              const byStatus: Record<string, number> = {};
              const regimes = new Set<string>();
              const topGaps: string[] = [];
              for (const sig of signals as Array<Record<string, unknown>>) {
                const status = typeof sig['status'] === 'string' ? sig['status'] : 'unknown';
                byStatus[status] = (byStatus[status] ?? 0) + 1;
                const fw = typeof sig['framework_id'] === 'string' ? sig['framework_id']
                  : (typeof sig['regime'] === 'string' ? sig['regime'] : null);
                if (fw) regimes.add(fw);
                if ((status === 'gap' || status === 'non-compliant' || status === 'partial')
                  && typeof sig['id'] === 'string' && topGaps.length < 5) {
                  topGaps.push(sig['id'] as string);
                }
              }
              pass_summary = { signals_by_status: byStatus };
              if (regimes.size > 0) pass_summary['regimes_evaluated'] = [...regimes].sort();
              if (topGaps.length > 0) pass_summary['top_gaps'] = topGaps;
            }
          }
        } catch { /* enrichment failed -- include size_bytes only */ }
        const entry: {
          pass_id: string;
          duration_ms?: number;
          signals_emitted?: number;
          exit_status?: string;
          size_bytes: number;
          pass_summary?: Record<string, unknown>;
        } = { pass_id: passId, size_bytes: st.size };
        if (duration_ms !== undefined) entry.duration_ms = duration_ms;
        if (signals_emitted !== undefined) entry.signals_emitted = signals_emitted;
        if (exit_status !== undefined) entry.exit_status = exit_status;
        if (pass_summary !== undefined) entry.pass_summary = pass_summary;
        passes.push(entry);
      } catch { /* skip */ }
    }
    if (appFpDetail.length > 0) fpDetail[app] = appFpDetail;
    if (appCtxDangling.length > 0) ctxDiag[app] = { dangling_evidence_refs: appCtxDangling };
    result[app] = { run_ref: runRef, pass_count: passes.length, passes };
  }
  return { passes: result, false_positive_detail: fpDetail, ctx_diagnostics: ctxDiag };
}

export function buildLlmLegsSummary(workspaceRoot: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  // #2423: LLM assessment runs live in llm-assessments/swao/<timestamp>/ (not per-app
  // dirs). The former code used llm-assessments/<app>/ which never exists, and read
  // 'legIds' which is not a pub-model field (the actual field is 'legs'). Fix: scan the
  // swao/ kind dir, read publication-model.json per run, extract app_id + legs, keep
  // latest run per app. Matches the path used by report.ts.
  const llmSwaoDir = join(workspaceRoot, 'llm-assessments', 'swao');
  if (!existsSync(llmSwaoDir)) return result;
  let runDirs: string[];
  try { runDirs = readdirSync(llmSwaoDir).filter(d => /^\d{4}/.test(d)).sort(); }
  catch { return result; }

  const latestByApp = new Map<string, { runTs: string; legs: Array<Record<string, unknown>> }>();

  for (const runTs of runDirs) {
    const pubModelPath = join(llmSwaoDir, runTs, 'comparison', 'publication-model.json');
    if (!existsSync(pubModelPath)) continue;
    let pubModel: Record<string, unknown>;
    try { pubModel = JSON.parse(readFileSync(pubModelPath, 'utf-8')) as Record<string, unknown>; }
    catch { continue; }

    const appId = typeof pubModel['app_id'] === 'string' ? pubModel['app_id'] : null;
    if (!appId) continue;

    // #2963: extract per-leg partial-score and call-count data for diagnostic output.
    const finalData = (typeof pubModel['final'] === 'object' && pubModel['final'] !== null)
      ? pubModel['final'] as Record<string, unknown>
      : {};
    const partialByLeg = (typeof finalData['partial'] === 'object' && finalData['partial'] !== null)
      ? finalData['partial'] as Record<string, unknown>
      : {};
    const runData = (typeof pubModel['run'] === 'object' && pubModel['run'] !== null)
      ? pubModel['run'] as Record<string, unknown>
      : {};
    const runLegs = (typeof runData['legs'] === 'object' && runData['legs'] !== null)
      ? runData['legs'] as Record<string, unknown>
      : {};

    const legs: Array<Record<string, unknown>> = Array.isArray(pubModel['legs'])
      ? (pubModel['legs'] as Array<Record<string, unknown>>).map(l => {
          const legId = typeof l['id'] === 'string' ? l['id'] : '';
          const missingGroups = Array.isArray(partialByLeg[legId])
            ? (partialByLeg[legId] as unknown[]).filter((g): g is string => typeof g === 'string')
            : [];
          const runLeg = (typeof runLegs[legId] === 'object' && runLegs[legId] !== null)
            ? runLegs[legId] as Record<string, unknown>
            : {};
          const callCount = typeof runLeg['call_count'] === 'number' ? runLeg['call_count'] : null;
          const status = callCount === 0 ? 'no-calls' : 'complete';
          return {
            connector:      typeof l['connector'] === 'string' ? l['connector'] : 'unknown',
            model:          typeof l['model']     === 'string' ? l['model']     : 'default',
            status,
            call_count:     callCount,
            partial:        missingGroups.length > 0,
            score_complete: missingGroups.length === 0,
            missing_fields: missingGroups,
          };
        })
      : [];

    // Later runTs is lexicographically greater; overwrite to keep the most recent run.
    latestByApp.set(appId, { runTs, legs });
  }

  for (const [appId, data] of latestByApp) {
    result[appId] = { last_run_ts: data.runTs, leg_count: data.legs.length, legs: data.legs };
  }
  return result;
}

function buildFrameworksUsed(workspaceRoot: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const appsDir = join(workspaceRoot, 'apps');
  if (!existsSync(appsDir)) return result;
  let appNames: string[];
  try { appNames = readdirSync(appsDir); } catch { return result; }

  for (const app of appNames) {
    let isDir = false;
    try { isDir = statSync(join(appsDir, app)).isDirectory(); } catch { continue; }
    if (!isDir) continue;
    const swaoYml = join(appsDir, app, '.swao.yml');
    if (!existsSync(swaoYml)) continue;
    try {
      const cfg = loadYaml(readFileSync(swaoYml, 'utf-8')) as Record<string, unknown>;
      // #2568: check all known locations for framework IDs. SWAO .swao.yml stores
      // frameworks under assessment.frameworks or assessment.regimes_active (legacy).
      const extractFwArray = (o: unknown): string[] => {
        if (!o || typeof o !== 'object') return [];
        const rec = o as Record<string, unknown>;
        // singular 'framework' (legacy)
        const fw = rec['framework'];
        const fwArr = typeof fw === 'string' ? [fw] : (Array.isArray(fw) ? fw.filter((f): f is string => typeof f === 'string') : []);
        // plural 'frameworks'
        const fws = rec['frameworks'];
        const fwsArr = typeof fws === 'string' ? [fws] : (Array.isArray(fws) ? fws.filter((f): f is string => typeof f === 'string') : []);
        // 'regimes_active' (legacy compliance pass key)
        const ra = rec['regimes_active'];
        const raArr = typeof ra === 'string' ? [ra] : (Array.isArray(ra) ? ra.filter((f): f is string => typeof f === 'string') : []);
        return [...fwArr, ...fwsArr, ...raArr];
      };
      const assessmentCfg = cfg['assessment'] as Record<string, unknown> | undefined ?? {};
      const frameworks = [
        ...extractFwArray(cfg),
        ...extractFwArray(assessmentCfg),
        ...extractFwArray((cfg['app'] as Record<string, unknown> | undefined) ?? {}),
        ...extractFwArray((cfg['assess'] as Record<string, unknown> | undefined) ?? {}),
      ];
      result[app] = { frameworks: [...new Set(frameworks)] };
    } catch { /* skip */ }
  }
  return result;
}

function buildChallengeAgentInventory(workspaceRoot: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const appsDir = join(workspaceRoot, 'apps');
  if (!existsSync(appsDir)) return result;
  let appNames: string[];
  try { appNames = readdirSync(appsDir); } catch { return result; }

  for (const app of appNames) {
    let isDir = false;
    try { isDir = statSync(join(appsDir, app)).isDirectory(); } catch { continue; }
    if (!isDir) continue;
    const swaoYml = join(appsDir, app, '.swao.yml');
    if (!existsSync(swaoYml)) continue;
    try {
      const cfg = loadYaml(readFileSync(swaoYml, 'utf-8')) as Record<string, unknown>;
      const challenge = cfg['challenge'] as Record<string, unknown> | undefined;
      const agents = challenge?.['agents'];
      const agentIds: string[] = Array.isArray(agents)
        ? agents.map((a: unknown) => {
            if (typeof a === 'string') return a;
            if (typeof a === 'object' && a && 'id' in a) return String((a as Record<string, unknown>)['id']);
            return String(a);
          })
        : [];

      const challengeAppDir = join(appsDir, app, 'wsp', 'challenge-app');
      const combinedPath = join(challengeAppDir, 'combined.yaml');
      const combinedExists = existsSync(combinedPath);
      let lastRunTs: string | null = null;
      if (existsSync(challengeAppDir)) {
        let entries: string[];
        try { entries = readdirSync(challengeAppDir).filter(d => /^\d{4}/.test(d)).sort(); } catch { entries = []; }
        lastRunTs = entries[entries.length - 1] ?? null;
      }
      // #3016: extract per-agent summary from combined.yaml so agents_from_combined
      // is non-empty even when challenge.agents is absent from .swao.yml.
      interface CombinedReport { agent_id?: unknown; agent_role?: unknown }
      interface CombinedYaml { assessed_at?: unknown; agent_count?: unknown; reports?: CombinedReport[] }
      let agentsFromCombined: Array<{ agent_id: string; agent_role: string }> = [];
      if (combinedExists) {
        try {
          const combined = loadYaml(readFileSync(combinedPath, 'utf-8')) as CombinedYaml | null;
          if (combined?.reports && Array.isArray(combined.reports)) {
            agentsFromCombined = combined.reports.map((r) => ({
              agent_id:   typeof r.agent_id === 'string' ? r.agent_id : String(r.agent_id ?? ''),
              agent_role: typeof r.agent_role === 'string' ? r.agent_role : String(r.agent_role ?? ''),
            }));
          }
        } catch { /* skip malformed combined.yaml */ }
      }
      result[app] = {
        agents_configured: agentIds,
        agent_count: agentIds.length,
        combined_yaml_exists: combinedExists,
        last_run_ts: lastRunTs,
        agents_from_combined: agentsFromCombined,
      };
    } catch { /* skip */ }
  }
  return result;
}

function readLatestHealthCheckNdjson(workspaceRoot: string): Record<string, unknown> | null {
  const logsDir = join(workspaceRoot, 'wsp', 'logs');
  if (!existsSync(logsDir)) return null;
  let files: string[];
  try { files = readdirSync(logsDir).filter(f => f.startsWith('health-check-') && f.endsWith('.ndjson')).sort(); }
  catch { return null; }
  for (let i = files.length - 1; i >= 0; i--) {
    let raw: string;
    try { raw = readFileSync(join(logsDir, files[i]!), 'utf-8'); } catch { continue; }
    const lines = raw.split('\n').filter(Boolean);
    const last = lines[lines.length - 1];
    if (!last) continue;
    try { return JSON.parse(last) as Record<string, unknown>; } catch { continue; }
  }
  return null;
}

function buildHealthCheckSnapshot(workspaceRoot: string): unknown {
  // #3014: spawnSync re-invokes the pkg binary and always fails inside a binary.
  // Read the most recent cached entry from wsp/logs/health-check-YYYY-MM.ndjson instead.
  const cached = readLatestHealthCheckNdjson(workspaceRoot);
  if (cached !== null) return { ...cached, source: 'cached-ndjson' };
  const isPkg = Boolean((process as { pkg?: unknown }).pkg);
  if (isPkg) return { error: 'health-check-unavailable-in-binary', hint: 'run swao health-check separately to populate the cache' };
  // Dev (non-pkg): live subprocess fallback.
  const selfArgs: string[] = [process.argv[1] as string];
  const result = spawnSync(
    process.execPath,
    [...selfArgs, 'health-check', '--json', '--workspace', workspaceRoot],
    { env: { ...process.env, PKG_EXECPATH: '' }, encoding: 'utf-8', timeout: 30_000 },
  );
  if (result.error) return { error: 'health-check-spawn-failed', exit_code: result.status ?? -1 };
  if (result.stdout) {
    try { return JSON.parse(result.stdout as string); } catch { /* fall through */ }
  }
  return { error: 'health-check-no-output', exit_code: result.status ?? -1 };
}

// Redact any string value that is an absolute path by replacing the whole
// value with "[PATH]". Operates on parsed JSON/YAML objects so backslash
// escaping in the raw text is never an issue.
function redactAbsolutePathsInValue(value: unknown): unknown {
  if (typeof value === 'string') {
    if (/^[A-Za-z]:[/\\]/.test(value) || /^\//.test(value)) return '[PATH]';
    return value;
  }
  if (Array.isArray(value)) return value.map(redactAbsolutePathsInValue);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactAbsolutePathsInValue(v);
    }
    return out;
  }
  return value;
}

// ---- v2.2 artefact builders (#2771) ----

interface ChatTurnRaw {
  ts?: unknown;
  role?: unknown;
  content?: unknown;
  model?: unknown;
  tokens_in?: unknown;
  tokens_out?: unknown;
  [key: string]: unknown;
}

function buildChatTranscripts(workspaceRoot: string, counts: ReturnType<typeof emptyCounts>): string {
  const chatDir = join(workspaceRoot, 'wsp', 'chat');
  if (!existsSync(chatDir)) return '';
  let files: string[];
  try { files = readdirSync(chatDir).filter(f => f.endsWith('.ndjson')).sort(); } catch { return ''; }
  const lines: string[] = [];
  for (const f of files) {
    const full = join(chatDir, f);
    let raw: string;
    try { raw = readFileSync(full, 'utf-8'); } catch { continue; }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let parsed: ChatTurnRaw;
      try { parsed = JSON.parse(line) as ChatTurnRaw; } catch { continue; }
      // Redact content; drop system turns (may contain full portfolio context)
      if (parsed.role === 'system') continue;
      const safe: Record<string, unknown> = {
        ts: parsed.ts,
        role: parsed.role,
        content: redactPiiValue(typeof parsed.content === 'string' ? parsed.content : '', counts),
        session: f.replace('.ndjson', ''),
      };
      if (typeof parsed.model === 'string') safe['model'] = parsed.model;
      if (typeof parsed.tokens_in === 'number') safe['tokens_in'] = parsed.tokens_in;
      if (typeof parsed.tokens_out === 'number') safe['tokens_out'] = parsed.tokens_out;
      lines.push(JSON.stringify(safe));
    }
  }
  return lines.join('\n') + (lines.length > 0 ? '\n' : '');
}

interface AgentRunMeta {
  run_id: string;
  created_at: string | null;
  tool_calls: number;
  has_report: boolean;
  has_trace: boolean;
}

function buildAgentRunsIndex(workspaceRoot: string): AgentRunMeta[] {
  const agentDir = join(workspaceRoot, 'wsp', 'agent-runs');
  if (!existsSync(agentDir)) return [];
  let runs: string[];
  try { runs = readdirSync(agentDir).filter(d => {
    try { return statSync(join(agentDir, d)).isDirectory(); } catch { return false; }
  }).sort(); } catch { return []; }
  return runs.map(runId => {
    const runPath = join(agentDir, runId);
    const tracePath = join(runPath, 'trace.ndjson');
    let toolCalls = 0;
    if (existsSync(tracePath)) {
      try {
        const lines = readFileSync(tracePath, 'utf-8').split('\n').filter(l => l.trim());
        toolCalls = lines.length;
      } catch { /* ignore */ }
    }
    const m = runId.match(/^(\d{8}T\d{6}Z)/);
    const createdAt = m ? `${m[1].slice(0,4)}-${m[1].slice(4,6)}-${m[1].slice(6,8)}T${m[1].slice(9,11)}:${m[1].slice(11,13)}:${m[1].slice(13,15)}Z` : null;
    return {
      run_id: runId,
      created_at: createdAt,
      tool_calls: toolCalls,
      has_report: existsSync(join(runPath, 'report.md')),
      has_trace: existsSync(tracePath),
    };
  });
}

interface ChatSessionStats {
  session_count: number;
  total_turns: number;
  total_tokens_in: number;
  total_tokens_out: number;
  models_used: string[];
  oldest_session: string | null;
  newest_session: string | null;
  sessions: Array<{
    session_id: string;
    turns: number;
    tokens_in: number;
    tokens_out: number;
    suspicious: boolean;
  }>;
}

function buildChatSessionStats(workspaceRoot: string): ChatSessionStats {
  const chatDir = join(workspaceRoot, 'wsp', 'chat');
  const result: ChatSessionStats = {
    session_count: 0,
    total_turns: 0,
    total_tokens_in: 0,
    total_tokens_out: 0,
    models_used: [],
    oldest_session: null,
    newest_session: null,
    sessions: [],
  };
  if (!existsSync(chatDir)) return result;
  let files: string[];
  try { files = readdirSync(chatDir).filter(f => f.endsWith('.ndjson')).sort(); } catch { return result; }
  result.session_count = files.length;
  if (files.length > 0) {
    result.oldest_session = files[0].replace('.ndjson', '');
    result.newest_session = files[files.length - 1].replace('.ndjson', '');
  }
  const modelSet = new Set<string>();
  for (const f of files) {
    const sessionId = f.replace('.ndjson', '');
    const sess = { session_id: sessionId, turns: 0, tokens_in: 0, tokens_out: 0, suspicious: false };
    try {
      const raw = readFileSync(join(chatDir, f), 'utf-8');
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        let parsed: ChatTurnRaw;
        try { parsed = JSON.parse(line) as ChatTurnRaw; } catch { continue; }
        if (parsed.role === 'user' || parsed.role === 'assistant') {
          result.total_turns++;
          sess.turns++;
        }
        if (typeof parsed.tokens_in === 'number') { result.total_tokens_in += parsed.tokens_in; sess.tokens_in += parsed.tokens_in; }
        if (typeof parsed.tokens_out === 'number') { result.total_tokens_out += parsed.tokens_out; sess.tokens_out += parsed.tokens_out; }
        if (typeof parsed.model === 'string' && parsed.model) modelSet.add(parsed.model);
      }
    } catch { /* ignore */ }
    if (sess.turns > 0) sess.suspicious = sess.tokens_out / sess.turns < 200;
    result.sessions.push(sess);
  }
  result.models_used = [...modelSet].sort();
  return result;
}

// ---- v2.3 artefact builders (#2965) ----

function parseCompactTs(ts: string): string | null {
  const m = ts.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}

function buildLzChallengeStats(workspaceRoot: string): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  const appsDir = join(workspaceRoot, 'apps');
  if (!existsSync(appsDir)) return result;
  let appNames: string[];
  try { appNames = readdirSync(appsDir); } catch { return result; }
  for (const app of appNames) {
    let isDir = false;
    try { isDir = statSync(join(appsDir, app)).isDirectory(); } catch { continue; }
    if (!isDir) continue;
    const challengeDir = join(appsDir, app, 'wsp', 'challenge-app');
    if (!existsSync(challengeDir)) continue;
    let entries: string[];
    try { entries = readdirSync(challengeDir).filter(d => /^\d{4}/.test(d)).sort(); } catch { continue; }
    if (entries.length === 0) continue;
    result[app] = {
      total_iterations: entries.length,
      first_run: parseCompactTs(entries[0]),
      last_run: parseCompactTs(entries[entries.length - 1]),
    };
  }
  return result;
}

function buildConnectorMeta(workspaceRoot: string): Array<Record<string, unknown>> {
  // #3015: collect from workspace-level AND per-app gateway dirs (binary only seeds
  // wsp/inputs/llm-gateway/ per-app after health-check runs; workspace-level may be empty).
  const candidates: { path: string; source: string }[] = [];

  const wsGatewayDir = join(workspaceRoot, 'wsp', 'inputs', 'llm-gateway');
  if (existsSync(wsGatewayDir)) {
    try {
      for (const f of readdirSync(wsGatewayDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml')))
        candidates.push({ path: join(wsGatewayDir, f), source: 'workspace' });
    } catch { /* skip */ }
  }
  const appsDir = join(workspaceRoot, 'apps');
  if (existsSync(appsDir)) {
    try {
      for (const app of readdirSync(appsDir)) {
        const appGatewayDir = join(appsDir, app, 'wsp', 'inputs', 'llm-gateway');
        if (!existsSync(appGatewayDir)) continue;
        try {
          for (const f of readdirSync(appGatewayDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml')))
            candidates.push({ path: join(appGatewayDir, f), source: `app:${app}` });
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  const seen = new Set<string>();
  const result: Array<Record<string, unknown>> = [];
  for (const { path: fullPath, source } of candidates) {
    try {
      const raw = readFileSync(fullPath, 'utf-8');
      const sha256 = createHash('sha256').update(raw).digest('hex');
      const connector = loadYaml(raw) as Record<string, unknown> | null;
      if (!connector || typeof connector !== 'object') continue;
      const auth = (typeof connector['auth'] === 'object' && connector['auth'] !== null)
        ? connector['auth'] as Record<string, unknown>
        : {};
      const credentialEnv = typeof auth['env_var'] === 'string' ? auth['env_var'] : null;
      const connectorId = typeof connector['id'] === 'string' ? connector['id'] : fullPath.replace(/\.ya?ml$/, '');
      if (seen.has(connectorId)) continue;
      seen.add(connectorId);
      result.push({
        id:               connectorId,
        protocol:         typeof connector['protocol'] === 'string' ? connector['protocol'] : null,
        context_window_k: typeof connector['context_window_k'] === 'number' ? connector['context_window_k'] : null,
        credential_env:   credentialEnv,
        source,
        sha256,
      });
    } catch { /* skip malformed yaml */ }
  }
  return result;
}

export function cmdSupportBundle(opts: { workspace?: string; out?: string }): void {
  const workspaceRoot = opts.workspace
    ? resolvePath(opts.workspace)
    : resolveWorkspaceRoot();
  // #2644: emit support.bundle.start event so the operator can trace when a bundle was created.
  try { logPortfolio('info', 'support.bundle.start', 'Support bundle creation started', { context: { bundle_version: BUNDLE_VERSION } }); } catch { /* best-effort */ }
  if (!workspaceRoot) {
    console.error('[swao support-bundle] not in a workspace (no `apps/` or `.swao.yml` found walking up from cwd)');
    process.exitCode = 1;
    return;
  }

  // Compute diagDir early so we can scan prior bundles before writing
  const diagDir = opts.out ? resolvePath(opts.out) : join(workspaceRoot, 'wsp', 'support-diag');

  // Gap 4: list existing .tar.gz bundles in diagDir before creating the new one
  const priorBundles: Array<{ filename: string; size_bytes: number; created_at: string }> = [];
  if (existsSync(diagDir)) {
    try {
      for (const f of readdirSync(diagDir).filter(fn => fn.endsWith('.tar.gz')).sort()) {
        try {
          const st = statSync(join(diagDir, f));
          priorBundles.push({ filename: f, size_bytes: st.size, created_at: st.birthtime.toISOString() });
        } catch { /* skip */ }
      }
    } catch { /* ignore */ }
  }

  const files = listLogFiles(workspaceRoot);
  const allEntries: LogEntry[] = [];
  for (const f of files) {
    for (const e of readLogEntries(f)) allEntries.push(e);
  }
  allEntries.sort((a, b) => a.ts.localeCompare(b.ts));

  const counts = emptyCounts();

  // execution-trace.ndjson: core fields + PII-redacted message and context.
  // LLM Assessment log entries lack scope/app_id -- fall back gracefully (#2398).
  // #2421: include message + context (was stripped, leaving only codes -- no diagnostic value).
  const traceEntries: SafeTraceEntry[] = allEntries.map((e) => ({
    ts: e.ts,
    level: e.level,
    code: e.code,
    scope: e.scope ?? 'llm-assessment',
    ...(e.app_id !== undefined ? { app_id: e.app_id } : {}),
    ...(e.run_id !== undefined ? { run_id: e.run_id } : {}),
    ...(typeof e.message === 'string' ? { message: redactPiiValue(e.message, counts) as string } : {}),
    ...(e.context !== undefined ? { context: redactPiiValue(e.context, counts) as Record<string, unknown> } : {}),
  }));
  const traceNdjson = traceEntries.map((e) => JSON.stringify(e)).join('\n') + (traceEntries.length > 0 ? '\n' : '');

  // error-context.json: error entries with PII-redacted context + message_redacted (#1599)
  // #3019: retain only last 7 days to avoid 81-entry bundles from months of logs.
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const retentionCutoff = new Date(Date.now() - SEVEN_DAYS_MS);
  const recentErrors = allEntries.filter((e) => e.level === 'error' && new Date(e.ts) >= retentionCutoff);
  const olderErrorCount = allEntries.filter((e) => e.level === 'error' && new Date(e.ts) < retentionCutoff).length;
  const errorEntries: SafeErrorEntry[] = recentErrors
    .map((e) => {
      const safeCtx = e.context
        ? (redactPiiValue(e.context, counts) as Record<string, unknown>)
        : undefined;
      const safeMsg = typeof e.message === 'string'
        ? (redactPiiValue(e.message, counts) as string)
        : undefined;
      return {
        ts: e.ts,
        level: e.level,
        code: e.code,
        scope: e.scope ?? 'llm-assessment',
        ...(e.app_id !== undefined ? { app_id: e.app_id } : {}),
        ...(e.run_id !== undefined ? { run_id: e.run_id } : {}),
        ...(safeMsg !== undefined ? { message_redacted: safeMsg } : {}),
        ...(safeCtx !== undefined ? { context: safeCtx } : {}),
      };
    });
  const hasErrors = errorEntries.length > 0;

  let licenseTier = 'community';
  try { licenseTier = LicenseGuard.load().state.tier; } catch { /* keep default */ }

  // Machine fingerprint: read from LicenseGuard state to ensure it matches the licence system.
  let machineFingerprint: string;
  try { machineFingerprint = LicenseGuard.load().state.fingerprint; }
  catch { machineFingerprint = createHash('sha256').update((process.env['COMPUTERNAME'] ?? process.env['HOSTNAME'] ?? 'unknown') + process.platform).digest('hex').slice(0, 16); }

  const now = new Date().toISOString();

  // v2.0 artefact: workspace-config.json
  const workspaceConfig = buildWorkspaceConfig(workspaceRoot, counts);

  // v2.0 artefact: workspace-structure.json
  const workspaceStructure = buildWorkspaceStructure(workspaceRoot);

  // v2.0 artefact: run-manifests.json
  const runManifests = buildRunManifests(workspaceRoot);

  // v2.0 artefact: licence-state.json
  const licenceState = buildLicenceState(machineFingerprint);

  // v2.0 artefact: lz-catalogue-meta.json
  const lzCatalogueMeta = buildLzCatalogueMeta(workspaceRoot);

  // v2.0 artefact: health-check.json (subprocess)
  const healthCheckSnapshot = buildHealthCheckSnapshot(workspaceRoot);

  // v2.1 artefacts
  const { passes: passInventory, false_positive_detail: fpDetail, ctx_diagnostics: ctxDiag } = buildPassInventory(workspaceRoot);
  const llmLegsSummary = buildLlmLegsSummary(workspaceRoot);
  const frameworksUsed = buildFrameworksUsed(workspaceRoot);
  const challengeAgents = buildChallengeAgentInventory(workspaceRoot);
  const binarySig = computeBinarySignature();

  // v2.2 artefacts (#2771)
  const chatTranscriptsNdjson = buildChatTranscripts(workspaceRoot, counts);
  const agentRunsIndex = buildAgentRunsIndex(workspaceRoot);
  const chatSessionStats = buildChatSessionStats(workspaceRoot);

  // v2.3 artefacts (#2965)
  const lzChallengeStats = buildLzChallengeStats(workspaceRoot);
  const connectorMeta = buildConnectorMeta(workspaceRoot);

  // Redacted SWAO env vars (exclude secret-shaped names defensively)
  const swaoEnvVars: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('SWAO_')) continue;
    const upper = k.toUpperCase();
    if (upper.includes('KEY') || upper.includes('SECRET') || upper.includes('TOKEN') || upper.includes('PASSWORD')) {
      swaoEnvVars[k] = '[REDACTED]';
    } else {
      swaoEnvVars[k] = redactPiiValue(v ?? '', counts);
    }
  }

  const isBinary = Object.prototype.hasOwnProperty.call(process, 'pkg');

  // Augment run manifests with v2.3 derived fields (Gap 1, Gap 5, Gap 7)
  const runManifestsAugmented = runManifests.map(entry => ({
    ...entry,
    ...(fpDetail[entry.app_id] ? { false_positive_detail: fpDetail[entry.app_id] } : {}),
    ...(lzChallengeStats[entry.app_id] ? { lz_challenge: lzChallengeStats[entry.app_id] } : {}),
    ...(ctxDiag[entry.app_id] ? { ctx_diagnostics: ctxDiag[entry.app_id] } : {}),
  }));

  const bundleContents = [
    'manifest.json',
    'execution-trace.ndjson',
    'environment.json',
    'workspace-config.json',
    'workspace-structure.json',
    'run-manifests.json',
    'licence-state.json',
    'lz-catalogue-meta.json',
    'health-check.json',
    'pass-inventory.json',
    'llm-legs-summary.json',
    'frameworks-used.json',
    'challenge-agents.json',
    'chat-transcripts.ndjson',
    'agent-runs-index.json',
    'chat-session-stats.json',
    'connector-meta.json',
  ];
  if (hasErrors || olderErrorCount > 0) bundleContents.push('error-context.json');

  // v2.1: include ingestion-manifest.json if present in the workspace
  const ingestionManifestPath = join(workspaceRoot, 'wsp', 'inputs', 'ingestion-manifest.json');
  const hasIngestionManifest = existsSync(ingestionManifestPath);
  if (hasIngestionManifest) bundleContents.push('ingestion-manifest.json');

  const manifest = {
    bundle_version: BUNDLE_VERSION,
    created_at: now,
    swao_version: SWAO_VERSION,
    license_tier: licenseTier,
    event_count: traceEntries.length,
    error_count: errorEntries.length,
    log_files_included: files.length,
    bundle_contents: bundleContents,
    prior_bundles: priorBundles,
    pii_attestation: 'no-user-data-collected',
  };

  const environment = {
    platform: process.platform,
    arch: process.arch,
    node_version: process.version,
    swao_version: SWAO_VERSION,
    machine_fingerprint: machineFingerprint,
    runtime_mode: isBinary ? 'binary' : 'node',
    node_env: process.env['NODE_ENV'] ?? 'undefined',
    cwd_depth: process.cwd().split(/[\\/]/).filter(Boolean).length,
    swao_env_vars: swaoEnvVars,
    binary_signature: binarySig.sha256_prefix,
    binary_size_bytes: binarySig.size_bytes,
  };

  const tarEntries: Array<{ name: string; content: Buffer }> = [
    { name: 'manifest.json',            content: Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf-8') },
    { name: 'execution-trace.ndjson',   content: Buffer.from(traceNdjson, 'utf-8') },
    { name: 'environment.json',         content: Buffer.from(JSON.stringify(environment, null, 2) + '\n', 'utf-8') },
    { name: 'workspace-config.json',    content: Buffer.from(JSON.stringify({ workspace_config: workspaceConfig }, null, 2) + '\n', 'utf-8') },
    { name: 'workspace-structure.json', content: Buffer.from(JSON.stringify(workspaceStructure, null, 2) + '\n', 'utf-8') },
    { name: 'run-manifests.json',       content: Buffer.from(JSON.stringify({ run_manifests: runManifestsAugmented }, null, 2) + '\n', 'utf-8') },
    { name: 'licence-state.json',       content: Buffer.from(JSON.stringify(licenceState, null, 2) + '\n', 'utf-8') },
    { name: 'lz-catalogue-meta.json',   content: Buffer.from(JSON.stringify(lzCatalogueMeta, null, 2) + '\n', 'utf-8') },
    { name: 'health-check.json',        content: Buffer.from(JSON.stringify({ health_check: healthCheckSnapshot }, null, 2) + '\n', 'utf-8') },
    { name: 'pass-inventory.json',      content: Buffer.from(JSON.stringify({ apps: passInventory }, null, 2) + '\n', 'utf-8') },
    { name: 'llm-legs-summary.json',    content: Buffer.from(JSON.stringify({ apps: llmLegsSummary }, null, 2) + '\n', 'utf-8') },
    { name: 'frameworks-used.json',     content: Buffer.from(JSON.stringify({ apps: frameworksUsed }, null, 2) + '\n', 'utf-8') },
    { name: 'challenge-agents.json',    content: Buffer.from(JSON.stringify({ apps: challengeAgents }, null, 2) + '\n', 'utf-8') },
    { name: 'chat-transcripts.ndjson',  content: Buffer.from(chatTranscriptsNdjson, 'utf-8') },
    { name: 'agent-runs-index.json',    content: Buffer.from(JSON.stringify({ runs: agentRunsIndex }, null, 2) + '\n', 'utf-8') },
    { name: 'chat-session-stats.json',  content: Buffer.from(JSON.stringify(chatSessionStats, null, 2) + '\n', 'utf-8') },
    { name: 'connector-meta.json',      content: Buffer.from(JSON.stringify({ connectors: connectorMeta }, null, 2) + '\n', 'utf-8') },
  ];
  if (hasErrors || olderErrorCount > 0) {
    const errJson = JSON.stringify({ error_events: errorEntries, older_error_count: olderErrorCount, retention_days: 7 }, null, 2) + '\n';
    tarEntries.push({ name: 'error-context.json', content: Buffer.from(errJson, 'utf-8') });
  }
  if (hasIngestionManifest) {
    try {
      const ingRaw = JSON.parse(readFileSync(ingestionManifestPath, 'utf-8')) as unknown;
      // Apply PII redaction then absolute-path redaction (parsed-object approach
      // avoids JSON backslash-escaping issues with Windows paths).
      const ingRedacted = redactAbsolutePathsInValue(redactPiiValue(ingRaw, counts));
      tarEntries.push({ name: 'ingestion-manifest.json', content: Buffer.from(JSON.stringify(ingRedacted, null, 2) + '\n', 'utf-8') });
    } catch { /* skip if unreadable or malformed */ }
  }

  try {
    mkdirSync(diagDir, { recursive: true });
  } catch (err) {
    console.error(`[swao support-bundle] failed to create output directory ${diagDir}: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const ts = now.replace(/[:.]/g, '-');
  const outPath = join(diagDir, `${ts}.tar.gz`);

  const tar = buildTar(tarEntries);
  const gz = gzipSync(tar);
  try {
    writeFileSync(outPath, gz);
  } catch (err) {
    console.error(`[swao support-bundle] failed to write ${outPath}: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`[ok]  Support bundle created: ${outPath}`);
  console.log(`[ok]  ${traceEntries.length} event trace entries | ${errorEntries.length} error context entries | ${files.length} log files`);
  console.log(`[ok]  17 diagnostic artefacts (bundle v${BUNDLE_VERSION})`);
  console.log(`[ok]  Extract with: tar -xzf "${outPath}"`);
  console.log(`[ok]  No user data, document content, or credentials included.`);
  // #2644: emit support.bundle.created so log monitors can confirm successful completion.
  try {
    logPortfolio('info', 'support.bundle.created', `Support bundle created: ${outPath}`, {
      context: {
        bundle_version: BUNDLE_VERSION,
        event_count: traceEntries.length,
        error_count: errorEntries.length,
        artefact_count: 17,
        prior_bundle_count: priorBundles.length,
      },
    });
  } catch { /* best-effort */ }
}

export function registerSupportBundle(program: Command): void {
  program
    .command('support-bundle')
    .description('Create a PII-free diagnostic bundle v2.3 (event trace + environment + pass inventory + LLM legs + frameworks + challenge agents + connector meta + per-session chat stats) for SWAO support hand-off (#1515 #1599 #1776 #2965)')
    .option('--workspace <path>', 'workspace root (default: resolve from cwd)')
    .option('--out <dir>', 'output directory (default: <workspace>/wsp/support-diag/)')
    .action((opts: { workspace?: string; out?: string }) => cmdSupportBundle(opts));
}
