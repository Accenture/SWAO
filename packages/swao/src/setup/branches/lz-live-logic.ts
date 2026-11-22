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

// #4195 SET-06 (Design 125 sections 5.5 and 5.7): pure logic of the Landing
// Zone Live setup steps Probe (20), Policy Baseline (30) and Org Evidence
// (40), kept apart from the Ink components so every rule is unit tested.
//
// - Probe drives `swao lz probe <lz-id>` through the CLI runner of the
//   Landing Zone Connections screen (argv from buildConnectionProbeArgs, never
//   an accept flag: the write-capable confirmation belongs to a run, Design
//   120 section 6.3). Only the scope id, the read-only state and the coverage
//   counts are shown; the identity line of the probe can carry a native cloud
//   id (an ARN or a user name) and is never rendered.
// - Policy Baseline reads the community frameworks probe of the health check
//   (buildCommunityFrameworksProbe, #3869), so the step and `swao health-check`
//   give the same validation result. SWAO never installs or updates a
//   community framework (Design 123 D-07 as changed by #4126): without a
//   baseline the step says where to copy it from on GitHub. The frameworks to
//   evaluate per landing zone are written to landing_zones[].frameworks
//   (section 5.7) through readLandingZones / writeLandingZones, so the Zod
//   schema validates the block and the rest of .swao.yml is kept.
// - Org Evidence names the landing zone ingestion folder of #4050
//   (`landing-zones/<lz-id>/ingestion/`, the folder the run reads,
//   module-landing-zone/src/live/assess.ts:291) and counts its documents.

import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { discoverFrameworks, loadRegimeCatalogue, logPortfolio, maskNativeIds, normalizeDashes } from '@swao/core';
import { buildCommunityFrameworksProbe, formatLzConnectionScopeLines, lzScopeStateWords, LZ_PROBE_AGAIN, LZ_PROBE_STALE_DAYS, type CommunityFrameworksProbeOptions, type LzConnectionScopeResult } from '@swao/module-health-check';
import { lzOrganisationalExpectedInputs, readLandingZones, readLzLastRunFacts, readLzProbeRecords, writeLandingZones } from '@swao/module-landing-zone';
import { buildConnectionProbeArgs, parseConnectionProbe } from '../../tui/screens/lz-connections-flow.js';
import { readLzLiveDefaults, type LzLiveDefaultsEntry } from '../defaults.js';
import type { SetupCheckItem } from '../types.js';

/** Where a client copies the Client LZ Policy Baseline from (Design 123 section 7.1). */
export const COMMUNITY_FRAMEWORKS_URL = 'https://github.com/Accenture/SWAO/tree/main/community-frameworks';
/** The shipped folder name of the Client LZ Policy Baseline (Design 123 section 9). */
export const BASELINE_FOLDER = 'client-lz-policy-baseline';
/** #4340: the exact GitHub folder of the template (checked by framework-url-folders.gate.test.ts). */
export const BASELINE_URL = `${COMMUNITY_FRAMEWORKS_URL}/${BASELINE_FOLDER}`;
/**
 * #4340: the template is in the repository since sprint 157 and reaches the
 * public GitHub repository with the next public release after v1.6.1 (it is
 * listed under Unreleased in CHANGELOG.md); until then the folder URL answers
 * 404. Named in the guidance with the manual page.
 */
export const BASELINE_FIRST_RELEASE = 'the first public release after SWAO v1.6.1';
export const BASELINE_MANUAL_PAGE = 'manual page "Client LZ Policy Baseline" (Frameworks section of the SWAO documentation, docs/frameworks/client-lz-policy-baseline.md)';
/** Workspace-relative community catalogue, the only place SWAO reads frameworks from. */
export const COMMUNITY_CATALOGUE_FOLDER = 'wsp/inputs/catalogs/community/';

/** Absolute workspace root ('.' before Init resolves to the current directory). */
export function wsRoot(workspaceRoot: string): string {
  return resolve(workspaceRoot || '.');
}

/** Registered landing zones (section 5.7 reader; [] when .swao.yml is missing or has none). */
export function registeredLandingZones(workspaceRoot: string): LzLiveDefaultsEntry[] {
  return readLzLiveDefaults(wsRoot(workspaceRoot)).landingZones;
}

// ---------------------------------------------------------------------------
// Probe (order 20)
// ---------------------------------------------------------------------------

export type ProbeReadOnly = 'verified' | 'refused' | 'unverifiable';

/** One probed scope as the step shows it: no identity, no recording path, no endpoint. */
export interface ProbeRow {
  lzId: string;
  scopeId: string;
  readOnly: ProbeReadOnly;
  /** The coverage line of the probe without its label, for example "5 readable". */
  coverage?: string;
}

/** The outcome of probing one landing zone. */
export interface LzProbeOutcome {
  lzId: string;
  rows: ProbeRow[];
  /** Exit code of the CLI call (1 for a refused credential, which is not a failure of the probe). */
  code: number;
  /** True when no scope line came back (a failed call). */
  failed: boolean;
  /**
   * #4496: the reason of a failed call: its first error line without the
   * `[lz live]` tag, native ids masked (maskNativeIds), cut to 160 characters.
   */
  reason?: string;
}

/** Longest reason of a landing zone that was not probed. */
const PROBE_REASON_MAX = 160;

/** #4496: the first error line of a failed probe call, masked and clipped; undefined when there is none. */
export function probeFailureReason(lines: readonly string[]): string | undefined {
  const first = lines.map((l) => l.trim()).find((l) => l !== '' && !l.startsWith('scope ') && !l.startsWith('identity:'));
  if (!first) return undefined;
  const tag = '[lz live]';
  const text = maskNativeIds(first.startsWith(tag) ? first.slice(tag.length).trim() : first);
  return text.length > PROBE_REASON_MAX ? `${text.slice(0, PROBE_REASON_MAX - 3)}...` : text;
}

/** argv of the probe of one landing zone; the same call as Landing Zone Connections, never with an accept flag. */
export function probeArgs(lzId: string): string[] {
  // #4265: the caller tells this probe apart from the Connections step and the health check in the log.
  return [...buildConnectionProbeArgs(lzId), '--caller', 'wizard.lz-live.probe'];
}

/** Turn the CLI output of `lz probe <lz-id>` into rows (identity and every other detail dropped). */
export function toProbeOutcome(lzId: string, code: number, lines: readonly string[]): LzProbeOutcome {
  const rows: ProbeRow[] = parseConnectionProbe(lines.join('\n')).map((p) => {
    const cov = p.detail.find((d) => d.startsWith('coverage:'));
    return { lzId, scopeId: p.scopeId, readOnly: p.readOnly, ...(cov ? { coverage: cov.slice('coverage:'.length).trim() } : {}) };
  });
  const reason = rows.length === 0 ? probeFailureReason(lines) : undefined;
  return { lzId, rows, code, failed: rows.length === 0, ...(reason ? { reason } : {}) };
}

export interface ProbeTotals {
  scopes: number;
  verified: number;
  writeCapable: number;
  unverifiable: number;
  failedLandingZones: number;
}

export function probeTotals(outcomes: readonly LzProbeOutcome[]): ProbeTotals {
  const rows = outcomes.flatMap((o) => o.rows);
  return {
    scopes: rows.length,
    verified: rows.filter((r) => r.readOnly === 'verified').length,
    writeCapable: rows.filter((r) => r.readOnly === 'refused').length,
    unverifiable: rows.filter((r) => r.readOnly === 'unverifiable').length,
    failedLandingZones: outcomes.filter((o) => o.failed).length,
  };
}

/** The Ready summary line of the probe (write-capable logins flagged, Design 125 section 5.5). */
export function probeSummaryLine(t: ProbeTotals): string {
  const parts = [`${t.scopes} scope${t.scopes === 1 ? '' : 's'} probed`, `${t.verified} read-only`];
  if (t.writeCapable > 0) parts.push(`${t.writeCapable} write-capable login${t.writeCapable === 1 ? '' : 's'} flagged`);
  if (t.unverifiable > 0) parts.push(`${t.unverifiable} not verifiable`);
  if (t.failedLandingZones > 0) parts.push(`${t.failedLandingZones} landing zone${t.failedLandingZones === 1 ? '' : 's'} not probed`);
  return parts.join(', ');
}

/** #4233: the TUI words of the health check's probe-again hint (its CLI part stays in the health check). */
const READY_PROBE_AGAIN = 'probe again in the Probe step of this setup';

/**
 * #4233: the Ready level of a stored scope state (only a verified login is ok).
 * #4496: the same level as the Probe step shows: a login that fails or a
 * login that reads nothing is fail there, so it is fail here, not warn.
 */
export function readyStateOf(state: LzConnectionScopeResult['state'], readable?: number): SetupCheckItem['state'] {
  if (state === 'login-failed') return 'fail';
  if (state !== 'not-probed' && readable === 0) return 'fail';
  return state === 'verified' ? 'ok' : 'warn';
}

/**
 * Non-interactive check of the probe step and its Ready rows. #4233
 * criterion 3: one row per registered scope with the same live facts as the
 * health check probe 26 (the stored last probe, `readLzProbeRecords`, and the
 * last run, `readLzLastRunFacts`; no network call), worded by the health
 * check formatter: the state in the Setup Probe step's words, then coverage,
 * probe time with the stale mark and the last run. The Ready step shows the
 * detail on line 2 and wraps it (#4223), never cut with an ellipsis.
 */
export function probeCheck(workspaceRoot: string, now: Date = new Date()): SetupCheckItem[] {
  const root = wsRoot(workspaceRoot);
  const lzs = registeredLandingZones(root);
  // #4297 (Design 125 D-8): Skip in the Landing Zones step leaves the branch needs-attention with this item.
  if (lzs.length === 0) return [{ label: 'Landing zones', state: 'missing', detail: 'no live landing zone registered', short: 'none registered' }];
  return lzs.flatMap((lz): SetupCheckItem[] => {
    if (lz.scopes.length === 0) return [{ label: `Landing zone ${lz.id}`, state: 'warn', detail: `${lz.provider}, no scope registered yet` }];
    const probes = readLzProbeRecords(root, lz.id);
    const runs = readLzLastRunFacts(root, lz.id);
    return lz.scopes.map((scopeId): SetupCheckItem => {
      const rec = probes.get(scopeId);
      const run = runs.get(scopeId);
      const stale = rec ? now.getTime() - Date.parse(rec.probed_at) > LZ_PROBE_STALE_DAYS * 86_400_000 : false;
      const s: LzConnectionScopeResult = {
        lz_id: lz.id,
        scope_id: scopeId,
        provider: lz.provider,
        state: rec ? rec.read_only : 'not-probed',
        ...(rec && rec.read_only !== 'login-failed' ? { readable: rec.readable, unreadable: rec.unreadable } : {}),
        ...(rec ? { probed_at: rec.probed_at } : {}),
        ...(stale ? { stale: true } : {}),
        ...(rec?.reason ? { reason: rec.reason } : {}),
        ...(run ? { last_run: { observed_at: run.observed_at, services: run.services, resources: run.resources } } : {}),
      };
      const [first, second] = formatLzConnectionScopeLines(s);
      const name = `${lz.id}/${scopeId}`;
      const state = (first ?? '').slice(`${name} (${lz.provider}): `.length) || lzScopeStateWords(s);
      // Design 126 section 8 rules 2 and 9: no CLI syntax and no placeholder on the Ready step.
      const facts = (second ? second.slice(`${name}: `.length) : '').split(LZ_PROBE_AGAIN).join(READY_PROBE_AGAIN);
      return { label: `${lz.id} / ${scopeId}`, state: readyStateOf(s.state, s.readable), detail: facts ? `${state}; ${facts}` : state, short: state }; // #4223: the state words on the row line
    });
  });
}

// ---------------------------------------------------------------------------
// Policy Baseline (order 30)
// ---------------------------------------------------------------------------

/** One Client LZ Policy Baseline copy in the workspace, as validated by the health check (#3869). */
export interface BaselineCopy {
  id: string;
  status: 'ok' | 'invalid';
  policies: number;
  enabled: number;
  disabled: number;
  notSet: number;
  catalogueVersion: string | null;
  shippedVersion: string | null;
  stale: boolean;
  /** The health-check warning and error lines that name this framework. */
  messages: string[];
}

export interface BaselineState {
  baselines: BaselineCopy[];
  /** The health check could not run (unreadable catalogue); the message, never a throw. */
  error?: string;
}

/** Client LZ Policy Baselines in wsp/inputs/catalogs/community/, with the #3869 validation. */
export function findPolicyBaselines(workspaceRoot: string, opts: CommunityFrameworksProbeOptions = {}): BaselineState {
  try {
    const r = buildCommunityFrameworksProbe(wsRoot(workspaceRoot), opts);
    const baselines = r.frameworks
      .filter((f) => f.scope === 'community' && f.policy_baseline.status !== 'absent')
      .map((f): BaselineCopy => {
        const pb = f.policy_baseline;
        const prefix = `${f.id}:`;
        return {
          id: f.id,
          status: pb.status === 'invalid' ? 'invalid' : 'ok',
          policies: pb.policies,
          enabled: pb.enabled,
          disabled: pb.disabled,
          notSet: pb.not_set.length,
          catalogueVersion: pb.catalogue_version,
          shippedVersion: pb.shipped_version,
          stale: pb.stale,
          messages: [...r.errors, ...r.warnings].filter((m) => m.startsWith(prefix) && m.includes('policy-baseline.yaml')),
        };
      });
    return { baselines };
  } catch (e) {
    return { baselines: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** One line per baseline for the step and the check. */
export function baselineLine(b: BaselineCopy): string {
  if (b.status === 'invalid') return `${b.id}: policy-baseline.yaml is invalid, fix it before a run`;
  const parts = [`${b.policies} policies`, `${b.enabled} enabled`, `${b.disabled} disabled`];
  if (b.notSet > 0) parts.push(`${b.notSet} not reviewed`);
  const version = b.catalogueVersion ? `, version ${b.catalogueVersion}` : '';
  return `${b.id}: valid${version}, ${parts.join(', ')}`;
}

/** The stale note (Design 123 section 7.4): SWAO never updates the copy. */
export function staleNote(b: BaselineCopy): string | undefined {
  if (!b.stale) return undefined;
  return `${b.id}: version ${b.catalogueVersion ?? '?'} is older than the shipped ${b.shippedVersion ?? '?'}; take the newer version from GitHub by hand if you want it.`;
}

/** Where to get a baseline when none is in the workspace (no copy action: D-07). */
export function missingBaselineLines(): string[] {
  return [
    `No Client LZ Policy Baseline in ${COMMUNITY_CATALOGUE_FOLDER}`,
    `Copy the ${BASELINE_FOLDER} folder from GitHub:`,
    `  ${BASELINE_URL}`,
    `into ${COMMUNITY_CATALOGUE_FOLDER}${BASELINE_FOLDER}/ and set your policies in its policy-baseline.yaml.`,
  ];
}

export function baselineCheck(workspaceRoot: string, opts: CommunityFrameworksProbeOptions = {}): SetupCheckItem[] {
  const s = findPolicyBaselines(workspaceRoot, opts);
  if (s.error) return [{ label: 'Policy baseline', state: 'warn', detail: `community frameworks could not be read: ${s.error}` }];
  if (s.baselines.length === 0) {
    return [{ label: 'Policy baseline', state: 'missing', detail: `none in ${COMMUNITY_CATALOGUE_FOLDER}; copy ${BASELINE_FOLDER} from GitHub (optional)` }];
  }
  return s.baselines.map((b) => ({
    label: `Policy baseline ${b.id}`,
    state: b.status === 'invalid' ? 'missing' : b.stale || b.notSet > 0 ? 'warn' : 'ok',
    detail: baselineLine(b).slice(b.id.length + 2),
  }));
}

/** A framework of the workspace community catalogue the LZ Live Assessment can evaluate. */
export interface WorkspaceFramework {
  id: string;
  /** Folder name under the community catalogue (a stored value may name the folder). */
  folder: string;
  version: string;
  /** #4230: name, authority and description from framework-meta.yaml, for the guidance of the row. */
  name?: string;
  authority?: string;
  description?: string;
}

/** Frameworks in wsp/inputs/catalogs/community/ (the same discovery as the LZ Live Assessment picker). */
export function workspaceFrameworks(workspaceRoot: string): WorkspaceFramework[] {
  return discoverFrameworks(join(wsRoot(workspaceRoot), 'wsp', 'inputs', 'catalogs', 'community'), { includeUnlisted: true, warn: () => {} })
    .map((f) => ({
      id: f.id,
      folder: f.folder,
      // #4501: framework metadata reaches the screen without a spaced double hyphen (normalizeDashes).
      version: normalizeDashes(f.meta.version ?? 'unversioned'),
      ...(f.meta.name ? { name: normalizeDashes(f.meta.name) } : {}),
      ...(f.meta.authority ? { authority: normalizeDashes(f.meta.authority) } : {}),
      ...(f.meta.description ? { description: normalizeDashes(f.meta.description.trim()) } : {}),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Stored landing_zones[].frameworks against the catalogue: `matched` are the
 * catalogue ids of stored values that name a framework by id or folder, case
 * insensitive (the resolution of the LZ Live Assessment picker); `unoffered`
 * are stored values the catalogue does not hold, kept unchanged on save.
 */
export function resolveStoredFrameworks(stored: readonly string[], available: readonly WorkspaceFramework[]): { matched: string[]; unoffered: string[] } {
  const matched: string[] = [];
  const unoffered: string[] = [];
  for (const v of stored) {
    const lower = v.toLowerCase();
    const f = available.find((a) => a.id.toLowerCase() === lower || a.folder.toLowerCase() === lower);
    if (f) { if (!matched.includes(f.id)) matched.push(f.id); } else unoffered.push(v);
  }
  return { matched, unoffered };
}

/**
 * The initial selection for one landing zone: the stored landing_zones[].frameworks
 * that the catalogue offers (Enter keeps the stored value, see frameworksToSave),
 * else the valid baselines of the workspace.
 */
export function initialFrameworkSelection(lz: LzLiveDefaultsEntry, available: readonly WorkspaceFramework[], baselines: readonly BaselineCopy[]): string[] {
  if (lz.frameworks.length > 0) return resolveStoredFrameworks(lz.frameworks, available).matched;
  const ids = new Set(available.map((f) => f.id));
  return baselines.filter((b) => b.status === 'ok' && ids.has(b.id)).map((b) => b.id);
}

/**
 * What Enter writes for one landing zone, or null to write nothing: an
 * unchanged selection with a stored value keeps the stored value byte for
 * byte (Design 125 section 4: Enter keeps the current value); a changed one
 * writes the selection plus the stored values the catalogue does not offer.
 */
export function frameworksToSave(lz: LzLiveDefaultsEntry, available: readonly WorkspaceFramework[], initial: readonly string[], selected: readonly string[]): string[] | null {
  if (lz.frameworks.length > 0 && sameSet(initial, selected)) return null;
  return [...selected, ...resolveStoredFrameworks(lz.frameworks, available).unoffered];
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');
}

export type SaveFrameworksOutcome = 'saved' | 'unchanged';

/**
 * Write landing_zones[<lzId>].frameworks (Design 125 section 5.7). An empty
 * selection drops the key. Validated by the landing_zones schema; only the
 * landing_zones block of .swao.yml is rewritten. Throws LzLiveError on an
 * unknown landing zone or an invalid block.
 */
export function saveLzFrameworks(workspaceRoot: string, lzId: string, frameworks: readonly string[]): SaveFrameworksOutcome {
  const root = wsRoot(workspaceRoot);
  const lzs = readLandingZones(root);
  const lz = lzs.find((l) => l.id === lzId);
  if (!lz) throw new Error(`landing zone ${lzId} is not registered in .swao.yml`);
  const current = lz.frameworks ?? [];
  const next = [...new Set(frameworks)].sort();
  if (sameSet(current, next)) return 'unchanged';
  const updated = lzs.map((l) => {
    if (l.id !== lzId) return l;
    const { frameworks: _drop, ...rest } = l;
    return next.length > 0 ? { ...rest, frameworks: next } : rest;
  });
  writeLandingZones(root, updated);
  return 'saved';
}

// ---------------------------------------------------------------------------
// Org Evidence (order 40)
// ---------------------------------------------------------------------------

/** Workspace-relative ingestion folder of a landing zone (#4050; the folder the run reads). */
export function lzEvidenceFolder(lzId: string): string {
  return `landing-zones/${lzId}/ingestion/`;
}

export interface EvidenceState {
  lzId: string;
  folder: string;
  exists: boolean;
  /** Documents in the folder (files, recursive), without the ingestion manifest and hidden files. */
  documents: number;
}

function countDocuments(dir: string): number {
  let n = 0;
  let entries: import('node:fs').Dirent[];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) n += countDocuments(join(dir, e.name));
    else if (e.isFile() && e.name !== 'ingestion-manifest.json') n++;
  }
  return n;
}

export function evidenceState(workspaceRoot: string, lzId: string): EvidenceState {
  const folder = lzEvidenceFolder(lzId);
  const abs = join(wsRoot(workspaceRoot), 'landing-zones', lzId, 'ingestion');
  const exists = existsSync(abs);
  return { lzId, folder, exists, documents: exists ? countDocuments(abs) : 0 };
}

/** Create the missing ingestion folders; returns the landing zone ids created. */
export function createEvidenceFolders(workspaceRoot: string, lzIds: readonly string[]): string[] {
  const created: string[] = [];
  for (const id of lzIds) {
    const abs = join(wsRoot(workspaceRoot), 'landing-zones', id, 'ingestion');
    if (existsSync(abs)) continue;
    mkdirSync(abs, { recursive: true });
    created.push(id);
  }
  return created;
}

export function evidenceLine(s: EvidenceState): string {
  if (!s.exists) return `${s.folder}: not created`;
  return `${s.folder}: created, ${s.documents} document${s.documents === 1 ? '' : 's'}`;
}

/** One ingestion folder after the Org Evidence step prepared it (#4346). */
export interface EvidenceFolderOutcome extends EvidenceState {
  /** Created now, there already, or not creatable (with the reason). */
  status: 'created' | 'exists' | 'failed';
  reason?: string;
}

/**
 * #4346: create the ingestion folder of every given landing zone that lacks
 * it (idempotent: never deletes or overwrites anything) and log
 * `lz.evidence.folder.created` for each folder created now. Shared by the Org
 * Evidence step and `swao setup --type lz-live --non-interactive`.
 */
export function ensureEvidenceFolders(workspaceRoot: string, lzIds: readonly string[], caller = 'wizard.lz-live.evidence'): EvidenceFolderOutcome[] {
  return lzIds.map((id): EvidenceFolderOutcome => {
    const abs = join(wsRoot(workspaceRoot), 'landing-zones', id, 'ingestion');
    let status: EvidenceFolderOutcome['status'] = 'exists';
    let reason: string | undefined;
    if (!existsSync(abs)) {
      try {
        mkdirSync(abs, { recursive: true });
        status = 'created';
        try { logPortfolio('info', 'lz.evidence.folder.created', `Ingestion folder of landing zone ${id} created`, { context: { lz_id: id, folder: lzEvidenceFolder(id), caller } }); } catch { /* best-effort */ }
      } catch (e) {
        status = 'failed';
        reason = e instanceof Error ? e.message : String(e);
      }
    }
    return { ...evidenceState(workspaceRoot, id), status, ...(reason ? { reason } : {}) };
  });
}

/** #4346: the status row of a prepared ingestion folder: `ok` with "created" or the document count, `fail` with the reason. */
export function evidenceRow(o: EvidenceFolderOutcome): { level: 'ok' | 'fail'; summary: string } {
  if (o.status === 'failed' || !o.exists) return { level: 'fail', summary: `${o.folder} not created: ${o.reason ?? 'unknown reason'}` };
  return { level: 'ok', summary: o.documents > 0 ? `${o.folder} ${o.documents} document${o.documents === 1 ? '' : 's'}` : `${o.folder} created` };
}

/**
 * #4346: the document names the organisational controls of the workspace
 * community frameworks expect (sorted, unique); [] when no framework has one.
 */
export function expectedEvidenceInputs(workspaceRoot: string): string[] {
  const names = new Set<string>();
  const root = join(wsRoot(workspaceRoot), 'wsp', 'inputs', 'catalogs', 'community');
  for (const f of discoverFrameworks(root, { includeUnlisted: true, warn: () => {} })) {
    const file = join(f.dir, 'controls.yaml');
    if (!existsSync(file)) continue;
    try { for (const n of lzOrganisationalExpectedInputs(loadRegimeCatalogue(file).controls)) names.add(n); } catch { /* a catalogue that does not load is reported by the health check */ }
  }
  return [...names].sort();
}

export function evidenceCheck(workspaceRoot: string): SetupCheckItem[] {
  return registeredLandingZones(workspaceRoot).map((lz) => {
    const s = evidenceState(workspaceRoot, lz.id);
    // #4346: the folder and its document count; the not-evaluated note only for an empty folder, as info.
    return {
      label: `Org evidence ${lz.id}`,
      state: s.documents > 0 ? 'ok' : 'info',
      detail: s.documents > 0 ? evidenceLine(s) : `${evidenceLine(s)} (optional; organisational controls stay not evaluated)`,
      short: !s.exists ? 'not created' : `${s.documents} document${s.documents === 1 ? '' : 's'}`,
    };
  });
}
