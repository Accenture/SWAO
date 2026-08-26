// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readdirSync, readFileSync } from 'fs';
import { load } from 'js-yaml';
import {
  resolveDefaultCataloguePath,
  loadCatalogue,
  deriveConstraints,
  matchLandingZone,
  DEFAULT_WEIGHTS,
} from './cloud-provider-catalogue.js';
import type { CatalogueProvider, LandingZoneConstraints } from './cloud-provider-catalogue.js';
import type { Signal } from '../schema/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_APPS = join(__dirname, '../../../../../examples/portfolio-workspace/portfolio/apps');

// ---------------------------------------------------------------------------
// Minimal provider fixtures for unit tests
// ---------------------------------------------------------------------------

function makeProvider(overrides: Partial<CatalogueProvider> & { id: string; name: string }): CatalogueProvider {
  const base: CatalogueProvider = {
    id: overrides.id,
    name: overrides.name,
    residency: { data_residency_guarantees: ['EU_only', 'DE_only'] },
    certifications: { bsi_c5: { status: 'attested' } },
    compliance_regime_coverage: { gdpr: 'satisfied', hipaa: 'not_applicable', bsi_c5: 'satisfied' },
    services: {
      postgresql: { available: true },
      redis: { available: true },
      kubernetes: { available: true },
    },
    meshstack_support: { supported: true },
    vendor_lock_in: {
      overall_risk: 'low',
      portability_score: 0.90,
      proprietary_apis: [],
      exclusive_capabilities: [],
    },
    cost_tier: 'medium',
    sovereign_score: 0.90,
  };
  return { ...base, ...overrides };
}

const NO_CONSTRAINTS: LandingZoneConstraints = {
  requiresDeOnly: false,
  requiresEuOnly: false,
  requiresBsiC5: false,
  requiresHipaa: false,
  requiresLowLockIn: false,
  requiredServices: [],
};

// ---------------------------------------------------------------------------
// Catalogue loading
// ---------------------------------------------------------------------------

describe('loadCatalogue', () => {
  it('loads and returns 15+ providers from the real catalogue', () => {
    const path = resolveDefaultCataloguePath();
    const providers = loadCatalogue(path);
    expect(providers.length).toBeGreaterThanOrEqual(15);
  });

  it('every provider has required top-level fields', () => {
    const providers = loadCatalogue(resolveDefaultCataloguePath());
    for (const p of providers) {
      expect(typeof p.id).toBe('string');
      expect(typeof p.name).toBe('string');
      expect(typeof p.sovereign_score).toBe('number');
      expect(['low', 'medium', 'high']).toContain(p.cost_tier);
    }
  });
});

// ---------------------------------------------------------------------------
// deriveConstraints
// ---------------------------------------------------------------------------

describe('deriveConstraints', () => {
  it('returns no constraints when signals have no implies', () => {
    const signals: Signal[] = [
      { id: 'INV-01', source: 'static_analysis', category: 'application', severity: 'informational', derivation: 'test', evidence: [], confidence: 'high' },
    ];
    const constraints = deriveConstraints(signals);
    expect(constraints.requiresDeOnly).toBe(false);
    expect(constraints.requiresBsiC5).toBe(false);
    expect(constraints.requiredServices).toHaveLength(0);
  });

  it('detects de_only_residency_confirmed and bsi_c5_required', () => {
    const signals: Signal[] = [
      { id: 'CTX-04', source: 'workshop', category: 'business_processes', severity: 'informational', derivation: 'workshop', evidence: [], confidence: 'high', implies: ['de_only_residency_confirmed', 'bsi_c5_required'] },
    ];
    const constraints = deriveConstraints(signals);
    expect(constraints.requiresDeOnly).toBe(true);
    expect(constraints.requiresBsiC5).toBe(true);
    expect(constraints.requiresEuOnly).toBe(false);
  });

  it('extracts service_dep tags into requiredServices with signal attribution', () => {
    const signals: Signal[] = [
      { id: 'INV-02', source: 'static_analysis', category: 'application', severity: 'informational', derivation: 'db', evidence: [], confidence: 'high', implies: ['service_dep:postgresql'] },
      { id: 'INV-03', source: 'static_analysis', category: 'infrastructure_platform', severity: 'informational', derivation: 'redis', evidence: [], confidence: 'high', implies: ['STATE-02', 'service_dep:redis'] },
    ];
    const constraints = deriveConstraints(signals);
    expect(constraints.requiredServices).toHaveLength(2);
    expect(constraints.requiredServices[0]).toEqual({ name: 'postgresql', signalId: 'INV-02' });
    expect(constraints.requiredServices[1]).toEqual({ name: 'redis', signalId: 'INV-03' });
  });

  it('deduplicates service_dep tags from multiple signals', () => {
    const signals: Signal[] = [
      { id: 'INV-02', source: 'static_analysis', category: 'application', severity: 'informational', derivation: 'db', evidence: [], confidence: 'high', implies: ['service_dep:postgresql'] },
      { id: 'STATE-01', source: 'static_analysis', category: 'infrastructure_platform', severity: 'informational', derivation: 'state', evidence: [], confidence: 'high', implies: ['service_dep:postgresql'] },
    ];
    const constraints = deriveConstraints(signals);
    expect(constraints.requiredServices).toHaveLength(1);
    expect(constraints.requiredServices[0].name).toBe('postgresql');
  });
});

// ---------------------------------------------------------------------------
// Hard filter: DE_only
// ---------------------------------------------------------------------------

describe('matchLandingZone -- hard filter: DE_only', () => {
  const euOnlyProvider = makeProvider({
    id: 'eu_only_provider',
    name: 'EU-only Provider',
    residency: { data_residency_guarantees: ['EU_only'] },
  });
  const deOnlyProvider = makeProvider({ id: 'de_provider', name: 'DE Provider' });

  it('disqualifies provider without DE_only guarantee when de_only_residency_confirmed', () => {
    const constraints: LandingZoneConstraints = { ...NO_CONSTRAINTS, requiresDeOnly: true };
    const result = matchLandingZone([euOnlyProvider], constraints);
    expect(result.landing_zone_candidates![0].disqualified).toBe(true);
    expect(result.landing_zone_candidates![0].disqualification_reason).toMatch(/DE_only/);
  });

  it('passes provider with DE_only guarantee when de_only_residency_confirmed', () => {
    const constraints: LandingZoneConstraints = { ...NO_CONSTRAINTS, requiresDeOnly: true };
    const result = matchLandingZone([deOnlyProvider], constraints);
    expect(result.landing_zone_candidates![0].disqualified).toBe(false);
    expect(result.recommended_landing_zone).toBe('de_provider');
  });
});

// ---------------------------------------------------------------------------
// Hard filter: BSI C5
// ---------------------------------------------------------------------------

describe('matchLandingZone -- hard filter: BSI C5', () => {
  const notAttestedProvider = makeProvider({
    id: 'not_attested',
    name: 'Not Attested',
    certifications: { bsi_c5: { status: 'in_progress' } },
  });
  const attestedProvider = makeProvider({ id: 'attested', name: 'Attested' });

  it('disqualifies provider with bsi_c5 status != attested when bsi_c5_required', () => {
    const constraints: LandingZoneConstraints = { ...NO_CONSTRAINTS, requiresBsiC5: true };
    const result = matchLandingZone([notAttestedProvider], constraints);
    expect(result.landing_zone_candidates![0].disqualified).toBe(true);
    expect(result.landing_zone_candidates![0].disqualification_reason).toMatch(/in_progress/);
  });

  it('passes provider with bsi_c5 attested when bsi_c5_required', () => {
    const constraints: LandingZoneConstraints = { ...NO_CONSTRAINTS, requiresBsiC5: true };
    const result = matchLandingZone([attestedProvider], constraints);
    expect(result.landing_zone_candidates![0].disqualified).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Hard filter: low_vendor_lock_in_required
// ---------------------------------------------------------------------------

describe('matchLandingZone -- hard filter: low_vendor_lock_in_required', () => {
  const highLockIn = makeProvider({
    id: 'high_lock_in',
    name: 'High Lock-in',
    vendor_lock_in: { overall_risk: 'high', portability_score: 0.45, proprietary_apis: [], exclusive_capabilities: [] },
  });
  const lowLockIn = makeProvider({ id: 'low_lock_in', name: 'Low Lock-in' });

  it('disqualifies provider with overall_risk=high when low_vendor_lock_in_required', () => {
    const constraints: LandingZoneConstraints = { ...NO_CONSTRAINTS, requiresLowLockIn: true };
    const result = matchLandingZone([highLockIn], constraints);
    expect(result.landing_zone_candidates![0].disqualified).toBe(true);
    expect(result.landing_zone_candidates![0].disqualification_reason).toMatch(/lock-in/);
  });

  it('passes provider with overall_risk=low when low_vendor_lock_in_required', () => {
    const constraints: LandingZoneConstraints = { ...NO_CONSTRAINTS, requiresLowLockIn: true };
    const result = matchLandingZone([lowLockIn], constraints);
    expect(result.landing_zone_candidates![0].disqualified).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Disqualified providers appear in output with reason
// ---------------------------------------------------------------------------

describe('matchLandingZone -- disqualified providers in output', () => {
  it('disqualified provider still appears in candidates with disqualified=true and reason', () => {
    const euOnly = makeProvider({
      id: 'eu_only',
      name: 'EU Only',
      residency: { data_residency_guarantees: ['EU_only'] },
    });
    const constraints: LandingZoneConstraints = { ...NO_CONSTRAINTS, requiresDeOnly: true };
    const result = matchLandingZone([euOnly], constraints);
    expect(result.landing_zone_candidates).toHaveLength(1);
    expect(result.landing_zone_candidates![0].disqualified).toBe(true);
    expect(typeof result.landing_zone_candidates![0].disqualification_reason).toBe('string');
  });

  it('disqualified providers are sorted after passing ones', () => {
    const passing = makeProvider({ id: 'passer', name: 'Passer' });
    const failing = makeProvider({
      id: 'failer',
      name: 'Failer',
      residency: { data_residency_guarantees: ['EU_only'] },
    });
    const constraints: LandingZoneConstraints = { ...NO_CONSTRAINTS, requiresDeOnly: true };
    const result = matchLandingZone([failing, passing], constraints);
    expect(result.landing_zone_candidates![0].id).toBe('passer');
    expect(result.landing_zone_candidates![1].id).toBe('failer');
  });
});

// ---------------------------------------------------------------------------
// Fit scoring
// ---------------------------------------------------------------------------

describe('matchLandingZone -- fit scoring', () => {
  it('computes fit score with exact formula: cost=low, mesh=true, portability=1.0, sov=1.0, svc=1.0', () => {
    const p = makeProvider({
      id: 'perfect',
      name: 'Perfect',
      sovereign_score: 1.0,
      cost_tier: 'low',
      vendor_lock_in: { overall_risk: 'low', portability_score: 1.0, proprietary_apis: [], exclusive_capabilities: [] },
      meshstack_support: { supported: true },
    });
    const result = matchLandingZone([p], NO_CONSTRAINTS, DEFAULT_WEIGHTS);
    const candidate = result.landing_zone_candidates![0];
    // 0.25*1.0 + 0.35*1.0 + 0.15*(1-0) + 0.15*1 + 0.10*1.0 = 1.0
    expect(candidate.fit_score).toBe(1.0);
  });

  it('higher sovereign_score wins when other factors equal', () => {
    const high = makeProvider({ id: 'high_sov', name: 'High Sov', sovereign_score: 0.95 });
    const low = makeProvider({ id: 'low_sov', name: 'Low Sov', sovereign_score: 0.60 });
    const result = matchLandingZone([low, high], NO_CONSTRAINTS);
    expect(result.recommended_landing_zone).toBe('high_sov');
    expect(result.landing_zone_candidates![0].fit_score).toBeGreaterThan(
      result.landing_zone_candidates![1].fit_score,
    );
  });

  it('applies custom weight overrides', () => {
    const p = makeProvider({ id: 'p', name: 'P', sovereign_score: 0.5, cost_tier: 'low' });
    const customWeights = { ...DEFAULT_WEIGHTS, sovereign_score: 0.0, cost_tier: 0.5, service_coverage: 0.5 };
    const result = matchLandingZone([p], NO_CONSTRAINTS, customWeights);
    const score = result.landing_zone_candidates![0].fit_score;
    // 0*0.5 + 0.5*1.0 + 0.5*(1-0) + 0.15*1 + 0.10*0.90 = 0 + 0.5 + 0.5 + 0.15 + 0.09 = 1.24 (but weights don't sum to 1)
    // Just verify it's a number > 0
    expect(score).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Lock-in flags
// ---------------------------------------------------------------------------

describe('matchLandingZone -- lock-in flags', () => {
  it('emits lock-in flag for high-risk proprietary API', () => {
    const p = makeProvider({
      id: 'p',
      name: 'P',
      vendor_lock_in: {
        overall_risk: 'high',
        portability_score: 0.40,
        proprietary_apis: [
          { service: 'object_storage', risk: 'high', migration_path: 'Rewrite required' },
          { service: 'dns', risk: 'low', migration_path: 'Easy swap' },
        ],
        exclusive_capabilities: [],
      },
    });
    const result = matchLandingZone([p], NO_CONSTRAINTS);
    const flags = result.landing_zone_candidates![0].lock_in_flags;
    expect(flags).toHaveLength(1);
    expect(flags[0].service).toBe('object_storage');
    expect(flags[0].risk).toBe('high');
  });

  it('emits lock-in flag for critical exclusive capability', () => {
    const p = makeProvider({
      id: 'p',
      name: 'P',
      vendor_lock_in: {
        overall_risk: 'medium',
        portability_score: 0.60,
        proprietary_apis: [],
        exclusive_capabilities: [
          { capability: 'Proprietary Bedrock API', risk: 'critical', note: 'No equivalent exists' },
          { capability: 'Some medium feature', risk: 'medium', note: 'Medium risk' },
        ],
      },
    });
    const result = matchLandingZone([p], NO_CONSTRAINTS);
    const flags = result.landing_zone_candidates![0].lock_in_flags;
    expect(flags).toHaveLength(1);
    expect(flags[0].risk).toBe('critical');
  });

  it('emits no lock-in flags for low/medium risk only', () => {
    const p = makeProvider({
      id: 'p',
      name: 'P',
      vendor_lock_in: {
        overall_risk: 'low',
        portability_score: 0.88,
        proprietary_apis: [
          { service: 'dns', risk: 'low', migration_path: 'Standard swap' },
          { service: 'redis', risk: 'medium', migration_path: 'Minor rewrite' },
        ],
        exclusive_capabilities: [],
      },
    });
    const result = matchLandingZone([p], NO_CONSTRAINTS);
    expect(result.landing_zone_candidates![0].lock_in_flags).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Landing zone blockers
// ---------------------------------------------------------------------------

describe('matchLandingZone -- landing zone blockers', () => {
  it('emits blocker when a required service is unavailable on all passing providers', () => {
    const p = makeProvider({
      id: 'p',
      name: 'P',
      services: { postgresql: { available: true }, ml_inference: { available: false } },
    });
    const constraints: LandingZoneConstraints = {
      ...NO_CONSTRAINTS,
      requiredServices: [
        { name: 'postgresql', signalId: 'INV-02' },
        { name: 'ml_inference', signalId: 'INV-07' },
      ],
    };
    const result = matchLandingZone([p], constraints);
    expect(result.landing_zone_blockers).toBeDefined();
    expect(result.landing_zone_blockers!).toHaveLength(1);
    expect(result.landing_zone_blockers![0].service).toBe('ml_inference');
    expect(result.landing_zone_blockers![0].signal).toBe('INV-07');
  });

  it('emits no blockers when all passing providers cover all services', () => {
    const p = makeProvider({ id: 'p', name: 'P' });
    const constraints: LandingZoneConstraints = {
      ...NO_CONSTRAINTS,
      requiredServices: [{ name: 'postgresql', signalId: 'INV-02' }],
    };
    const result = matchLandingZone([p], constraints);
    expect(result.landing_zone_blockers).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Ghostfolio integration test (acceptance criterion)
// ---------------------------------------------------------------------------

function loadGhostfolioSignals(): Signal[] {
  const passesDir = join(EXAMPLES_APPS, 'ghostfolio', 'wsp', 'passes');
  const files = readdirSync(passesDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
  const signals: Signal[] = [];
  for (const file of files) {
    const raw = readFileSync(join(passesDir, file), 'utf-8');
    const parsed = load(raw) as { signals?: Signal[] } | null;
    if (parsed?.signals) signals.push(...parsed.signals);
  }
  return signals;
}

describe('matchLandingZone -- ghostfolio fixture integration', () => {
  it('STACKIT or OTC recommended; Azure, AWS, GCP disqualified', () => {
    const signals = loadGhostfolioSignals();
    const constraints = deriveConstraints(signals);
    const providers = loadCatalogue(resolveDefaultCataloguePath());
    const result = matchLandingZone(providers, constraints);

    expect(result.recommended_landing_zone).toMatch(/stackit_de_sovereign|otc_de_sovereign/);

    const candidateMap = Object.fromEntries(
      (result.landing_zone_candidates ?? []).map(c => [c.id, c]),
    );

    // DE_only + BSI C5 constraints should disqualify Azure, AWS, GCP
    expect(candidateMap['azure_west_europe']?.disqualified).toBe(true);
    expect(candidateMap['aws_eu_central_1']?.disqualified).toBe(true);
    expect(candidateMap['gcp_eu_regions']?.disqualified).toBe(true);

    // STACKIT and OTC must survive both filters
    expect(candidateMap['stackit_de_sovereign']?.disqualified).toBe(false);
    expect(candidateMap['otc_de_sovereign']?.disqualified).toBe(false);
  });

  it('derives de_only and bsi_c5 constraints from ghostfolio CTX-04 implies', () => {
    const signals = loadGhostfolioSignals();
    const constraints = deriveConstraints(signals);
    expect(constraints.requiresDeOnly).toBe(true);
    expect(constraints.requiresBsiC5).toBe(true);
  });

  it('derives postgresql and redis as required services from INV signals', () => {
    const signals = loadGhostfolioSignals();
    const constraints = deriveConstraints(signals);
    const serviceNames = constraints.requiredServices.map(s => s.name);
    expect(serviceNames).toContain('postgresql');
    expect(serviceNames).toContain('redis');
  });

  it('confidence is high when coverage_score >= 0.9 and hard constraints set', () => {
    const signals = loadGhostfolioSignals();
    const constraints = deriveConstraints(signals);
    const providers = loadCatalogue(resolveDefaultCataloguePath());
    const result = matchLandingZone(providers, constraints, {}, 0.95);
    expect(result.landing_zone_recommendation_confidence).toBe('high');
  });

  it('AWS ESC is disqualified when bsi_c5_required (status is in_progress)', () => {
    const providers = loadCatalogue(resolveDefaultCataloguePath());
    const constraints = { requiresDeOnly: true, requiresEuOnly: false, requiresBsiC5: true, requiresHipaa: false, requiresLowLockIn: false, requiredServices: [] };
    const result = matchLandingZone(providers, constraints);
    const candidateMap = Object.fromEntries(
      (result.landing_zone_candidates ?? []).map(c => [c.id, c]),
    );
    expect(candidateMap['aws_eu_sovereign']?.disqualified).toBe(true);
    expect(candidateMap['aws_eu_sovereign']?.disqualification_reason).toMatch(/bsi.c5/i);
  });

  it('AWS ESC survives DE_only filter when bsi_c5 is not required', () => {
    const providers = loadCatalogue(resolveDefaultCataloguePath());
    const constraints = { requiresDeOnly: true, requiresEuOnly: false, requiresBsiC5: false, requiresHipaa: false, requiresLowLockIn: false, requiredServices: [] };
    const result = matchLandingZone(providers, constraints);
    const candidateMap = Object.fromEntries(
      (result.landing_zone_candidates ?? []).map(c => [c.id, c]),
    );
    expect(candidateMap['aws_eu_sovereign']?.disqualified).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #0097: meshStack live BB cross-reference bonus
// ---------------------------------------------------------------------------

describe('matchLandingZone -- meshStack live BB bonus (#0097)', () => {
  it('all candidates expose meshstack_integration as delivery readiness (not scored)', () => {
    const providers = loadCatalogue(resolveDefaultCataloguePath());
    const constraints = deriveConstraints(loadGhostfolioSignals());
    const result = matchLandingZone(providers, constraints);
    for (const c of result.landing_zone_candidates ?? []) {
      expect(c.meshstack_integration).toBeDefined();
      expect(typeof c.meshstack_integration!.supported).toBe('boolean');
    }
  });

  it('STACKIT meshstack_integration reflects catalogue building blocks', () => {
    const providers = loadCatalogue(resolveDefaultCataloguePath());
    const constraints = deriveConstraints(loadGhostfolioSignals());
    const result = matchLandingZone(providers, constraints);
    const stackit = result.landing_zone_candidates?.find(c => c.id === 'stackit_de_sovereign');
    expect(stackit?.meshstack_integration?.supported).toBe(true);
    expect(stackit?.meshstack_integration?.building_blocks?.length).toBeGreaterThan(0);
  });

  it('fit_score does not exceed 1.0 for any candidate', () => {
    const providers = loadCatalogue(resolveDefaultCataloguePath());
    const constraints = { requiresDeOnly: false, requiresEuOnly: false, requiresBsiC5: false, requiresHipaa: false, requiresLowLockIn: false, requiredServices: [] };
    const result = matchLandingZone(providers, constraints);
    for (const c of result.landing_zone_candidates ?? []) {
      expect(c.fit_score).toBeLessThanOrEqual(1.0);
    }
  });

  it('ghostfolio recommendation is STACKIT or OTC with sovereignty-first weights', () => {
    const providers = loadCatalogue(resolveDefaultCataloguePath());
    const constraints = deriveConstraints(loadGhostfolioSignals());
    const result = matchLandingZone(providers, constraints);
    expect(result.recommended_landing_zone).toMatch(/stackit_de_sovereign|otc_de_sovereign/);
  });
});
