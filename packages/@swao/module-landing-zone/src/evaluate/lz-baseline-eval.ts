// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module -- Client LZ Policy Baseline evaluator (#3871)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Evaluates every enabled policy of a client baseline against one live scope
// (Design 123 section 8). Pure and CSP-agnostic: it reads the normalised scan
// (regions, services, resources, guardrails, estate.posture) plus catalogue
// region facts, and returns
//   - one estate check per enabled policy (estate.checks[], LzLiveCheckSchema),
//   - one check definition per policy for the lights engine, scoped to the
//     baseline framework column (service_dep_codes = the policy's tags),
//   - the lz-baseline-result/1 document with the offering verdict per policy.
// not_set policies are listed and never evaluated (D-10); disabled policies
// are listed. Unverified never counts as a pass (ADR-0041).
//
// Phase 1 (Design 123 section 13) decides region_residency, service_deny,
// service_allow_list, audit_trail, min_availability_zones, required_tags and
// the encryption_at_rest offering (catalogue key_custody); budget_alerts reads
// estate.posture.budgets (#3936). Phase 2 (#3871 posture evaluators,
// lz-baseline-posture.ts) decides the estate of the other kinds that read
// `estate.posture` (#3865 to #3868): encryption at rest and in transit,
// exposure, admin ingress, privileged MFA, credential age, log retention and
// backup. documented_exit is never observable.

import { readFileSync } from 'fs';
import { join } from 'path';
import { load as yamlLoad } from 'js-yaml';
import {
  KEY_CUSTODY_LEVELS,
  LZ_BASELINE_RESULT_SCHEMA,
  type KeyCustodyLevel,
  baselineOverallVerdict,
  type LzBaselineOfferingVerdict,
  type LzBaselinePolicyResult,
  type LzBaselineResult,
  type LzLiveCheck,
  type LzLiveCheckStatus,
  type LzLiveObservability,
  type LzLiveScan,
  type LzLiveService,
  type LzRegion,
  type Policy,
  type PolicyBaseline,
  type PolicyKind,
} from '@swao/core';
import { residencyAllowed, sovereigntyFailures, type SovereigntyRequirements } from '../fit/lz-fit.js';
import {
  deriveSovereigntyRequirements,
  sovereigntyRequirementProvenance,
  type FrameworkSovereigntyDecl,
} from '../fit/orchestrate-lz.js';
import type { LzLiveCheckDefinition } from './lz-live-eval.js';
import { LIVE_RESOURCE_TYPES_WITHOUT_TAGS, liveResourceCapabilityTags } from '../live/resource-capabilities.js';
import {
  evalBackupConfigured,
  evalCredentialAge,
  evalEncryptionAtRestEstate,
  evalEncryptionInTransit,
  evalLogRetention,
  evalNoOpenAdminIngress,
  evalNoPublicExposure,
  evalPrivilegedMfa,
} from './lz-baseline-posture.js';

export type ControlSeverity = 'critical' | 'high' | 'medium' | 'low' | 'informational';

export interface LzBaselineControl {
  title: string;
  severity_default?: ControlSeverity;
}

export interface LzBaselineEvalInput {
  /** framework.id of the baseline copy. */
  framework: string;
  baseline: PolicyBaseline;
  /** sha256 of the evaluated policy-baseline.yaml. */
  sha256: string;
  /** Controls of the baseline's controls.yaml by id. */
  controls: ReadonlyMap<string, LzBaselineControl>;
  /** Catalogue region facts by region id (sovereignty, services with key_custody). */
  regions: ReadonlyMap<string, LzRegion>;
  /** Sovereignty declarations of every selected framework, the baseline included (D-11 union). */
  sovereigntyDecls: readonly FrameworkSovereigntyDecl[];
}

export interface LzBaselineEvalOutput {
  checks: LzLiveCheck[];
  definitions: LzLiveCheckDefinition[];
  result: LzBaselineResult;
}

type Severity = 'blocker' | 'warning' | 'info';

/** Control severity to check severity (Design 123 section 8.2): the inverse of
 *  LZ_LIVE_CHECK_SEVERITY. A control without severity_default is a warning. */
export function baselineCheckSeverity(sev: ControlSeverity | undefined): Severity {
  switch (sev) {
    case 'critical':
    case 'high': return 'blocker';
    case 'medium':
    case undefined: return 'warning';
    case 'low':
    case 'informational': return 'info';
    default: {
      const exhaustive: never = sev;
      return exhaustive;
    }
  }
}

// #3874: baselineOverallVerdict moved to @swao/core (shared with the publication); re-exported here.
export { baselineOverallVerdict };

/** Catalogue key_custody strings to the ordered levels; an unmapped value is unknown (never READY). */
const KEY_CUSTODY_ALIASES: Readonly<Record<string, KeyCustodyLevel>> = {
  'provider-managed': 'provider-managed',
  'customer-managed': 'customer-managed',
  cmk: 'customer-managed',
  byok: 'byok',
  hyok: 'hyok',
};
export function keyCustodyRank(value: string): number | null {
  const level = KEY_CUSTODY_ALIASES[value];
  return level === undefined ? null : KEY_CUSTODY_LEVELS.indexOf(level);
}

/**
 * Observability of a kind when the scan has no evidence for it (Design 123
 * section 5.4 tables, "Today" column): not_observable where no read-only live
 * API answers it on that CSP, else not_collected.
 */
const NOT_OBSERVABLE: Readonly<Record<string, readonly PolicyKind[]>> = {
  otc: ['budget_alerts', 'documented_exit'],
  aws: ['documented_exit'],
  // #3955: the Audit Log v2 API answers 404 for the Reader key (STACKIT_AUDITLOG_UNANSWERED, stackit-driver.ts).
  stackit: ['privileged_mfa', 'credential_age', 'audit_trail', 'log_retention', 'budget_alerts', 'documented_exit'],
  azure: ['privileged_mfa', 'credential_age', 'documented_exit'],
};
export function observabilityWithoutEvidence(provider: string, kind: PolicyKind): LzLiveObservability {
  if (kind === 'documented_exit') return 'not_observable';
  return (NOT_OBSERVABLE[provider] ?? []).includes(kind) ? 'not_observable' : 'not_collected';
}

interface Outcome {
  offering: LzBaselineOfferingVerdict;
  estate: LzLiveCheckStatus;
  observability: LzLiveObservability;
  detail: string;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

function offeredRegions(scan: LzLiveScan): string[] {
  return scan.offering.regions.filter((r) => r.status === 'enabled' || r.status === 'available_not_enabled').map((r) => r.id).sort();
}

/** Region values that mark a global resource, not a location (OTC RMS lists IAM
 *  resources with region `global`, live run 2026-11-05). */
const GLOBAL_REGIONS: ReadonlySet<string> = new Set(['global']);

/** Regions the estate uses: regions of the scope's resources (global resources have none). */
function regionsInUse(scan: LzLiveScan): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of scan.estate.resources) if (r.region && !GLOBAL_REGIONS.has(r.region)) out.set(r.region, (out.get(r.region) ?? 0) + 1);
  return out;
}

/** Catalogue facts of a region, with the live region country as residency fallback. */
function regionFacts(scan: LzLiveScan, regions: ReadonlyMap<string, LzRegion>, id: string): LzRegion | undefined {
  const facts = regions.get(id);
  const live = scan.offering.regions.find((r) => r.id === id);
  if (facts) return facts;
  if (live?.country) return { id, country: live.country, sovereignty: { residency_country: live.country, extraterritorial_exposure: [], certifications: [] }, services: [] };
  return undefined;
}

export type RegionJudgement = 'pass' | 'fail' | 'unknown';

/** One region against the keys a residency policy sets (merged values, D-11). */
export function judgeRegion(facts: LzRegion | undefined, req: SovereigntyRequirements): RegionJudgement {
  const s = facts?.sovereignty;
  if (!s) return 'unknown';
  if (req.require_residency_country && (!s.residency_country || s.residency_country === 'UNKNOWN')) return 'unknown';
  if (req.require_operator_jurisdiction && !s.operator_jurisdiction) return 'unknown';
  if (req.require_residency_country && s.residency_country && !residencyAllowed(s.residency_country, req.require_residency_country)) return 'fail';
  return sovereigntyFailures(facts!, req).length > 0 ? 'fail' : 'pass';
}

/** The merged requirement restricted to the keys the policy sets (a RES-01 is not failed on jurisdiction). */
export function residencyRequirementFor(p: Extract<Policy, { kind: 'region_residency' }>, merged: SovereigntyRequirements | undefined): SovereigntyRequirements {
  const q = p.params;
  return {
    ...(q.allowed_countries ? { require_residency_country: merged?.require_residency_country ?? q.allowed_countries } : {}),
    ...(q.allowed_operator_jurisdictions ? { require_operator_jurisdiction: merged?.require_operator_jurisdiction ?? q.allowed_operator_jurisdictions } : {}),
    ...(q.forbid_exposure ? { forbid_exposure: merged?.forbid_exposure ?? q.forbid_exposure } : {}),
    ...(q.required_certifications ? { require_certifications: merged?.require_certifications ?? q.required_certifications } : {}),
  };
}

function evalResidency(scan: LzLiveScan, input: LzBaselineEvalInput, req: SovereigntyRequirements): Outcome {
  const offered = offeredRegions(scan);
  const judged = offered.map((r) => judgeRegion(regionFacts(scan, input.regions, r), req));
  const pass = judged.filter((j) => j === 'pass').length;
  const fail = judged.filter((j) => j === 'fail').length;
  const unknown = judged.filter((j) => j === 'unknown').length;
  let offering: LzBaselineOfferingVerdict;
  if (offered.length === 0) offering = 'NEEDS_VERIFICATION';
  else if (pass === 0 && unknown === 0) offering = 'SOVEREIGNTY_BLOCKED';
  else if (pass === 0) offering = 'NEEDS_VERIFICATION';
  else if (fail > 0 || unknown > 0) offering = 'READY_WITH_CHANGES';
  else offering = 'READY';

  const inUse = regionsInUse(scan);
  const offeredDetail = `offered regions: ${pass} allowed, ${fail} not allowed, ${unknown} without facts`;
  if (inUse.size === 0) return { offering, estate: 'na', observability: 'observed', detail: `no resource with a region in scope; ${offeredDetail}` };
  let used = { pass: 0, fail: 0, unknown: 0 };
  let failingResources = 0;
  for (const [r, count] of inUse) {
    const j = judgeRegion(regionFacts(scan, input.regions, r), req);
    used = { ...used, [j]: used[j] + 1 };
    if (j === 'fail') failingResources += count;
  }
  const usedDetail = `${plural(inUse.size, 'region')} in use: ${used.pass} allowed, ${used.fail} not allowed, ${used.unknown} without facts`;
  if (used.fail > 0) return { offering, estate: 'fail', observability: 'observed', detail: `${usedDetail}; ${plural(failingResources, 'resource')} outside the allowed set; ${offeredDetail}` };
  if (used.unknown > 0) return { offering, estate: 'unverified', observability: 'catalogue', detail: `${usedDetail}; region facts missing; ${offeredDetail}` };
  return { offering, estate: 'pass', observability: 'observed', detail: `${usedDetail}; ${offeredDetail}` };
}

/** Capability tags of every service in the scan by native code. */
function serviceTags(scan: LzLiveScan): Map<string, readonly string[]> {
  return new Map(scan.offering.services.map((s) => [s.code, s.capability_tags] as const));
}

function enabledSomewhere(s: LzLiveService): boolean {
  return Object.values(s.regions).some((r) => r.status === 'enabled');
}

interface ResourceJoin { matched: number; unmapped: number; total: number }

/**
 * Resources whose capability tags `hit(tags)` is true for. A resource's tags
 * come from its live resource type (#3931, live/resource-capabilities.ts),
 * else from the offering service it joins by service code; a resource with
 * neither is unmapped (never guessed).
 */
function joinResources(scan: LzLiveScan, hit: (tags: readonly string[]) => boolean): ResourceJoin {
  const tags = serviceTags(scan);
  let matched = 0;
  let unmapped = 0;
  for (const r of scan.estate.resources) {
    const t = liveResourceCapabilityTags(scan.meta.provider, r.type) ?? (r.service_code ? tags.get(r.service_code) : undefined);
    if (!t || t.length === 0) { unmapped++; continue; }
    if (hit(t)) matched++;
  }
  return { matched, unmapped, total: scan.estate.resources.length };
}

function evalServiceDeny(scan: LzLiveScan, caps: readonly string[]): Outcome {
  const deny = new Set(caps);
  const forbidden = scan.offering.services.filter((s) => s.capability_tags.some((t) => deny.has(t)));
  let offering: LzBaselineOfferingVerdict;
  if (scan.offering.services.length === 0) offering = 'NEEDS_VERIFICATION';
  else if (forbidden.some((s) => Object.values(s.regions).some((r) => r.status === 'enabled' || r.status === 'available_not_enabled'))) offering = 'READY_WITH_CHANGES';
  else if (forbidden.some((s) => Object.values(s.regions).some((r) => r.status === 'unknown'))) offering = 'NEEDS_VERIFICATION';
  else offering = 'READY';
  const enabled = forbidden.filter(enabledSomewhere).length;
  const offeredDetail = `${plural(forbidden.length, 'forbidden service')} in the offering, ${enabled} enabled`;

  const j = joinResources(scan, (t) => t.some((x) => deny.has(x)));
  if (j.matched > 0) return { offering, estate: 'fail', observability: 'observed', detail: `${plural(j.matched, 'resource')} of a forbidden capability deployed; ${offeredDetail}` };
  if (j.unmapped > 0) return { offering, estate: 'unverified', observability: 'not_collected', detail: `${plural(j.unmapped, 'resource')} without a capability mapping (resource type to capability tag); ${offeredDetail}` };
  if (enabled > 0) return { offering, estate: 'warn', observability: 'observed', detail: `no forbidden resource deployed, but ${offeredDetail}` };
  if (j.total === 0 && scan.offering.services.length === 0) return { offering, estate: 'unverified', observability: 'not_collected', detail: 'no services and no resources collected' };
  return { offering, estate: 'pass', observability: 'observed', detail: `no forbidden resource deployed; ${offeredDetail}` };
}

function evalServiceAllowList(scan: LzLiveScan, caps: readonly string[]): Outcome {
  const allow = new Set(caps);
  const outside = (t: readonly string[]): boolean => !t.some((x) => allow.has(x));
  const enabledTagged = scan.offering.services.filter((s) => enabledSomewhere(s) && s.capability_tags.length > 0);
  const enabledUntagged = scan.offering.services.filter((s) => enabledSomewhere(s) && s.capability_tags.length === 0);
  const enabledOutside = enabledTagged.filter((s) => outside(s.capability_tags)).length;
  let offering: LzBaselineOfferingVerdict;
  if (scan.offering.services.length === 0) offering = 'NEEDS_VERIFICATION';
  else if (enabledOutside > 0) offering = 'READY_WITH_CHANGES';
  else if (enabledUntagged.length > 0) offering = 'NEEDS_VERIFICATION';
  else offering = 'READY';
  const offeredDetail = `${plural(enabledOutside, 'enabled service')} outside the allow-list, ${enabledUntagged.length} enabled without capability tags`;

  const j = joinResources(scan, outside);
  if (j.matched > 0) return { offering, estate: 'fail', observability: 'observed', detail: `${plural(j.matched, 'resource')} outside the allow-list deployed; ${offeredDetail}` };
  if (j.unmapped > 0) return { offering, estate: 'unverified', observability: 'not_collected', detail: `${plural(j.unmapped, 'resource')} without a capability mapping; ${offeredDetail}` };
  if (j.total === 0) return { offering, estate: 'na', observability: 'observed', detail: `no resource deployed; ${offeredDetail}` };
  return { offering, estate: 'pass', observability: 'observed', detail: `every deployed resource is allow-listed; ${offeredDetail}` };
}

const AUDIT_GUARDRAILS = new Set(['cts-tracker', 'cloudtrail-trail']);

function evalAuditTrail(scan: LzLiveScan, allRegions: boolean, provider: string): Outcome {
  const offered = scan.offering.services.some((s) => s.capability_tags.includes('audit_logging') && Object.values(s.regions).some((r) => r.status === 'enabled' || r.status === 'available_not_enabled'));
  const inUse = [...regionsInUse(scan).keys()].sort();
  // #3955: without evidence, a CSP where no read-only API answers the audit trail (section 5.4) gives not_observable.
  const unread = observabilityWithoutEvidence(provider, 'audit_trail');
  const toOutcome = (estate: LzLiveCheckStatus, detail: string): Outcome => ({
    offering: estate === 'pass' ? 'READY' : estate === 'fail' ? 'READY_WITH_CHANGES' : 'NEEDS_VERIFICATION',
    estate,
    observability: estate === 'unverified' ? unread : 'observed',
    detail,
  });

  const logging = scan.estate.posture?.logging;
  if (logging && logging.source.status === 'ok') {
    const on = logging.trails.filter((t) => t.enabled);
    if (on.length === 0) return toOutcome('fail', `${plural(logging.trails.length, 'trail')}, none enabled`);
    if (!allRegions || on.some((t) => t.all_regions === true)) return toOutcome('pass', `${plural(on.length, 'enabled trail')}${allRegions ? ', one covers all regions' : ''}`);
    const covered = new Set(on.map((t) => t.region).filter((r): r is string => r !== undefined));
    const missing = inUse.filter((r) => !covered.has(r));
    return missing.length > 0 ? toOutcome('fail', `${plural(missing.length, 'region')} in use without an enabled trail`) : toOutcome('pass', `every region in use has an enabled trail`);
  }

  const trails = scan.estate.guardrails.filter((g) => AUDIT_GUARDRAILS.has(g.type));
  if (trails.length > 0) {
    const passing = trails.filter((g) => g.status === 'pass');
    if (passing.length === 0) return toOutcome('fail', `${plural(trails.length, 'audit trail guardrail')}, none passing`);
    if (!allRegions) return toOutcome('pass', `${plural(passing.length, 'passing audit trail')}`);
    // OTC: one CTS system tracker per region project (`<region>/<tracker>`); AWS: a passing trail is multi-region.
    const perRegion = trails.every((g) => g.type === 'cts-tracker');
    if (!perRegion) return toOutcome('pass', `${plural(passing.length, 'multi-region trail')} logging`);
    const covered = new Set(passing.map((g) => (g.id ?? '').split('/')[0]));
    const regions = inUse.length > 0 ? inUse : scan.offering.regions.filter((r) => r.status === 'enabled').map((r) => r.id);
    const missing = regions.filter((r) => !covered.has(r));
    return missing.length > 0 ? toOutcome('fail', `${plural(missing.length, 'region')} without an enabled system tracker`) : toOutcome('pass', `every region (${regions.length}) has an enabled system tracker`);
  }
  const why = scan.meta.sources.find((s) => s.name.startsWith('guardrails') && s.status === 'not_collected');
  // #3955: a refused audit log read names its status (and why the key cannot read it) before the guardrail fallback.
  if (logging && logging.source.status === 'not_collected' && trails.length === 0) {
    const s = logging.source;
    const base = toOutcome('unverified', `audit log not read (${[s.http_status !== undefined ? `HTTP ${s.http_status}` : undefined, s.reason].filter((x) => x !== undefined).join('; ')})`);
    return offered ? base : { ...base, detail: `${base.detail}; no audit logging service observed in the offering` };
  }
  const base = toOutcome('unverified', why ? `audit trail not collected (${why.http_status ? `HTTP ${why.http_status}` : why.reason ?? 'not collected'})` : `audit trail not collected by the ${provider} driver`);
  return offered ? base : { ...base, detail: `${base.detail}; no audit logging service observed in the offering` };
}

function evalMinAzs(scan: LzLiveScan, input: LzBaselineEvalInput, min: number, residency: SovereigntyRequirements | undefined): Outcome {
  const allowed = scan.offering.regions
    .filter((r) => r.status === 'enabled' || r.status === 'available_not_enabled')
    .filter((r) => !residency || judgeRegion(regionFacts(scan, input.regions, r.id), residency) !== 'fail');
  const azs = (id: string): number | null => {
    const r = scan.offering.regions.find((x) => x.id === id);
    return r && r.azs.length > 0 ? r.azs.filter((a) => a.available).length : null;
  };
  const known = allowed.filter((r) => azs(r.id) !== null);
  const enough = known.filter((r) => (azs(r.id) ?? 0) >= min).length;
  let offering: LzBaselineOfferingVerdict;
  if (known.length === 0) offering = 'NEEDS_VERIFICATION';
  else if (enough === 0) offering = 'BLOCKED';
  else if (enough < allowed.length) offering = 'READY_WITH_CHANGES';
  else offering = 'READY';
  const offeredDetail = `${plural(allowed.length, 'allowed region')}: ${enough} with at least ${min} availability zones, ${allowed.length - known.length} without zone data`;

  const inUse = [...regionsInUse(scan).keys()];
  if (inUse.length === 0) return { offering, estate: 'na', observability: 'observed', detail: `no resource with a region in scope; ${offeredDetail}` };
  const unknown = inUse.filter((r) => azs(r) === null).length;
  const short = inUse.filter((r) => { const n = azs(r); return n !== null && n < min; }).length;
  if (short > 0) return { offering, estate: 'fail', observability: 'observed', detail: `${plural(short, 'region')} in use with fewer than ${min} availability zones; ${offeredDetail}` };
  if (unknown > 0) return { offering, estate: 'unverified', observability: 'not_collected', detail: `${plural(unknown, 'region')} in use without zone data; ${offeredDetail}` };
  return { offering, estate: 'pass', observability: 'observed', detail: `every region in use (${inUse.length}) has at least ${min} availability zones; ${offeredDetail}` };
}

function evalRequiredTags(scan: LzLiveScan, keys: readonly string[]): Outcome {
  const res = scan.estate.resources;
  const toOutcome = (estate: LzLiveCheckStatus, observability: LzLiveObservability, detail: string): Outcome => ({
    offering: estate === 'pass' || estate === 'na' ? 'READY' : estate === 'fail' ? 'READY_WITH_CHANGES' : 'NEEDS_VERIFICATION',
    estate, observability, detail,
  });
  if (res.length === 0) return toOutcome('na', 'observed', 'no resource in scope');
  // Drivers omit `tags` for a resource without tags (OTC RMS, STACKIT labels, Azure
  // Resource Graph), so an absent map is "no tags", not "not read".
  // #3970: except for types whose API has no labels at all (LIVE_RESOURCE_TYPES_WITHOUT_TAGS): not judged.
  const untaggable = LIVE_RESOURCE_TYPES_WITHOUT_TAGS[scan.meta.provider];
  const blind = untaggable === undefined ? 0 : res.filter((r) => untaggable.has(r.type)).length;
  const judged = untaggable === undefined ? res : res.filter((r) => !untaggable.has(r.type));
  const blindNote = blind > 0 ? `; ${plural(blind, 'resource')} of a type without labels in its API not judged` : '';
  const missing = judged.filter((r) => keys.some((k) => !(k in (r.tags ?? {})))).length;
  if (missing > 0) return toOutcome('fail', 'observed', `${plural(missing, 'resource')} of ${judged.length} without every required tag key (${keys.join(', ')})${blindNote}`);
  if (blind > 0) return toOutcome('unverified', 'not_observable', `${judged.length === 0 ? 'no resource with readable labels' : `every resource with readable labels (${judged.length}) carries ${keys.join(', ')}`}${blindNote}`);
  // AWS lists tagged resources only (Resource Groups Tagging API, D-15): untagged ones are not observable.
  if (scan.meta.provider === 'aws') return toOutcome('unverified', 'not_observable', `every listed resource (${res.length}) carries ${keys.join(', ')}; the tagging API lists tagged resources only, untagged resources are not observable (D-15)`);
  return toOutcome('pass', 'observed', `every resource (${res.length}) carries ${keys.join(', ')}`);
}

function evalEncryptionAtRestOffering(scan: LzLiveScan, input: LzBaselineEvalInput, minCustody: KeyCustodyLevel, appliesTo: readonly string[]): Outcome {
  const min = KEY_CUSTODY_LEVELS.indexOf(minCustody);
  const offered = offeredRegions(scan);
  // Per applies_to tag offered in scope: does some catalogue service of an offered region offer the custody?
  const tagsOffered = appliesTo.filter((t) => scan.offering.services.some((s) => s.capability_tags.includes(t) && Object.values(s.regions).some((r) => r.status === 'enabled' || r.status === 'available_not_enabled')));
  const blockedTags: string[] = [];
  const unknownTags: string[] = [];
  for (const tag of tagsOffered) {
    // A generated catalogue entry with provider-managed only is the fetcher default
    // (fetch-stackit.ts keyCustodyFor), not a statement that nothing stronger is
    // offered: it counts as no custody data. Only a curated entry can support BLOCKED.
    const custody = offered.flatMap((r) => (input.regions.get(r)?.services ?? [])
      .filter((s) => s.fulfills.includes(tag))
      .filter((s) => s.source === 'curated' || s.key_custody.some((k) => k !== 'provider-managed'))
      .flatMap((s) => s.key_custody));
    const ranks = custody.map(keyCustodyRank);
    if (ranks.some((x) => x !== null && x >= min)) continue;
    if (custody.length === 0 || ranks.some((x) => x === null)) unknownTags.push(tag);
    else blockedTags.push(tag);
  }
  const blocked = blockedTags.length;
  const unknown = unknownTags.length;
  let offering: LzBaselineOfferingVerdict;
  if (tagsOffered.length === 0) offering = 'READY';
  else if (blocked > 0) offering = 'BLOCKED';
  else if (unknown > 0) offering = 'NEEDS_VERIFICATION';
  else offering = 'READY_WITH_CHANGES'; // offered, but enforcement is tenant configuration
  const detail = tagsOffered.length === 0
    ? 'no service of applies_to offered in scope'
    : `${plural(tagsOffered.length, 'capability', 'capabilities')} offered: ${tagsOffered.length - blocked - unknown} with ${minCustody} key custody or stronger in the catalogue, ${blocked} without${blocked > 0 ? ` (${blockedTags.join(', ')})` : ''}, ${unknown} without custody data${unknown > 0 ? ` (${unknownTags.join(', ')})` : ''}; tenant encryption settings not collected`;
  return { offering, estate: 'unverified', observability: 'catalogue', detail };
}

/**
 * #3936 (Design 123 sections 5.4, 8.1): `budget_alerts` from
 * `estate.posture.budgets`. A budget alerts when one of its alerts is not
 * disabled and has at least one recipient (counted, never named). Pass when a
 * budget of the scope alerts; fail when the block was read and none does;
 * unverified when the recipients were not read or a partial read found none
 * (the unread part may hold the budget). `required: false` makes the policy
 * informational (na). Budgets are tenant configuration, so the offering
 * follows the estate as for the audit trail.
 */
function evalBudgetAlerts(scan: LzLiveScan, required: boolean, provider: string): Outcome {
  const toOutcome = (estate: LzLiveCheckStatus, observability: LzLiveObservability, detail: string): Outcome => ({
    offering: estate === 'pass' || estate === 'na' ? 'READY' : estate === 'fail' ? 'READY_WITH_CHANGES' : 'NEEDS_VERIFICATION',
    estate, observability, detail,
  });
  const block = scan.estate.posture?.budgets;
  if (!block) return unverifiedKind(provider, 'budget_alerts');
  if (block.source.status !== 'ok') {
    return toOutcome('unverified', 'not_collected', `budgets not collected (${block.source.http_status !== undefined ? `HTTP ${block.source.http_status}` : block.source.reason ?? 'not collected'})`);
  }
  const budgets = block.items;
  const live = (a: (typeof budgets)[number]['alerts'][number]): boolean => a.enabled !== false;
  const alerting = budgets.filter((b) => b.alerts.some((a) => live(a) && (a.recipients ?? 0) > 0));
  const unknown = budgets.filter((b) => !alerting.includes(b) && b.alerts.some((a) => live(a) && a.recipients === undefined));
  const summary = `${plural(budgets.length, 'budget')}, ${alerting.length} with an alert that has a recipient`;
  if (!required) return toOutcome('na', 'observed', `budget alerts not required; ${summary}`);
  if (alerting.length > 0) return toOutcome('pass', 'observed', summary);
  if (unknown.length > 0) return toOutcome('unverified', 'not_collected', `${summary}; the recipients of ${plural(unknown.length, 'budget')} were not read`);
  if (block.source.partial) return toOutcome('unverified', 'not_collected', `${summary}; the budget read was partial`);
  return toOutcome('fail', 'observed', budgets.length === 0 ? 'no budget in scope' : `${summary}: no budget alert reaches a recipient`);
}

function unverifiedKind(provider: string, kind: PolicyKind): Outcome {
  const observability = observabilityWithoutEvidence(provider, kind);
  return {
    offering: 'NEEDS_VERIFICATION',
    estate: 'unverified',
    observability,
    detail: observability === 'not_observable'
      ? 'not observable from live read-only data; manual evidence item'
      : `not collected by the ${provider} driver yet (read-only collector pending)`,
  };
}

/** The resource inventory source of the scan when it was not collected (scan.ts `inventory:resources`). */
function inventoryGap(scan: LzLiveScan): string | null {
  const s = scan.meta.sources.find((x) => x.name === 'inventory:resources' && x.status === 'not_collected');
  if (!s) return null;
  return s.http_status !== undefined ? `HTTP ${s.http_status}` : s.reason ?? 'not collected';
}

// #3871 posture: the applies_to kinds and exposure cross-check the inventory for collector gaps, so they need it too.
const RESOURCE_BASED: ReadonlySet<PolicyKind> = new Set(['region_residency', 'service_deny', 'service_allow_list', 'min_availability_zones', 'required_tags', 'encryption_at_rest', 'encryption_in_transit', 'no_public_exposure', 'backup_configured']);

/** A resource-based estate result cannot be a pass or na when the inventory was not read (ADR-0041). */
function evaluatePolicy(p: Policy, scan: LzLiveScan, input: LzBaselineEvalInput, merged: SovereigntyRequirements | undefined, residencyAll: SovereigntyRequirements | undefined): Outcome {
  const o = evaluatePolicyKind(p, scan, input, merged, residencyAll);
  const gap = RESOURCE_BASED.has(p.kind) ? inventoryGap(scan) : null;
  if (gap !== null && (o.estate === 'pass' || o.estate === 'na' || o.estate === 'warn')) {
    return { ...o, estate: 'unverified', observability: 'not_collected', detail: `resource inventory not collected (${gap}); ${o.detail}` };
  }
  return o;
}

function evaluatePolicyKind(p: Policy, scan: LzLiveScan, input: LzBaselineEvalInput, merged: SovereigntyRequirements | undefined, residencyAll: SovereigntyRequirements | undefined): Outcome {
  const provider = scan.meta.provider;
  switch (p.kind) {
    case 'region_residency':
      return evalResidency(scan, input, residencyRequirementFor(p, merged));
    case 'service_deny':
      return evalServiceDeny(scan, p.params.capabilities ?? []);
    case 'service_allow_list':
      return evalServiceAllowList(scan, p.params.capabilities ?? []);
    case 'audit_trail':
      return evalAuditTrail(scan, p.params.all_regions ?? true, provider);
    case 'min_availability_zones':
      return evalMinAzs(scan, input, p.params.min ?? 2, residencyAll);
    case 'required_tags':
      return evalRequiredTags(scan, p.params.keys ?? []);
    case 'encryption_at_rest': {
      // Offering from the catalogue; estate from posture.encryption when it was read (#3871 posture).
      const custody = p.params.min_key_custody ?? 'customer-managed';
      const appliesTo = p.params.applies_to ?? [];
      const offering = evalEncryptionAtRestOffering(scan, input, custody, appliesTo);
      const estate = evalEncryptionAtRestEstate(scan, custody, appliesTo);
      return estate ? { ...offering, estate: estate.estate, observability: estate.observability, detail: `${estate.detail}; offering: ${offering.detail.replace('; tenant encryption settings not collected', '')}` } : offering;
    }
    // #3871 posture (Design 123 sections 5.4, 8.2a): shipped defaults when a parameter is absent (policy-baseline.yaml).
    case 'encryption_in_transit':
      return evalEncryptionInTransit(scan, p.params.min_tls_version ?? '1.2', p.params.applies_to ?? [], observabilityWithoutEvidence(provider, p.kind));
    case 'no_public_exposure':
      return evalNoPublicExposure(scan, p.params.allow_capabilities ?? []);
    case 'no_open_admin_ingress':
      return evalNoOpenAdminIngress(scan, p.params.ports ?? [22, 3389], p.params.forbidden_sources ?? ['0.0.0.0/0', '::/0']);
    case 'privileged_mfa':
      return evalPrivilegedMfa(scan, observabilityWithoutEvidence(provider, p.kind));
    case 'credential_age':
      return evalCredentialAge(scan, p.params.max_age_days ?? 90, observabilityWithoutEvidence(provider, p.kind));
    case 'log_retention':
      return evalLogRetention(scan, p.params.min_days ?? 180, observabilityWithoutEvidence(provider, p.kind));
    case 'backup_configured':
      return evalBackupConfigured(scan, p.params.applies_to ?? []);
    case 'budget_alerts':
      return evalBudgetAlerts(scan, p.params.required ?? true, provider);
    case 'documented_exit':
      return unverifiedKind(provider, p.kind);
    default: {
      const exhaustive: never = p;
      return exhaustive;
    }
  }
}

/** Capability tags a policy's check concerns (the lights join); scope-level policies have none. */
function policyServiceDeps(p: Policy): string[] {
  switch (p.kind) {
    case 'service_deny':
      return [...(p.params.capabilities ?? [])];
    case 'encryption_at_rest':
    case 'encryption_in_transit':
    case 'backup_configured':
      return [...(p.params.applies_to ?? [])];
    case 'region_residency':
    case 'service_allow_list':
    case 'no_public_exposure':
    case 'no_open_admin_ingress':
    case 'privileged_mfa':
    case 'credential_age':
    case 'audit_trail':
    case 'log_retention':
    case 'required_tags':
    case 'min_availability_zones':
    case 'budget_alerts':
    case 'documented_exit':
      return [];
    default: {
      const exhaustive: never = p;
      return exhaustive;
    }
  }
}

/**
 * Evaluate a baseline against one live scope (Design 123 section 8.1). The
 * residency policies use the union of the sovereignty declarations of every
 * selected framework (D-11), restricted per policy to the keys it sets.
 */
export function evaluateLzBaseline(scan: LzLiveScan, input: LzBaselineEvalInput): LzBaselineEvalOutput {
  const merged = deriveSovereigntyRequirements([...input.sovereigntyDecls]);
  const residencyAll = merged
    ? {
        ...(merged.require_residency_country ? { require_residency_country: merged.require_residency_country } : {}),
        ...(merged.require_operator_jurisdiction ? { require_operator_jurisdiction: merged.require_operator_jurisdiction } : {}),
        ...(merged.forbid_exposure && merged.forbid_exposure.length > 0 ? { forbid_exposure: merged.forbid_exposure } : {}),
        ...(merged.require_certifications ? { require_certifications: merged.require_certifications } : {}),
      }
    : undefined;
  const checks: LzLiveCheck[] = [];
  const definitions: LzLiveCheckDefinition[] = [];
  const policies: LzBaselinePolicyResult[] = [];
  for (const p of input.baseline.policies) {
    if (p.state !== 'enabled') continue;
    const control = input.controls.get(p.control);
    const severity = baselineCheckSeverity(control?.severity_default);
    const o = evaluatePolicy(p, scan, input, merged, residencyAll);
    checks.push({
      id: p.id,
      title: control?.title ?? p.id,
      controls: [p.control],
      status: o.estate,
      observability: o.observability,
      detail: o.detail,
    });
    definitions.push({ id: p.id, severity, service_dep_codes: policyServiceDeps(p), framework: input.framework });
    policies.push({ id: p.id, kind: p.kind, category: p.category, control: p.control, severity, offering: o.offering, estate: o.estate, observability: o.observability, detail: o.detail, default_source: p.default_source });
  }
  const result: LzBaselineResult = {
    schema: LZ_BASELINE_RESULT_SCHEMA,
    lz_id: scan.meta.lz_id,
    scope_id: scan.meta.scope_id,
    provider: scan.meta.provider,
    framework: input.framework,
    baseline_of: input.baseline.baseline_of,
    catalogue_version: input.baseline.catalogue_version,
    sha256: input.sha256,
    overall: baselineOverallVerdict(policies.map((p) => p.offering)),
    policies,
    not_reviewed: input.baseline.policies.filter((p) => p.state === 'not_set').map((p) => ({ id: p.id, kind: p.kind, params: { ...(p.params as Record<string, unknown>) }, default_source: p.default_source })),
    disabled: input.baseline.policies.filter((p) => p.state === 'disabled').map((p) => p.id),
    requirement_provenance: sovereigntyRequirementProvenance(input.sovereigntyDecls),
  };
  return { checks, definitions, result };
}

/**
 * App fit (Design 123 sections 8.2 and 8.4, D-12): the needed capabilities an
 * enabled service_deny policy forbids, with the policy id. Used by computeLzFit
 * to give BLOCKED_BY_POLICY with evidence `baseline:<policy-id>`.
 */
export function baselineServiceDenies(baseline: PolicyBaseline): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of baseline.policies) {
    if (p.state !== 'enabled' || p.kind !== 'service_deny') continue;
    for (const c of p.params.capabilities ?? []) if (!out.has(c)) out.set(c, p.id);
  }
  return out;
}

/** Controls of a baseline's controls.yaml (title, severity_default) by id; empty when unreadable. */
export function readBaselineControls(frameworkDir: string): Map<string, LzBaselineControl> {
  const out = new Map<string, LzBaselineControl>();
  try {
    const raw = yamlLoad(readFileSync(join(frameworkDir, 'controls.yaml'), 'utf-8')) as { controls?: unknown } | null;
    const list = Array.isArray(raw?.controls) ? (raw.controls as unknown[]) : [];
    const severities: readonly string[] = ['critical', 'high', 'medium', 'low', 'informational'];
    for (const c of list) {
      if (!c || typeof c !== 'object') continue;
      const rec = c as Record<string, unknown>;
      if (typeof rec['id'] !== 'string') continue;
      const sev = rec['severity_default'];
      out.set(rec['id'], {
        title: typeof rec['title'] === 'string' ? rec['title'] : rec['id'],
        ...(typeof sev === 'string' && severities.includes(sev) ? { severity_default: sev as ControlSeverity } : {}),
      });
    }
  } catch { /* unreadable controls.yaml: titles fall back to the policy id */ }
  return out;
}
