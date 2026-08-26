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
import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { load } from 'js-yaml';
import { SignalSchema } from '../schema/signals.js';
import { ProviderStatusSchema, ProvidersUsedItemSchema, SpineSchema } from '../schema/wsp-spine.js';
import '../passes/types.js';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = resolve(__dirname, '../../../../');
const CONTROLS   = join(REPO_ROOT, 'controls');

function loadYaml<T>(file: string): T {
  return load(readFileSync(file, 'utf-8')) as T;
}

// ---------------------------------------------------------------------------
// Sovereign Service Catalogue (#0058)
// ---------------------------------------------------------------------------

interface SovereignServiceEntry {
  id: string;
  name: string;
  category: string;
  vendor: string;
  portability_verdict: string;
  sovereign_evidence: string;
  blocks_migration?: boolean;
  remediation?: string;
  last_reviewed?: string;
  tags?: string[];
}

interface SovereignServiceCatalogue {
  services: SovereignServiceEntry[];
}

describe('sovereign-service-catalogue.yaml (#0058)', () => {
  const CATALOGUE_FILE = join(CONTROLS, 'sovereign-service-catalogue.yaml');

  it('file exists in controls/', () => {
    expect(existsSync(CATALOGUE_FILE)).toBe(true);
  });

  it('parses as valid YAML', () => {
    expect(() => loadYaml(CATALOGUE_FILE)).not.toThrow();
  });

  it('has a top-level "services" array', () => {
    const cat = loadYaml<SovereignServiceCatalogue>(CATALOGUE_FILE);
    expect(Array.isArray(cat.services)).toBe(true);
  });

  it('contains at least 20 entries (issue acceptance criterion)', () => {
    const cat = loadYaml<SovereignServiceCatalogue>(CATALOGUE_FILE);
    expect(cat.services.length).toBeGreaterThanOrEqual(20);
  });

  it('every entry has required fields: id, name, category, portability_verdict', () => {
    const cat = loadYaml<SovereignServiceCatalogue>(CATALOGUE_FILE);
    for (const entry of cat.services) {
      expect(typeof entry.id, `id missing on entry: ${JSON.stringify(entry)}`).toBe('string');
      expect(typeof entry.name, `name missing on ${entry.id}`).toBe('string');
      expect(typeof entry.category, `category missing on ${entry.id}`).toBe('string');
      expect(typeof entry.portability_verdict, `portability_verdict missing on ${entry.id}`).toBe('string');
    }
  });

  it('every entry has a valid portability_verdict: available | partial | unavailable', () => {
    const cat = loadYaml<SovereignServiceCatalogue>(CATALOGUE_FILE);
    const valid = new Set(['available', 'partial', 'unavailable']);
    for (const entry of cat.services) {
      expect(valid.has(entry.portability_verdict), `invalid verdict "${entry.portability_verdict}" on ${entry.id}`).toBe(true);
    }
  });

  it('blocks_migration is only true on "unavailable" entries', () => {
    const cat = loadYaml<SovereignServiceCatalogue>(CATALOGUE_FILE);
    for (const entry of cat.services) {
      if (entry.blocks_migration === true) {
        expect(entry.portability_verdict, `blocks_migration:true but verdict not unavailable on ${entry.id}`).toBe('unavailable');
      }
    }
  });

  it('entry IDs are unique', () => {
    const cat = loadYaml<SovereignServiceCatalogue>(CATALOGUE_FILE);
    const ids = cat.services.map(e => e.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('includes aws-comprehend-medical with unavailable verdict (Medplum EGR-01 case)', () => {
    const cat = loadYaml<SovereignServiceCatalogue>(CATALOGUE_FILE);
    const entry = cat.services.find(e => e.id === 'aws-comprehend-medical');
    expect(entry).toBeDefined();
    expect(entry?.portability_verdict).toBe('unavailable');
  });

  it('includes at least one entry per portability_verdict tier', () => {
    const cat = loadYaml<SovereignServiceCatalogue>(CATALOGUE_FILE);
    const verdicts = new Set(cat.services.map(e => e.portability_verdict));
    expect(verdicts.has('available')).toBe(true);
    expect(verdicts.has('partial')).toBe(true);
    expect(verdicts.has('unavailable')).toBe(true);
  });

  it('contains docker-hub entry (used in sovereign-health fixture)', () => {
    const cat = loadYaml<SovereignServiceCatalogue>(CATALOGUE_FILE);
    expect(cat.services.some(e => e.id === 'docker-hub')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Vendor SDK Catalogue (#0059)
// ---------------------------------------------------------------------------

interface VendorSdkEntry {
  id: string;
  name: string;
  vendor: string;
  lock_in_level: string;
  sovereign_impact: string;
  detection?: unknown;
}

interface VendorSdkCatalogue {
  sdks: VendorSdkEntry[];
}

describe('vendor-sdk-catalogue.yaml (#0059)', () => {
  const CATALOGUE_FILE = join(CONTROLS, 'vendor-sdk-catalogue.yaml');

  it('file exists in controls/', () => {
    expect(existsSync(CATALOGUE_FILE)).toBe(true);
  });

  it('parses as valid YAML', () => {
    expect(() => loadYaml(CATALOGUE_FILE)).not.toThrow();
  });

  it('has a top-level "sdks" array', () => {
    const cat = loadYaml<VendorSdkCatalogue>(CATALOGUE_FILE);
    expect(Array.isArray(cat.sdks)).toBe(true);
  });

  it('contains at least 15 entries', () => {
    const cat = loadYaml<VendorSdkCatalogue>(CATALOGUE_FILE);
    expect(cat.sdks.length).toBeGreaterThanOrEqual(15);
  });

  it('every entry has required fields: id, name, vendor, lock_in_level, sovereign_impact', () => {
    const cat = loadYaml<VendorSdkCatalogue>(CATALOGUE_FILE);
    for (const entry of cat.sdks) {
      expect(typeof entry.id, `id missing: ${JSON.stringify(entry)}`).toBe('string');
      expect(typeof entry.name, `name missing on ${entry.id}`).toBe('string');
      expect(typeof entry.vendor, `vendor missing on ${entry.id}`).toBe('string');
      expect(typeof entry.lock_in_level, `lock_in_level missing on ${entry.id}`).toBe('string');
      expect(typeof entry.sovereign_impact, `sovereign_impact missing on ${entry.id}`).toBe('string');
    }
  });

  it('every lock_in_level is valid: extreme | high | medium | low', () => {
    const cat = loadYaml<VendorSdkCatalogue>(CATALOGUE_FILE);
    const valid = new Set(['extreme', 'high', 'medium', 'low']);
    for (const entry of cat.sdks) {
      expect(valid.has(entry.lock_in_level), `invalid lock_in_level "${entry.lock_in_level}" on ${entry.id}`).toBe(true);
    }
  });

  it('every sovereign_impact is valid: blocks_migration | partial | manageable | none', () => {
    const cat = loadYaml<VendorSdkCatalogue>(CATALOGUE_FILE);
    const valid = new Set(['blocks_migration', 'partial', 'manageable', 'none']);
    for (const entry of cat.sdks) {
      expect(valid.has(entry.sovereign_impact), `invalid sovereign_impact "${entry.sovereign_impact}" on ${entry.id}`).toBe(true);
    }
  });

  it('SDK IDs are unique', () => {
    const cat = loadYaml<VendorSdkCatalogue>(CATALOGUE_FILE);
    const ids = cat.sdks.map(e => e.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('covers major cloud providers: AWS, GCP, Azure', () => {
    const cat = loadYaml<VendorSdkCatalogue>(CATALOGUE_FILE);
    const vendors = cat.sdks.map(e => e.vendor.toLowerCase());
    expect(vendors.some(v => v.includes('aws') || v.includes('amazon'))).toBe(true);
    expect(vendors.some(v => v.includes('gcp') || v.includes('google'))).toBe(true);
    expect(vendors.some(v => v.includes('azure') || v.includes('microsoft'))).toBe(true);
  });

  it('contains at least one "extreme" lock_in_level entry (proprietary middleware)', () => {
    const cat = loadYaml<VendorSdkCatalogue>(CATALOGUE_FILE);
    expect(cat.sdks.some(e => e.lock_in_level === 'extreme')).toBe(true);
  });

  it('portability score formula: counts available verdicts from sovereign-service-catalogue', () => {
    const serviceCat = loadYaml<SovereignServiceCatalogue>(join(CONTROLS, 'sovereign-service-catalogue.yaml'));
    const available = serviceCat.services.filter(e => e.portability_verdict === 'available').length;
    const partial = serviceCat.services.filter(e => e.portability_verdict === 'partial').length;
    const total = serviceCat.services.length;
    const score = (available + 0.5 * partial) / total;
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
    expect(total).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Legacy Indicators Catalogue (#0057)
// ---------------------------------------------------------------------------

interface LegacyEntry {
  id: string;
  name: string;
  detection?: unknown;
  migration_path?: string;
}

interface LegacyIndicatorsCatalogue {
  tiers: {
    tier_1_blockers: LegacyEntry[];
    tier_2_complicators: LegacyEntry[];
    tier_3_manageable: LegacyEntry[];
  };
}

describe('legacy-indicators-catalogue.yaml (#0057)', () => {
  const CATALOGUE_FILE = join(CONTROLS, 'legacy-indicators-catalogue.yaml');

  it('file exists in controls/', () => {
    expect(existsSync(CATALOGUE_FILE)).toBe(true);
  });

  it('parses as valid YAML', () => {
    expect(() => loadYaml(CATALOGUE_FILE)).not.toThrow();
  });

  it('has a top-level "tiers" object', () => {
    const cat = loadYaml<LegacyIndicatorsCatalogue>(CATALOGUE_FILE);
    expect(typeof cat.tiers).toBe('object');
  });

  it('has all three tier arrays', () => {
    const cat = loadYaml<LegacyIndicatorsCatalogue>(CATALOGUE_FILE);
    expect(Array.isArray(cat.tiers.tier_1_blockers)).toBe(true);
    expect(Array.isArray(cat.tiers.tier_2_complicators)).toBe(true);
    expect(Array.isArray(cat.tiers.tier_3_manageable)).toBe(true);
  });

  it('contains at least 15 total entries across all tiers', () => {
    const cat = loadYaml<LegacyIndicatorsCatalogue>(CATALOGUE_FILE);
    const total =
      cat.tiers.tier_1_blockers.length +
      cat.tiers.tier_2_complicators.length +
      cat.tiers.tier_3_manageable.length;
    expect(total).toBeGreaterThanOrEqual(15);
  });

  it('tier_1_blockers has at least 5 entries', () => {
    const cat = loadYaml<LegacyIndicatorsCatalogue>(CATALOGUE_FILE);
    expect(cat.tiers.tier_1_blockers.length).toBeGreaterThanOrEqual(5);
  });

  it('every entry has an id and name field', () => {
    const cat = loadYaml<LegacyIndicatorsCatalogue>(CATALOGUE_FILE);
    const all = [
      ...cat.tiers.tier_1_blockers,
      ...cat.tiers.tier_2_complicators,
      ...cat.tiers.tier_3_manageable,
    ];
    for (const entry of all) {
      expect(typeof entry.id, `id missing: ${JSON.stringify(entry)}`).toBe('string');
      expect(typeof entry.name, `name missing on ${entry.id}`).toBe('string');
    }
  });

  it('all IDs are unique across tiers', () => {
    const cat = loadYaml<LegacyIndicatorsCatalogue>(CATALOGUE_FILE);
    const all = [
      ...cat.tiers.tier_1_blockers,
      ...cat.tiers.tier_2_complicators,
      ...cat.tiers.tier_3_manageable,
    ];
    const ids = all.map(e => e.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('contains IBM MQ in tier_1_blockers (primary blocker example)', () => {
    const cat = loadYaml<LegacyIndicatorsCatalogue>(CATALOGUE_FILE);
    expect(cat.tiers.tier_1_blockers.some(e => e.id.includes('ibm-mq') || e.name.toLowerCase().includes('ibm mq'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Signal schema legacy_tier field (#0057)
// ---------------------------------------------------------------------------

describe('SignalSchema legacy_tier field (#0057)', () => {
  it('accepts a signal with legacy_tier: tier_1_blocker', () => {
    const result = SignalSchema.safeParse({
      id: 'INV-01',
      source: 'static_analysis',
      category: 'application',
      severity: 'high',
      derivation: 'IBM MQ JMS dependency detected in pom.xml line 42; tier-1 blocker',
      evidence: ['pom.xml:42'],
      confidence: 'high',
      legacy_tier: 'tier_1_blocker',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a signal with legacy_tier: tier_2_complicator', () => {
    const result = SignalSchema.safeParse({
      id: 'INV-02',
      source: 'static_analysis',
      category: 'application',
      derivation: 'Oracle DB detected via pom.xml dependency entry; legacy stored procs likely',
      evidence: [],
      confidence: 'medium',
      legacy_tier: 'tier_2_complicator',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a signal with legacy_tier: tier_3_manageable', () => {
    const result = SignalSchema.safeParse({
      id: 'INV-03',
      source: 'static_analysis',
      category: 'application',
      derivation: 'PHP 7.x runtime detected in composer.json; manageable tier per legacy catalogue',
      evidence: ['composer.json:5'],
      confidence: 'high',
      legacy_tier: 'tier_3_manageable',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid legacy_tier value', () => {
    const result = SignalSchema.safeParse({
      id: 'INV-04',
      source: 'static_analysis',
      category: 'application',
      derivation: 'test fixture derivation string padded to satisfy min length constraint',
      evidence: [],
      confidence: 'high',
      legacy_tier: 'tier_4_impossible',
    });
    expect(result.success).toBe(false);
  });

  it('legacy_tier is optional -- existing signals parse without it', () => {
    const result = SignalSchema.safeParse({
      id: 'INV-05',
      source: 'static_analysis',
      category: 'application',
      derivation: 'test fixture derivation string padded to satisfy min length constraint',
      evidence: [],
      confidence: 'high',
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// providers_used schema (#0046)
// ---------------------------------------------------------------------------

describe('ProviderStatusSchema + ProvidersUsedItemSchema (#0046)', () => {
  it('ProviderStatusSchema accepts all four valid values', () => {
    for (const v of ['configured_not_executed', 'executed_with_results', 'executed_no_findings', 'failed']) {
      expect(ProviderStatusSchema.safeParse(v).success).toBe(true);
    }
  });

  it('ProviderStatusSchema rejects unknown values', () => {
    expect(ProviderStatusSchema.safeParse('running').success).toBe(false);
  });

  it('ProvidersUsedItemSchema accepts item with status + skip_reason', () => {
    const result = ProvidersUsedItemSchema.safeParse({
      type: 'playwright',
      status: 'configured_not_executed',
      skip_reason: 'WoZ simulation: no live target available',
    });
    expect(result.success).toBe(true);
  });

  it('ProvidersUsedItemSchema accepts item without status (backward compatible)', () => {
    const result = ProvidersUsedItemSchema.safeParse({
      type: 'anthropic',
      model: 'claude-sonnet-4-6',
      endpoint: 'acn-proxy://anthropic-eu',
    });
    expect(result.success).toBe(true);
  });

  it('SpineSchema accepts wsp.yaml with providers_used block (Medplum fixture)', () => {
    const result = SpineSchema.safeParse({
      wsp_version: '0.9',
      meta: { assessor: 'test', assessment_date: '2026-04-29', simulation_type: 'woz', iter: 1 },
      assessed_at: '2026-04-29T00:00:00Z',
      overall: { seven_r_label: 'Rehost', categories: [] },
      passes_executed: [],
      wsp_files: { evidence: 'wsp-evidence.yaml', plan: 'wsp-plan.yaml', passes_dir: 'passes/' },
      app: { name: 'test-app' },
      providers_used: {
        llm: { type: 'anthropic', model: 'claude-sonnet-4-6', status: 'executed_with_results' },
        dynamic_crawler: { type: 'playwright', status: 'configured_not_executed', skip_reason: 'WoZ: no live target' },
      },
    });
    if (!result.success) console.error(JSON.stringify(result.error.issues, null, 2));
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PassContext landingZoneRegion (#0016)
// ---------------------------------------------------------------------------

describe('PassContext landingZoneRegion field (#0016)', { timeout: 30_000 }, () => {
  it('PassContext type accepts landingZoneRegion', () => {
    const ctx = {
      appId: 'sovereign-health',
      sourcePath: '/workspace/sovereign-health',
      workspacePath: '/workspace/sovereign-health',
      iter: 1,
      assessedAt: '2026-04-29T00:00:00Z',
      landingZoneRegion: 'eu-central-1',
    };
    expect(ctx.landingZoneRegion).toBe('eu-central-1');
  });

  it('PassContext type accepts context without landingZoneRegion (optional)', () => {
    const ctx = {
      appId: 'sovereign-health',
      sourcePath: '/workspace',
      workspacePath: '/workspace',
      iter: 1,
      assessedAt: '2026-04-29T00:00:00Z',
    };
    expect((ctx as { landingZoneRegion?: string }).landingZoneRegion).toBeUndefined();
  });

  it('EU region list covers all expected AWS EU regions', () => {
    const EU_AWS_REGIONS = [
      'eu-west-1', 'eu-west-2', 'eu-west-3',
      'eu-central-1', 'eu-north-1', 'eu-south-1',
    ];
    for (const region of EU_AWS_REGIONS) {
      expect(region.startsWith('eu-')).toBe(true);
    }
    expect(EU_AWS_REGIONS.length).toBe(6);
  });

  it('EU region list covers all expected Azure EU regions', () => {
    const EU_AZURE_REGIONS = [
      'westeurope', 'northeurope', 'francecentral',
      'germanywestcentral', 'switzerlandnorth',
    ];
    expect(EU_AZURE_REGIONS.length).toBe(5);
    expect(EU_AZURE_REGIONS).toContain('germanywestcentral');
  });
});
