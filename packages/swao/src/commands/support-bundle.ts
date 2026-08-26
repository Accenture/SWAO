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
// Bundle v2.1 contents:
//   manifest.json            -- SWAO version, OS, Node, license tier, pii_attestation
//   execution-trace.ndjson   -- event codes + timestamps only (no message, no context)
//   environment.json         -- platform, arch, node_version, swao_env_vars, runtime_mode,
//                               cwd_depth, node_env, binary_signature (no hostname, no paths)
//   error-context.json       -- error-level events with PII-redacted context + message_redacted
//   workspace-config.json    -- sanitised .swao.yml with secrets redacted
//   workspace-structure.json -- wsp/apps directory tree (metadata only, no file content)
//   run-manifests.json       -- latest run-manifest.json per app (stats only)
//   licence-state.json       -- tier, counts, expiry (no licensee/email/org)
//   lz-catalogue-meta.json   -- catalogue version + provider list
//   health-check.json        -- fresh health-check snapshot (--json mode)
//   pass-inventory.json      -- (v2.1) passes completed in latest run per app
//   llm-legs-summary.json    -- (v2.1) LLM leg/pass status + latency from latest LLM assessment
//   frameworks-used.json     -- (v2.1) community framework IDs configured per app
//   challenge-agents.json    -- (v2.1) challenge agent inventory + last-run presence per app
//
// Explicitly excluded from every file: prompt content, document text, API keys,
// engagement name, email addresses, absolute filesystem paths, username, hostname.

import type { Command } from 'commander';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { join, resolve as resolvePath } from 'node:path';
import { spawnSync } from 'node:child_process';
import { load as loadYaml } from 'js-yaml';
import type { LogEntry } from '@swao/core';
import { LicenseGuard, resolveWorkspaceRoot } from '@swao/core';
import { resolveLzCataloguesDir, loadLzCatalogueIndex } from '@swao/module-landing-zone';
import { SWAO_VERSION } from '../branding.js';
import { buildTar } from '../util/tar-write.js';
import { emptyCounts, redactPiiValue } from '../util/redact-pii.js';

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
    return redactPiiValue(raw, counts);
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
  try {
    const st = LicenseGuard.load().state;
    return {
      tier: st.tier,
      assessment_count: st.assessmentCount,
      days_elapsed: st.daysElapsed,
      assessment_limit: st.assessmentLimit ?? null,
      expires_at: st.exp ?? null,
      machine_fingerprint: machineFingerprint,
    };
  } catch {
    return { tier: 'community', machine_fingerprint: machineFingerprint, error: 'load-failed' };
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

function buildPassInventory(workspaceRoot: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const appsDir = join(workspaceRoot, 'apps');
  if (!existsSync(appsDir)) return result;
  let appNames: string[];
  try { appNames = readdirSync(appsDir); } catch { return result; }

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

    // Accept both wsp/<ptr>/passes and wsp/runs/<ts>/passes
    const candidateDirs = [
      join(appWspDir, runRef, 'passes'),
      join(appWspDir, 'runs', runRef, 'passes'),
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
          const d = join(runsDir, latest, 'passes');
          if (existsSync(d)) { passesDir = d; runRef = `runs/${latest}`; }
        }
      }
    }
    if (!passesDir) continue;

    const passes: Array<{ pass_id: string; size_bytes: number }> = [];
    let passFiles: string[];
    try { passFiles = readdirSync(passesDir); } catch { continue; }
    for (const f of passFiles) {
      if (!f.endsWith('.yaml') && !f.endsWith('.yml')) continue;
      const passId = f.replace(/\.ya?ml$/, '');
      try {
        const st = statSync(join(passesDir, f));
        passes.push({ pass_id: passId, size_bytes: st.size });
      } catch { /* skip */ }
    }
    result[app] = { run_ref: runRef, pass_count: passes.length, passes };
  }
  return result;
}

function buildLlmLegsSummary(workspaceRoot: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const llmRoot = join(workspaceRoot, 'llm-assessments');
  if (!existsSync(llmRoot)) return result;
  let appDirs: string[];
  try { appDirs = readdirSync(llmRoot); } catch { return result; }

  for (const appId of appDirs) {
    let isDir = false;
    try { isDir = statSync(join(llmRoot, appId)).isDirectory(); } catch { continue; }
    if (!isDir) continue;
    let runDirs: string[];
    try { runDirs = readdirSync(join(llmRoot, appId)).filter(d => /^\d{4}/.test(d)).sort(); } catch { continue; }
    const latestRun = runDirs[runDirs.length - 1];
    if (!latestRun) continue;

    const candidates = [
      join(llmRoot, appId, latestRun, 'comparison', 'comparison.json'),
      join(llmRoot, appId, latestRun, 'comparison', 'publication-model.json'),
    ];
    let compData: Record<string, unknown> | null = null;
    for (const c of candidates) {
      if (!existsSync(c)) continue;
      try { compData = JSON.parse(readFileSync(c, 'utf-8')) as Record<string, unknown>; break; }
      catch { /* try next */ }
    }
    if (!compData) continue;

    const legIds: string[] = Array.isArray(compData['legIds']) ? compData['legIds'] as string[] : [];
    const passGroups = Array.isArray(compData['passGroups'])
      ? compData['passGroups'] as Array<Record<string, unknown>>
      : [];

    const legs = legIds.map(legId => {
      const passes = passGroups.map(pg => {
        const pgLegs = pg['legs'] as Record<string, unknown> | undefined;
        const ld = pgLegs?.[legId] as Record<string, unknown> | undefined;
        return { pass_id: pg['pass_id'] ?? pg['passId'], status: ld?.['status'] ?? 'unknown', latency_ms: ld?.['latency_ms'] ?? null };
      });
      return { leg_id: legId, passes };
    });
    result[appId] = { run_ts: latestRun, leg_count: legIds.length, legs };
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
      const extractFw = (o: unknown): string[] => {
        if (!o || typeof o !== 'object') return [];
        const fw = (o as Record<string, unknown>)['framework'];
        if (typeof fw === 'string') return [fw];
        if (Array.isArray(fw)) return fw.filter((f): f is string => typeof f === 'string');
        return [];
      };
      const frameworks = [
        ...extractFw(cfg),
        ...extractFw((cfg['app'] as Record<string, unknown> | undefined) ?? {}),
        ...extractFw((cfg['assess'] as Record<string, unknown> | undefined) ?? {}),
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
      const combinedExists = existsSync(join(challengeAppDir, 'combined.yaml'));
      let lastRunTs: string | null = null;
      if (existsSync(challengeAppDir)) {
        let entries: string[];
        try { entries = readdirSync(challengeAppDir).filter(d => /^\d{4}/.test(d)).sort(); } catch { entries = []; }
        lastRunTs = entries[entries.length - 1] ?? null;
      }
      result[app] = { agents_configured: agentIds, agent_count: agentIds.length, combined_yaml_exists: combinedExists, last_run_ts: lastRunTs };
    } catch { /* skip */ }
  }
  return result;
}

function buildHealthCheckSnapshot(workspaceRoot: string): unknown {
  const selfPath = process.argv[1] ?? '';
  if (!selfPath) return { error: 'no-self-path' };
  const result = spawnSync(
    process.execPath,
    [selfPath, 'health-check', '--json', '--workspace', workspaceRoot],
    { env: { ...process.env, PKG_EXECPATH: '' }, encoding: 'utf-8', timeout: 30_000 },
  );
  if (result.error || result.status !== 0) {
    return { error: 'health-check-failed', exit_code: result.status ?? -1 };
  }
  if (!result.stdout) return { error: 'health-check-no-output' };
  try { return JSON.parse(result.stdout as string); }
  catch { return { error: 'health-check-json-parse-failed' }; }
}

export function cmdSupportBundle(opts: { workspace?: string; out?: string }): void {
  const workspaceRoot = opts.workspace
    ? resolvePath(opts.workspace)
    : resolveWorkspaceRoot();
  if (!workspaceRoot) {
    console.error('[swao support-bundle] not in a workspace (no `apps/` or `.swao.yml` found walking up from cwd)');
    process.exitCode = 1;
    return;
  }

  const files = listLogFiles(workspaceRoot);
  const allEntries: LogEntry[] = [];
  for (const f of files) {
    for (const e of readLogEntries(f)) allEntries.push(e);
  }
  allEntries.sort((a, b) => a.ts.localeCompare(b.ts));

  const counts = emptyCounts();

  // execution-trace.ndjson: safe fields only -- no message, no context
  const traceEntries: SafeTraceEntry[] = allEntries.map((e) => ({
    ts: e.ts,
    level: e.level,
    code: e.code,
    scope: e.scope,
    ...(e.app_id !== undefined ? { app_id: e.app_id } : {}),
    ...(e.run_id !== undefined ? { run_id: e.run_id } : {}),
  }));
  const traceNdjson = traceEntries.map((e) => JSON.stringify(e)).join('\n') + (traceEntries.length > 0 ? '\n' : '');

  // error-context.json: error entries with PII-redacted context + message_redacted (#1599)
  const errorEntries: SafeErrorEntry[] = allEntries
    .filter((e) => e.level === 'error')
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
        scope: e.scope,
        ...(e.app_id !== undefined ? { app_id: e.app_id } : {}),
        ...(e.run_id !== undefined ? { run_id: e.run_id } : {}),
        ...(safeMsg !== undefined ? { message_redacted: safeMsg } : {}),
        ...(safeCtx !== undefined ? { context: safeCtx } : {}),
      };
    });
  const hasErrors = errorEntries.length > 0;

  let licenseTier = 'community';
  try { licenseTier = LicenseGuard.load().state.tier; } catch { /* keep default */ }

  // Machine fingerprint: hashed (COMPUTERNAME/HOSTNAME + platform) -- not a direct identity
  const hostRaw = process.env['COMPUTERNAME'] ?? process.env['HOSTNAME'] ?? 'unknown';
  const machineFingerprint = createHash('sha256').update(hostRaw + process.platform).digest('hex').slice(0, 16);

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
  const passInventory = buildPassInventory(workspaceRoot);
  const llmLegsSummary = buildLlmLegsSummary(workspaceRoot);
  const frameworksUsed = buildFrameworksUsed(workspaceRoot);
  const challengeAgents = buildChallengeAgentInventory(workspaceRoot);
  const binarySig = computeBinarySignature();

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
  ];
  if (hasErrors) bundleContents.push('error-context.json');

  const manifest = {
    bundle_version: '2.1',
    created_at: now,
    swao_version: SWAO_VERSION,
    license_tier: licenseTier,
    event_count: traceEntries.length,
    error_count: errorEntries.length,
    log_files_included: files.length,
    bundle_contents: bundleContents,
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
    { name: 'run-manifests.json',       content: Buffer.from(JSON.stringify({ run_manifests: runManifests }, null, 2) + '\n', 'utf-8') },
    { name: 'licence-state.json',       content: Buffer.from(JSON.stringify(licenceState, null, 2) + '\n', 'utf-8') },
    { name: 'lz-catalogue-meta.json',   content: Buffer.from(JSON.stringify(lzCatalogueMeta, null, 2) + '\n', 'utf-8') },
    { name: 'health-check.json',        content: Buffer.from(JSON.stringify({ health_check: healthCheckSnapshot }, null, 2) + '\n', 'utf-8') },
    { name: 'pass-inventory.json',      content: Buffer.from(JSON.stringify({ apps: passInventory }, null, 2) + '\n', 'utf-8') },
    { name: 'llm-legs-summary.json',    content: Buffer.from(JSON.stringify({ apps: llmLegsSummary }, null, 2) + '\n', 'utf-8') },
    { name: 'frameworks-used.json',     content: Buffer.from(JSON.stringify({ apps: frameworksUsed }, null, 2) + '\n', 'utf-8') },
    { name: 'challenge-agents.json',    content: Buffer.from(JSON.stringify({ apps: challengeAgents }, null, 2) + '\n', 'utf-8') },
  ];
  if (hasErrors) {
    const errJson = JSON.stringify({ error_events: errorEntries }, null, 2) + '\n';
    tarEntries.push({ name: 'error-context.json', content: Buffer.from(errJson, 'utf-8') });
  }

  const diagDir = opts.out ? resolvePath(opts.out) : join(workspaceRoot, 'wsp', 'support-diag');
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
  console.log(`[ok]  14 diagnostic artefacts (bundle v2.1)`);
  console.log(`[ok]  Extract with: tar -xzf "${outPath}"`);
  console.log(`[ok]  No user data, document content, or credentials included.`);
}

export function registerSupportBundle(program: Command): void {
  program
    .command('support-bundle')
    .description('Create a PII-free diagnostic bundle v2.1 (event trace + environment + pass inventory + LLM legs + frameworks + challenge agents) for SWAO support hand-off (#1515 #1599 #1776)')
    .option('--workspace <path>', 'workspace root (default: resolve from cwd)')
    .option('--out <dir>', 'output directory (default: <workspace>/wsp/support-diag/)')
    .action((opts: { workspace?: string; out?: string }) => cmdSupportBundle(opts));
}
