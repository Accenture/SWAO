// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { load } from 'js-yaml';
import type { Signal } from './plugin-types.js';
import type { LandingZoneCandidate, LandingZoneResult, LockInFlag } from './wsp-landing-zone.js';

// ---------------------------------------------------------------------------
// Catalogue type definitions (mirrors cloud-provider-catalogue.yaml structure)
// ---------------------------------------------------------------------------

interface CatalogueCertification {
  status: string;
  scope?: string;
}

interface CatalogueService {
  available: boolean;
  managed?: boolean;
}

interface MeshstackSupport {
  supported: boolean;
  building_blocks_available?: string[];
  notes?: string;
}

interface ProprietaryApi {
  service: string;
  risk: string;
  migration_path: string;
}

interface ExclusiveCapability {
  capability: string;
  risk: string;
  note: string;
}

interface VendorLockIn {
  overall_risk: 'low' | 'medium' | 'high';
  portability_score: number;
  exclusive_capabilities?: ExclusiveCapability[];
  proprietary_apis?: ProprietaryApi[];
}

export interface CatalogueProvider {
  id: string;
  name: string;
  residency: {
    data_residency_guarantees: string[];
  };
  certifications: {
    bsi_c5?: CatalogueCertification;
  };
  compliance_regime_coverage: Record<string, string>;
  services: Record<string, CatalogueService>;
  meshstack_support: MeshstackSupport;
  vendor_lock_in: VendorLockIn;
  cost_tier: 'low' | 'medium' | 'high';
  sovereign_score: number;
}

interface CatalogueRoot {
  providers: CatalogueProvider[];
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RequiredService {
  name: string;
  signalId: string;
}

export interface LandingZoneConstraints {
  requiresDeOnly: boolean;
  requiresEuOnly: boolean;
  requiresBsiC5: boolean;
  requiresHipaa: boolean;
  requiresLowLockIn: boolean;
  requiredServices: RequiredService[];
}

export interface LandingZoneWeights {
  sovereign_score: number;
  service_coverage: number;
  portability: number;
  cost_tier: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Fit score reflects workload-sovereignty fitness only -- not delivery tooling.
// meshStack integration is surfaced separately as delivery_readiness, not scored.
// sovereign_score weight (0.50) is 10x cost_tier (0.05): compliance cannot be
// outranked by a lower price tier.
export const DEFAULT_WEIGHTS: LandingZoneWeights = {
  sovereign_score: 0.50,
  service_coverage: 0.35,
  portability: 0.10,
  cost_tier: 0.05,
};

const COST_TIER_NUMERIC: Record<string, number> = {
  low: 0.0,
  medium: 0.5,
  high: 1.0,
};

// ---------------------------------------------------------------------------
// Catalogue loading
// ---------------------------------------------------------------------------

// NOTE: path walks 4 levels up from this file to the repo root (monorepo-only assumption).
// When SWAO is published as an npm package, controls must ship inside the package
// at a stable relative path -- this will need updating at that point.
export function resolveDefaultCataloguePath(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  return resolve(__dirname, '../../../../controls/cloud-provider-catalogue.yaml');
}

export function loadCatalogue(cataloguePath: string): CatalogueProvider[] {
  const raw = readFileSync(cataloguePath, 'utf-8');
  const parsed = load(raw) as CatalogueRoot;
  return parsed.providers;
}

// ---------------------------------------------------------------------------
// Constraint derivation from signal implies tags
// ---------------------------------------------------------------------------

export function deriveConstraints(signals: Signal[]): LandingZoneConstraints {
  const allImplies = signals.flatMap(s => s.implies ?? []);

  const seenServices = new Set<string>();
  const requiredServices: RequiredService[] = [];
  for (const signal of signals) {
    for (const tag of signal.implies ?? []) {
      if (tag.startsWith('service_dep:')) {
        const svc = tag.slice('service_dep:'.length);
        if (!seenServices.has(svc)) {
          seenServices.add(svc);
          requiredServices.push({ name: svc, signalId: signal.id });
        }
      }
    }
  }

  return {
    requiresDeOnly: allImplies.includes('de_only_residency_confirmed'),
    requiresEuOnly: allImplies.includes('eu_only_residency_confirmed'),
    requiresBsiC5: allImplies.includes('bsi_c5_required'),
    requiresHipaa: allImplies.includes('hipaa_required'),
    requiresLowLockIn: allImplies.includes('low_vendor_lock_in_required'),
    requiredServices,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function computeDisqualification(
  provider: CatalogueProvider,
  constraints: LandingZoneConstraints,
): { disqualified: boolean; reason?: string } {
  const guarantees = provider.residency.data_residency_guarantees;

  if (constraints.requiresDeOnly && !guarantees.includes('DE_only')) {
    return {
      disqualified: true,
      reason: 'DE_only residency required; provider does not guarantee data remains in Germany',
    };
  }
  if (constraints.requiresEuOnly && !guarantees.includes('EU_only') && !guarantees.includes('DE_only')) {
    return {
      disqualified: true,
      reason: 'EU_only residency required; provider does not guarantee data remains in the EU',
    };
  }
  if (constraints.requiresBsiC5 && provider.certifications.bsi_c5?.status !== 'attested') {
    const status = provider.certifications.bsi_c5?.status ?? 'not_assessed';
    return {
      disqualified: true,
      reason: `BSI C5 attested certification required; provider status is "${status}"`,
    };
  }
  if (constraints.requiresHipaa && provider.compliance_regime_coverage['hipaa'] !== 'satisfied') {
    const status = provider.compliance_regime_coverage['hipaa'] ?? 'not_applicable';
    return {
      disqualified: true,
      reason: `HIPAA compliance required; provider status is "${status}"`,
    };
  }
  if (constraints.requiresLowLockIn && provider.vendor_lock_in.overall_risk === 'high') {
    return {
      disqualified: true,
      reason: 'Low vendor lock-in required; provider has high overall lock-in risk',
    };
  }

  // Note: service_dep requires only influence fit score and blockers -- not hard disqualification.
  // Hard disqualification for missing services requires blocks_migration:true from WSP security
  // findings, which are not available in this pass. That is deferred to a later iteration.

  return { disqualified: false };
}

function computeServiceCoverage(provider: CatalogueProvider, requiredServices: RequiredService[]): number {
  if (requiredServices.length === 0) return 1.0;
  const covered = requiredServices.filter(({ name }) => provider.services[name]?.available === true).length;
  return covered / requiredServices.length;
}

function deriveLockInFlags(provider: CatalogueProvider): LockInFlag[] {
  const flags: LockInFlag[] = [];
  for (const api of provider.vendor_lock_in.proprietary_apis ?? []) {
    if (api.risk === 'high' || api.risk === 'critical') {
      flags.push({ service: api.service, risk: api.risk as 'high' | 'critical', note: api.migration_path });
    }
  }
  for (const cap of provider.vendor_lock_in.exclusive_capabilities ?? []) {
    if (cap.risk === 'high' || cap.risk === 'critical') {
      flags.push({ service: cap.capability, risk: cap.risk as 'high' | 'critical', note: cap.note });
    }
  }
  return flags;
}

function deriveConfidence(
  passingCount: number,
  constraints: LandingZoneConstraints,
  coverageScore: number,
): 'low' | 'medium' | 'high' {
  if (passingCount === 0) return 'low';
  if (coverageScore >= 0.9 && (constraints.requiresDeOnly || constraints.requiresBsiC5 || constraints.requiresHipaa)) {
    return 'high';
  }
  if (coverageScore >= 0.7) return 'medium';
  return 'low';
}

// ---------------------------------------------------------------------------
// Landing zone matching
// ---------------------------------------------------------------------------

export function matchLandingZone(
  providers: CatalogueProvider[],
  constraints: LandingZoneConstraints,
  weights: Partial<LandingZoneWeights> = {},
  coverageScore = 0.8,
): LandingZoneResult {
  const w: LandingZoneWeights = { ...DEFAULT_WEIGHTS, ...weights };

  const candidates: LandingZoneCandidate[] = providers.map(provider => {
    const { disqualified, reason } = computeDisqualification(provider, constraints);
    const lockInFlags = deriveLockInFlags(provider);
    const serviceGaps = constraints.requiredServices
      .filter(({ name }) => !provider.services[name]?.available)
      .map(({ name }) => name);

    const certMatched: string[] = [];
    if (provider.certifications.bsi_c5?.status === 'attested') certMatched.push('BSI_C5');
    if (provider.compliance_regime_coverage['hipaa'] === 'satisfied') certMatched.push('HIPAA');
    if (provider.compliance_regime_coverage['gdpr'] === 'satisfied') certMatched.push('GDPR');

    // meshStack integration is delivery readiness, not a fit dimension -- stored separately
    const ms = provider.meshstack_support;
    const meshstackIntegration = {
      supported: ms.supported,
      ...(ms.building_blocks_available ? { building_blocks: ms.building_blocks_available } : {}),
      ...(ms.notes ? { note: ms.notes } : {}),
    };

    let fitScore = 0;
    let rationale: string;

    if (!disqualified) {
      const costNum = COST_TIER_NUMERIC[provider.cost_tier] ?? 0.5;
      const svcCoverage = computeServiceCoverage(provider, constraints.requiredServices);
      fitScore = Math.min(1.0, Math.round((
        w.sovereign_score * provider.sovereign_score +
        w.service_coverage * svcCoverage +
        w.portability * provider.vendor_lock_in.portability_score +
        w.cost_tier * (1 - costNum)
      ) * 1000) / 1000);
      rationale = `sovereign=${provider.sovereign_score} svc_coverage=${svcCoverage.toFixed(2)} portability=${provider.vendor_lock_in.portability_score} cost=${provider.cost_tier}`;
    } else {
      rationale = reason!;
    }

    return {
      id: provider.id,
      name: provider.name,
      fit_score: fitScore,
      rationale,
      disqualified,
      disqualification_reason: disqualified ? reason : undefined,
      service_gaps: serviceGaps,
      certifications_matched: certMatched,
      lock_in_flags: lockInFlags,
      overall_lock_in_risk: provider.vendor_lock_in.overall_risk,
      meshstack_integration: meshstackIntegration,
    };
  });

  // Sort: passing candidates descending by fit_score, then disqualified ones
  candidates.sort((a, b) => {
    if (a.disqualified !== b.disqualified) return a.disqualified ? 1 : -1;
    return b.fit_score - a.fit_score;
  });

  const passing = candidates.filter(c => !c.disqualified);
  const recommended = passing[0];

  // Blockers: services required by signals that no passing provider covers
  const blockers = constraints.requiredServices
    .filter(({ name }) => passing.every(c => !providers.find(p => p.id === c.id)?.services[name]?.available))
    .map(({ name, signalId }) => ({
      service: name,
      signal: signalId,
      note: `No passing provider offers "${name}" as an available service`,
    }));

  const confidence = deriveConfidence(passing.length, constraints, coverageScore);

  return {
    landing_zone_candidates: candidates,
    recommended_landing_zone: recommended?.id,
    landing_zone_recommendation_confidence: confidence,
    landing_zone_blockers: blockers.length > 0 ? blockers : undefined,
  };
}
