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

import {
  regionFulfills,
  scanFulfills,
  type LzRegion,
  type LzScanResult,
} from '@swao/core';

/**
 * LZ fit/gap engine (Design 056 Layer C, #0567) -- the headline deliverable.
 * Joins the app's REQUIRED services x the catalogue region's AVAILABLE services
 * x the customer LZ scan's ENABLED services, and produces a per-capability
 * verdict + an overall LZ-fit verdict + remediation.
 *
 * Sovereignty is framework-driven (D-LZ-07): the caller derives
 * `sovereigntyRequirements` from the installed community frameworks'
 * sovereignty-relevant controls and passes them in. This engine hardcodes NO
 * sovereignty tiers -- it only checks the region's facts against the
 * caller-supplied (framework-derived) requirements.
 */

export type LzFitVerdict =
  | 'SUPPORTED'
  | 'AVAILABLE_NOT_ENABLED'
  | 'MISCONFIGURED'
  | 'NOT_AVAILABLE_IN_REGION'
  | 'VERSION_MISMATCH'
  | 'CAPABILITY_MISSING'
  | 'SOVEREIGNTY_GAP';

export type LzOverallVerdict = 'READY' | 'READY_WITH_CHANGES' | 'NEEDS_VERIFICATION' | 'BLOCKED' | 'SOVEREIGNTY_BLOCKED';

export interface LzRequiredService {
  /** Abstract capability key the app needs (the `service_dep:<key>` token,
   *  e.g. "kubernetes"). Matched against catalogue/scan `fulfills`. */
  code: string;
  /** Human label (from the app assessment). */
  label?: string;
  /** Signal id that demanded it (provenance back to the app WSP). */
  signalId?: string;
}

/** Framework-derived sovereignty requirements (NOT hardcoded; from active frameworks). */
export interface SovereigntyRequirements {
  /** Exposure facts that must be ABSENT, e.g. ["us_cloud_act", "fisa_702"]. */
  forbid_exposure?: string[];
  /** Operator jurisdictions that are acceptable, e.g. ["EU-entity"]. */
  require_operator_jurisdiction?: string[];
  /** Residency countries/groupings that are acceptable, e.g. ["DE", "EU"]. */
  require_residency_country?: string[];
  /** Attestations the region must hold, e.g. ["HIPAA", "BSI_C5"]. All listed
   *  certifications must be present (AND semantics). */
  require_certifications?: string[];
  /** Frameworks that produced these requirements (for the report statement). */
  derived_from?: string[];
  /** Capability codes that must appear in the required-services scope regardless
   *  of what the app's INV signals detected (e.g. ["key_vault"] from GDPR).
   *  Injected by assembleLzCatalogWsp before the fit engine runs (#1353). */
  required_services?: string[];
}

export interface LzFitItem {
  service_code: string;
  label?: string;
  signalId?: string;
  verdict: LzFitVerdict;
  detail: string;
  remediation?: string;
}

export interface LzFitReport {
  provider: string;
  region: string;
  overall: LzOverallVerdict;
  /** #1118/#1511: 'catalogue-sovereignty-only' when no service signals present;
   *  'partial' when some baseline services are missing; 'full' when all baseline
   *  categories (compute/network/kms/storage) have been checked. */
  assessment_mode: 'catalogue-sovereignty-only' | 'partial' | 'full';
  /** #1241: false when sovereigntyRequirements was not provided (e.g. DEMO framework run).
   *  A READY verdict with sovereignty_active=false means no sovereignty gates were exercised. */
  sovereignty_active: boolean;
  /** #1246: classifies the blocking reason; present only when overall === 'SOVEREIGNTY_BLOCKED'. */
  blocker_category?: 'structural' | 'certification' | 'mixed';
  items: LzFitItem[];
  sovereignty_statement: string;
  generated_at: string;
  /** #1244: present when the assessed service inventory is missing one or more baseline
   *  categories (compute/network/kms/storage). Warning is additive -- verdict is unchanged. */
  coverage_warning?: string;
  /** #1591: framework IDs that contributed sovereignty requirements (derived_from on
   *  SovereigntyRequirements). Used to filter compliance_regime_coverage in the HTML report. */
  selected_frameworks?: string[];
}

export interface LzFitInput {
  requiredServices: LzRequiredService[];
  region: LzRegion;
  scan: LzScanResult;
  sovereigntyRequirements?: SovereigntyRequirements;
  generatedAt?: string;
  /** True when assessing against a CSP catalogue (no customer LZ snapshot).
   *  A service available in the region catalogue is treated as a positive
   *  match (SUPPORTED) -- the customer has not deployed the LZ yet, so there
   *  is nothing "not enabled" to remediate.  AVAILABLE_NOT_ENABLED is only
   *  appropriate when assessing against a customer-deployed LZ scan where the
   *  service genuinely needs to be provisioned. */
  catalogueMode?: boolean;
}

// Baseline service categories every production deployment is expected to cover.
// A service code matches a category if any pattern is a substring of the code (case-insensitive).
const BASELINE_CATEGORIES: Array<{ name: string; patterns: string[] }> = [
  { name: 'compute', patterns: ['compute', 'kubernetes', 'k8s', 'vm', 'container', 'function', 'lambda', 'serverless', 'ecs', 'aks', 'gke', 'app-service', 'cloud-run', 'worker'] },
  { name: 'network', patterns: ['network', 'vpc', 'vnet', 'transit', 'vpn', 'load-balancer', 'firewall', 'cdn', 'dns', 'routing', 'peering'] },
  { name: 'kms', patterns: ['kms', 'key-management', 'key_management', 'hsm', 'vault', 'secrets', 'key-vault', 'secret-manager', 'keyvault', 'crypto'] },
  { name: 'storage', patterns: ['storage', 'object-storage', 'object_storage', 's3', 'blob', 'gcs', 'backup', 'filesystem', 'disk', 'volume'] },
];

/** Returns a coverage_warning string when the service list is missing one or more baseline
 *  categories (compute, network, kms, storage). Returns undefined when all are covered. */
export function detectCoverageGap(services: LzRequiredService[]): string | undefined {
  const codes = services.map((s) => s.code.toLowerCase());
  const missing = BASELINE_CATEGORIES.filter(
    (cat) => !codes.some((code) => cat.patterns.some((p) => code.includes(p))),
  ).map((cat) => cat.name);

  if (missing.length === 0) return undefined;
  return (
    `service footprint incomplete -- ${services.length} service(s) assessed, ` +
    `baseline requires compute/network/kms/storage (missing: ${missing.join(', ')})`
  );
}

/** Evaluate a region's sovereignty facts against framework-derived requirements.
 *  Returns the failing reasons (empty = passes). */
export function sovereigntyFailures(region: LzRegion, req?: SovereigntyRequirements): string[] {
  if (!req) return [];
  const facts = region.sovereignty;
  const fails: string[] = [];
  const exposure = facts?.extraterritorial_exposure ?? [];
  for (const forbidden of req.forbid_exposure ?? []) {
    if (exposure.includes(forbidden)) fails.push(`exposed to ${forbidden}`);
  }
  if (req.require_operator_jurisdiction && req.require_operator_jurisdiction.length > 0) {
    const j = facts?.operator_jurisdiction;
    if (!j || !req.require_operator_jurisdiction.includes(j)) {
      fails.push(`operator jurisdiction ${j ?? 'unknown'} not in [${req.require_operator_jurisdiction.join(', ')}]`);
    }
  }
  if (req.require_residency_country && req.require_residency_country.length > 0) {
    const c = facts?.residency_country;
    if (!c || !req.require_residency_country.includes(c)) {
      fails.push(`residency ${c ?? 'unknown'} not in [${req.require_residency_country.join(', ')}]`);
    }
  }
  if (req.require_certifications && req.require_certifications.length > 0) {
    const held = facts?.certifications ?? [];
    for (const cert of req.require_certifications) {
      if (!held.includes(cert)) {
        fails.push(`certification ${cert} not held (has: [${held.join(', ') || 'none'}])`);
      }
    }
  }
  return fails;
}

export function computeLzFit(input: LzFitInput): LzFitReport {
  const { region, scan, sovereigntyRequirements: sov, catalogueMode = false } = input;
  const sovFails = sovereigntyFailures(region, sov);
  const items: LzFitItem[] = [];

  for (const req of input.requiredServices) {
    const available = regionFulfills(region, req.code);
    const enabled   = scanFulfills(scan, req.code);
    const base = { service_code: req.code, label: req.label, signalId: req.signalId };

    if (!available) {
      // Distinguish qualifier mismatch (base service present, qualifier fails) from true absence.
      const atIdx = req.code.indexOf('@');
      const plusIdx = req.code.indexOf('+');
      const hasQualifier = atIdx !== -1 || plusIdx !== -1;
      const basePresent = hasQualifier && regionFulfills(region, atIdx !== -1
        ? req.code.slice(0, atIdx)
        : req.code.slice(0, plusIdx));
      if (hasQualifier && basePresent) {
        const isVersionQualifier = atIdx !== -1;
        items.push({ ...base,
          verdict: isVersionQualifier ? 'VERSION_MISMATCH' : 'CAPABILITY_MISSING',
          detail: isVersionQualifier
            ? `${req.code.slice(0, atIdx)} is available in ${region.id} but does not meet the minimum version requirement (${req.code}).`
            : `${req.code.slice(0, plusIdx)} is available in ${region.id} but the required capability (${req.code.slice(plusIdx + 1)}) is not supported.`,
          remediation: isVersionQualifier
            ? `Upgrade the ${req.code.slice(0, atIdx)} service to a version that satisfies ${req.code}.`
            : `Enable the ${req.code.slice(plusIdx + 1)} capability on ${req.code.slice(0, plusIdx)} in this region.`,
        });
      } else {
        items.push({ ...base, verdict: 'NOT_AVAILABLE_IN_REGION',
          detail: `${req.code} is not offered in ${region.id}.`,
          remediation: `Choose an alternative service, a region that offers ${req.code}, or accept a sovereignty trade-off.` });
      }
    } else if (sovFails.length > 0) {
      items.push({ ...base, verdict: 'SOVEREIGNTY_GAP',
        detail: `${req.code} is available in ${region.id} but the region fails sovereignty requirements: ${sovFails.join('; ')}.`,
        remediation: `Select a region/provider whose sovereignty facts satisfy the active frameworks (${(sov?.derived_from ?? []).join(', ') || 'installed frameworks'}).` });
    } else if (!catalogueMode && !enabled) {
      // Real customer LZ scan: service is in the catalogue but not provisioned
      // in the deployed landing zone -- operator must enable it.
      items.push({ ...base, verdict: 'AVAILABLE_NOT_ENABLED',
        detail: `${req.code} is available in ${region.id} but not enabled/provisioned in the scanned LZ.`,
        remediation: `Enable + configure ${req.code} in the landing zone.` });
    } else {
      // Catalogue mode: available in the CSP region catalogue = positive match.
      // Custom LZ mode: available and enabled in the deployed LZ.
      items.push({ ...base, verdict: 'SUPPORTED',
        detail: catalogueMode
          ? `${req.code} is offered in ${region.id} -- available for provisioning.`
          : `${req.code} is available and provisioned.` });
    }
  }

  // Coverage gap must be computed before finalising the overall verdict so that
  // NEEDS_VERIFICATION escalation can reference it (#1506/#1511).
  const coverageWarning = detectCoverageGap(input.requiredServices);

  // Overall verdict: sovereignty gap dominates, then hard unavailability, then changes.
  // #1106: check sovFails directly so SOVEREIGNTY_BLOCKED fires even when requiredServices
  // is empty (catalogue-only run with no prior app assessment produces items:[]).
  let overall: LzOverallVerdict = 'READY';
  if (items.some((i) => i.verdict === 'SOVEREIGNTY_GAP')) overall = 'SOVEREIGNTY_BLOCKED';
  else if (sov && sovFails.length > 0) overall = 'SOVEREIGNTY_BLOCKED';
  else if (items.some((i) => i.verdict === 'NOT_AVAILABLE_IN_REGION' || i.verdict === 'VERSION_MISMATCH' || i.verdict === 'CAPABILITY_MISSING')) overall = 'BLOCKED';
  else if (items.some((i) => i.verdict === 'AVAILABLE_NOT_ENABLED' || i.verdict === 'MISCONFIGURED')) overall = 'READY_WITH_CHANGES';

  // #1506/#1511: a READY verdict without positive service evidence is misleading.
  // Escalate to NEEDS_VERIFICATION when:
  //  - no service checks ran at all (catalogue-sovereignty-only mode); OR
  //  - one or more baseline service categories (compute/network/kms/storage) are absent.
  if (overall === 'READY' && (items.length === 0 || coverageWarning !== undefined)) {
    overall = 'NEEDS_VERIFICATION';
  }

  // #1117: catalogue-only scope caveat appended to READY statements so the verdict is
  // not misread as a full production sign-off. #1118: assessment_mode field added.
  const catalogueOnly = items.length === 0;
  const catalogueCaveat = catalogueOnly
    ? ' Catalogue-only assessment: service-fit and deployed operational controls not evaluated.'
    : '';
  const sovStatement = sov
    ? (sovFails.length === 0
        ? `Region ${region.id} satisfies the sovereignty requirements derived from ${(sov.derived_from ?? []).join(', ') || 'the active frameworks'}.${catalogueCaveat}`
        : `Region ${region.id} FAILS sovereignty requirements (${sovFails.join('; ')}) derived from ${(sov.derived_from ?? []).join(', ') || 'the active frameworks'}.`)
    : 'No sovereignty requirements were active for the selected frameworks. To enable sovereignty gate evaluation, select a framework that declares sovereignty requirements (such as BSI_C5, GDPR, or NIST_SP_800_66R2) and ensure it is installed in the workspace community catalog.';

  // #1246: classify the blocking reason when SOVEREIGNTY_BLOCKED.
  // Split the existing sovFails into structural (exposure/jurisdiction) vs certification buckets.
  let blocker_category: 'structural' | 'certification' | 'mixed' | undefined;
  if (overall === 'SOVEREIGNTY_BLOCKED' && sov) {
    const structFails = sovereigntyFailures(region, {
      forbid_exposure: sov.forbid_exposure,
      require_operator_jurisdiction: sov.require_operator_jurisdiction,
      require_residency_country: sov.require_residency_country,
    });
    const certFails = sovereigntyFailures(region, { require_certifications: sov.require_certifications });
    const hasStruct = structFails.length > 0;
    const hasCert = certFails.length > 0;
    blocker_category = hasStruct && hasCert ? 'mixed' : hasCert ? 'certification' : 'structural';
  }

  return {
    provider: scan.provider,
    region: region.id,
    overall,
    assessment_mode: catalogueOnly ? 'catalogue-sovereignty-only' : coverageWarning ? 'partial' : 'full',
    sovereignty_active: sov !== undefined,
    ...(blocker_category ? { blocker_category } : {}),
    items,
    sovereignty_statement: sovStatement,
    generated_at: input.generatedAt ?? new Date().toISOString().slice(0, 10),
    ...(coverageWarning ? { coverage_warning: coverageWarning } : {}),
    ...(sov?.derived_from?.length ? { selected_frameworks: sov.derived_from } : {}),
  };
}
