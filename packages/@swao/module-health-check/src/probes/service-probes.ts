// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Health check module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Service workspace probes [19]-[25] (Design 103 §19.4, #3127-#3133).
 *
 * Every probe skips (INFO) outside a service workspace: the workspace
 * `.swao.yml` has no `service_portfolio:` block. Layout follows the existing
 * configuration model: one workspace `.swao.yml`, one `apps/<id>/.swao.yml` per
 * app with `assessment.type: service` (no separate service config file).
 *
 * PII rule (G-06): the PII scrub audit reports the file and field path only,
 * never the matched value.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { looksLikePhone, PortfolioSummarySchema, ScaffoldSignalsFileSchema } from '@swao/core';
import {
  APM_DOMAINS,
  ApmControlSchema,
  InfraCatFileSchema,
  RESEARCH_TOPICS,
  ServiceAppConfigSchema,
  apmFrameworkDir,
  listSnapshots,
  MAX_SNAPSHOTS,
  readStub,
  tier2Dir,
} from '@swao/module-service-assessment';

export type ServiceProbeStatus = 'skip' | 'ok' | 'warn' | 'error';

export interface ServiceProbeResult {
  key: string;
  label: string;
  status: ServiceProbeStatus;
  message: string;
  errors: string[];
  warnings: string[];
}

export const SERVICE_PROBE_FIRST = 19;
export const PROBE_TOTAL = 25;

type Rec = Record<string, any>;

function readYaml(p: string): Rec | null {
  try { return (load(readFileSync(p, 'utf-8')) ?? null) as Rec | null; } catch { return null; }
}

export function isServiceWorkspace(workspacePath: string): boolean {
  return !!readYaml(join(workspacePath, '.swao.yml'))?.['service_portfolio'];
}

/** App folders under apps/ whose `.swao.yml` declares `assessment.type: service`. */
function serviceAppDirs(workspacePath: string): Array<{ id: string; dir: string; doc: Rec | null }> {
  const apps = join(workspacePath, 'apps');
  if (!existsSync(apps)) return [];
  return readdirSync(apps, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ id: d.name, dir: join(apps, d.name), doc: readYaml(join(apps, d.name, '.swao.yml')) }))
    .filter((a) => a.doc?.['assessment']?.['type'] === 'service')
    .sort((a, b) => a.id.localeCompare(b.id));
}

function result(key: string, label: string, errors: string[], warnings: string[], okMessage: string): ServiceProbeResult {
  if (errors.length > 0) return { key, label, status: 'error', message: errors.join('; '), errors, warnings };
  if (warnings.length > 0) return { key, label, status: 'warn', message: warnings.join('; '), errors, warnings };
  return { key, label, status: 'ok', message: okMessage, errors, warnings };
}
const skip = (key: string, label: string, message = 'not a service workspace'): ServiceProbeResult =>
  ({ key, label, status: 'skip', message, errors: [], warnings: [] });
const listShort = (xs: string[], n = 5) => (xs.length > n ? `${xs.slice(0, n).join(', ')} (+${xs.length - n} more)` : xs.join(', '));

// ---------------------------------------------------------------- [19] #3127

/** Workspace structure: service apps, valid app configs, scaffold signals, portfolio summary. */
export function buildServiceWorkspaceProbe(workspacePath: string): ServiceProbeResult {
  const key = 'service_workspace';
  const label = 'Service workspace';
  if (!isServiceWorkspace(workspacePath)) return skip(key, label);
  const errors: string[] = [];
  const warnings: string[] = [];
  const apps = serviceAppDirs(workspacePath);
  if (apps.length === 0) errors.push('no service apps under apps/ (run swao service init)');
  const invalid = apps.filter((a) => !ServiceAppConfigSchema.safeParse(a.doc).success).map((a) => a.id);
  if (invalid.length > 0) errors.push(`invalid apps/<id>/.swao.yml for ${listShort(invalid)}`);

  // Apps named in the scaffold signals or cluster membership must have a folder.
  const signalsPath = join(workspacePath, 'wsp', 'signals', 'scaffold-signals.json');
  if (!existsSync(signalsPath)) {
    errors.push('wsp/signals/scaffold-signals.json missing (run swao service init)');
  } else {
    let parsed: ReturnType<typeof ScaffoldSignalsFileSchema.safeParse> | null = null;
    try { parsed = ScaffoldSignalsFileSchema.safeParse(JSON.parse(readFileSync(signalsPath, 'utf-8'))); } catch { /* invalid JSON */ }
    if (!parsed?.success) errors.push('wsp/signals/scaffold-signals.json is not valid');
    else {
      const ids = new Set(apps.map((a) => a.id));
      const missing = [...new Set(parsed.data.signals.map((s) => s.app_id).filter((id): id is string => !!id && !ids.has(id)))].sort();
      const dropped = missing.filter((id) => !parsed!.data.signals.some((s) => s.app_id === id && s.code === 'SCAFFOLD.DUPLICATE_ID'));
      if (dropped.length > 0) errors.push(`app folder missing for ${listShort(dropped)} (named in scaffold signals)`);
    }
  }

  const summaryPath = join(workspacePath, 'wsp', 'portfolio-summary.json');
  if (!existsSync(summaryPath)) warnings.push('wsp/portfolio-summary.json not built yet (run swao assess for an app, or swao service research)');
  else {
    let ok = false;
    try { ok = PortfolioSummarySchema.safeParse(JSON.parse(readFileSync(summaryPath, 'utf-8'))).success; } catch { /* invalid */ }
    if (!ok) errors.push('wsp/portfolio-summary.json does not match the portfolio summary schema');
  }
  return result(key, label, errors, warnings, `${apps.length} service app(s); scaffold signals and portfolio summary valid`);
}

// ---------------------------------------------------------------- [20] #3128

export const RESEARCH_STALE_DAYS = 30;
const API_STUBS = ['cve-summary', 'eol-status'] as const;

export function buildResearchCacheProbe(workspacePath: string, now: Date = new Date()): ServiceProbeResult {
  const key = 'research_cache';
  const label = 'Research cache';
  if (!isServiceWorkspace(workspacePath)) return skip(key, label);
  const missing: string[] = [];
  const stale: string[] = [];
  const noConfidence: string[] = [];
  const apps = serviceAppDirs(workspacePath);
  if (apps.length === 0) return skip(key, label, 'no service apps yet (run swao service init)');
  for (const a of apps) {
    const dir = join(a.dir, 'wsp', 'inputs', 'research');
    const stubs = API_STUBS.map((t) => readStub(join(dir, `${t}.md`)));
    if (stubs.some((s) => !s)) { missing.push(a.id); continue; }
    const oldest = Math.min(...stubs.map((s) => Date.parse(String(s!.front['retrieved_at'] ?? ''))).map((t) => (Number.isFinite(t) ? t : 0)));
    if ((now.getTime() - oldest) / 86_400_000 > RESEARCH_STALE_DAYS) stale.push(a.id);
    if (!existsSync(join(dir, 'confidence.json'))) noConfidence.push(a.id);
  }
  const errors = missing.length > 0 ? [`Research stub missing for app ${listShort(missing)} - run swao service research`] : [];
  const warnings = [
    ...(stale.length > 0 ? [`Research stub stale (> ${RESEARCH_STALE_DAYS} days) for ${listShort(stale)} - run swao service research --refresh`] : []),
    ...(noConfidence.length > 0 ? [`Confidence data missing for ${listShort(noConfidence)}`] : []),
  ];
  return result(key, label, errors, warnings, `${apps.length} app(s) researched within ${RESEARCH_STALE_DAYS} days (${RESEARCH_TOPICS.length} topics)`);
}

// ---------------------------------------------------------------- [21] #3129

/** Tier 2 INFRA-CAT files (`wsp/inputs/catalogs/infra-cat/*.yaml`); optional, so absent = skip. */
export function buildVendorCatalogProbe(workspacePath: string): ServiceProbeResult {
  const key = 'vendor_catalog';
  const label = 'Vendor catalogue (Tier 2)';
  if (!isServiceWorkspace(workspacePath)) return skip(key, label);
  const dir = tier2Dir(workspacePath);
  const files = existsSync(dir) ? readdirSync(dir).filter((n) => /\.ya?ml$/i.test(n)).sort() : [];
  if (files.length === 0) return skip(key, label, 'no Tier 2 catalogue (optional)');
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Map<string, string>();
  let count = 0;
  for (const f of files) {
    let raw: unknown;
    try { raw = load(readFileSync(join(dir, f), 'utf-8')); } catch { errors.push(`${f}: YAML parse error`); continue; }
    const parsed = InfraCatFileSchema.safeParse(raw ?? {});
    if (!parsed.success) { errors.push(`${f}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}`); continue; }
    for (const svc of parsed.data.services) {
      count++;
      for (const p of svc.product_name_patterns ?? []) {
        try { new RegExp(p, 'i'); } catch { errors.push(`${f}: ${svc.id} product_name_patterns regex does not compile`); }
      }
      if ((svc.vendor_patterns ?? []).some((p) => p.trim() === '')) errors.push(`${f}: ${svc.id} has a blank vendor_patterns entry`);
      const prev = seen.get(svc.id);
      if (prev) warnings.push(`${svc.id} defined in both ${prev} and ${f} (last file wins)`);
      seen.set(svc.id, f);
    }
  }
  return result(key, label, errors, warnings, `${count} Tier 2 categor${count === 1 ? 'y' : 'ies'} in ${files.length} file(s) valid`);
}

// ---------------------------------------------------------------- [22] #3130

export function buildClusterDetectionProbe(workspacePath: string): ServiceProbeResult {
  const key = 'cluster_detection';
  const label = 'Cluster detection';
  if (!isServiceWorkspace(workspacePath)) return skip(key, label);
  let signals: Array<{ code: string; app_id?: string | undefined; evidence: string[] }> = [];
  try {
    const parsed = ScaffoldSignalsFileSchema.safeParse(JSON.parse(readFileSync(join(workspacePath, 'wsp', 'signals', 'scaffold-signals.json'), 'utf-8')));
    if (parsed.success) signals = parsed.data.signals;
  } catch { return skip(key, label, 'no scaffold signals yet (run swao service init)'); }
  const clusters = signals.filter((s) => s.code === 'SCAFFOLD.CLUSTER_DETECTED' && s.app_id);
  if (clusters.length === 0) return { key, label, status: 'ok', message: '0 clusters detected', errors: [], warnings: [] };
  const warnings: string[] = [];
  for (const c of clusters) {
    const doc = readYaml(join(workspacePath, 'apps', c.app_id!, '.swao.yml'));
    const members = Array.isArray(doc?.['cluster_members']) ? (doc!['cluster_members'] as unknown[]) : [];
    if (!doc) warnings.push(`cluster ${c.app_id} has no app folder`);
    else if (members.length === 0) warnings.push(`cluster ${c.app_id} has no cluster_members`);
  }
  const summary = `${clusters.length} cluster(s) detected: ${clusters.map((c) => `${c.app_id} (${c.evidence.length} apps)`).join(', ')}`;
  return warnings.length > 0
    ? { key, label, status: 'warn', message: `${summary}; ${warnings.join('; ')}`, errors: [], warnings }
    : { key, label, status: 'ok', message: summary, errors: [], warnings };
}

// ---------------------------------------------------------------- [23] #3131

const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
/** Shared with the support bundle redaction pass (@swao/core, #3136). */
export { looksLikePhone };

const BOOLEAN_ONLY = ['vendor.support_contact_present', 'vendor.support_phone_present', 'vendor.support_email_present'];

/** Scans every service app `.swao.yml` for e-mail and phone values; reports field paths only. */
export function buildPiiScrubAuditProbe(workspacePath: string): ServiceProbeResult {
  const key = 'pii_scrub_audit';
  const label = 'PII scrub audit';
  if (!isServiceWorkspace(workspacePath)) return skip(key, label);
  const errors: string[] = [];
  const apps = serviceAppDirs(workspacePath);
  if (apps.length === 0) return skip(key, label, 'no service apps yet (run swao service init)');
  for (const a of apps) {
    const hits: string[] = [];
    const walk = (v: unknown, path: string): void => {
      if (typeof v === 'string') {
        if (EMAIL.test(v)) hits.push(`${path} (e-mail)`);
        else if (looksLikePhone(v)) hits.push(`${path} (phone)`);
      } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
    };
    walk(a.doc, '');
    for (const f of BOOLEAN_ONLY) {
      const [, field] = f.split('.');
      const val = a.doc?.['vendor']?.[field!];
      if (val !== undefined && typeof val !== 'boolean') hits.push(`${f} (must be boolean)`);
    }
    if (hits.length > 0) errors.push(`apps/${a.id}/.swao.yml: ${hits.join(', ')}`);
  }
  return result(key, label, errors, [], `${apps.length} app config(s) free of e-mail and phone values`);
}

// ---------------------------------------------------------------- [24] #3132

export const SNAPSHOT_STALE_DAYS = 90;

export function buildDeltaSnapshotProbe(workspacePath: string, now: Date = new Date()): ServiceProbeResult {
  const key = 'delta_snapshot';
  const label = 'Portfolio snapshots';
  if (!isServiceWorkspace(workspacePath)) return skip(key, label);
  const snaps = listSnapshots(workspacePath);
  if (snaps.length === 0) return skip(key, label, 'No portfolio snapshots yet - baseline will be established on first run');
  const m = /(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(snaps.at(-1)!)!;
  const age = Math.floor((now.getTime() - Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`)) / 86_400_000);
  const warnings = [
    ...(age > SNAPSHOT_STALE_DAYS ? [`Portfolio snapshot is ${age} days old - run swao service research to refresh`] : []),
    ...(snaps.length > MAX_SNAPSHOTS ? [`${snaps.length} snapshots found (max ${MAX_SNAPSHOTS}) - oldest should be pruned by runtime`] : []),
  ];
  return result(key, label, [], warnings, `${snaps.length} snapshot(s); newest ${age} day(s) old`);
}

// ---------------------------------------------------------------- [25] #3133

/**
 * Minimum controls per domain before a WARN. #3133 proposed 5; the approved
 * SWAO_APM 2026.10 framework has 4 in APM-HW, so 4 keeps the shipped framework clean.
 */
export const MIN_CONTROLS_PER_DOMAIN = 4;

/** SWAO_APM controls.yaml: all 11 domains, >= MIN_CONTROLS_PER_DOMAIN controls each, required fields, unique IDs. */
export function buildFrameworkControlsProbe(workspacePath: string): ServiceProbeResult {
  const key = 'framework_controls';
  const label = 'SWAO_APM controls';
  if (!isServiceWorkspace(workspacePath)) return skip(key, label);
  const located = apmFrameworkDir(workspacePath);
  if (!located) return skip(key, label, 'SWAO_APM framework not found');
  const doc = readYaml(join(located.dir, 'controls.yaml'));
  const controls = Array.isArray(doc?.['controls']) ? (doc!['controls'] as unknown[]) : null;
  if (!controls) return { key, label, status: 'error', message: 'SWAO_APM controls.yaml unreadable or has no controls', errors: ['unreadable'], warnings: [] };
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Map<string, number>();
  const perDomain = new Map<string, number>(APM_DOMAINS.map((d) => [d, 0]));
  controls.forEach((c, i) => {
    const parsed = ApmControlSchema.safeParse(c);
    if (!parsed.success) { errors.push(`control #${i + 1}: requires id (APM-XXX-NN) and title`); return; }
    const id = parsed.data.id;
    ids.set(id, (ids.get(id) ?? 0) + 1);
    if (parsed.data.evidence_basis.length === 0) errors.push(`${id}: evidence_basis (signal source) missing`);
    const domain = id.slice(0, id.lastIndexOf('-'));
    if (!perDomain.has(domain)) errors.push(`${id}: unknown domain ${domain}`);
    else perDomain.set(domain, perDomain.get(domain)! + 1);
  });
  const dupes = [...ids].filter(([, n]) => n > 1).map(([id]) => id);
  if (dupes.length > 0) errors.push(`duplicate control IDs: ${listShort(dupes)}`);
  const absent = [...perDomain].filter(([, n]) => n === 0).map(([d]) => d);
  if (absent.length > 0) errors.push(`domains without controls: ${absent.join(', ')}`);
  const thin = [...perDomain].filter(([, n]) => n > 0 && n < MIN_CONTROLS_PER_DOMAIN).map(([d, n]) => `${d} (${n})`);
  if (thin.length > 0) warnings.push(`domains with fewer than ${MIN_CONTROLS_PER_DOMAIN} controls: ${thin.join(', ')}`);
  return result(key, label, errors, warnings, `${controls.length} controls across ${APM_DOMAINS.length} domains (${located.source} framework)`);
}

// ---------------------------------------------------------------- registry

/**
 * Probes [19]-[25] in display order, keyed before they run (#3171) so the
 * runner can emit health-check.probe.start and time each probe on its own
 * instead of logging seven probe.complete events against one batch start.
 */
export interface ServiceProbeRunner {
  key: string;
  run: (workspacePath: string, now: Date) => ServiceProbeResult;
}

export const SERVICE_PROBE_RUNNERS: readonly ServiceProbeRunner[] = [
  { key: 'service_workspace', run: (ws) => buildServiceWorkspaceProbe(ws) },
  { key: 'research_cache', run: (ws, now) => buildResearchCacheProbe(ws, now) },
  { key: 'vendor_catalog', run: (ws) => buildVendorCatalogProbe(ws) },
  { key: 'cluster_detection', run: (ws) => buildClusterDetectionProbe(ws) },
  { key: 'pii_scrub_audit', run: (ws) => buildPiiScrubAuditProbe(ws) },
  { key: 'delta_snapshot', run: (ws, now) => buildDeltaSnapshotProbe(ws, now) },
  { key: 'framework_controls', run: (ws) => buildFrameworkControlsProbe(ws) },
];

/** Probes [19]-[25] in display order. */
export function buildServiceProbes(workspacePath: string, now: Date = new Date()): ServiceProbeResult[] {
  return SERVICE_PROBE_RUNNERS.map((r) => r.run(workspacePath, now));
}

/** Event sink used by runServiceProbes; the runner passes logPortfolio. */
export type ServiceProbeLogFn = (
  level: 'info',
  code: 'health-check.probe.start' | 'health-check.probe.complete',
  message: string,
  opts: { context: Record<string, unknown> },
) => void;

/**
 * Run probes [19]-[25] one at a time, emitting health-check.probe.start before
 * and health-check.probe.complete after each, with elapsed_ms measured for
 * that probe alone (#3171; same contract as probes [1]-[18], #1786).
 */
export function runServiceProbes(
  workspacePath: string,
  log: ServiceProbeLogFn,
  onResult?: (probe: ServiceProbeResult, index: number) => void,
  now: Date = new Date(),
  clock: () => number = Date.now,
): ServiceProbeResult[] {
  return SERVICE_PROBE_RUNNERS.map((runner, i) => {
    const t0 = clock();
    log('info', 'health-check.probe.start', `probe: ${runner.key}`, { context: { probe: runner.key } });
    const sp = runner.run(workspacePath, now);
    log('info', 'health-check.probe.complete', `probe: ${sp.key} status=${sp.status}`, {
      context: { probe: sp.key, status: sp.status, errors: sp.errors.length, warnings: sp.warnings.length, elapsed_ms: clock() - t0 },
    });
    onResult?.(sp, i);
    return sp;
  });
}

export function formatServiceProbeLine(probe: ServiceProbeResult, index: number): string {
  // Dot padding (at least 2) so the TUI health-check parser's HEADER_RE matches.
  const text = `[${SERVICE_PROBE_FIRST + index}/${PROBE_TOTAL}] ${probe.label}`;
  const label = text + '.'.repeat(Math.max(2, 26 - text.length));
  const tag = ({ skip: 'INFO', ok: 'ok  ', warn: 'WARN', error: 'FAIL' } as const)[probe.status];
  return `  ${label}  ${tag}  ${probe.message}`;
}

