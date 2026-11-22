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

// #3766: `swao assess --type landing-zone-live --lz <lz-id>` (Design 120
// sections 7.3, 7.4, 8, 13.2, 14.3) and the run writer of section 7.4.
//
//   1. Frameworks: `--frameworks`, else `assessment.frameworks`, else
//      `assessment.regimes_active` of the workspace .swao.yml; only frameworks
//      installed in the workspace community catalogue; at least one. Checked
//      before any request.
//   2. Per scope: read-only probe, gate, crawl (runLzLiveScan). A refused or
//      failing scope is logged (`lz.live.scope.error`) and skipped; the run
//      closes `partial` when at least one scope succeeded and `failed` when
//      none did (056 addendum 2026-10-17, commands/lz-run-lifecycle.ts).
//   3. Evaluate each scan (evaluateLzLiveScan, #3579) and diff it against the
//      scope's scan in the previous run (computeLzLiveDiff).
//   4. Write landing-zones/<lz-id>/wsp/runs/<ts>/: one scan per scope,
//      lz-live-merged.yaml (#3583), lz-live-catalogue.json (#3581),
//      manifest.json, run-status.json, evidence-refs.json (#3956, local only,
//      never published); update latest-lz-live.txt unless the
//      run failed. Raw responses are never written here (section 6.4).
//   5. #4050 (section 8.4): when the host routes the landing zone ingestion
//      folder (`landing-zones/<lz-id>/ingestion/`, Pass 00), the organisational
//      controls (`layer: governance`) of the selected frameworks are decided
//      from those documents and written as lz-organisational.json; document
//      paths only enter the local evidence map.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dump as yamlDump, load as yamlLoad } from 'js-yaml';
import { LzLiveScanSchema, buildProvenance, logPortfolio, loadRegimeCatalogue, lzEvidencePublicIndex, LZ_BASELINE_RESULT_SUFFIX, LZ_EVIDENCE_MAP_FILE, LZ_ORGANISATIONAL_RESULT_FILE } from '@swao/core';
import { writeLzEvidenceMap } from './evidence.js';
import type { LzBaselineResult, LzLiveScan, LzRegion, LzServiceCatalogue } from '@swao/core';
import { evaluateLzBaseline, readBaselineControls } from '../evaluate/lz-baseline-eval.js';
import { readLandingZones, LzLiveError } from './session.js';
import type { ReadOnlyFlags, ScopeCtxOptions } from './session.js';
import { runLzLiveScan, DEFAULT_ACTIVITY_DAYS } from './scan.js';
import { describeSimulation } from './simulation.js';
import { mergeLzLiveScopes, LZ_LIVE_MERGED_FILE } from './merge.js';
import { buildLzLiveCatalogue, LZ_LIVE_CATALOGUE_FILE } from './live-catalogue.js';
import { evaluateLzLiveScan } from '../evaluate/lz-live-eval.js';
import type { LzLiveCheckDefinition, LzLiveScopeFinding } from '../evaluate/lz-live-eval.js';
import { computeLzLiveDiff } from '../evaluate/lz-live-diff.js';
import { resolveLzLiveFrameworkIds, selectLzLiveFrameworks } from '../evaluate/lz-live-frameworks.js';
import type { LzLiveManifestFramework } from '../evaluate/lz-live-frameworks.js';
import { resolveProviderCatalogue } from '../catalogue/loader.js';
import { evaluateLzOrganisationalControls, lzOrganisationalControls, toLzOrganisationalResult } from '../evaluate/lz-organisational-eval.js';
import type { LzOrganisationalDocument, LzOrganisationalEvaluation, LzOrganisationalFrameworkInput } from '../evaluate/lz-organisational-eval.js';
import type { LzLiveEvalFramework } from '../evaluate/lz-live-eval.js';
import { LZ_SOVEREIGNTY_PINS } from '../catalogue/sovereignty-pins.js';

export const LZ_LIVE_MANIFEST_FILE = 'manifest.json';
export const LZ_LIVE_RUN_STATUS_FILE = 'run-status.json';
export const LZ_LIVE_LATEST_FILE = 'latest-lz-live.txt';

export interface LzLiveAssessOptions extends ScopeCtxOptions, ReadOnlyFlags {
  workspaceRoot: string;
  lzId: string;
  /** Scopes to run; all registered scopes when empty or absent. */
  scopeIds?: readonly string[];
  /** `--frameworks` value (comma-separated). */
  frameworks?: string;
  /** Baseline checks of `controls/landing-zone-checks-catalogue.yaml`, injected by the host. */
  checks: readonly LzLiveCheckDefinition[];
  activityDays?: number;
  staleDays?: number;
  swaoVersion?: string;
  now?: () => Date;
  /** Progress lines (TUI and CLI). */
  progress?: (line: string) => void;
  /**
   * #4050: routes `landing-zones/<lz-id>/ingestion/` through Pass 00 (injected by
   * the host, which owns module-app-assessment) and returns its documents; null
   * when the folder is absent or empty. Without it no organisational controls
   * are evaluated (for example `swao lz scan`).
   */
  ingestOrganisationalDocuments?: (lzDir: string) => Promise<readonly LzOrganisationalDocument[] | null>;
}

export type LzLiveScopeRunStatus = 'complete' | 'refused' | 'failed';

export interface LzLiveScopeRun {
  scope_id: string;
  status: LzLiveScopeRunStatus;
  message?: string;
}

export interface LzLiveAssessOutcome {
  runDir: string;
  runId: string;
  status: 'complete' | 'partial' | 'failed';
  scopes: LzLiveScopeRun[];
  scopeFindings: Record<string, LzLiveScopeFinding[]>;
  exitCode: 0 | 1;
}

/** Run folder name from a timestamp: `2026-11-03T08-00-00` (ISO, colons to dashes, no fraction). */
export function lzLiveRunId(d: Date): string {
  return d.toISOString().replace(/\.\d+Z$/, '').replace(/:/g, '-');
}

export function lzLiveWspDir(workspaceRoot: string, lzId: string): string {
  return join(workspaceRoot, 'landing-zones', lzId, 'wsp');
}

function readWorkspaceAssessment(workspaceRoot: string): { frameworks?: string[]; regimes_active?: string[] } | undefined {
  try {
    const doc = (yamlLoad(readFileSync(join(workspaceRoot, '.swao.yml'), 'utf-8')) ?? {}) as Record<string, unknown>;
    const a = doc['assessment'];
    if (!a || typeof a !== 'object') return undefined;
    const pick = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined);
    const rec = a as Record<string, unknown>;
    return { frameworks: pick(rec['frameworks']), regimes_active: pick(rec['regimes_active']) };
  } catch {
    return undefined;
  }
}

/** Workspace `.swao.yml` framework_context (the applies_when keys of #3425), stringified scalars. */
function readWorkspaceFrameworkContext(workspaceRoot: string): Record<string, string> | undefined {
  try {
    const doc = (yamlLoad(readFileSync(join(workspaceRoot, '.swao.yml'), 'utf-8')) ?? {}) as Record<string, unknown>;
    const fc = doc['framework_context'];
    if (!fc || typeof fc !== 'object' || Array.isArray(fc)) return undefined;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(fc as Record<string, unknown>)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = String(v);
    }
    return out;
  } catch {
    return undefined;
  }
}

/** #4050: the controls of each selected framework (controls.yaml through the core schema); unreadable catalogues are reported and skipped. */
function organisationalFrameworks(frameworks: readonly LzLiveEvalFramework[], progress: (line: string) => void): LzOrganisationalFrameworkInput[] {
  const out: LzOrganisationalFrameworkInput[] = [];
  for (const fw of frameworks) {
    if (!fw.dir) continue;
    const file = join(fw.dir, 'controls.yaml');
    if (!existsSync(file)) continue;
    try {
      out.push({ id: fw.id, version: fw.version, controls: loadRegimeCatalogue(file).controls });
    } catch (err) {
      progress(`organisational controls: ${fw.id} controls.yaml does not load (${(err instanceof Error ? err.message : String(err)).slice(0, 120)}); skipped`);
    }
  }
  return out;
}

/** Scans of the previous run (latest-lz-live.txt), by scope id. */
function previousScans(wspDir: string, lzId: string): { runId?: string; scans: Map<string, LzLiveScan> } {
  const scans = new Map<string, LzLiveScan>();
  const ptr = join(wspDir, LZ_LIVE_LATEST_FILE);
  if (!existsSync(ptr)) return { scans };
  const runId = readFileSync(ptr, 'utf-8').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/.test(runId)) return { scans };
  const dir = join(wspDir, 'runs', runId);
  if (!existsSync(dir)) return { scans };
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(`${lzId}.`) || !name.endsWith('.lz-live-scan.json')) continue;
    try {
      const r = LzLiveScanSchema.safeParse(JSON.parse(readFileSync(join(dir, name), 'utf-8')));
      if (r.success) scans.set(r.data.meta.scope_id, r.data);
    } catch { /* unreadable: no previous scan for that scope */ }
  }
  return { runId, scans };
}

/**
 * Run a Landing Zone Live Assessment and write its run folder. Throws
 * LzLiveError (exit 1) for input errors found before any request: unknown
 * landing zone or scope, no framework, framework not installed.
 */
export async function runLzLiveAssessment(opts: LzLiveAssessOptions): Promise<LzLiveAssessOutcome> {
  const progress = opts.progress ?? (() => undefined);
  const lz = readLandingZones(opts.workspaceRoot).find((l) => l.id === opts.lzId);
  if (!lz) throw new LzLiveError(`landing zone ${opts.lzId} is not registered in .swao.yml; run swao lz connect first`);
  const wanted = opts.scopeIds && opts.scopeIds.length > 0 ? [...opts.scopeIds] : lz.scopes.map((s) => s.id);
  const unknownScopes = wanted.filter((id) => !lz.scopes.some((s) => s.id === id));
  if (unknownScopes.length > 0) throw new LzLiveError(`landing zone ${lz.id} has no scope ${unknownScopes.join(', ')}`);

  const ids = resolveLzLiveFrameworkIds(opts.frameworks, readWorkspaceAssessment(opts.workspaceRoot));
  if (ids.length === 0) throw new LzLiveError('select at least one community framework (--frameworks <id,...>, or assessment.frameworks in .swao.yml)');
  const selection = selectLzLiveFrameworks(ids, join(opts.workspaceRoot, 'wsp', 'inputs', 'catalogs'));
  if (selection.not_installed.length > 0) {
    throw new LzLiveError(`framework(s) not installed in the workspace community catalogue: ${selection.not_installed.join(', ')} (SWAO never fetches frameworks during a live assessment)`);
  }
  // #3871 (Design 123 sections 8 and 9.1): at most one client policy baseline per run
  // (meta.baseline names one), and only a valid one; both refused before any request.
  if (selection.invalid_baselines.length > 0) {
    throw new LzLiveError(`policy-baseline.yaml is invalid in ${selection.invalid_baselines.map((b) => `${b.id} (${b.errors.join('; ')})`).join(', ')}; run swao health-check`);
  }
  if (selection.baselines.length > 1) {
    throw new LzLiveError(`select one client policy baseline per run, not ${selection.baselines.map((b) => b.id).join(', ')}`);
  }
  const selectedBaseline = selection.baselines[0];
  const baselineControls = selectedBaseline ? readBaselineControls(selectedBaseline.dir) : new Map();
  const sovereigntyDecls = selection.frameworks.map((f) => ({ id: f.id, sovereignty_requirements: f.sovereignty_requirements }));

  let staticCatalogue: LzServiceCatalogue | null = null;
  try { staticCatalogue = resolveProviderCatalogue(lz.provider, opts.workspaceRoot).catalogue; } catch { staticCatalogue = null; }
  const regionFacts = new Map<string, LzRegion>((staticCatalogue?.regions ?? []).map((r) => [r.id, r] as const));

  const startedAt = (opts.now ?? (() => new Date()))();
  const runId = lzLiveRunId(startedAt);
  const wspDir = lzLiveWspDir(opts.workspaceRoot, lz.id);
  const runDir = join(wspDir, 'runs', runId);
  if (existsSync(runDir)) throw new LzLiveError(`run folder ${runDir} exists already; wait a second and retry`);
  const previous = previousScans(wspDir, lz.id);

  // #4411 (Design 120 section 6.4): the run is visible in the workspace log, not only on stdout.
  // Landing zone and scope ids only; no account, project or resource id.
  const runStartedMs = Date.now();
  logPortfolio('info', 'lz.live.run.start', `Landing Zone Live run ${runId} started: ${lz.id}`, {
    // #4430: the build that ran it (LZ Live runs have no swao.run.start).
    context: { lz_id: lz.id, provider: lz.provider, run_id: runId, scopes: wanted, frameworks: selection.frameworks.map((f) => f.id), ...(selectedBaseline ? { baseline: selectedBaseline.id } : {}), ...buildProvenance() },
  });

  // #4411: every lz.live.run.start is closed by lz.live.run.complete, also when the run throws
  // after the start (run folder, evidence map); the body below is not re-indented.
  let runCompleteLogged = false;
  try {
  const scopes: LzLiveScopeRun[] = [];
  const scans: LzLiveScan[] = [];
  const scopeFindings: Record<string, LzLiveScopeFinding[]> = {};
  const baselineResults: LzBaselineResult[] = [];
  const manifestScopes: Record<string, unknown>[] = [];
  for (const scopeId of wanted) {
    progress(`scope ${scopeId}: probe and crawl`);
    const scopeStartedMs = Date.now();
    try {
      const out = await runLzLiveScan({ ...opts, workspaceRoot: opts.workspaceRoot, lzId: lz.id, scopeId, activityDays: opts.activityDays ?? DEFAULT_ACTIVITY_DAYS });
      const r = out.results[0];
      if (!r) throw new LzLiveError(`scope ${scopeId} returned no result`);
      manifestScopes.push({
        scope_id: scopeId,
        kind: lz.scopes.find((s) => s.id === scopeId)?.kind,
        ...r.gate.manifest,
        coverage: r.probe.coverage,
        endpoint_overrides: r.endpointOverrides,
        recorded: r.recordingDir !== null,
        // #3596: Design 121 section 10, item 2 (refused scopes too).
        ...(r.simulated ? { simulated: r.simulated } : {}),
        // #4059 (Design 120 section 6.3): the log archive scope's gate, when this scope read through it.
        ...(r.logArchive ? { log_archive: r.logArchive } : {}),
      });
      if (r.simulated) progress(`scope ${scopeId}: ${describeSimulation(r.simulated)}`);
      if (!r.scan) {
        scopes.push({ scope_id: scopeId, status: 'refused', message: r.gate.message });
        logPortfolio('warn', 'lz.live.scope.error', `Live scope ${scopeId} refused by the read-only gate`, { context: { lz: lz.id, scope: scopeId, reason: 'read-only gate' } });
        progress(`scope ${scopeId}: refused (${r.gate.message})`);
        continue;
      }
      // #4411: the scope's probe and crawl are complete; evaluate follows (its own line).
      logPortfolio('info', 'lz.live.scope.complete', `Landing Zone Live scope complete: ${lz.id}/${scopeId}`, {
        context: { lz_id: lz.id, scope_id: scopeId, run_id: runId, services: r.scan.offering.services.length, resources: r.scan.estate.resources.length, duration_ms: Date.now() - scopeStartedMs },
      });
      progress(`scope ${scopeId}: evaluate`);
      let toEvaluate = r.scan;
      let checkDefs = opts.checks;
      if (selectedBaseline) {
        const b = evaluateLzBaseline(r.scan, {
          framework: selectedBaseline.id, baseline: selectedBaseline.baseline, sha256: selectedBaseline.sha256,
          controls: baselineControls, regions: regionFacts, sovereigntyDecls,
        });
        const ids = new Set(b.checks.map((c) => c.id));
        toEvaluate = {
          ...r.scan,
          meta: { ...r.scan.meta, baseline: { framework: selectedBaseline.id, catalogue_version: selectedBaseline.baseline.catalogue_version, sha256: selectedBaseline.sha256 } },
          estate: { ...r.scan.estate, checks: [...r.scan.estate.checks.filter((c) => !ids.has(c.id)), ...b.checks] },
        };
        checkDefs = [...opts.checks, ...b.definitions];
        baselineResults.push(b.result);
        progress(`scope ${scopeId}: baseline ${selectedBaseline.id} ${b.result.overall} (${b.result.policies.length} policies evaluated, ${b.result.not_reviewed.length} not reviewed)`);
      }
      const evaluated = evaluateLzLiveScan(toEvaluate, { frameworks: selection.frameworks, regions: regionFacts, checks: checkDefs });
      const scopeBaseline = selectedBaseline ? baselineResults.find((b) => b.scope_id === scopeId) : undefined;
      logPortfolio('info', 'lz.live.evaluate.complete', `Landing Zone Live evaluate: ${lz.id}/${scopeId}, ${evaluated.scope_findings.length} finding(s)`, {
        context: { lz_id: lz.id, scope_id: scopeId, run_id: runId, frameworks: selection.frameworks.map((f) => f.id), findings: evaluated.scope_findings.length, ...(scopeBaseline && selectedBaseline ? { baseline: { framework: selectedBaseline.id, overall: scopeBaseline.overall, policies: scopeBaseline.policies.length, not_reviewed: scopeBaseline.not_reviewed.length } } : {}) },
      });
      const prev = previous.scans.get(scopeId);
      const scan = { ...evaluated.scan, diff: computeLzLiveDiff(evaluated.scan, prev, prev ? previous.runId : undefined) };
      scans.push(scan);
      scopeFindings[scopeId] = evaluated.scope_findings;
      scopes.push({ scope_id: scopeId, status: 'complete' });
      progress(`scope ${scopeId}: complete (${scan.offering.services.length} services, ${scan.estate.resources.length} resources)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      scopes.push({ scope_id: scopeId, status: 'failed', message });
      logPortfolio('warn', 'lz.live.scope.error', `Live scope ${scopeId} failed`, { context: { lz: lz.id, scope: scopeId, error: message.slice(0, 300) } });
      progress(`scope ${scopeId}: failed (${message})`);
    }
  }

  // #4050 (Design 120 section 8.4): organisational controls from the landing zone ingestion folder.
  let organisational: LzOrganisationalEvaluation | null = null;
  let organisationalDocuments: readonly LzOrganisationalDocument[] = [];
  if (opts.ingestOrganisationalDocuments) {
    const fwInputs = organisationalFrameworks(selection.frameworks, progress).filter((f) => lzOrganisationalControls(f.controls).length > 0);
    if (fwInputs.length > 0) {
      const folder = `landing-zones/${lz.id}/ingestion`;
      try {
        organisationalDocuments = (await opts.ingestOrganisationalDocuments(join(opts.workspaceRoot, 'landing-zones', lz.id))) ?? [];
        const frameworkContext = readWorkspaceFrameworkContext(opts.workspaceRoot);
        organisational = evaluateLzOrganisationalControls({ frameworks: fwInputs, documents: organisationalDocuments, folder, ...(frameworkContext ? { frameworkContext } : {}) });
        for (const f of organisational.frameworks) {
          const n = (o: string): number => f.controls.filter((c) => c.outcome === o).length;
          progress(`organisational controls ${f.id}: ${n('SATISFIED')} satisfied, ${n('PARTIAL')} partial, ${n('UNKNOWN')} unknown, ${n('N_A')} n/a (${organisational.documents.total} document(s) in ${folder}/, ${organisational.documents.matched} matched)${f.out_of_scope > 0 ? `; ${f.out_of_scope} more scoped to application or audit assessments` : ''}`);
        }
      } catch (err) {
        progress(`organisational controls: ${folder}/ not read (${(err instanceof Error ? err.message : String(err)).slice(0, 200)})`);
        organisational = null;
        organisationalDocuments = [];
      }
    }
  }

  const status: LzLiveAssessOutcome['status'] = scans.length === 0 ? 'failed' : scans.length === wanted.length ? 'complete' : 'partial';
  mkdirSync(runDir, { recursive: true });
  for (const scan of scans) writeFileSync(join(runDir, `${lz.id}.${scan.meta.scope_id}.lz-live-scan.json`), JSON.stringify(scan, null, 2) + '\n');
  // #3871: one lz-baseline-result/1 per evaluated scope (offering verdicts live only here).
  const baselineFiles: string[] = [];
  for (const b of baselineResults) {
    if (!scans.some((sc) => sc.meta.scope_id === b.scope_id)) continue;
    const name = `${lz.id}.${b.scope_id}${LZ_BASELINE_RESULT_SUFFIX}`;
    writeFileSync(join(runDir, name), JSON.stringify(b, null, 2) + '\n');
    baselineFiles.push(name);
  }
  let documentRef: (source: string) => string | undefined = () => undefined;
  if (scans.length > 0) {
    // Scopes not run now join from the previous run while inside the window (section 11.1).
    const carried = [...previous.scans.values()].filter((s) => !scans.some((c) => c.meta.scope_id === s.meta.scope_id));
    const merged = mergeLzLiveScopes({ lzId: lz.id, provider: lz.provider, scans: [...scans, ...carried], registeredScopes: lz.scopes, ...(opts.staleDays !== undefined ? { windowDays: opts.staleDays } : {}), now: startedAt });
    writeFileSync(join(runDir, LZ_LIVE_MERGED_FILE), yamlDump(merged, { noRefs: true, lineWidth: 120 }));
    const catalogue = buildLzLiveCatalogue({ scans, staticCatalogue, pins: LZ_SOVEREIGNTY_PINS[lz.provider] });
    writeFileSync(join(runDir, LZ_LIVE_CATALOGUE_FILE), JSON.stringify(catalogue, null, 2) + '\n');
    // #3956 (Design 123 section 9.5): the local evidence map of this run (native ids and console
    // links, never published); carried scopes are included so every merged node gets a reference.
    const ev = await writeLzEvidenceMap({ runDir, runId, lzId: lz.id, provider: lz.provider, scans: [...scans, ...carried], store: opts.store, baselineResults, documents: organisationalDocuments });
    if (ev.ok) {
      const index = lzEvidencePublicIndex(ev.map);
      documentRef = (source) => index.document(source);
    }
    progress(ev.ok ? `run ${runId}: ${ev.entries} evidence reference(s) in ${LZ_EVIDENCE_MAP_FILE}` : `run ${runId}: evidence map not written (${ev.reason})`);
  }
  // #4050: the organisational result carries input names and references, never a document path.
  let organisationalFile: Record<string, unknown> | undefined;
  if (organisational) {
    const result = toLzOrganisationalResult(organisational, { lzId: lz.id, runId, generatedAt: startedAt.toISOString(), refOf: documentRef });
    writeFileSync(join(runDir, LZ_ORGANISATIONAL_RESULT_FILE), JSON.stringify(result, null, 2) + '\n');
    organisationalFile = {
      file: LZ_ORGANISATIONAL_RESULT_FILE,
      folder: result.folder,
      documents: result.documents,
      frameworks: result.frameworks.map((f) => ({ id: f.id, ...f.counts, out_of_scope: f.out_of_scope })),
    };
  }
  const finishedAt = (opts.now ?? (() => new Date()))();
  const frameworks: LzLiveManifestFramework[] = selection.manifest;
  writeFileSync(join(runDir, LZ_LIVE_MANIFEST_FILE), JSON.stringify({
    schema: 'lz-live-run-manifest/1',
    lz_id: lz.id,
    provider: lz.provider,
    run_id: runId,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    ...(opts.swaoVersion ? { swao_version: opts.swaoVersion } : {}),
    // #4430: the build that ran the scan (build_commit, build_date; additive).
    ...buildProvenance(),
    ...(previous.runId ? { previous_run: previous.runId } : {}),
    frameworks,
    invalid_framework_mappings: selection.invalid_mappings,
    // #3871 (Design 123 section 7.4): which baseline settings this run measured against.
    ...(selectedBaseline ? { baseline: {
      framework: selectedBaseline.id,
      baseline_of: selectedBaseline.baseline.baseline_of,
      catalogue_version: selectedBaseline.baseline.catalogue_version,
      sha256: selectedBaseline.sha256,
      results: baselineFiles,
    } } : {}),
    ...(organisationalFile ? { organisational: organisationalFile } : {}),
    // #3596: true when any scope of this run was served by a mock CSP.
    simulated: manifestScopes.some((m) => m['simulated'] !== undefined),
    scopes: manifestScopes,
  }, null, 2) + '\n');
  writeFileSync(join(runDir, LZ_LIVE_RUN_STATUS_FILE), JSON.stringify({ status, scopes }, null, 2) + '\n');
  if (status !== 'failed') writeFileSync(join(wspDir, LZ_LIVE_LATEST_FILE), `${runId}\n`);
  progress(`run ${runId}: ${status}`);
  logPortfolio(status === 'complete' ? 'info' : 'warn', 'lz.live.run.complete', `Landing Zone Live run ${runId} ${status}: ${lz.id}`, {
    context: { lz_id: lz.id, run_id: runId, status, scopes: scopes.map((s) => ({ scope_id: s.scope_id, status: s.status })), duration_ms: Date.now() - runStartedMs },
  });
  runCompleteLogged = true;
  return { runDir, runId, status, scopes, scopeFindings, exitCode: status === 'complete' ? 0 : 1 };
  } catch (err) {
    if (!runCompleteLogged) {
      logPortfolio('warn', 'lz.live.run.complete', `Landing Zone Live run ${runId} failed: ${lz.id}`, {
        context: { lz_id: lz.id, run_id: runId, status: 'failed', error: (err instanceof Error ? err.message : String(err)).slice(0, 300), duration_ms: Date.now() - runStartedMs },
      });
    }
    throw err;
  }
}
