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
import { isAbsolute, join } from 'node:path';
import { load } from 'js-yaml';
import { listAppConfigs, prefetchedText } from '../app-config-walk.js';
import { meterFileRead, meterStep } from '../probe-meter.js';
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
  INTAKE_TEMPLATE_FILE,
  loadColumnMapFile,
  parseIntakeWorkbook,
  parseStub,
  SERVICE_INTAKE_DIR,
  tier2Dir,
} from '@swao/module-service-assessment';

/**
 * #4262: `info` is a probe that ran and reports a fact with nothing to fix
 * (the recorded intake before its first import); `skip` is a probe that did
 * not run. Both print as INFO; only `skip` counts as not checked.
 */
export type ServiceProbeStatus = 'skip' | 'info' | 'ok' | 'warn' | 'error';

export interface ServiceProbeResult {
  key: string;
  label: string;
  status: ServiceProbeStatus;
  message: string;
  errors: string[];
  warnings: string[];
}

export const SERVICE_PROBE_FIRST = 19;
// #3589: probe [26] LZ connections (lz-connections-probe.ts) follows the service probes.
export const PROBE_TOTAL = 26;

type Rec = Record<string, any>;

function readYaml(p: string): Rec | null {
  try { return (load(readFileSync(p, 'utf-8')) ?? null) as Rec | null; } catch { return null; }
}

/**
 * #4262: how far a workspace is a service workspace. `portfolio`: the
 * `service_portfolio` block is recorded (the intake ran; the Setup Wizard's
 * Service intake step and `swao service init` write it). `declared`:
 * `workspace.assessment_types` lists `service` (the Setup Wizard's type
 * selection) but no intake is recorded yet. `none`: neither marker.
 */
export type ServiceWorkspaceState = 'portfolio' | 'declared' | 'none';

export function serviceWorkspaceState(workspacePath: string): ServiceWorkspaceState {
  const doc = readYaml(join(workspacePath, '.swao.yml'));
  if (doc?.['service_portfolio']) return 'portfolio';
  const types = doc?.['workspace']?.['assessment_types'];
  return Array.isArray(types) && types.includes('service') ? 'declared' : 'none';
}

/** #4262: either marker makes a service workspace (one detector for every service probe). */
export function isServiceWorkspace(workspacePath: string): boolean {
  return serviceWorkspaceState(workspacePath) !== 'none';
}

/** #4262: the warning of a declared service workspace without a recorded intake. */
export const SERVICE_INTAKE_MISSING =
  'service workspace without a recorded intake: the service_portfolio block is missing in the workspace .swao.yml ' +
  '(run the Service intake step of swao setup, or swao service init)';

/**
 * #4295: CLI remedies of the service probes and their TUI path. The probe
 * message is the CLI wording; the TUI health check list (HealthCheckProbeList,
 * tuiRemedyText) shows the TUI path instead, so an operator in the TUI never
 * reads a command it does not see.
 */
export const SERVICE_IMPORT_REMEDY = 'run swao service init';
export const SERVICE_RESEARCH_REMEDY = 'run swao service research';
export const SERVICE_TUI_REMEDIES: ReadonlyArray<readonly [cli: string, tui: string]> = [
  ['(run the Service intake step of swao setup, or swao service init)', '(Setup, Service Portfolio Assessment, Intake Input)'],
  [`${SERVICE_RESEARCH_REMEDY} --refresh`, 'run Run Assessment, Service Portfolio Assessment again (it refreshes stale research)'],
  [`re-${SERVICE_IMPORT_REMEDY}`, 'run Run Assessment, Service Portfolio Assessment again (it imports the intake first)'],
  [SERVICE_IMPORT_REMEDY, 'start Run Assessment, Service Portfolio Assessment (it imports the intake first)'],
  [SERVICE_RESEARCH_REMEDY, 'start Run Assessment, Service Portfolio Assessment (it researches every app)'],
  ['(swao service init --replace keeps one workbook)', '(Run Assessment, Service Portfolio Assessment can replace the earlier sources and keep one workbook)'],
  ['run swao assess for an app, or swao service research', 'start Run Assessment, Service Portfolio Assessment'],
];

/** #4295: a probe message in TUI wording (plain string replacement, no pattern on the input). */
export function tuiRemedyText(text: string): string {
  let out = text;
  for (const [cli, tui] of SERVICE_TUI_REMEDIES) out = out.split(cli).join(tui);
  return out;
}

/** #4262: skip message of the probes that need the intake, in a declared workspace. */
const WAITS_FOR_INTAKE = 'waits for the service intake (service_portfolio block missing)';

/**
 * App folders under apps/ whose `.swao.yml` declares `assessment.type: service`.
 * #4461: from the shared walk of the app configs (one read per health check).
 */
function serviceAppDirs(workspacePath: string): Array<{ id: string; dir: string; doc: Rec | null }> {
  return listAppConfigs(workspacePath)
    .map((a) => ({ id: a.id, dir: a.dir, doc: a.parseError ? null : ((a.doc ?? null) as Rec | null) }))
    .filter((a) => a.doc?.['assessment']?.['type'] === 'service')
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * #4461: readStub with the read counted by the probe meter (same result). A
 * stub the prefetch of the health check already read (prefetchAppInputs) is
 * parsed from memory and not counted as a probe read.
 */
function readStub(path: string): ReturnType<typeof parseStub> {
  const pre = prefetchedText(path);
  if (pre.hit) {
    if (pre.text === null) return null;
    try { return parseStub(pre.text); } catch { return null; }
  }
  if (!existsSync(path)) return null;
  try {
    const text = readFileSync(path, 'utf-8');
    meterFileRead(Buffer.byteLength(text));
    return parseStub(text);
  } catch {
    return null;
  }
}

function result(key: string, label: string, errors: string[], warnings: string[], okMessage: string): ServiceProbeResult {
  if (errors.length > 0) return { key, label, status: 'error', message: errors.join('; '), errors, warnings };
  if (warnings.length > 0) return { key, label, status: 'warn', message: warnings.join('; '), errors, warnings };
  return { key, label, status: 'ok', message: okMessage, errors, warnings };
}
const skip = (key: string, label: string, message = 'not a service workspace'): ServiceProbeResult =>
  ({ key, label, status: 'skip', message, errors: [], warnings: [] });
/** #4262: a probe that needs the recorded intake skips, naming why. */
function intakeGate(workspacePath: string, key: string, label: string): ServiceProbeResult | null {
  const state = serviceWorkspaceState(workspacePath);
  if (state === 'portfolio') return null;
  return skip(key, label, state === 'declared' ? WAITS_FOR_INTAKE : undefined);
}
const OFFICE_LOCK_PREFIX = '~$';
// The blank template Setup copies in is not an intake until it is filled and recorded.
const isWorkbook = (name: string): boolean => name.toLowerCase().endsWith('.xlsx') && !name.startsWith(OFFICE_LOCK_PREFIX) && name !== INTAKE_TEMPLATE_FILE;

/**
 * #4295: the intake the `service_portfolio` block records: `intake` (the Setup
 * Intake Input step and `service init` write it), else the single workbook in
 * `intake_folder` (the form `service init` resolves, intake-location.ts).
 * Null when neither names a workbook.
 */
export function recordedServiceIntake(workspacePath: string): { file: string; exists: boolean } | null {
  const sp = readYaml(join(workspacePath, '.swao.yml'))?.['service_portfolio'];
  if (!sp || typeof sp !== 'object') return null;
  const intake = (sp as Rec)['intake'];
  if (typeof intake === 'string' && intake.trim()) {
    const file = intake.trim();
    return { file, exists: existsSync(isAbsolute(file) ? file : join(workspacePath, file)) };
  }
  const folderRaw = (sp as Rec)['intake_folder'];
  const folder = typeof folderRaw === 'string' && folderRaw.trim() ? folderRaw.trim() : SERVICE_INTAKE_DIR;
  const dir = isAbsolute(folder) ? folder : join(workspacePath, folder);
  let books: string[] = [];
  try { books = readdirSync(dir).filter(isWorkbook).sort(); } catch { return null; }
  return books.length === 1 ? { file: `${slashes(folder)}/${books[0]}`, exists: true } : null;
}

/** #4295: outcome of reading the recorded intake before the import: data rows, or why it cannot be read. */
export type RecordedIntakeCheck = { rows: number } | { error: string };

function shortReason(e: unknown): string {
  const msg = (e instanceof Error ? e.message : String(e)).split('\n').join(' ').trim();
  return msg.length > 160 ? `${msg.slice(0, 157)}...` : msg;
}

/**
 * #4295: reads the recorded intake workbook (with the recorded column map, as
 * `service init` does) for the service workspace probe. Only counts leave
 * this function, never a cell value. Null when no intake is recorded or no
 * app import is pending (apps exist), so the probe needs no read.
 */
export async function checkRecordedIntake(
  workspacePath: string,
  parse: typeof parseIntakeWorkbook = parseIntakeWorkbook,
): Promise<RecordedIntakeCheck | null> {
  if (serviceWorkspaceState(workspacePath) !== 'portfolio' || serviceAppDirs(workspacePath).length > 0) return null;
  const intake = recordedServiceIntake(workspacePath);
  if (!intake?.exists) return null;
  const abs = isAbsolute(intake.file) ? intake.file : join(workspacePath, intake.file);
  try {
    const mapping = readYaml(join(workspacePath, '.swao.yml'))?.['service_portfolio']?.['mapping'];
    const map = typeof mapping === 'string' && mapping.trim()
      ? loadColumnMapFile(isAbsolute(mapping) ? mapping : join(workspacePath, mapping))
      : undefined;
    const r = await parse(abs, { ...(map ? { map } : {}), sourceLabel: intake.file });
    return { rows: r.rows.length };
  } catch (e) {
    return { error: shortReason(e) };
  }
}

/** Forward slashes in a displayed path (no pattern on the input). */
function slashes(p: string): string {
  return p.split('\\').join('/');
}

const listShort = (xs: string[], n = 5) => (xs.length > n ? `${xs.slice(0, n).join(', ')} (+${xs.length - n} more)` : xs.join(', '));

// ---------------------------------------------------------------- [19] #3127

/** Workspace structure: service apps, valid app configs, scaffold signals, portfolio summary. */
export function buildServiceWorkspaceProbe(workspacePath: string, intakeCheck?: RecordedIntakeCheck | null): ServiceProbeResult {
  const key = 'service_workspace';
  const label = 'Service workspace';
  const state = serviceWorkspaceState(workspacePath);
  if (state === 'none') return skip(key, label);
  if (state === 'declared') return result(key, label, [], [SERVICE_INTAKE_MISSING], '');
  const errors: string[] = [];
  const warnings: string[] = [];
  const apps = serviceAppDirs(workspacePath);
  if (apps.length === 0) {
    // #4295: before the first import the intake is the expected state, not a
    // failure: the Service Portfolio Assessment imports it as its first step.
    const intake = recordedServiceIntake(workspacePath);
    if (intake?.exists) {
      // #4295: with the read of the runner (checkRecordedIntake) the probe names the rows or the reason it cannot import.
      if (intakeCheck && 'error' in intakeCheck) return result(key, label, [`intake ${intake.file} cannot be read: ${intakeCheck.error}`], [], '');
      if (intakeCheck && intakeCheck.rows === 0) return result(key, label, [`intake ${intake.file} has no data rows (fill it or record another workbook)`], [], '');
      const what = intakeCheck ? `${intakeCheck.rows} rows in ${intake.file}` : intake.file;
      // #4262: the probe ran and found the expected pre-import state: info, not skip.
      return { key, label, status: 'info', message: `intake recorded (${what}); the Service Portfolio Assessment imports it and creates the apps at its first run`, errors: [], warnings: [] };
    }
    return result(key, label, [intake
      ? `intake ${intake.file} not found; no service apps under apps/ (copy the workbook back, then ${SERVICE_IMPORT_REMEDY})`
      : `no intake recorded and no service apps under apps/ (put the intake workbook into ${slashes(SERVICE_INTAKE_DIR)}/, then ${SERVICE_IMPORT_REMEDY})`], [], '');
  }
  const invalid = apps.filter((a) => !ServiceAppConfigSchema.safeParse(a.doc).success).map((a) => a.id);
  if (invalid.length > 0) errors.push(`invalid apps/<id>/.swao.yml for ${listShort(invalid)}`);

  // #3521: a second intake workbook next to an earlier import scaffolds every service twice.
  const bySource = new Map<string, number>();
  for (const a of apps) {
    const src = typeof a.doc?.['intake']?.['source'] === 'string' ? String(a.doc['intake']['source']) : '(source not recorded)';
    bySource.set(src, (bySource.get(src) ?? 0) + 1);
  }
  if (bySource.size > 1) {
    const parts = [...bySource.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([s, n]) => `${s} (${n})`);
    warnings.push(`service apps come from ${bySource.size} intake sources: ${parts.join(', ')}; services may be listed twice (swao service init --replace keeps one workbook)`);
  }
  const recorded = readYaml(join(workspacePath, '.swao.yml'))?.['service_portfolio']?.['app_count'];
  if (typeof recorded === 'number' && apps.length > 0 && recorded !== apps.length) {
    warnings.push(`${apps.length} service app folder(s) under apps/, but service_portfolio.app_count is ${recorded} (apps from another intake, or folders added or removed by hand)`);
  }

  // Apps named in the scaffold signals or cluster membership must have a folder.
  const signalsPath = join(workspacePath, 'wsp', 'signals', 'scaffold-signals.json');
  if (!existsSync(signalsPath)) {
    errors.push(`wsp/signals/scaffold-signals.json missing (${SERVICE_IMPORT_REMEDY})`);
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
  const gate = intakeGate(workspacePath, key, label);
  if (gate) return gate;
  const missing: string[] = [];
  const stale: string[] = [];
  const noConfidence: string[] = [];
  const apps = serviceAppDirs(workspacePath);
  if (apps.length === 0) return skip(key, label, 'no service apps yet (run swao service init)');
  meterStep('research stubs of the apps', () => { for (const a of apps) {
    const dir = join(a.dir, 'wsp', 'inputs', 'research');
    const stubs = API_STUBS.map((t) => readStub(join(dir, `${t}.md`)));
    if (stubs.some((s) => !s)) { missing.push(a.id); continue; }
    const oldest = Math.min(...stubs.map((s) => Date.parse(String(s!.front['retrieved_at'] ?? ''))).map((t) => (Number.isFinite(t) ? t : 0)));
    if ((now.getTime() - oldest) / 86_400_000 > RESEARCH_STALE_DAYS) stale.push(a.id);
    const conf = prefetchedText(join(dir, 'confidence.json'));
    if (conf.hit ? conf.text === null : !existsSync(join(dir, 'confidence.json'))) noConfidence.push(a.id);
  } });
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
  const gate = intakeGate(workspacePath, key, label);
  if (gate) return gate;
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
  const gate = intakeGate(workspacePath, key, label);
  if (gate) return gate;
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
  const gate = intakeGate(workspacePath, key, label);
  if (gate) return gate;
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
  const gate = intakeGate(workspacePath, key, label);
  if (gate) return gate;
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
  const gate = intakeGate(workspacePath, key, label);
  if (gate) return gate;
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
  run: (workspacePath: string, now: Date, intakeCheck?: RecordedIntakeCheck | null) => ServiceProbeResult;
}

export const SERVICE_PROBE_RUNNERS: readonly ServiceProbeRunner[] = [
  { key: 'service_workspace', run: (ws, _now, intakeCheck) => buildServiceWorkspaceProbe(ws, intakeCheck) },
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
  level: 'info' | 'warn' | 'error',
  code: 'health-check.probe.start' | 'health-check.probe.complete',
  message: string,
  opts: { context: Record<string, unknown> },
) => void;

/** #4260: log level of a service probe outcome (warn for warn, error for error, info for ok and skip). */
export function serviceProbeLogLevel(status: ServiceProbeResult['status']): 'info' | 'warn' | 'error' {
  switch (status) {
    case 'ok':
    case 'info':
    case 'skip':
      return 'info';
    case 'warn':
      return 'warn';
    case 'error':
      return 'error';
  }
}

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
  /** #4295: the runner's read of the recorded intake (checkRecordedIntake). */
  intakeCheck: RecordedIntakeCheck | null = null,
): ServiceProbeResult[] {
  return SERVICE_PROBE_RUNNERS.map((runner, i) => {
    const t0 = clock();
    log('info', 'health-check.probe.start', `probe: ${runner.key}`, { context: { probe: runner.key } });
    const sp = runner.run(workspacePath, now, intakeCheck);
    log(serviceProbeLogLevel(sp.status), 'health-check.probe.complete', `probe: ${sp.key} status=${sp.status}`, {
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
  const tag = ({ skip: 'INFO', info: 'INFO', ok: 'ok  ', warn: 'WARN', error: 'FAIL' } as const)[probe.status];
  return `  ${label}  ${tag}  ${probe.message}`;
}

