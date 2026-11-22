// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module -- cross-CSP baseline comparison (#3872)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Design 123 section 8.3: several CSPs against one client baseline.
//
// Per landing zone, the scope results (lz-baseline-result/1, one per merged
// scope) are rolled up per policy:
//   - governance policies (residency, service control, audit trail and log
//     retention, identity, budget): the platform scope decides; without a
//     platform scope the worst over the scopes;
//   - every other policy: the worst over all merged scopes (a fail in any
//     scope fails the landing zone).
// Worst means the offering order of baselineOverallVerdict and the estate
// order of LZ_LIVE_CHECK_RANK (fail, warn, unverified, pass, na).
//
// The comparison is valid only between landing zones assessed with the same
// baseline hash. The reference is the hash most landing zones used (ties: the
// one of the first landing zone by id); every other landing zone, and one whose
// scopes used different hashes, is listed with same_baseline false and is not
// ranked. A landing zone with no READY policy is not ranked as fit.

import {
  baselineOverallVerdict,
  lzProviderBrand,
  rollUpBaselineScopes,
  type BaselineRollUpScope,
  type LzLiveBaselineComparison,
  type LzRequirementProvenance,
} from '@swao/core';

// #3874: the roll-up moved to @swao/core so the lz-live publication uses the
// same rule as this comparison; re-exported for the existing callers.
export { rollUpBaselineScopes };

export type BaselineComparisonScope = BaselineRollUpScope;

export interface BaselineComparisonLzInput {
  lz_id: string;
  provider: string;
  simulated: boolean;
  /** Baseline results of the merged (included) scopes. */
  scopes: readonly BaselineComparisonScope[];
}

/** Union of the scopes' requirement provenance, frameworks in first-seen order (#3874). */
function unionProvenance(scopes: readonly BaselineComparisonScope[]): LzRequirementProvenance[] {
  const out: LzRequirementProvenance[] = [];
  for (const sc of scopes) {
    for (const r of sc.result.requirement_provenance) {
      const e = out.find((x) => x.requirement === r.requirement && x.value === r.value);
      if (!e) out.push({ requirement: r.requirement, value: r.value, frameworks: [...r.frameworks] });
      else for (const f of r.frameworks) if (!e.frameworks.includes(f)) e.frameworks.push(f);
    }
  }
  return out;
}

/** The comparison block, or undefined when no landing zone has a baseline result. */
export function buildBaselineComparison(inputs: readonly BaselineComparisonLzInput[]): LzLiveBaselineComparison | undefined {
  const withResults = inputs.filter((i) => i.scopes.length > 0).sort((a, b) => a.lz_id.localeCompare(b.lz_id));
  if (withResults.length === 0) return undefined;

  const hashOf = (i: BaselineComparisonLzInput): string | null => {
    const hashes = new Set(i.scopes.map((s) => s.result.sha256));
    return hashes.size === 1 ? [...hashes][0]! : null;
  };
  const counts = new Map<string, number>();
  for (const i of withResults) { const h = hashOf(i); if (h) counts.set(h, (counts.get(h) ?? 0) + 1); }
  let reference: string | null = null;
  for (const i of withResults) {
    const h = hashOf(i);
    if (h && (reference === null || (counts.get(h) ?? 0) > (counts.get(reference) ?? 0))) reference = h;
  }
  const refLz = withResults.find((i) => hashOf(i) === reference) ?? withResults[0]!;
  const refResult = refLz.scopes[0]!.result;

  const rolled = new Map(withResults.map((i) => [i.lz_id, rollUpBaselineScopes(i.scopes)] as const));
  const landing_zones = withResults.map((i) => {
    const same = reference !== null && hashOf(i) === reference;
    const policies = [...rolled.get(i.lz_id)!.values()];
    const c = {
      enabled: policies.length,
      ready: policies.filter((p) => p.offering === 'READY').length,
      ready_with_changes: policies.filter((p) => p.offering === 'READY_WITH_CHANGES').length,
      needs_verification: policies.filter((p) => p.offering === 'NEEDS_VERIFICATION').length,
      blocked: policies.filter((p) => p.offering === 'BLOCKED' || p.offering === 'SOVEREIGNTY_BLOCKED').length,
    };
    return {
      lz_id: i.lz_id,
      provider: i.provider,
      simulated: i.simulated,
      framework: i.scopes[0]!.result.framework,
      sha256: i.scopes[0]!.result.sha256,
      same_baseline: same,
      overall: baselineOverallVerdict(policies.map((p) => p.offering)),
      counts: c,
      fit_score: same && c.enabled > 0 ? c.ready / c.enabled : null,
      rank: null as number | null,
      requirement_provenance: unionProvenance(i.scopes),
    };
  });
  const rankable = landing_zones.filter((l) => l.fit_score !== null && l.counts.ready > 0)
    .sort((a, b) => (b.fit_score! - a.fit_score!) || (a.counts.blocked - b.counts.blocked) || a.lz_id.localeCompare(b.lz_id));
  rankable.forEach((l, idx) => { l.rank = idx + 1; });

  // Matrix: the policies of the reference baseline first, then any other policy id seen.
  const ids: string[] = [];
  const meta = new Map<string, { kind: string; category: string; default_source?: string }>();
  for (const lz of [refLz, ...withResults]) {
    for (const [id, p] of rolled.get(lz.lz_id)!) {
      if (!meta.has(id)) { ids.push(id); meta.set(id, { kind: p.kind, category: p.category, ...(p.default_source !== undefined ? { default_source: p.default_source } : {}) }); }
    }
  }
  const policies = ids.map((id) => ({
    id,
    kind: meta.get(id)!.kind,
    category: meta.get(id)!.category,
    ...(meta.get(id)!.default_source !== undefined ? { default_source: meta.get(id)!.default_source } : {}),
    cells: withResults.flatMap((i) => {
      const p = rolled.get(i.lz_id)!.get(id);
      return p ? [{ lz_id: i.lz_id, offering: p.offering, estate: p.estate, observability: p.observability }] : [];
    }),
  }));
  const comparable = new Set(landing_zones.filter((l) => l.same_baseline).map((l) => l.lz_id));
  const not_met_anywhere = policies
    .filter((p) => !p.cells.some((c) => comparable.has(c.lz_id) && c.offering === 'READY'))
    .map((p) => p.id);

  return {
    framework: refResult.framework,
    baseline_of: refResult.baseline_of,
    catalogue_version: refResult.catalogue_version,
    sha256: reference ?? refResult.sha256,
    landing_zones,
    policies,
    not_met_anywhere,
    not_reviewed: refResult.not_reviewed.map((n) => ({ id: n.id, kind: n.kind, params: { ...n.params }, ...(n.default_source !== undefined ? { default_source: n.default_source } : {}) })),
    disabled: [...refResult.disabled],
  };
}

/** CLI lines of the comparison (formatLzLivePortfolio). */
export function formatBaselineComparison(c: LzLiveBaselineComparison): string[] {
  const lines = [`baseline ${c.framework} ${c.catalogue_version} (sha256 ${c.sha256.slice(0, 12)}): ${c.policies.length} policies compared across ${c.landing_zones.length} landing zone(s)`];
  for (const l of [...c.landing_zones].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || a.lz_id.localeCompare(b.lz_id))) {
    const fit = l.same_baseline
      ? `fit ${l.counts.ready}/${l.counts.enabled} READY, ${l.counts.ready_with_changes} with changes, ${l.counts.needs_verification} need verification, ${l.counts.blocked} blocked${l.rank !== null ? `, rank ${l.rank}` : ', not ranked'}`
      : `different baseline (sha256 ${l.sha256.slice(0, 12)}), not ranked`;
    lines.push(`  ${l.lz_id} (${lzProviderBrand(l.provider)})${l.simulated ? ' [SIM]' : ''}: ${l.overall}; ${fit}`);
  }
  if (c.not_met_anywhere.length > 0) lines.push(`  not met by any landing zone: ${c.not_met_anywhere.join(', ')}`);
  return lines;
}
