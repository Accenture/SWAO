// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module -- live evaluation engine (Design 120 section 8.3, #3579)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Evaluates one LzLiveScan per (service, framework) and fills
// `offering.services[].frameworks` with a light (Design 120 section 8.3).
// Pure: the caller resolves the frameworks (lz-live-frameworks.ts), the
// catalogue region facts and the baseline check catalogue
// (`controls/landing-zone-checks-catalogue.yaml`) and passes them in, so this
// module needs no file access and no dependency on module-app-assessment.
//
// Precedence of the lights (Design 120 section 8.3, decided with #3579):
//   n/a    every mapped relevance of the service's tags is n/a
//   red    sovereignty failure in an offered region, or an open
//          critical / high / medium finding on the service
//   grey   no mapping for any of the service's capability tags
//   amber  only low findings or unverified checks (#3864: never a pass,
//          ADR-0041); IaC level not full; only `derived` mapping rows
//          (unreviewed, Q-23); sovereignty not evaluable; not enabled in any
//          region of the scope
//   green  everything else
// Red comes before grey so that a known sovereignty failure is not shown as a
// mapping gap. Findings count only for mapped services (the control layer).

import {
  serviceMappingStatus,
  type LzLiveCheckStatus,
  type LzLiveScan,
  type LzLiveService,
  type LzRegion,
  type ServiceControlMapping,
  type ServiceControls,
} from '@swao/core';
import { sovereigntyFailures } from '../fit/lz-fit.js';
import { deriveSovereigntyRequirements, type FrameworkSovereigntyDecl } from '../fit/orchestrate-lz.js';

export type LzLiveLight = 'red' | 'amber' | 'green' | 'grey' | 'n/a';

/** Minimal structural view of a baseline check from
 *  `controls/landing-zone-checks-catalogue.yaml` (the `LzrCheck` type of
 *  module-app-assessment satisfies it). */
export interface LzLiveCheckDefinition {
  id: string;
  severity: 'blocker' | 'warning' | 'info';
  /** Capability tags a check concerns; a check without them is scope-level. */
  service_dep_codes?: string[];
  /** #3871: framework column the check belongs to (a Client LZ Policy Baseline
   *  check, Design 123 section 8.2); absent for catalogue checks, which apply
   *  to every framework column. */
  framework?: string;
}

/** One framework selected for the run (lz-live-frameworks.ts). */
export interface LzLiveEvalFramework {
  id: string;
  version: string;
  /** Combined sha256 of the framework files (see lz-live-frameworks.ts). */
  sha256: string;
  /** `service-controls.yaml`; null when the framework has none (every service grey). */
  mapping: ServiceControls | null;
  sovereignty_requirements?: FrameworkSovereigntyDecl['sovereignty_requirements'];
  /** #4050: framework folder in the workspace community catalogue (controls.yaml for the organisational controls). */
  dir?: string;
}

export interface LzLiveEvalInput {
  frameworks: readonly LzLiveEvalFramework[];
  /** Catalogue region facts by region id (sovereignty block), for the sovereignty layer. */
  regions: ReadonlyMap<string, LzRegion>;
  /** Baseline checks of the catalogue (no second check set, Design 120 section 7.3). */
  checks: readonly LzLiveCheckDefinition[];
}

export type LzLiveFindingSeverity = 'high' | 'medium' | 'low';

/** Check statuses that are a finding (#3864: `unverified` too, it never counts as a pass). */
export type LzLiveFindingStatus = Exclude<LzLiveCheckStatus, 'pass' | 'na'>;

/** A failing, warning or unverified check that hits no single service (no `service_dep_codes`). */
export interface LzLiveScopeFinding {
  check_id: string;
  status: LzLiveFindingStatus;
  severity: LzLiveFindingSeverity;
  /** #3871: framework the finding belongs to; absent for catalogue checks. */
  framework?: string;
}

export interface LzLiveEvalResult {
  scan: LzLiveScan;
  /** `estate.checks[].id` values that are not in the check catalogue; never used for a light. */
  unknown_checks: string[];
  scope_findings: LzLiveScopeFinding[];
}

/** Catalogue severity to finding severity; same mapping as Pass 23
 *  (`pass-23-lzr.ts`: blocker = high, warning = medium); info = low. */
export const LZ_LIVE_CHECK_SEVERITY: Record<LzLiveCheckDefinition['severity'], LzLiveFindingSeverity> = {
  blocker: 'high',
  warning: 'medium',
  info: 'low',
};

interface ServiceFinding { check_id: string; status: LzLiveFindingStatus; severity: LzLiveFindingSeverity; framework?: string }

/** Severity of one check result: a `fail` takes the catalogue severity, a
 *  `warn` is low, an `unverified` is low (#3864, Design 123 section 5.3: it
 *  never counts as a pass, so the service cannot be green, but missing
 *  evidence is not a failure); `pass` and `na` are no finding. */
export function findingSeverity(status: LzLiveCheckStatus, def: LzLiveCheckDefinition): LzLiveFindingSeverity | null {
  switch (status) {
    case 'fail': return LZ_LIVE_CHECK_SEVERITY[def.severity];
    case 'warn':
    case 'unverified': return 'low';
    case 'pass':
    case 'na': return null;
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

/** Light of one service for one framework (Design 120 section 8.3). */
export function lzLiveServiceLight(
  service: LzLiveService,
  framework: LzLiveEvalFramework,
  regions: ReadonlyMap<string, LzRegion>,
  findings: readonly ServiceFinding[],
): { light: LzLiveLight; controls: string[]; detail: string } {
  const tags = service.capability_tags;
  const mappingState = serviceMappingStatus(framework.mapping, tags);
  const byTag = new Map((framework.mapping?.mappings ?? []).map((m) => [m.capability, m] as const));
  const applicable = tags.map((t) => byTag.get(t))
    .filter((m): m is ServiceControlMapping => m !== undefined && m.relevance !== 'n/a');
  const controls = [...new Set(applicable.flatMap((m) => m.controls))].sort();

  if (mappingState === 'n/a') {
    return { light: 'n/a', controls: [], detail: `${framework.id} does not apply to the capability tags of this service` };
  }

  // Sovereignty layer: offered regions (enabled or available_not_enabled).
  const req = deriveSovereigntyRequirements([{ id: framework.id, sovereignty_requirements: framework.sovereignty_requirements }]);
  const offered = Object.entries(service.regions)
    .filter(([, s]) => s.status === 'enabled' || s.status === 'available_not_enabled')
    .map(([r]) => r)
    .sort();
  const sovFails: string[] = [];
  const sovUnknown: string[] = [];
  if (req) {
    for (const r of offered) {
      const facts = regions.get(r);
      // Absent facts are "not evaluable", never a pass and never a failure
      // (sovereigntyFailures would pass a forbid_exposure-only framework).
      if (!facts?.sovereignty) { sovUnknown.push(r); continue; }
      for (const f of sovereigntyFailures(facts, req)) sovFails.push(`${r}: ${f}`);
    }
  }
  if (sovFails.length > 0) {
    return { light: 'red', controls, detail: `sovereignty failure (${sovFails.join('; ')})` };
  }

  if (mappingState === 'grey') {
    const what = tags.length === 0 ? 'service has no capability tags' : `no ${framework.id} mapping for ${tags.join(', ')}`;
    return { light: 'grey', controls: [], detail: what };
  }

  const open = findings.filter((f) => f.severity === 'high' || f.severity === 'medium');
  if (open.length > 0) {
    return { light: 'red', controls, detail: `open finding ${open.map((f) => `${f.check_id} (${f.severity})`).join(', ')}` };
  }

  const amber: string[] = [];
  const low = findings.filter((f) => f.severity === 'low' && f.status !== 'unverified');
  if (low.length > 0) amber.push(`low finding ${low.map((f) => f.check_id).join(', ')}`);
  const unverified = findings.filter((f) => f.status === 'unverified');
  if (unverified.length > 0) amber.push(`unverified ${unverified.map((f) => f.check_id).join(', ')}`);
  // IaC level n/a means IaC does not apply to the service, so it cannot fall short.
  const iacLevel = service.iac?.level;
  if (iacLevel === undefined) amber.push('IaC level not determined');
  else if (iacLevel !== 'full' && iacLevel !== 'n/a') amber.push(`IaC level ${iacLevel}`);
  if (!applicable.some((m) => m.confidence === 'curated')) amber.push('mapping not reviewed (confidence derived)');
  if (req && offered.length === 0) amber.push('sovereignty not evaluable (no offered region)');
  if (sovUnknown.length > 0) amber.push(`sovereignty facts missing for ${sovUnknown.join(', ')}`);
  if (!Object.values(service.regions).some((s) => s.status === 'enabled')) amber.push('not enabled in any region of this scope');

  if (amber.length > 0) return { light: 'amber', controls, detail: amber.join('; ') };
  return { light: 'green', controls, detail: 'controls mapped, no open finding, IaC full, sovereignty passes' };
}

/**
 * Evaluate every service of a live scan for every selected framework and stamp
 * the frameworks into `meta.frameworks` (Design 120 sections 7.3, 8.1, 8.3).
 * Returns a new scan; the input is not modified.
 */
export function evaluateLzLiveScan(scan: LzLiveScan, input: LzLiveEvalInput): LzLiveEvalResult {
  const defs = new Map(input.checks.map((c) => [c.id, c] as const));
  const unknown = new Set<string>();
  const scopeFindings: LzLiveScopeFinding[] = [];
  const attributed: { tags: Set<string>; finding: ServiceFinding }[] = [];

  for (const check of scan.estate.checks) {
    const def = defs.get(check.id);
    if (!def) { unknown.add(check.id); continue; }
    const status = check.status;
    if (status === 'pass' || status === 'na') continue;
    const severity = findingSeverity(status, def);
    if (severity === null) continue;
    const deps = def.service_dep_codes ?? [];
    const scoped = def.framework !== undefined ? { framework: def.framework } : {};
    if (deps.length === 0) {
      scopeFindings.push({ check_id: check.id, status, severity, ...scoped });
    } else {
      attributed.push({ tags: new Set(deps), finding: { check_id: check.id, status, severity, ...scoped } });
    }
  }

  const services = scan.offering.services.map((service) => {
    const findings = attributed
      .filter((a) => service.capability_tags.some((t) => a.tags.has(t)))
      .map((a) => a.finding);
    const frameworks: LzLiveService['frameworks'] = {};
    for (const fw of input.frameworks) {
      // #3871: a framework-scoped check (baseline policy) colours only its own column.
      const own = findings.filter((f) => f.framework === undefined || f.framework === fw.id);
      frameworks[fw.id] = lzLiveServiceLight(service, fw, input.regions, own);
    }
    return { ...service, frameworks };
  });

  return {
    scan: {
      ...scan,
      meta: { ...scan.meta, frameworks: input.frameworks.map((f) => ({ id: f.id, version: f.version, sha256: f.sha256 })) },
      offering: { ...scan.offering, services },
    },
    unknown_checks: [...unknown].sort(),
    scope_findings: scopeFindings,
  };
}
