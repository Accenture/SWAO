// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module -- verdict narrative generator (#1358)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * LzVerdictNarrative -- plain-language verdict reasoning for Landing Zone assessments.
 *
 * Converts a computed LzFitReport into a deterministic, human-readable narrative
 * suitable for HTML publication blocks and the lz-narratives.json WSP file.
 * No LLM call required; all output is template-based from existing fit-report fields.
 *
 * Design 056 Layer C complement; see lz-fit.ts for the underlying engine.
 */

import type { LzFitReport, LzOverallVerdict, LzFitVerdict } from './lz-fit.js';

// ---------------------------------------------------------------------------
// Exported interfaces
// ---------------------------------------------------------------------------

export interface LzSovereigntyNarrative {
  /** True when the overall verdict is not SOVEREIGNTY_BLOCKED. */
  passed: boolean;
  /** Legal entity / jurisdiction that operates the region. 'unknown' when not available from the fit report. */
  operator_jurisdiction: string;
  /** ISO country / region grouping where data rests. 'unknown' when not available. */
  residency_country: string;
  /** Held attestations relevant to sovereignty, e.g. ["C5", "SecNumCloud"]. */
  certifications: string[];
  /** Human-readable sovereignty failure reasons extracted from SOVEREIGNTY_GAP item details. */
  blockers: string[];
  /** Verbatim sovereignty_statement from LzFitReport. */
  statement: string;
}

export interface LzServiceCheckNarrative {
  /** Abstract capability key (service_dep token), e.g. "kubernetes". */
  primitive: string;
  /** LzFitVerdict string for this service check. */
  verdict: LzFitVerdict;
  /** Human display name for the service (label or code). */
  service_code?: string;
  /** Detail text from the fit item explaining the verdict. */
  reason?: string;
}

export interface LzVerdictNarrative {
  /** Unique identifier for this landing zone assessment entry, e.g. "aws/eu-central-1". */
  lz_id: string;
  /** CSP region identifier, e.g. "eu-central-1". */
  region_id: string;
  /** Human-readable display label, e.g. "Amazon Web Services / eu-central-1". */
  display: string;
  /** Overall landing zone verdict. */
  verdict: LzOverallVerdict;
  /** Structured sovereignty analysis. */
  sovereignty: LzSovereigntyNarrative;
  /** Per-service-primitive results. */
  service_checks: LzServiceCheckNarrative[];
  /** One-line summary suitable for a card header. */
  summary_headline: string;
  /** Full paragraph narrative with sovereignty and service gap details. */
  summary_body: string;
  /** Paths to WSP evidence files referenced by this narrative. */
  evidence_files: string[];
}

// ---------------------------------------------------------------------------
// Optional structured sovereignty facts (not stored in LzFitReport)
// ---------------------------------------------------------------------------

/** Caller-supplied sovereignty facts that are not present in LzFitReport.
 *  When omitted, operator_jurisdiction, residency_country, and certifications
 *  default to 'unknown' / [] -- the sovereignty_statement field carries the
 *  full human-readable analysis regardless. */
export interface LzSovereigntyFactsInput {
  operator_jurisdiction?: string;
  residency_country?: string;
  certifications?: string[];
}

// ---------------------------------------------------------------------------
// Narrative generator
// ---------------------------------------------------------------------------

/** Verdicts where the service check did not pass -- used in M-gap counting. */
const HARD_BLOCKING_VERDICTS: ReadonlySet<LzFitVerdict> = new Set([
  'NOT_AVAILABLE_IN_REGION',
  'VERSION_MISMATCH',
  'CAPABILITY_MISSING',
]);

/**
 * Generate a deterministic LzVerdictNarrative from a computed LzFitReport.
 *
 * Fields used from fit (lz-fit.ts):
 *   fit.overall              -- LzOverallVerdict; drives all branching.
 *   fit.sovereignty_active   -- whether sovereignty gates were exercised.
 *   fit.sovereignty_statement -- verbatim sovereignty text.
 *   fit.items                -- LzFitItem[]; source of service_checks + gap counts.
 *   fit.blocker_category     -- 'structural' | 'certification' | 'mixed' (present when SOVEREIGNTY_BLOCKED).
 */
export function generateLzNarrative(opts: {
  lz_id: string;
  region_id: string;
  display: string;
  fit: LzFitReport;
  evidence_files?: string[];
  sovereigntyFacts?: LzSovereigntyFactsInput;
}): LzVerdictNarrative {
  const { fit, lz_id, region_id, display, evidence_files = [], sovereigntyFacts } = opts;

  // Sovereignty passed when the overall verdict is NOT SOVEREIGNTY_BLOCKED.
  // Note: lz-fit.ts blocker_category values are 'structural' | 'certification' | 'mixed' --
  // there is no 'sovereignty' value; use the overall verdict as the authoritative discriminator.
  const sovereigntyPassed = fit.overall !== 'SOVEREIGNTY_BLOCKED';

  // Extract sovereignty failure blockers from SOVEREIGNTY_GAP item details.
  const sovereigntyBlockers = fit.items
    .filter(i => i.verdict === 'SOVEREIGNTY_GAP')
    .map(i => i.detail);

  const sovereignty: LzSovereigntyNarrative = {
    passed: sovereigntyPassed,
    operator_jurisdiction: sovereigntyFacts?.operator_jurisdiction ?? 'unknown',
    residency_country: sovereigntyFacts?.residency_country ?? 'unknown',
    certifications: sovereigntyFacts?.certifications ?? [],
    blockers: sovereigntyBlockers,
    statement: fit.sovereignty_statement,
  };

  // Map each fit item to a LzServiceCheckNarrative.
  const service_checks: LzServiceCheckNarrative[] = fit.items.map(item => ({
    primitive: item.service_code,
    verdict: item.verdict,
    service_code: item.label ?? item.service_code,
    reason: item.detail,
  }));

  // Hard-blocking gaps (NOT_AVAILABLE_IN_REGION, VERSION_MISMATCH, CAPABILITY_MISSING).
  const failedItems = fit.items.filter(i => HARD_BLOCKING_VERDICTS.has(i.verdict));
  const failedCount = failedItems.length;
  const failedNames = failedItems.map(i => i.service_code).join(', ');
  const totalAssessed = fit.items.length;

  // Deterministic summary headline per verdict.
  let summary_headline: string;
  switch (fit.overall) {
    case 'READY':
    case 'READY_WITH_CHANGES':
      summary_headline =
        `All sovereignty requirements met; all ${totalAssessed} assessed service primitive(s) supported.`;
      break;
    case 'NEEDS_VERIFICATION':
      summary_headline =
        `Insufficient service evidence -- ${totalAssessed} service primitive(s) assessed, baseline coverage incomplete.` +
        ` Manual verification required before issuing a production READY verdict.`;
      break;
    case 'BLOCKED':
      if (sovereigntyPassed) {
        // Standard path: sovereignty passes, one or more service primitives unavailable.
        summary_headline =
          `Passes sovereignty; blocked on ${failedCount} missing service primitive(s): ${failedNames}.`;
      } else {
        // Unusual path: computeLzFit forces SOVEREIGNTY_BLOCKED when sovFails exist,
        // so BLOCKED + !sovereigntyPassed is unreachable through the standard engine.
        // Retained defensively.
        summary_headline =
          `BLOCKED: sovereignty failure (operator_jurisdiction: ${sovereignty.operator_jurisdiction}) and ${failedCount} service gap(s).`;
      }
      break;
    case 'SOVEREIGNTY_BLOCKED':
      summary_headline =
        `Sovereignty blocked: operator_jurisdiction ${sovereignty.operator_jurisdiction} is not in the required set. ${failedCount} service gap(s) also present.`;
      break;
    default:
      // Exhaustive guard -- LzOverallVerdict is a closed union.
      summary_headline = `Verdict: ${fit.overall}.`;
      break;
  }

  // Build summary_body as a full paragraph.
  const bodyParts: string[] = [];

  // Sovereignty section.
  const certList = sovereignty.certifications.length > 0
    ? sovereignty.certifications.join(', ')
    : 'none';
  const sovResult = sovereignty.passed ? 'passed' : 'failed';
  bodyParts.push(
    `Sovereignty assessment ${sovResult}.` +
    ` Operator jurisdiction: ${sovereignty.operator_jurisdiction}.` +
    ` Data residency: ${sovereignty.residency_country}.` +
    ` Certifications held: ${certList}.`,
  );

  // Service section.
  if (failedItems.length > 0) {
    const gapDetails = failedItems
      .map(i => `${i.service_code} (${i.verdict}${i.label ? `, ${i.label}` : ''})`)
      .join('; ');
    bodyParts.push(`Service gaps identified: ${gapDetails}.`);
  } else if (fit.overall === 'READY' || fit.overall === 'READY_WITH_CHANGES') {
    bodyParts.push(
      `All ${totalAssessed} required service primitive(s) are available in this landing zone.`,
    );
  } else if (fit.overall === 'NEEDS_VERIFICATION') {
    bodyParts.push(
      `${totalAssessed} service primitive(s) assessed. Baseline coverage is incomplete -- ` +
      `compute, network, KMS, or storage sovereignty facts are unverified. ` +
      `Extend the landing zone catalogue or obtain supplementary sovereignty attestations before issuing a READY verdict.`,
    );
  }

  // Sovereignty blocker detail (when present).
  if (!sovereigntyPassed && sovereigntyBlockers.length > 0) {
    bodyParts.push(
      `Sovereignty blockers: ${sovereigntyBlockers.join('; ')}.`,
    );
  }

  const summary_body = bodyParts.join(' ');

  return {
    lz_id,
    region_id,
    display,
    verdict: fit.overall,
    sovereignty,
    service_checks,
    summary_headline,
    summary_body,
    evidence_files,
  };
}
