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
  type LzFitVerdict,
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

/** One merged requirement value and the frameworks that contributed it (#3871, D-11). */
export interface SovereigntyRequirementProvenance {
  requirement: 'residency_country' | 'operator_jurisdiction' | 'forbid_exposure' | 'certification';
  value: string;
  frameworks: string[];
}

/**
 * Value-level provenance of the merged requirements of `deriveSovereigntyRequirements`
 * (#3871, Design 123 section 8.2, D-11): for every requirement value the frameworks
 * that declared it, in declaration order. A separate function so the merged
 * requirements keep their shape (`derived_from` stays the framework list).
 */
export function sovereigntyRequirementProvenance(frameworks: readonly FrameworkSovereigntyDecl[]): SovereigntyRequirementProvenance[] {
  const keys = [
    ['residency_country', 'require_residency_country'],
    ['operator_jurisdiction', 'require_operator_jurisdiction'],
    ['forbid_exposure', 'forbid_exposure'],
    ['certification', 'require_certifications'],
  ] as const;
  const out: SovereigntyRequirementProvenance[] = [];
  for (const [requirement, field] of keys) {
    const byValue = new Map<string, string[]>();
    for (const fw of frameworks) {
      for (const v of fw.sovereignty_requirements?.[field] ?? []) {
        const list = byValue.get(v) ?? [];
        if (!list.includes(fw.id)) list.push(fw.id);
        byValue.set(v, list);
      }
    }
    for (const [value, fws] of byValue) out.push({ requirement, value, frameworks: fws });
  }
  return out;
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
  /** #3888 (D-12): forwarded to computeLzFit (LzFitInput.baselineDenies). */
  baselineDenies?: ReadonlyMap<string, string>;
  /** #3920: forwarded to computeLzFit (LzFitInput.requirementProvenance). */
  requirementProvenance?: readonly SovereigntyRequirementProvenance[];
}

/** Exhaustive over LzFitVerdict (#3569), so a new verdict cannot silently fall back. */
export const SEVERITY_BY_VERDICT: Record<LzFitVerdict, Signal['severity']> = {
  SUPPORTED: 'informational',
  SOVEREIGNTY_GAP: 'critical',
  NOT_AVAILABLE_IN_REGION: 'high',
  BLOCKED_BY_POLICY: 'high',
  MISCONFIGURED: 'high',
  AVAILABLE_NOT_ENABLED: 'medium',
  VERSION_MISMATCH: 'medium',
  CAPABILITY_MISSING: 'medium',
  UNVERIFIED: 'low',
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
      severity: SEVERITY_BY_VERDICT[item.verdict],
      derivation: `${item.service_code}: ${item.verdict} -- ${item.detail}`,
      // #3430: provenance of the requirement (service footprint); documentation-only stays low.
      evidence: item.evidence ?? [],
      confidence: item.confidence === 'low' ? 'low' : 'high',
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
    ...(input.baselineDenies ? { baselineDenies: input.baselineDenies } : {}),
    ...(input.requirementProvenance ? { requirementProvenance: input.requirementProvenance } : {}),
  });

  return {
    wsp_version: '0.11',
    generated_at: new Date().toISOString(),
    assessment_type: 'landing-zone',
    signals: gapSignals(report.items, assessedAt),
    lz: report,
  };
}
