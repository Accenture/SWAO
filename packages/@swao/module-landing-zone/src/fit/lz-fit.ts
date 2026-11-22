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
  lzLiveStatusesForRegion,
  projectLzLiveScan,
  regionFulfills,
  scanFulfills,
  type LzLiveScan,
  type LzLiveStatus,
  type LzRegion,
  type LzRequirementProvenance,
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
  | 'SOVEREIGNTY_GAP'
  /** Design 120 section 5.3 (#3569): the tenant's governance (SCP, Azure Policy,
   *  org policy) denies use of the service itself. Hard blocker; distinct from
   *  MISCONFIGURED (enabled, but the configuration conflicts with guardrails). */
  | 'BLOCKED_BY_POLICY'
  /** Design 120 section 5.3 (#3569): the live scope cannot tell (missing
   *  permission, API error, expired token). Not a blocker; the overall verdict
   *  escalates to NEEDS_VERIFICATION. */
  | 'UNVERIFIED';

export type LzOverallVerdict = 'READY' | 'READY_WITH_CHANGES' | 'NEEDS_VERIFICATION' | 'BLOCKED' | 'SOVEREIGNTY_BLOCKED';

export interface LzRequiredService {
  /** Abstract capability key the app needs (the `service_dep:<key>` token,
   *  e.g. "kubernetes"). Matched against catalogue/scan `fulfills`. */
  code: string;
  /** Human label (from the app assessment). */
  label?: string;
  /** Signal id that demanded it (provenance back to the app WSP). */
  signalId?: string;
  /** #3430: confidence of the demanding signal; low = documentation only (service footprint). */
  confidence?: 'high' | 'medium' | 'low';
  /** #3430: evidence paths behind the requirement (build file, manifest, document). */
  evidence?: string[];
}

/** #3430: app required services (core deriveConstraints) to fit inputs, provenance included. */
export function toLzRequiredServices(
  required: ReadonlyArray<{ name: string; signalId: string; confidence?: 'high' | 'medium' | 'low'; evidence?: string[] }>,
): LzRequiredService[] {
  return required.map((s) => ({
    code: s.name,
    signalId: s.signalId,
    ...(s.confidence ? { confidence: s.confidence } : {}),
    ...(s.evidence && s.evidence.length > 0 ? { evidence: s.evidence } : {}),
  }));
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
  /** #3430: provenance of the requirement (copied from LzRequiredService). */
  confidence?: 'high' | 'medium' | 'low';
  evidence?: string[];
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
  /** #3430: required services the region does not offer (NOT_AVAILABLE_IN_REGION,
   *  CAPABILITY_MISSING, VERSION_MISMATCH), in item order. Present when non-empty. */
  services_not_in_catalogue?: string[];
  /** #3920 (Design 123 section 9.3): value-level provenance of the merged
   *  sovereignty requirements (`sovereigntyRequirementProvenance`), present only
   *  when the caller passes `requirementProvenance` (an app run that selected a
   *  client policy baseline). Additive; every other fit is unchanged. */
  requirement_provenance?: LzRequirementProvenance[];
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
  /** #3609 (Design 120 section 5.3): observed live status per capability tag in
   *  `region` (`lzLiveStatusesForRegion`). A requirement with an observation is
   *  judged by the live status (`lzFitVerdictForLiveStatus`); the static
   *  catalogue and the projected scan decide only where there is none. Use
   *  `computeLzFitFromLiveScan` to fill it from an `LzLiveScan`. */
  liveStatus?: ReadonlyMap<string, LzLiveStatus>;
  /** #3871 (Design 123 sections 8.2 and 8.4, D-12): capability key to the id of the
   *  enabled Client LZ Policy Baseline service_deny policy that forbids it
   *  (`baselineServiceDenies`). A needed capability in the map is BLOCKED_BY_POLICY
   *  with the evidence string `baseline:<policy-id>`, whatever the region offers. */
  baselineDenies?: ReadonlyMap<string, string>;
  /** #3920: copied to `requirement_provenance` of the report (an empty list included). */
  requirementProvenance?: readonly LzRequirementProvenance[];
}

/** Capability key without its `@version` / `+capability` qualifier. */
function capabilityBase(code: string): string {
  const atIdx = code.indexOf('@');
  const plusIdx = code.indexOf('+');
  return atIdx !== -1 ? code.slice(0, atIdx) : plusIdx !== -1 ? code.slice(0, plusIdx) : code;
}

// Baseline service categories every production deployment is expected to cover.
// A service code matches a category if any pattern is a substring of the code (case-insensitive).
const BASELINE_CATEGORIES: Array<{ name: string; patterns: string[] }> = [
  { name: 'compute', patterns: ['compute', 'kubernetes', 'k8s', 'vm', 'container', 'function', 'lambda', 'serverless', 'ecs', 'aks', 'gke', 'app-service', 'cloud-run', 'worker'] },
  // #3430: 'load_balancer' and 'ingress' added; the catalogue code is load_balancer (underscore), which 'load-balancer' never matched.
  { name: 'network', patterns: ['network', 'vpc', 'vnet', 'transit', 'vpn', 'load-balancer', 'load_balancer', 'ingress', 'firewall', 'cdn', 'dns', 'routing', 'peering'] },
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
    // #3430: comma instead of a double dash (report output convention, CLAUDE.md 5.1).
    `service footprint incomplete, ${services.length} service(s) assessed, ` +
    `baseline requires compute/network/kms/storage (missing: ${missing.join(', ')})`
  );
}

/** Evaluate a region's sovereignty facts against framework-derived requirements.
 *  Returns the failing reasons (empty = passes). */
/**
 * Certification aliases (#3155). Catalogue refreshes and curated seeds name the
 * same attestation differently (aws, azure, and gcp record `C5`; stackit, otc,
 * and oci record `BSI_C5`; frameworks require `BSI_C5`). Keys are compared
 * upper-case with separators removed, so `ISO_27001`, `ISO-27001`, and
 * `iso 27001` also match.
 */
const CERTIFICATION_ALIASES: Record<string, string> = {
  C5: 'BSIC5',
  BSIC5: 'BSIC5',
};

/** Comparison key for a certification id: alias-resolved, upper-case, separators removed. */
export function certificationKey(id: string): string {
  const k = id.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return CERTIFICATION_ALIASES[k] ?? k;
}

/** True when `held` contains `required` or one of its aliases. */
export function holdsCertification(held: readonly string[], required: string): boolean {
  const want = certificationKey(required);
  return held.some((h) => certificationKey(h) === want);
}

/** EU member states (ISO 3166-1 alpha-2, 27 since 2020-02-01). The value `EU` in an
 *  allowed residency list accepts a region in any of them (#3871, Design 123 sections
 *  5.1 and 8.2); a region whose residency fact is the grouping `EU` itself matches `EU`. */
export const EU_MEMBER_STATES: readonly string[] = [
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU',
  'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
];

/** True when residency `country` is in `allowed`, with `EU` expanded to the member states. */
export function residencyAllowed(country: string, allowed: readonly string[]): boolean {
  if (allowed.includes(country)) return true;
  return allowed.includes('EU') && EU_MEMBER_STATES.includes(country);
}

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
    if (!c || !residencyAllowed(c, req.require_residency_country)) {
      fails.push(`residency ${c ?? 'unknown'} not in [${req.require_residency_country.join(', ')}]`);
    }
  }
  if (req.require_certifications && req.require_certifications.length > 0) {
    const held = facts?.certifications ?? [];
    for (const cert of req.require_certifications) {
      if (!holdsCertification(held, cert)) {
        fails.push(`certification ${cert} not held (has: [${held.join(', ') || 'none'}])`);
      }
    }
  }
  return fails;
}

/**
 * Item verdicts that block the landing zone (hard blockers). Shared by the
 * overall verdict below and the narrative (lz-narrative.ts), so both count the
 * same items. BLOCKED_BY_POLICY (Design 120 section 5.3, #3569) is a hard
 * blocker; UNVERIFIED is not.
 */
export const LZ_HARD_BLOCKING_VERDICTS: ReadonlySet<LzFitVerdict> = new Set<LzFitVerdict>([
  'NOT_AVAILABLE_IN_REGION',
  'VERSION_MISMATCH',
  'CAPABILITY_MISSING',
  'BLOCKED_BY_POLICY',
]);

function isHardBlocking(i: LzFitItem): boolean {
  return LZ_HARD_BLOCKING_VERDICTS.has(i.verdict);
}

/**
 * Item verdict for an observed live status (Design 120 section 5.3 table, #3569).
 * A deny on SWAO's own read call is recorded by the driver as `unknown` (never
 * `restricted`), so it maps to UNVERIFIED, not to BLOCKED_BY_POLICY.
 */
export function lzFitVerdictForLiveStatus(status: LzLiveStatus): LzFitVerdict {
  switch (status) {
    case 'enabled': return 'SUPPORTED';
    case 'available_not_enabled': return 'AVAILABLE_NOT_ENABLED';
    case 'restricted': return 'BLOCKED_BY_POLICY';
    case 'not_offered': return 'NOT_AVAILABLE_IN_REGION';
    case 'unknown': return 'UNVERIFIED';
    default: {
      const unreachable: never = status;
      throw new Error(`unhandled live status ${String(unreachable)}`);
    }
  }
}

/**
 * Overall LZ-fit verdict from the item verdicts (extracted from computeLzFit,
 * #3569; behaviour for the pre-existing verdicts unchanged). Order: sovereignty
 * gap, hard blockers (BLOCKED, or NEEDS_VERIFICATION when every hard blocker is
 * documentation-only, #3497), changes needed, then the NEEDS_VERIFICATION
 * escalations: an UNVERIFIED item (#3569), no service checks, or an incomplete
 * baseline (#1506/#1511).
 */
export function deriveLzOverallVerdict(input: {
  items: readonly LzFitItem[];
  sovereigntyActive: boolean;
  sovereigntyFailures: readonly string[];
  coverageWarning: string | undefined;
}): LzOverallVerdict {
  const { items, sovereigntyActive, sovereigntyFailures: sovFails, coverageWarning } = input;
  let overall: LzOverallVerdict = 'READY';
  if (items.some((i) => i.verdict === 'SOVEREIGNTY_GAP')) overall = 'SOVEREIGNTY_BLOCKED';
  else if (sovereigntyActive && sovFails.length > 0) overall = 'SOVEREIGNTY_BLOCKED';
  else if (items.some((i) => isHardBlocking(i) && i.confidence !== 'low')) overall = 'BLOCKED';
  // #3497: when every hard blocker is evidenced by documentation only (low
  // confidence), the requirement is unconfirmed: the overall verdict asks for
  // verification instead of blocking. Each item keeps its own verdict.
  else if (items.some(isHardBlocking)) overall = 'NEEDS_VERIFICATION';
  else if (items.some((i) => i.verdict === 'AVAILABLE_NOT_ENABLED' || i.verdict === 'MISCONFIGURED')) overall = 'READY_WITH_CHANGES';

  // #3569: a scope that cannot tell must not read as ready.
  if ((overall === 'READY' || overall === 'READY_WITH_CHANGES') && items.some((i) => i.verdict === 'UNVERIFIED')) {
    overall = 'NEEDS_VERIFICATION';
  }

  // #1506/#1511: a READY verdict without positive service evidence is misleading.
  // Escalate to NEEDS_VERIFICATION when:
  //  - no service checks ran at all (catalogue-sovereignty-only mode); OR
  //  - one or more baseline service categories (compute/network/kms/storage) are absent.
  if (overall === 'READY' && (items.length === 0 || coverageWarning !== undefined)) {
    overall = 'NEEDS_VERIFICATION';
  }
  return overall;
}

export function computeLzFit(input: LzFitInput): LzFitReport {
  const { region, scan, sovereigntyRequirements: sov, catalogueMode = false } = input;
  const sovFails = sovereigntyFailures(region, sov);
  const items: LzFitItem[] = [];

  for (const req of input.requiredServices) {
    const live = input.liveStatus?.get(capabilityBase(req.code));
    const enabled   = scanFulfills(scan, req.code);
    const base = {
      service_code: req.code, label: req.label, signalId: req.signalId,
      ...(req.confidence ? { confidence: req.confidence } : {}),
      ...(req.evidence && req.evidence.length > 0 ? { evidence: req.evidence } : {}),
    };
    // #3430: a requirement evidenced by documents only is reported, but flagged for confirmation.
    const docNote = req.confidence === 'low'
      ? ' The requirement is evidenced by documentation only (low confidence); confirm it before treating this as a blocker.'
      : '';

    // #3871 (D-12): the client baseline forbids the capability; the tenant-governance
    // meaning of BLOCKED_BY_POLICY is kept apart by the evidence prefix `baseline:`.
    const deniedBy = input.baselineDenies?.get(capabilityBase(req.code));
    if (deniedBy !== undefined) {
      items.push({ ...base, evidence: [...(req.evidence ?? []), `baseline:${deniedBy}`], verdict: 'BLOCKED_BY_POLICY',
        detail: `${req.code} is forbidden by the client policy baseline (${deniedBy}).${docNote}`,
        remediation: `Choose an alternative service, or get an approved exception and change ${deniedBy} in the baseline.` });
      continue;
    }

    // Distinguish qualifier mismatch (base service present, qualifier fails) from true absence.
    const atIdx = req.code.indexOf('@');
    const plusIdx = req.code.indexOf('+');
    const hasQualifier = atIdx !== -1 || plusIdx !== -1;
    const qualifierFails = hasQualifier && !regionFulfills(region, req.code)
      && regionFulfills(region, capabilityBase(req.code));
    const pushQualifierMismatch = (): void => {
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
    };

    if (live !== undefined) {
      // #3609: observed tenant state decides (Design 120 section 5.3). Version and
      // capability qualifiers stay catalogue-driven: the live scan carries no
      // version facts, so a qualifier the catalogue says the region cannot meet
      // is still reported for a usable service.
      const verdict = lzFitVerdictForLiveStatus(live);
      if (verdict === 'NOT_AVAILABLE_IN_REGION') {
        items.push({ ...base, verdict,
          detail: `${req.code} is not offered in ${region.id} (observed by the live scan).${docNote}`,
          remediation: `Choose an alternative service, a region that offers ${req.code}, or accept a sovereignty trade-off.` });
      } else if (sovFails.length > 0) {
        items.push({ ...base, verdict: 'SOVEREIGNTY_GAP',
          detail: `${req.code} is offered in ${region.id} but the region fails sovereignty requirements: ${sovFails.join('; ')}.`,
          remediation: `Select a region/provider whose sovereignty facts satisfy the active frameworks (${(sov?.derived_from ?? []).join(', ') || 'installed frameworks'}).` });
      } else if (qualifierFails && (verdict === 'SUPPORTED' || verdict === 'AVAILABLE_NOT_ENABLED')) {
        pushQualifierMismatch();
      } else if (verdict === 'BLOCKED_BY_POLICY') {
        items.push({ ...base, verdict,
          detail: `${req.code} is offered in ${region.id} but the tenant's governance policy denies its use in this scope (observed by the live scan).${docNote}`,
          remediation: `Ask the landing-zone owner to lift the policy restriction on ${req.code}, or choose an alternative service.` });
      } else if (verdict === 'UNVERIFIED') {
        items.push({ ...base, verdict,
          detail: `The live scan could not tell whether ${req.code} is usable in ${region.id} (missing read permission or API error).`,
          remediation: `Grant the read permission for ${req.code} to the assessment login, or confirm its status with the landing-zone owner, then re-run the scan.` });
      } else if (verdict === 'AVAILABLE_NOT_ENABLED') {
        items.push({ ...base, verdict,
          detail: `${req.code} is offered in ${region.id} but not enabled in the scanned scope (observed by the live scan).`,
          remediation: `Enable + configure ${req.code} in the landing zone.` });
      } else {
        items.push({ ...base, verdict: 'SUPPORTED',
          detail: `${req.code} is enabled in ${region.id} (observed by the live scan).` });
      }
      continue;
    }

    const available = regionFulfills(region, req.code);
    if (!available) {
      if (qualifierFails) {
        pushQualifierMismatch();
      } else {
        items.push({ ...base, verdict: 'NOT_AVAILABLE_IN_REGION',
          detail: `${req.code} is not offered in ${region.id}.${docNote}`,
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
          ? `${req.code} is offered in ${region.id}, available for provisioning.`
          : `${req.code} is available and provisioned.` });
    }
  }

  // Coverage gap must be computed before finalising the overall verdict so that
  // NEEDS_VERIFICATION escalation can reference it (#1506/#1511).
  const coverageWarning = detectCoverageGap(input.requiredServices);

  // Overall verdict: sovereignty gap dominates, then hard unavailability, then changes.
  // #1106: check sovFails directly so SOVEREIGNTY_BLOCKED fires even when requiredServices
  // is empty (catalogue-only run with no prior app assessment produces items:[]).
  const overall = deriveLzOverallVerdict({
    items, sovereigntyActive: sov !== undefined, sovereigntyFailures: sovFails, coverageWarning,
  });

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

  const notInCatalogue = items
    .filter((i) => i.verdict === 'NOT_AVAILABLE_IN_REGION' || i.verdict === 'CAPABILITY_MISSING' || i.verdict === 'VERSION_MISMATCH')
    .map((i) => i.service_code);

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
    ...(notInCatalogue.length > 0 ? { services_not_in_catalogue: notInCatalogue } : {}),
    ...(input.requirementProvenance ? { requirement_provenance: input.requirementProvenance.map((r) => ({ ...r, frameworks: [...r.frameworks] })) } : {}),
  };
}

/**
 * Fit for a live scan (#3609, Design 120 sections 5.3 and 7.3): projects the
 * scan onto the base schema and judges every requirement with an observation in
 * `region` by its live status. Requirements the scan did not observe fall back
 * to the static catalogue, as in `computeLzFit`.
 */
export function computeLzFitFromLiveScan(
  input: Omit<LzFitInput, 'scan' | 'liveStatus' | 'catalogueMode'> & { liveScan: LzLiveScan },
): LzFitReport {
  const { liveScan, ...rest } = input;
  return computeLzFit({
    ...rest,
    scan: projectLzLiveScan(liveScan),
    liveStatus: lzLiveStatusesForRegion(liveScan.offering, input.region.id),
  });
}
