// #3888 (Design 123 section 8.4, D-08, D-12, CP-4): host side of the baseline
// rule engine of an Application Assessment. Built just before Pass 11 from
// this run's signals (passes 01 to 10 have run), the LZ source of #3887 and
// the app's installed baseline framework(s); the decisions travel to Pass 11
// on its PassContext (`baselineDecisions`), and the same framework selection
// gives the inline fit its `baselineDenies` (BLOCKED_BY_POLICY with evidence
// `baseline:<policy-id>`). Host-side because Pass 11 (@swao/module-framework)
// depends on @swao/core only and the rules live in @swao/module-landing-zone.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  BASELINE_DECISIONS_FILE,
  BaselineControlDecisionsSchema,
  deriveConstraints,
  loadPolicyBaseline,
  loadRegimeRegistry,
  LzBaselineResultSchema,
  LZ_BASELINE_RESULT_SUFFIX,
  POLICY_BASELINE_FILE,
  type BaselineControlDecisions,
  type LzBaselineResult,
  type LzRegion,
  type LzRequirementProvenance,
  type PolicyBaseline,
} from '@swao/core';
import { loadPriorSignals } from '@swao/module-app-assessment';
import { baselineServiceDenies, evaluateAppBaselineRules, resolveProviderCatalogue, sovereigntyRequirementProvenance, toLzRequiredServices, type FrameworkSovereigntyDecl } from '@swao/module-landing-zone';

export interface InstalledBaseline {
  id: string;
  dir: string;
  baseline: PolicyBaseline;
  sha256: string;
}

/** The valid policy baselines among the app's selected regimes (installed under wsp/inputs/catalogs/). */
export function selectedPolicyBaselines(workspaceRoot: string, regimeIds: readonly string[]): InstalledBaseline[] {
  const catalogsDir = join(workspaceRoot, 'wsp', 'inputs', 'catalogs');
  if (!existsSync(catalogsDir) || regimeIds.length === 0) return [];
  let registry;
  try {
    registry = loadRegimeRegistry(catalogsDir);
  } catch {
    return [];
  }
  const out: InstalledBaseline[] = [];
  for (const id of regimeIds) {
    const resolved = registry.byId.get(id);
    if (!resolved) continue;
    const dir = dirname(resolved.catalogueFile);
    const loaded = loadPolicyBaseline(dir, id);
    if (loaded.status !== 'ok') continue;
    out.push({ id, dir, baseline: loaded.baseline, sha256: createHash('sha256').update(readFileSync(join(dir, POLICY_BASELINE_FILE))).digest('hex') });
  }
  return out;
}

/** Capability -> policy id of every enabled service_deny of the selected baselines (first policy wins). */
export function selectedBaselineDenies(baselines: readonly InstalledBaseline[]): Map<string, string> | undefined {
  const out = new Map<string, string>();
  for (const b of baselines) for (const [cap, id] of baselineServiceDenies(b.baseline)) if (!out.has(cap)) out.set(cap, id);
  return out.size > 0 ? out : undefined;
}

/**
 * #3920 (Design 123 section 9.3): the value-level provenance of the merged sovereignty
 * requirements (D-11) for the app's inline LZ fit, only when the app selected at least one
 * client policy baseline; undefined otherwise, so the fit and the publication of every other
 * app stay unchanged. An empty list (a baseline without residency policies) is kept: the
 * publication then states that no requirement value was merged.
 */
export function baselineRequirementProvenance(
  baselines: readonly InstalledBaseline[],
  decls: readonly FrameworkSovereigntyDecl[],
): LzRequirementProvenance[] | undefined {
  return baselines.length > 0 ? sovereigntyRequirementProvenance(decls) : undefined;
}

/** Capability keys the app needs, from this run's signals; undefined when the run has no signals yet. */
export function appNeededCapabilities(appDir: string, passesDir: string): string[] | undefined {
  let signals;
  try {
    signals = loadPriorSignals(appDir, passesDir);
  } catch {
    return undefined;
  }
  if (signals.length === 0) return undefined;
  const base = (code: string): string => code.split(/[@+]/)[0] as string;
  return [...new Set(toLzRequiredServices(deriveConstraints(signals).requiredServices).map((r) => base(r.code)))].sort();
}

/** lz-baseline-result/1 documents of a live run, for the given scopes (empty = all). */
export function readLiveBaselineResults(workspaceRoot: string, lzId: string, runId: string, scopes: readonly string[]): LzBaselineResult[] {
  const runDir = join(workspaceRoot, 'landing-zones', lzId, 'wsp', 'runs', runId);
  if (!existsSync(runDir)) return [];
  const out: LzBaselineResult[] = [];
  for (const f of readdirSync(runDir).filter((n) => n.startsWith(`${lzId}.`) && n.endsWith(LZ_BASELINE_RESULT_SUFFIX)).sort()) {
    try {
      const r = LzBaselineResultSchema.safeParse(JSON.parse(readFileSync(join(runDir, f), 'utf-8')));
      if (r.success && (scopes.length === 0 || scopes.includes(r.data.scope_id))) out.push(r.data);
    } catch { /* unreadable result: not used */ }
  }
  return out;
}

export interface AppBaselineDecisionsInput {
  workspaceRoot: string;
  baselines: readonly InstalledBaseline[];
  needs: readonly string[] | undefined;
  source:
    | { kind: 'catalogue'; targets: readonly { provider: string; region: string }[]; cataloguesDir?: string }
    | { kind: 'live'; lzId: string; runId: string; scopes: readonly string[]; stale: boolean }
    | { kind: 'none'; reason: string };
}

/** Rule decisions of every selected baseline's controls, for Pass 11. */
export function appBaselineDecisions(i: AppBaselineDecisionsInput): BaselineControlDecisions {
  if (i.source.kind === 'none') return { source: 'none', regimes: {}, reason: i.source.reason };
  const regimes: BaselineControlDecisions['regimes'] = {};
  if (i.source.kind === 'catalogue') {
    const src = i.source;
    const targets = src.targets.map((t) => {
      let facts: LzRegion | undefined;
      try {
        facts = resolveProviderCatalogue(t.provider, i.workspaceRoot, src.cataloguesDir).catalogue.regions.find((r) => r.id === t.region);
      } catch { /* no catalogue facts: the residency and custody rules say UNKNOWN */ }
      return { provider: t.provider, region: t.region, ...(facts ? { facts } : {}) };
    });
    for (const b of i.baselines) regimes[b.id] = Object.fromEntries(evaluateAppBaselineRules({ baseline: b.baseline, source: 'catalogue', needs: i.needs, targets }));
    return { source: 'catalogue', regimes };
  }
  const src = i.source;
  const results = readLiveBaselineResults(i.workspaceRoot, src.lzId, src.runId, src.scopes);
  for (const b of i.baselines) {
    regimes[b.id] = Object.fromEntries(evaluateAppBaselineRules({ baseline: b.baseline, source: 'live', needs: i.needs, live: { runId: src.runId, results, sha256: b.sha256, stale: src.stale } }));
  }
  return { source: 'live', regimes };
}

/**
 * #3981: writes the decisions of this run to `<runDir>/baseline-decisions.json`
 * (validated by BaselineControlDecisionsSchema) and returns the pass context
 * part unchanged. Readers: the TUI results step, the MCP tools and the chat
 * context. A write failure never fails the run; nothing is written when there
 * are no decisions (no baseline selected).
 */
export function persistBaselineDecisions<T extends { baselineDecisions?: BaselineControlDecisions }>(runDir: string, part: T): T {
  const d = part.baselineDecisions;
  if (!d) return part;
  try {
    const parsed = BaselineControlDecisionsSchema.parse(d);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, BASELINE_DECISIONS_FILE), `${JSON.stringify(parsed, null, 2)}
`, 'utf-8');
  } catch (e) {
    console.warn(`[warn] baseline decisions not written: ${e instanceof Error ? e.message : String(e)}`);
  }
  return part;
}

/** #3981: reader of the persisted decisions (in @swao/core, shared with the TUI, MCP and chat). */
export { readBaselineDecisions } from '@swao/core';
