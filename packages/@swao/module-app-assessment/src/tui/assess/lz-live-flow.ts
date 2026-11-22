// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Application assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3588: pure logic of the Landing Zone Live Assessment screen (Design 120
// section 14.3), kept apart from the Ink component so every step is unit
// tested. The screen drives the CLI, so TUI and CLI stay in parity:
//   step 1 landing zone   -> --lz <lz-id>
//   step 2 scopes         -> --scope <id> (repeated)
//   step 3 probe          -> `swao lz probe`; refused stops unless the operator
//                            confirms a write-capable credential for this run
//                            (--accept-write-capable-credentials, never
//                            remembered); unverifiable asks per run
//                            (--accept-unverified-read-only)
//   step 4 frameworks     -> --frameworks <id,...>, local community catalogue
//                            only, pre-selected from assessment.frameworks /
//                            regimes_active, at least one

import { existsSync, readFileSync, readdirSync } from 'fs';
import { isAbsolute, join } from 'path';
import { load as loadYaml } from 'js-yaml';
import { SwaoYmlLandingZonesSchema, discoverFrameworks, normalizeDashes, parseLzProbeScopeLine, parseLzProbeIdentityLine, LzBaselineResultSchema, LZ_BASELINE_RESULT_SUFFIX, LZ_LIVE_CHECK_STATUSES, readLzEvidenceMap, readLzOrganisationalResult, LZ_ACCEPT_WRITE_CAPABLE_PHRASE, LZ_ACCEPT_UNVERIFIED_PHRASE } from '@swao/core';
import type { LzBaselineOfferingVerdict, LzLiveCheckStatus } from '@swao/core';

export interface LiveLzOption {
  id: string;
  provider: string;
  display?: string;
  scopes: { id: string; kind: 'platform' | 'application' }[];
  /** #4198 (Design 125 section 5.7): `landing_zones[].frameworks` stored by the LZ Live setup. */
  frameworks?: string[];
}

/**
 * #4198: the framework selection after a landing zone is chosen: its stored
 * `landing_zones[].frameworks` that are installed, else the current selection
 * (assessment.frameworks / regimes_active). The operator can still change it.
 */
export function frameworksForLz(lz: LiveLzOption, installed: readonly LiveFrameworkOption[], current: ReadonlySet<string>): Set<string> {
  const want = new Set((lz.frameworks ?? []).map((f) => f.toLowerCase()));
  if (want.size === 0) return new Set(current);
  const hit = installed.filter((f) => want.has(f.id.toLowerCase())).map((f) => f.id);
  return hit.length > 0 ? new Set(hit) : new Set(current);
}

/** Landing zones registered in the workspace .swao.yml (empty when none or invalid). */
export function readRegisteredLandingZones(workspace: string): LiveLzOption[] {
  try {
    const doc = (loadYaml(readFileSync(join(workspace, '.swao.yml'), 'utf-8')) ?? {}) as Record<string, unknown>;
    const r = SwaoYmlLandingZonesSchema.safeParse(doc['landing_zones'] ?? []);
    if (!r.success) return [];
    return r.data.map((l) => ({ id: l.id, provider: l.provider, ...(l.display ? { display: l.display } : {}), scopes: l.scopes.map((s) => ({ id: s.id, kind: s.kind })), ...(l.frameworks && l.frameworks.length > 0 ? { frameworks: l.frameworks } : {}) }));
  } catch {
    return [];
  }
}

export interface LiveFrameworkOption {
  id: string;
  name: string;
  version: string;
  /** service-controls.yaml present (Design 120 section 8.2); without it every service is grey. */
  hasServiceMapping: boolean;
  preselected: boolean;
}

/**
 * Frameworks installed in the workspace community catalogue
 * (`wsp/inputs/catalogs/community/`), never fetched from the network.
 * Pre-selected: assessment.frameworks, else regimes_active (same resolution
 * as the CLI, lz-live-frameworks.ts resolveLzLiveFrameworkIds).
 */
export function listLiveFrameworks(workspace: string): LiveFrameworkOption[] {
  let pre: string[] = [];
  try {
    const doc = (loadYaml(readFileSync(join(workspace, '.swao.yml'), 'utf-8')) ?? {}) as Record<string, unknown>;
    const a = (doc['assessment'] ?? {}) as Record<string, unknown>;
    const pick = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined);
    pre = pick(a['frameworks']) ?? pick(a['regimes_active']) ?? [];
  } catch { /* no preselection */ }
  const preLower = new Set(pre.map((p) => p.toLowerCase()));
  return discoverFrameworks(join(workspace, 'wsp', 'inputs', 'catalogs', 'community'), { includeUnlisted: true, warn: () => {} })
    .map((f) => ({
      id: f.id,
      // #4501: no spaced double hyphen on screen (normalizeDashes).
      name: normalizeDashes(f.meta.name ?? f.id),
      version: normalizeDashes(f.meta.version ?? 'unversioned'),
      hasServiceMapping: existsSync(join(f.dir, 'service-controls.yaml')),
      preselected: preLower.has(f.id.toLowerCase()) || preLower.has(f.folder.toLowerCase()),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export type ProbeReadOnly = 'verified' | 'refused' | 'unverifiable';

export interface ProbeLine {
  scopeId: string;
  readOnly: ProbeReadOnly;
  /** Gate message lines printed after the scope line (roles, reason). */
  detail: string[];
}

/** #4460: the CLI flag phrases of the probe gate message and the TUI choice that replaces each on screen. */
const TUI_PROBE_CHOICES: ReadonlyArray<readonly [string, string]> = [
  [LZ_ACCEPT_WRITE_CAPABLE_PHRASE, 'or choose "Continue with the write-capable credential for this run" below.'],
  [LZ_ACCEPT_UNVERIFIED_PHRASE, 'Choose "Accept for this run only" below.'],
];

/**
 * #4460: a gate message line of the probe in the words of the TUI: the CLI
 * flag (`--accept-write-capable-credentials`, `--accept-unverified-read-only`)
 * becomes the choice of the probe result screen. The CLI output keeps the flag.
 */
export function tuiProbeDetail(line: string): string {
  let out = line;
  for (const [cli, tui] of TUI_PROBE_CHOICES) out = out.split(cli).join(tui);
  return out;
}

/**
 * Parse `swao lz probe` output (`scope <id>: read-only check: <verdict>`, #4399,
 * or the older `scope <id>: identity <x>, read-only <state>`, plus indented
 * lines). The `identity:` line is dropped: it can carry a native cloud id.
 */
export function parseProbeOutput(text: string): ProbeLine[] {
  const out: ProbeLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = parseLzProbeScopeLine(raw);
    if (m) {
      out.push({ scopeId: m.scopeId, readOnly: m.readOnly as ProbeReadOnly, detail: [] });
      continue;
    }
    const last = out[out.length - 1];
    if (parseLzProbeIdentityLine(raw) !== null) continue;
    if (last && /^\s+\S/.test(raw)) last.detail.push(tuiProbeDetail(raw.trim()));
  }
  return out;
}

export type ProbeDecision =
  | { kind: 'proceed' }
  | { kind: 'refused'; scopes: ProbeLine[] }
  | { kind: 'unverifiable'; scopes: ProbeLine[] }
  | { kind: 'error'; message: string };

/** Refused wins over unverifiable: a write-capable credential needs its own confirmation. */
export function probeDecision(lines: readonly ProbeLine[], wantedScopes: readonly string[]): ProbeDecision {
  const missing = wantedScopes.filter((s) => !lines.some((l) => l.scopeId === s));
  if (missing.length > 0) return { kind: 'error', message: `no probe result for scope ${missing.join(', ')}` };
  const refused = lines.filter((l) => wantedScopes.includes(l.scopeId) && l.readOnly === 'refused');
  if (refused.length > 0) return { kind: 'refused', scopes: refused };
  const unverifiable = lines.filter((l) => wantedScopes.includes(l.scopeId) && l.readOnly === 'unverifiable');
  if (unverifiable.length > 0) return { kind: 'unverifiable', scopes: unverifiable };
  return { kind: 'proceed' };
}

/** #4241 / #4255: the recovery entries of a failed probe (Design 126 section 4.9, ErrorPanel). */
export type ProbeRecoveryId = 'retry' | 'without-scope' | 'back';

export interface ProbeRecovery {
  /** Entries in order: Probe again, Continue without the failed scopes (when some scopes answered), Back. */
  options: { label: string; value: ProbeRecoveryId }[];
  /** The selected scopes without a probe result. */
  failedScopes: string[];
  /** The selected scopes that answered; the run continues with these on "without-scope". */
  answeredScopes: string[];
}

/**
 * The way out of a failed probe: never a dead end (#4241 Log 17:22). "Continue
 * without" is offered only when at least one selected scope answered, so the
 * run keeps a probed scope; it drops the failed scopes and probes the rest again.
 */
export function probeRecovery(probeOutput: readonly string[], wantedScopes: readonly string[]): ProbeRecovery {
  const answered = new Set(parseProbeOutput(probeOutput.join('\n')).map((l) => l.scopeId));
  const failedScopes = wantedScopes.filter((s) => !answered.has(s));
  const answeredScopes = wantedScopes.filter((s) => answered.has(s));
  const options: ProbeRecovery['options'] = [{ label: 'Probe again', value: 'retry' }];
  if (answeredScopes.length > 0 && failedScopes.length > 0) {
    options.push({ label: `Continue without ${failedScopes.length === 1 ? 'scope' : 'scopes'} ${failedScopes.join(', ')}`, value: 'without-scope' });
  }
  options.push({ label: 'Back to the scopes', value: 'back' });
  return { options, failedScopes, answeredScopes };
}

export interface LiveRunChoice {
  lzId: string;
  scopes: readonly string[];
  frameworks: readonly string[];
  acceptWriteCapableCredentials: boolean;
  acceptUnverifiedReadOnly: boolean;
}

/** argv of `swao lz probe` for the chosen scopes (one call; no scope flag means all). */
export function buildProbeArgs(lzId: string, scopes: readonly string[], all: readonly string[]): string[][] {
  if (scopes.length === all.length) return [['lz', 'probe', lzId]];
  return scopes.map((s) => ['lz', 'probe', lzId, '--scope', s]);
}

/** argv of `swao assess --type landing-zone-live`, the CLI parity of steps 1 to 4. */
export function buildLiveAssessArgs(c: LiveRunChoice): string[] {
  if (c.frameworks.length === 0) throw new Error('select at least one framework');
  const args = ['assess', '--type', 'landing-zone-live', '--lz', c.lzId];
  for (const s of c.scopes) args.push('--scope', s);
  args.push('--frameworks', c.frameworks.join(','));
  if (c.acceptWriteCapableCredentials) args.push('--accept-write-capable-credentials');
  if (c.acceptUnverifiedReadOnly) args.push('--accept-unverified-read-only');
  return args;
}

/** Done menu of section 14.3. */
export const LIVE_DONE_ACTIONS = [
  { key: '1', id: 'publish', label: 'Publish Live View (lz-live)' },
  { key: '2', id: 'catalogue-source', label: 'Use as source for Update LZ Catalogue' },
  { key: '3', id: 'diff', label: 'Diff vs previous run' },
  { key: '4', id: 'hierarchy', label: 'Tenant hierarchy' },
  { key: '5', id: 'evidence', label: 'Evidence references (resolve locally)' },
  { key: '6', id: 'back', label: 'Back' },
] as const;
export type LiveDoneAction = (typeof LIVE_DONE_ACTIONS)[number]['id'];

/**
 * argv for a done-menu action, or null with the reason when the command is not built yet.
 * #3589: "Use as source for Update LZ Catalogue" runs the dry-run diff of #3582
 * (`swao lz catalogue update --provider <p> --source live --lz <lz-id> --dry-run`);
 * writing stays a separate, confirmed step (Tools > Update LZ Catalogue, live source).
 */
export function doneActionArgs(action: LiveDoneAction, lzId: string, provider: string): { args: string[]; followUp?: string } | { notice: string } | null {
  switch (action) {
    case 'publish': return { args: ['publish', '--lz-live', lzId] };
    case 'catalogue-source': return {
      args: ['lz', 'catalogue', 'update', '--provider', provider, '--source', 'live', '--lz', lzId, '--dry-run'],
      followUp: 'Dry run only. Write it with Tools > Update LZ Catalogue > Source: Live landing zone catalogue.',
    };
    // #3830: the run against the previous scan of each scope (Design 120 section 13.2).
    case 'diff': return { args: ['lz', 'diff', lzId], followUp: 'Diff vs the previous run of each scope.' };
    // #3885: the tenant tree of the latest run (Design 123 section 9.4), shown in the output pane.
    case 'hierarchy': return { args: ['lz', 'hierarchy', lzId], followUp: 'Tenant hierarchy of the latest run, pseudonymised.' };
    // #3956 (Design 123 section 9.5): the screen opens the evidence list of this run; this is the CLI equivalent (list, no native id).
    case 'evidence': return { args: ['lz', 'evidence', '--lz', lzId], followUp: 'Evidence references of the latest run; resolve one from the evidence list.' };
    case 'back': return null;
    default: {
      const never: never = action;
      return never;
    }
  }
}

// ---------------------------------------------------------------------------
// #3875 (Design 123 section 9.4): the baseline summary of the results step.
// The run folder is the one the CLI names in its last line (`[lz live] run
// <id>: <status> -> <dir>`, module-landing-zone live/cli.ts), so the summary is
// of this run. Read through LzBaselineResultSchema (@swao/core
// lz-baseline-result.ts); shown as verdicts and counts only: no detail text,
// no resource ids, no credentials.
// ---------------------------------------------------------------------------

/** Run folder named by the CLI output of `swao assess --type landing-zone-live` (relative to `base`), or null. */
export function parseLiveRunDir(lines: readonly string[], base?: string): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^\[lz live\] run \S+: \S+ -> (.+)$/.exec(lines[i]!.trim());
    if (m) {
      const dir = m[1]!.trim();
      return base && !isAbsolute(dir) ? join(base, dir) : dir;
    }
  }
  return null;
}

/** #3956: one row of the TUI evidence list (no native id; the CLI resolves). */
export interface LiveEvidenceRow {
  ref: string;
  kind: string;
  title: string;
  status?: string;
}

/**
 * #3956 (Design 123 section 9.5): the evidence references of one run folder,
 * from its local evidence map (@swao/core readLzEvidenceMap). Only the
 * reference, kind, title and status are kept for the list; resolving goes
 * through `swao lz evidence <ref>` (TUI and CLI parity). Checks first.
 */
export function readLiveEvidenceRows(runDir: string): LiveEvidenceRow[] {
  const map = readLzEvidenceMap(runDir);
  if (!map) return [];
  const rank = (k: string): number => (k === 'check' ? 0 : k === 'guardrail' ? 1 : k === 'hierarchy_node' ? 2 : 3);
  return map.entries
    .map((e) => ({ ref: e.ref, kind: e.kind, title: e.title, ...(e.status ? { status: e.status } : {}) }))
    .sort((a, b) => rank(a.kind) - rank(b.kind) || a.kind.localeCompare(b.kind) || a.ref.localeCompare(b.ref));
}

/** argv of resolving (and opening) one reference. */
export function evidenceResolveArgs(ref: string, open: boolean): string[] {
  return ['lz', 'evidence', ref, ...(open ? ['--open'] : [])];
}

export interface LiveBaselineScopeSummary {
  scope_id: string;
  framework: string;
  catalogue_version: string;
  overall: LzBaselineOfferingVerdict;
  evaluated: number;
  estate: Record<LzLiveCheckStatus, number>;
  not_reviewed: number;
  disabled: number;
}

export interface LiveBaselineSummary {
  scopes: LiveBaselineScopeSummary[];
  /** Baseline result files that did not parse (counted, not shown). */
  unreadable: number;
}

/** Baseline results (`*.lz-baseline.json`) of a run folder; empty when the baseline was not selected. */
export function readLiveBaselineSummary(runDir: string): LiveBaselineSummary {
  let files: string[];
  try {
    files = readdirSync(runDir).filter((f) => f.endsWith(LZ_BASELINE_RESULT_SUFFIX)).sort();
  } catch {
    return { scopes: [], unreadable: 0 };
  }
  const scopes: LiveBaselineScopeSummary[] = [];
  let unreadable = 0;
  for (const f of files) {
    let parsed;
    try { parsed = LzBaselineResultSchema.safeParse(JSON.parse(readFileSync(join(runDir, f), 'utf-8'))); } catch { unreadable += 1; continue; }
    if (!parsed.success) { unreadable += 1; continue; }
    const r = parsed.data;
    const estate = Object.fromEntries(LZ_LIVE_CHECK_STATUSES.map((s) => [s, 0])) as Record<LzLiveCheckStatus, number>;
    for (const p of r.policies) estate[p.estate] += 1;
    scopes.push({
      scope_id: r.scope_id, framework: r.framework, catalogue_version: r.catalogue_version, overall: r.overall,
      evaluated: r.policies.length, estate, not_reviewed: r.not_reviewed.length, disabled: r.disabled.length,
    });
  }
  return { scopes, unreadable };
}

/** Lines of the baseline summary (none when the run has no baseline result). */
export function formatLiveBaselineSummary(s: LiveBaselineSummary): string[] {
  if (s.scopes.length === 0 && s.unreadable === 0) return [];
  const lines: string[] = [];
  const frameworks = [...new Set(s.scopes.map((x) => `${x.framework} ${x.catalogue_version}`))];
  lines.push(`Client LZ Policy Baseline: ${frameworks.join(', ') || '(no readable result)'}`);
  for (const x of s.scopes) {
    const e = x.estate;
    lines.push(`  scope ${x.scope_id}: ${x.overall}, ${x.evaluated} evaluated (${e.pass} pass, ${e.fail} fail, ${e.warn} warn, ${e.unverified} unverified, ${e.na} n/a), ${x.not_reviewed} not reviewed, ${x.disabled} disabled`);
  }
  if (s.unreadable > 0) lines.push(`  ${s.unreadable} baseline result file(s) could not be read`);
  return lines;
}

// #4050 (Design 120 section 8.4): organisational controls from the landing zone ingestion folder.

/** Workspace-relative ingestion folder of a landing zone (same path as the CLI run writer). */
export function lzIngestionFolder(lzId: string): string {
  return `landing-zones/${lzId}/ingestion/`;
}

/** Hint of the frameworks step: where organisational documents go (CLI parity: the run reads the same folder). */
export function lzIngestionFolderHint(lzId: string): string {
  return `Organisational controls (layer governance, for example DORA) are decided from the documents in ${lzIngestionFolder(lzId)}: name each file after the expected input (for example ict_risk_management_framework.pdf); without documents they stay not evaluated.`;
}

/** Lines of the organisational summary of a run (none when the run evaluated no organisational controls). */
export function formatLiveOrganisationalSummary(runDir: string): string[] {
  const r = readLzOrganisationalResult(runDir);
  if (!r) return [];
  const lines = [`Organisational controls from ${r.folder}/: ${r.documents.total} document(s), ${r.documents.matched} matched`];
  for (const f of r.frameworks) {
    const c = f.counts;
    lines.push(`  ${f.id}: ${c.satisfied} documented, ${c.partial} partly documented, ${c.unknown} not evaluated, ${c.n_a} n/a${f.out_of_scope > 0 ? `; ${f.out_of_scope} more in application or audit assessments` : ''}`);
  }
  return lines;
}

/**
 * #4256 (Design 126 section 4.6, A-20): the stage name of a running LZ Live
 * assessment, from the newest output line that names a stage; the run screen
 * and its guidance follow it.
 */
export function liveRunStageLabel(lines: readonly string[]): string {
  const stages: ReadonlyArray<readonly [string, string]> = [
    ['diff', 'Comparing with the last run'],
    ['evaluat', 'Evaluating the controls'],
    ['crawl', 'Reading the scopes'],
    ['probe', 'Probing the scopes'],
  ];
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = (lines[i] ?? '').toLowerCase();
    for (const [key, label] of stages) if (l.includes(key)) return label;
  }
  return 'Starting: probe, read, evaluate and compare per scope';
}
