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

// #3888 (Design 123 section 8.4, D-08, CP-4): the rule engine that decides the
// controls of a Client LZ Policy Baseline in an Application Assessment. Pure:
// the host builds the input (the app's needs from this run's signals, the
// catalogue target regions or the live run's baseline results) and Pass 11
// takes the result from its PassContext, so no baseline control reaches the
// LLM. Outcome rules (Design 123 section 8.4, worst-of over several targets):
//
//   policy disabled                     N_A
//   policy not_set (not reviewed, D-10) UNKNOWN
//   service_deny / service_allow_list   by the app's needed capabilities
//                                       (both sources): a forbidden or
//                                       not allow-listed need is GAP (the fit
//                                       shows BLOCKED_BY_POLICY, D-12)
//   region_residency (catalogue)        per target region facts
//   encryption_at_rest (catalogue)      the needed stateful capabilities of
//                                       applies_to against the key custody
//                                       the target region offers: offered
//                                       PARTIAL (achievable with
//                                       configuration), not offered GAP
//   every other kind (catalogue)        UNKNOWN, the static catalogue has no
//                                       tenant state (zone data included)
//   every other kind (live)             the estate status of the live run's
//                                       baseline result: pass SATISFIED, fail
//                                       GAP, warn PARTIAL, na N_A, unverified
//                                       UNKNOWN
//
// Needs that were not derived in this run (no signals) make the needs-based
// kinds UNKNOWN, never SATISFIED (ADR-0041). Rationales carry policy ids,
// kinds, counts and region ids only (Design 123 section 12).
//
// #3981: a decision over several targets (catalogue residency and
// encryption_at_rest) or scopes (live) keeps each target's or scope's outcome
// in `contributions`, ranked worst first, so the second and third worst are
// reportable; the worst-of outcome itself is unchanged.

import { BASELINE_OUTCOME_RANK, KEY_CUSTODY_LEVELS, maskNativeIds, rankBaselineContributions } from '@swao/core';
import type { BaselineControlContribution, BaselineControlDecision, BaselineControlOutcome, KeyCustodyLevel, LzBaselineResult, LzLiveCheckStatus, LzRegion, Policy, PolicyBaseline } from '@swao/core';
import { judgeRegion, keyCustodyRank, residencyRequirementFor } from './lz-baseline-eval.js';

export interface AppBaselineCatalogueTarget {
  provider: string;
  region: string;
  /** Catalogue facts of the region; undefined when the catalogue has none. */
  facts?: LzRegion;
}

export interface AppBaselineRulesInput {
  baseline: PolicyBaseline;
  source: 'catalogue' | 'live';
  /** Needed capability keys of the app (service_dep:<key>), without qualifiers; undefined = not derived in this run. */
  needs: readonly string[] | undefined;
  /** Catalogue source: the target regions. */
  targets?: readonly AppBaselineCatalogueTarget[];
  /** Live source: the baseline results of the scopes the fit uses. */
  live?: {
    runId: string;
    results: readonly LzBaselineResult[];
    /** sha256 of the app's installed policy-baseline.yaml; results of another sha256 are not reused. */
    sha256: string;
    stale: boolean;
  };
}

const worst = (a: BaselineControlOutcome, b: BaselineControlOutcome): BaselineControlOutcome => (BASELINE_OUTCOME_RANK[b] > BASELINE_OUTCOME_RANK[a] ? b : a);
const NO_TENANT_STATE = 'static catalogue has no tenant state';

function decide(p: Policy, outcome: BaselineControlOutcome, why: string, contributions?: readonly BaselineControlContribution[]): BaselineControlDecision {
  return {
    policy_id: p.id,
    outcome,
    rationale: `${p.id} (${p.kind}): ${why}. Decided by the baseline rule engine, no LLM evaluation.`,
    // #3981: per target or scope, ranked worst first; the first entry equals the worst-of outcome.
    ...(contributions && contributions.length > 0 ? { contributions: rankBaselineContributions(contributions) } : {}),
  };
}

function needsBased(p: Policy, needs: readonly string[] | undefined): BaselineControlDecision | null {
  if (p.kind !== 'service_deny' && p.kind !== 'service_allow_list') return null;
  if (needs === undefined) return decide(p, 'UNKNOWN', 'the app needs were not derived in this run (no service_dep signals)');
  const caps = new Set(p.params.capabilities ?? []);
  if (p.kind === 'service_deny') {
    const hit = needs.filter((n) => caps.has(n));
    return hit.length > 0
      ? decide(p, 'GAP', `the app needs ${hit.join(', ')}, which the baseline forbids (fit verdict BLOCKED_BY_POLICY, evidence baseline:${p.id})`)
      : decide(p, 'SATISFIED', `none of the ${needs.length} needed capabilities is forbidden`);
  }
  const outside = needs.filter((n) => !caps.has(n));
  return outside.length > 0
    ? decide(p, 'GAP', `${outside.length} needed capabilities are outside the allow-list (${outside.join(', ')})`)
    : decide(p, 'SATISFIED', `every needed capability (${needs.length}) is allow-listed`);
}

function catalogueDecision(p: Policy, input: AppBaselineRulesInput): BaselineControlDecision {
  const targets = input.targets ?? [];
  switch (p.kind) {
    case 'region_residency': {
      if (targets.length === 0) return decide(p, 'UNKNOWN', 'no LZ target region in this run');
      const req = residencyRequirementFor(p, undefined);
      let out: BaselineControlOutcome = 'N_A';
      const parts: string[] = [];
      const contributions: BaselineControlContribution[] = [];
      for (const t of targets) {
        const j = judgeRegion(t.facts, req);
        const o: BaselineControlOutcome = j === 'pass' ? 'SATISFIED' : j === 'fail' ? 'GAP' : 'UNKNOWN';
        out = worst(out, o);
        const part = `${t.provider}/${t.region} ${j === 'pass' ? 'allowed' : j === 'fail' ? 'not allowed' : 'without facts'}`;
        parts.push(part);
        contributions.push({ target: `${t.provider}/${t.region}`, provider: t.provider, region: t.region, outcome: o, rationale: `region ${part}` });
      }
      return decide(p, out, `target regions: ${parts.join(', ')}`, contributions);
    }
    case 'encryption_at_rest': {
      if (input.needs === undefined) return decide(p, 'UNKNOWN', 'the app needs were not derived in this run (no service_dep signals)');
      const appliesTo = new Set(p.params.applies_to ?? []);
      const stateful = input.needs.filter((n) => appliesTo.has(n));
      if (stateful.length === 0) return decide(p, 'N_A', 'the app needs no capability of applies_to');
      if (targets.length === 0) return decide(p, 'UNKNOWN', 'no LZ target region in this run');
      const min: KeyCustodyLevel = p.params.min_key_custody ?? 'customer-managed';
      const minRank = KEY_CUSTODY_LEVELS.indexOf(min);
      let out: BaselineControlOutcome = 'N_A';
      const parts: string[] = [];
      const contributions: BaselineControlContribution[] = [];
      for (const t of targets) {
        // #3981: worst over the needed capabilities within this target.
        let perTarget: BaselineControlOutcome = 'N_A';
        const targetParts: string[] = [];
        for (const cap of stateful) {
          const services = (t.facts?.services ?? []).filter((s) => s.fulfills.includes(cap));
          // As the LZ evaluator: a generated provider-managed-only entry is no custody statement.
          const stated = services.filter((s) => s.source === 'curated' || s.key_custody.some((k) => k !== 'provider-managed'));
          const ranks = stated.flatMap((s) => s.key_custody).map(keyCustodyRank);
          let o: BaselineControlOutcome;
          if (ranks.some((r) => r !== null && r >= minRank)) o = 'PARTIAL';
          else if (stated.length === 0 || ranks.some((r) => r === null)) o = 'UNKNOWN';
          else o = 'GAP';
          out = worst(out, o);
          perTarget = worst(perTarget, o);
          const part = `${cap} in ${t.provider}/${t.region}: ${o === 'PARTIAL' ? `${min} key custody offered, to configure` : o === 'GAP' ? `no ${min} key custody offered` : 'no custody data'}`;
          parts.push(part);
          targetParts.push(part);
        }
        contributions.push({ target: `${t.provider}/${t.region}`, provider: t.provider, region: t.region, outcome: perTarget, rationale: targetParts.join('; ') });
      }
      return decide(p, out, parts.join('; '), contributions);
    }
    case 'service_deny':
    case 'service_allow_list':
      return needsBased(p, input.needs) as BaselineControlDecision;
    case 'encryption_in_transit':
    case 'no_public_exposure':
    case 'no_open_admin_ingress':
    case 'privileged_mfa':
    case 'credential_age':
    case 'audit_trail':
    case 'log_retention':
    case 'required_tags':
    case 'min_availability_zones':
    case 'backup_configured':
    case 'budget_alerts':
    case 'documented_exit':
      return decide(p, 'UNKNOWN', NO_TENANT_STATE);
    default: {
      const exhaustive: never = p;
      return exhaustive;
    }
  }
}

const ESTATE: Record<LzLiveCheckStatus, BaselineControlOutcome> = { pass: 'SATISFIED', fail: 'GAP', warn: 'PARTIAL', na: 'N_A', unverified: 'UNKNOWN' };

function liveDecision(p: Policy, input: AppBaselineRulesInput): BaselineControlDecision {
  const needs = needsBased(p, input.needs);
  if (needs) return needs;
  const live = input.live;
  if (!live) return decide(p, 'UNKNOWN', 'no live run in this assessment');
  const same = live.results.filter((r) => r.sha256 === live.sha256);
  if (same.length === 0) return decide(p, 'UNKNOWN', `live run ${live.runId} measured another baseline version (sha256 differs) or no baseline`);
  let out: BaselineControlOutcome = 'N_A';
  const parts: string[] = [];
  const contributions: BaselineControlContribution[] = [];
  for (const r of same) {
    const res = r.policies.find((x) => x.id === p.id);
    if (!res) continue;
    const o = ESTATE[res.estate];
    out = worst(out, o);
    parts.push(`scope ${r.scope_id}: estate ${res.estate}`);
    // #3981: the scope's estate row; detail is counts and reasons, masked again (Design 123 section 12).
    contributions.push({ scope_id: r.scope_id, provider: r.provider, outcome: o, rationale: `estate ${res.estate} (${res.observability}): ${maskNativeIds(res.detail)}` });
  }
  if (contributions.length === 0) return decide(p, 'UNKNOWN', `live run ${live.runId} has no result for the policy`);
  return decide(p, out, `live run ${live.runId}${live.stale ? ' (stale)' : ''}, ${parts.join(', ')}`, contributions);
}

/** One decision per policy of the baseline, keyed by the policy's control id. */
export function evaluateAppBaselineRules(input: AppBaselineRulesInput): Map<string, BaselineControlDecision> {
  const out = new Map<string, BaselineControlDecision>();
  for (const p of input.baseline.policies) {
    let d: BaselineControlDecision;
    if (p.state === 'disabled') d = decide(p, 'N_A', 'the policy is disabled in the baseline');
    else if (p.state === 'not_set') d = decide(p, 'UNKNOWN', 'the policy is not reviewed (state not_set, D-10)');
    else d = input.source === 'catalogue' ? catalogueDecision(p, input) : liveDecision(p, input);
    out.set(p.control, d);
  }
  return out;
}
