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

import type { WspResult, Signal, LzRegion, LzScanResult } from '@swao/core';
import {
  computeLzFit,
  type LzRequiredService,
  type SovereigntyRequirements,
  type LzFitItem,
} from './lz-fit.js';

/**
 * type:landing-zone orchestration (Design 056 Layer C, #0567). Assembles the
 * fit report into a WspResult: a per-gap LZ-NN signal stream + an `lz` block
 * carrying the full fit report. Deterministic; no LLM.
 */

// --- Framework-driven sovereignty derivation (D-LZ-07) -------------------

/** A framework's optional sovereignty-requirements declaration. A framework
 *  that does NOT declare this contributes nothing -- so with no
 *  sovereignty-declaring framework active, there is no sovereignty gate (honest:
 *  e.g. GDPR alone requires transfer safeguards, it does not forbid a CSP). */
export interface FrameworkSovereigntyDecl {
  id: string;
  sovereignty_requirements?: {
    forbid_exposure?: string[];
    require_operator_jurisdiction?: string[];
    require_residency_country?: string[];
    require_certifications?: string[];
    /** Capability codes this framework mandates in the LZ assessed scope,
     *  regardless of what the app's INV pass detected (#1353). */
    required_services?: string[];
  };
}

/**
 * Aggregate the sovereignty requirements declared by the active frameworks.
 * Pure + data-driven: requirements come from the frameworks, never hardcoded.
 * Returns undefined when no active framework declares any (no sovereignty gate).
 */
export function deriveSovereigntyRequirements(
  frameworks: FrameworkSovereigntyDecl[],
): SovereigntyRequirements | undefined {
  const forbid = new Set<string>();
  const jurisdiction = new Set<string>();
  const residency = new Set<string>();
  const certifications = new Set<string>();
  const requiredServices = new Set<string>();
  const derivedFrom: string[] = [];

  for (const fw of frameworks) {
    const sr = fw.sovereignty_requirements;
    if (!sr) continue;
    let contributed = false;
    for (const e of sr.forbid_exposure ?? []) { forbid.add(e); contributed = true; }
    for (const j of sr.require_operator_jurisdiction ?? []) { jurisdiction.add(j); contributed = true; }
    for (const c of sr.require_residency_country ?? []) { residency.add(c); contributed = true; }
    for (const c of sr.require_certifications ?? []) { certifications.add(c); contributed = true; }
    for (const s of sr.required_services ?? []) { requiredServices.add(s); contributed = true; }
    if (contributed) derivedFrom.push(fw.id);
  }

  if (derivedFrom.length === 0) return undefined;
  return {
    forbid_exposure: [...forbid],
    // Intersection semantics would be stricter; for v1 the union of acceptable
    // jurisdictions/residencies is used (a region passes if it matches any
    // active framework's accepted set). Refine per-framework AND semantics later.
    require_operator_jurisdiction: jurisdiction.size > 0 ? [...jurisdiction] : undefined,
    require_residency_country: residency.size > 0 ? [...residency] : undefined,
    require_certifications: certifications.size > 0 ? [...certifications] : undefined,
    derived_from: derivedFrom,
    required_services: requiredServices.size > 0 ? [...requiredServices] : undefined,
  };
}

// --- Orchestration -------------------------------------------------------

export interface OrchestrateLzInput {
  region: LzRegion;
  scan: LzScanResult;
  requiredServices: LzRequiredService[];
  /** Already derived from the active frameworks (deriveSovereigntyRequirements). */
  sovereigntyRequirements?: SovereigntyRequirements;
  iter?: number;
  assessedAt?: string;
  /** Forwarded from AssembleLzInput -- see LzFitInput.catalogueMode for semantics. */
  catalogueMode?: boolean;
}

const SEVERITY_BY_VERDICT: Record<string, Signal['severity']> = {
  SOVEREIGNTY_GAP: 'critical',
  NOT_AVAILABLE_IN_REGION: 'high',
  MISCONFIGURED: 'high',
  AVAILABLE_NOT_ENABLED: 'medium',
};

/** Emit an LZ-NN signal per non-SUPPORTED fit item (a gap to act on). */
function gapSignals(items: LzFitItem[], assessedAt: string): Signal[] {
  const signals: Signal[] = [];
  let n = 0;
  for (const item of items) {
    if (item.verdict === 'SUPPORTED') continue;
    n += 1;
    signals.push({
      id: `LZ-${String(n).padStart(2, '0')}`,
      source: 'static_analysis',
      category: 'infrastructure_platform',
      severity: SEVERITY_BY_VERDICT[item.verdict] ?? 'medium',
      derivation: `${item.service_code}: ${item.verdict} -- ${item.detail}`,
      evidence: [],
      confidence: 'high',
      outcome: 'negative',
      assessor: 'rule_engine',
      assessed_at: assessedAt,
    });
  }
  return signals;
}

export function orchestrateLandingZone(input: OrchestrateLzInput): WspResult {
  const assessedAt = input.assessedAt ?? new Date().toISOString().slice(0, 10);
  const report = computeLzFit({
    requiredServices: input.requiredServices,
    region: input.region,
    scan: input.scan,
    sovereigntyRequirements: input.sovereigntyRequirements,
    generatedAt: assessedAt,
    catalogueMode: input.catalogueMode,
  });

  return {
    wsp_version: '0.11',
    generated_at: new Date().toISOString(),
    assessment_type: 'landing-zone',
    signals: gapSignals(report.items, assessedAt),
    lz: report,
  };
}
