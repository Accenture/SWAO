// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module -- baseline consultation impact (#4128)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4128 BC-03 (Design 123 section 17.3.1): the live impact of candidate
// baseline values, for the MCP tool swao_baseline_impact. The hidden command
// `swao lz baseline-impact <lz-id> --framework <id> --changes <json> [--run <ts>] --json`
// re-evaluates the stored scans of one run twice with evaluateLzBaseline: once
// with the current policy-baseline.yaml and once with the candidate applied in
// memory. Both use the catalogue region facts and the sovereignty declarations
// of the run's frameworks, as the run did (live/assess.ts); for the candidate
// the baseline's own declaration is rebuilt from the candidate's residency
// policies, so a residency change reaches the D-11 union. No network call, no
// tenant read, nothing written. The output carries ids, statuses and counts
// only, never `detail` text or a native id.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { load as yamlLoad } from 'js-yaml';
import { z } from 'zod';
import {
  PolicyBaselineChangeSchema,
  applyPolicyBaselineChanges,
  discoverFrameworks,
  findFramework,
  loadPolicyBaseline,
  policyBaselineSovereigntyRequirements,
  validatePolicyBaselineChanges,
  POLICY_BASELINE_FILE,
  type LzBaselineOfferingVerdict,
  type LzLiveCheckStatus,
  type LzLiveObservability,
  type LzLiveScan,
  type LzRegion,
  type PolicyBaseline,
  type PolicyBaselineChange,
} from '@swao/core';
import { evaluateLzBaseline, readBaselineControls } from '../evaluate/lz-baseline-eval.js';
import { readFrameworkSovereigntyDecls } from '../fit/run-lz.js';
import type { FrameworkSovereigntyDecl } from '../fit/orchestrate-lz.js';
import { resolveProviderCatalogue } from '../catalogue/loader.js';
import { LZ_LIVE_LATEST_FILE } from './assess.js';
import { LzDiffError, scansOf } from './run-diff.js';

export const LZ_BASELINE_IMPACT_SCHEMA = 'lz-baseline-impact/1';

const LZ_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RUN_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/;
const STATUSES = ['pass', 'fail', 'warn', 'unverified', 'na'] as const satisfies readonly LzLiveCheckStatus[];

type Counts = Record<LzLiveCheckStatus, number>;
const zeroCounts = (): Counts => ({ pass: 0, fail: 0, warn: 0, unverified: 0, na: 0 });

export interface LzBaselineImpactScope {
  scope_id: string;
  /** Estate counts over the evaluated policies of the scope, current file. */
  current: Counts;
  /** Estate counts with the candidate applied. */
  candidate: Counts;
  overall_current: LzBaselineOfferingVerdict;
  overall_candidate: LzBaselineOfferingVerdict;
}

export interface LzBaselineImpactPolicy {
  policy_id: string;
  state_current: string;
  state_candidate: string;
  /** Estate counts of this policy over the scopes (a disabled or not_set policy counts nowhere). */
  current: Counts;
  candidate: Counts;
  /** Scopes whose estate status of this policy changes. */
  changed_scopes: Array<{ scope_id: string; from: LzLiveCheckStatus | 'not_evaluated'; to: LzLiveCheckStatus | 'not_evaluated' }>;
  /** Offering verdict per scope now and with the candidate. */
  offering: Array<{ scope_id: string; current: LzBaselineOfferingVerdict | 'not_evaluated'; candidate: LzBaselineOfferingVerdict | 'not_evaluated' }>;
  notes: string[];
}

export interface LzBaselineImpactResult {
  schema: typeof LZ_BASELINE_IMPACT_SCHEMA;
  lz_id: string;
  run_id: string;
  provider: string;
  framework: string;
  /** Always the re-evaluation label of section 17.3.1. */
  label: string;
  /** The baseline the run measured, when it differs from the current file (framework id or sha256). */
  run_baseline: { framework: string; sha256_12: string; same: boolean } | null;
  scopes: LzBaselineImpactScope[];
  policies: LzBaselineImpactPolicy[];
  notes: string[];
}

export interface LzBaselineImpactOptions {
  workspaceRoot: string;
  lzId: string;
  /** framework.id or folder of the baseline in wsp/inputs/catalogs/community/. */
  framework: string;
  changes: readonly PolicyBaselineChange[];
  /** Run folder name or ISO time; default latest-lz-live.txt, else the newest run with scans. */
  run?: string;
}

/** The `--changes` value: a JSON array of typed changes (Design 123 section 17.3, tools 3 and 4). */
export function parseBaselineImpactChanges(json: string): PolicyBaselineChange[] {
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { throw new LzDiffError('[lz live] --changes must be a JSON array of changes'); }
  const r = z.array(PolicyBaselineChangeSchema).max(25).safeParse(raw);
  if (!r.success) throw new LzDiffError(`[lz live] --changes: ${r.error.issues[0]?.path.join('.') ?? ''} ${r.error.issues[0]?.message ?? 'invalid'}`.trim());
  return r.data;
}

function resolveRun(workspaceRoot: string, lzId: string, run: string | undefined): { runId: string; runDir: string } {
  if (!LZ_ID_RE.test(lzId)) throw new LzDiffError(`[lz live] landing zone id '${lzId}' must be kebab-case`);
  const wsp = join(workspaceRoot, 'landing-zones', lzId, 'wsp');
  const runsDir = join(wsp, 'runs');
  const runs = existsSync(runsDir) ? readdirSync(runsDir).filter((r) => RUN_SEGMENT_RE.test(r) && scansOf(join(runsDir, r), lzId).size > 0).sort() : [];
  if (runs.length === 0) throw new LzDiffError(`[lz live] no live run of landing zone ${lzId}; run swao assess --type landing-zone-live --lz ${lzId} first`);
  let runId: string;
  if (run) {
    const name = run.replace(/:/g, '-').replace(/\.\d{1,9}Z?$|Z$/, '');
    if (!runs.includes(name)) throw new LzDiffError(`[lz live] --run ${run}: no run with live scans of ${lzId}`);
    runId = name;
  } else {
    const ptr = join(wsp, LZ_LIVE_LATEST_FILE);
    const pointed = existsSync(ptr) ? readFileSync(ptr, 'utf-8').trim() : '';
    runId = runs.includes(pointed) ? pointed : (runs[runs.length - 1] as string);
  }
  return { runId, runDir: join(runsDir, runId) };
}

type Decl = FrameworkSovereigntyDecl['sovereignty_requirements'];
const DECL_KEYS = ['require_residency_country', 'require_operator_jurisdiction', 'forbid_exposure', 'require_certifications'] as const;

/** The framework-meta.yaml block of a framework folder (without the policy residency). */
function metaDecl(dir: string): Decl {
  try {
    const raw = yamlLoad(readFileSync(join(dir, 'framework-meta.yaml'), 'utf-8')) as { framework?: { sovereignty_requirements?: Record<string, unknown> } } | null;
    const block = raw?.framework?.sovereignty_requirements;
    if (!block || typeof block !== 'object') return undefined;
    const out: NonNullable<Decl> = {};
    for (const k of DECL_KEYS) {
      const v = block[k];
      if (Array.isArray(v) && v.every((x) => typeof x === 'string')) out[k] = v as string[];
    }
    return Object.keys(out).length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

/** The baseline's own declaration: framework-meta block joined with the enabled residency policies (run-lz.ts withBaselineResidency). */
function baselineDecl(meta: Decl, doc: PolicyBaseline): Decl {
  const fromPolicies = policyBaselineSovereigntyRequirements(doc);
  if (!fromPolicies) return meta;
  const out: NonNullable<Decl> = { ...(meta ?? {}) };
  for (const k of DECL_KEYS) {
    const set = new Set([...(meta?.[k] ?? []), ...(fromPolicies[k] ?? [])]);
    if (set.size > 0) out[k] = [...set];
  }
  return out;
}

const RESIDENCY_KEY: Readonly<Record<string, (typeof DECL_KEYS)[number]>> = {
  allowed_countries: 'require_residency_country',
  allowed_operator_jurisdictions: 'require_operator_jurisdiction',
  forbid_exposure: 'forbid_exposure',
  required_certifications: 'require_certifications',
};

/**
 * Re-evaluate the stored scans of one run with the current and the candidate
 * baseline (Design 123 section 17.3.1). Throws LzDiffError for input errors.
 */
export function runLzBaselineImpact(o: LzBaselineImpactOptions): LzBaselineImpactResult {
  const { runId, runDir } = resolveRun(o.workspaceRoot, o.lzId, o.run);
  const scans: LzLiveScan[] = [...scansOf(runDir, o.lzId).values()];
  const catalogsDir = join(o.workspaceRoot, 'wsp', 'inputs', 'catalogs');
  const installed = discoverFrameworks(join(catalogsDir, 'community'), { includeUnlisted: true, warn: () => {} });
  const fw = findFramework(installed, o.framework);
  if (!fw) throw new LzDiffError(`[lz live] framework ${o.framework} is not installed in the workspace community catalogue`);
  const loaded = loadPolicyBaseline(fw.dir, fw.id);
  if (loaded.status === 'absent') throw new LzDiffError(`[lz live] framework ${fw.id} is not a policy baseline (no ${POLICY_BASELINE_FILE})`);
  if (loaded.status === 'invalid') throw new LzDiffError(`[lz live] ${POLICY_BASELINE_FILE} of ${fw.id} is invalid; run swao health-check`);
  const current = loaded.baseline;
  const errors = validatePolicyBaselineChanges(current, o.changes);
  if (errors.length > 0) throw new LzDiffError(`[lz live] ${errors.join('; ')}`);
  const candidate = applyPolicyBaselineChanges(current, o.changes);
  const sha256 = createHash('sha256').update(readFileSync(join(fw.dir, POLICY_BASELINE_FILE))).digest('hex');

  // The run's frameworks (meta.frameworks of its scans), the baseline included.
  const runIds = [...new Set(scans.flatMap((s) => s.meta.frameworks.map((f) => f.id)))];
  const ids = runIds.some((id) => id.toUpperCase() === fw.id.toUpperCase()) ? runIds : [...runIds, fw.id];
  const others = readFrameworkSovereigntyDecls(ids.filter((id) => id.toUpperCase() !== fw.id.toUpperCase()), catalogsDir);
  const meta = metaDecl(fw.dir);
  const declsOf = (doc: PolicyBaseline): FrameworkSovereigntyDecl[] => [...others, { id: fw.id, sovereignty_requirements: baselineDecl(meta, doc) }];

  const controls = readBaselineControls(fw.dir);
  const provider = scans[0]?.meta.provider ?? 'unknown';
  let regions = new Map<string, LzRegion>();
  try { regions = new Map(resolveProviderCatalogue(provider, o.workspaceRoot).catalogue.regions.map((r) => [r.id, r] as const)); } catch { /* no catalogue: offering facts unknown, as in the run */ }

  const changedIds = o.changes.map((c) => c.policy_id);
  const policies: LzBaselineImpactPolicy[] = changedIds.map((id) => ({
    policy_id: id,
    state_current: current.policies.find((p) => p.id === id)?.state ?? 'unknown',
    state_candidate: candidate.policies.find((p) => p.id === id)?.state ?? 'unknown',
    current: zeroCounts(),
    candidate: zeroCounts(),
    changed_scopes: [],
    offering: [],
    notes: [],
  }));
  const unverifiedIn = new Map<string, Map<LzLiveObservability, number>>();
  const scopes: LzBaselineImpactScope[] = [];
  let runBaseline: LzBaselineImpactResult['run_baseline'] = null;
  const unionNotes = new Set<string>();

  for (const scan of scans) {
    if (scan.meta.baseline && !runBaseline) {
      const same = scan.meta.baseline.framework === fw.id && scan.meta.baseline.sha256 === sha256;
      runBaseline = { framework: scan.meta.baseline.framework, sha256_12: scan.meta.baseline.sha256.slice(0, 12), same };
    }
    const evalWith = (doc: PolicyBaseline) => evaluateLzBaseline(scan, { framework: fw.id, baseline: doc, sha256, controls, regions, sovereigntyDecls: declsOf(doc) }).result;
    const now = evalWith(current);
    const next = evalWith(candidate);
    const count = (r: typeof now): Counts => { const c = zeroCounts(); for (const p of r.policies) c[p.estate]++; return c; };
    scopes.push({ scope_id: scan.meta.scope_id, current: count(now), candidate: count(next), overall_current: now.overall, overall_candidate: next.overall });
    for (const pol of policies) {
      const a = now.policies.find((p) => p.id === pol.policy_id);
      const b = next.policies.find((p) => p.id === pol.policy_id);
      if (a) pol.current[a.estate]++;
      if (b) pol.candidate[b.estate]++;
      const from = a?.estate ?? 'not_evaluated';
      const to = b?.estate ?? 'not_evaluated';
      if (from !== to) pol.changed_scopes.push({ scope_id: scan.meta.scope_id, from, to });
      pol.offering.push({ scope_id: scan.meta.scope_id, current: a?.offering ?? 'not_evaluated', candidate: b?.offering ?? 'not_evaluated' });
      const unverified = [a, b].find((x) => x?.estate === 'unverified');
      if (unverified) {
        const m = unverifiedIn.get(pol.policy_id) ?? new Map<LzLiveObservability, number>();
        m.set(unverified.observability, (m.get(unverified.observability) ?? 0) + 1);
        unverifiedIn.set(pol.policy_id, m);
      }
    }
    // Union widening (D-11): a residency value of the candidate that another framework widens.
    for (const c of o.changes) {
      const p = candidate.policies.find((x) => x.id === c.policy_id);
      if (!p || p.kind !== 'region_residency' || p.state !== 'enabled') continue;
      for (const [param, values] of Object.entries(p.params as Record<string, unknown>)) {
        const key = RESIDENCY_KEY[param];
        if (!key || !Array.isArray(values)) continue;
        const requirement = key === 'require_residency_country' ? 'residency_country' : key === 'require_operator_jurisdiction' ? 'operator_jurisdiction' : key === 'forbid_exposure' ? 'forbid_exposure' : 'certification';
        for (const prov of next.requirement_provenance) {
          if (prov.requirement !== requirement || values.includes(prov.value)) continue;
          const by = prov.frameworks.filter((f) => f !== fw.id);
          if (by.length > 0) unionNotes.add(`${p.id}: the union with ${by.join(', ')} also accepts ${prov.value}; the candidate value does not decide alone`);
        }
      }
    }
  }

  for (const pol of policies) {
    const m = unverifiedIn.get(pol.policy_id);
    if (m) {
      const n = [...m.values()].reduce((a, b) => a + b, 0);
      pol.notes.push(`no live effect measurable in ${n} scope${n === 1 ? '' : 's'} (observability ${[...m.keys()].sort().join(', ')}); a candidate value never makes such a scope pass`);
    }
    for (const note of unionNotes) if (note.startsWith(`${pol.policy_id}:`)) pol.notes.push(note.slice(pol.policy_id.length + 2));
  }

  const notes: string[] = [];
  if (runBaseline && !runBaseline.same) {
    notes.push(`the run measured baseline ${runBaseline.framework} (sha256 ${runBaseline.sha256_12}), not the current file; the current-value counts are a re-evaluation, not the stored result`);
  }
  if (!runBaseline) notes.push('the run had no Client LZ Policy Baseline selected; the current-value counts are a re-evaluation');
  return {
    schema: LZ_BASELINE_IMPACT_SCHEMA,
    lz_id: o.lzId,
    run_id: runId,
    provider,
    framework: fw.id,
    label: `re-evaluated from the stored scan of run ${runId}, not a new live read`,
    run_baseline: runBaseline,
    scopes,
    policies,
    notes,
  };
}

/** Plain-text lines of the result (the CLI without --json). */
export function formatLzBaselineImpact(r: LzBaselineImpactResult): string[] {
  const fmt = (c: Counts): string => STATUSES.map((s) => `${c[s]} ${s}`).join(', ');
  const lines = [`landing zone ${r.lz_id} (${r.provider}), run ${r.run_id}, baseline ${r.framework}: ${r.label}`];
  for (const s of r.scopes) lines.push(`  scope ${s.scope_id}: now ${fmt(s.current)} (${s.overall_current}); candidate ${fmt(s.candidate)} (${s.overall_candidate})`);
  for (const p of r.policies) {
    lines.push(`  ${p.policy_id} (${p.state_current} -> ${p.state_candidate}): now ${fmt(p.current)}; candidate ${fmt(p.candidate)}`);
    for (const c of p.changed_scopes) lines.push(`    scope ${c.scope_id}: ${c.from} -> ${c.to}`);
    for (const n of p.notes) lines.push(`    note: ${n}`);
  }
  for (const n of r.notes) lines.push(`  note: ${n}`);
  return lines;
}
