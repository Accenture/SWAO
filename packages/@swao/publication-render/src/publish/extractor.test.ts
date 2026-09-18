// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Publication renderer
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Tests for extractor.ts -- issue #0428
 *
 * Uses the sovereign-health example workspace as an integration fixture.
 * Lens YAML files live in swao/controls/lenses/.
 */

import { describe, it, expect } from 'vitest';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';

import { extractPublicationModel, extractLzCatalogPublicationModel, sanitisePII, loadLensDefinition } from './extractor.js';
import { PublicationModelSchema } from './model.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Integration test fixture: the 2026-05-13 sovereign-health run
const SOVEREIGN_HEALTH_RUN = join(
  __dirname,
  '../../../../../examples/portfolio-workspace/portfolio/apps/sovereign-health/wsp/runs/2026-05-13T18-42-00',
);

// ---------------------------------------------------------------------------
// 1. loadLensDefinition -- happy path
// ---------------------------------------------------------------------------
describe('loadLensDefinition', () => {
  it("returns passes array including 'INV' for cloud-migration lens", () => {
    const def = loadLensDefinition('cloud-migration');
    expect(def.id).toBe('cloud-migration');
    expect(Array.isArray(def.passes)).toBe(true);
    expect(def.passes).toContain('INV');
  });

  it("throws 'Unknown lens: nonexistent' for unknown lens", () => {
    expect(() => loadLensDefinition('nonexistent')).toThrow('Unknown lens: nonexistent');
  });
});

// ---------------------------------------------------------------------------
// 2. Integration: extractPublicationModel with sovereign-health fixture
// ---------------------------------------------------------------------------
describe('extractPublicationModel (integration)', { timeout: 60000 }, () => {
  it('returns a valid PublicationModel from sovereign-health run', async () => {
    const model = await extractPublicationModel(SOVEREIGN_HEALTH_RUN);

    // Validate with Zod schema
    const result = PublicationModelSchema.safeParse(model);
    if (!result.success) {
      throw new Error(`Schema validation failed: ${JSON.stringify(result.error.issues, null, 2)}`);
    }
    expect(result.success).toBe(true);

    // Contract assertions
    expect(model.contract_version).toBe('1.1');
    expect(model.meta.app_id).toBe('sovereign-health');
    expect(model.signals.length).toBeGreaterThan(0);
    expect(model.evidence.length).toBeGreaterThan(0);
    // Risk register must be populated (wsp-plan.yaml raw read -- #0428 fix)
    expect(model.risk_register.length).toBeGreaterThan(0);
    // Compliance must include GDPR (auto-detected from DATA/CRYPTO signals)
    expect(model.compliance.length).toBeGreaterThan(0);
    const gdpr = model.compliance.find(fw => fw.framework_id === 'GDPR');
    expect(gdpr).toBeDefined();
    expect(gdpr!.controls.length).toBeGreaterThan(0);
    // GDPR must have at least one fail (DATA signals are high/medium severity)
    expect(gdpr!.fail_count).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Missing optional files -- evidence should be []
// ---------------------------------------------------------------------------
describe('extractPublicationModel (missing optional files)', () => {
  it('returns evidence: [] when wsp-evidence.yaml is absent', async () => {
    // Build a minimal temp run dir: apps/<app>/wsp/runs/<ts>
    // so ../../../.swao.yml resolves to apps/<app>/.swao.yml (does not exist)
    const base = mkdtempSync(join(tmpdir(), 'swao-test-'));
    const runDir = join(base, 'apps', 'test-app', 'wsp', 'runs', '2026-01-01T00-00-00');
    mkdirSync(runDir, { recursive: true });

    const minimalWsp = `
schema_version: '0.10'
app_id: test-app
run_id: '2026-01-01T00:00:00.000Z'
assessed_at: '2026-01-01'
iter: 1
workload:
  name: test-app
  business_domain: ''
  business_criticality: ''
overall:
  seven_r_label: ''
  modernization_position: ''
  coverage_score: ''
  cloud_native_score: ''
  portability_score: ''
  confidence: ''
landing_zone:
  primary: ''
engagement:
  name: Test Engagement
  client_code: test
  partnership_lead: test@example.com
  start_date: 2026-01-01T00:00:00.000Z
`;
    writeFileSync(join(runDir, 'wsp.yaml'), minimalWsp);

    const model = await extractPublicationModel(runDir);
    expect(model.evidence).toEqual([]);
    expect(model.meta.app_id).toBe('test-app');
  });
});

// ---------------------------------------------------------------------------
// 4. sanitisePII -- redacts email in signal derivation
// ---------------------------------------------------------------------------
describe('sanitisePII', () => {
  it('redacts email address in signal derivation', async () => {  // extractPublicationModel does file I/O
    // Build a minimal model with a signal containing an email
    const model = await extractPublicationModel(SOVEREIGN_HEALTH_RUN);
    // Inject a synthetic signal with a known email
    const testSignal = {
      id: 'INV-05',
      pass: '1',
      severity: 'informational' as const,
      outcome: 'informational' as const,
      derivation: 'Contact john.doe@company.com for access credentials.',
      evidence_refs: [],
      implies: [],
      tags: [],
      anchor: 'signal-TEST-99',
    };
    model.signals.push(testSignal);

    const result = sanitisePII(model);

    // The signal with the email should have been redacted to [REDACTED-EMAIL]
    // (redact-pii.ts:81 uses uppercase; verified against source).
    const redactedSignal = model.signals.find(s => s.anchor === 'signal-TEST-99');
    expect(redactedSignal?.derivation).toContain('[REDACTED-EMAIL]');
    expect(redactedSignal?.derivation).not.toContain('john.doe@company.com');
    expect(result.redactions.length).toBeGreaterThan(0);
  }, 20000);

  it('leaves engagement.partnership_lead unchanged after sanitisePII', async () => {
    const model = await extractPublicationModel(SOVEREIGN_HEALTH_RUN);
    const originalLead = model.meta.engagement.partnership_lead;
    // Ensure partnership_lead contains an email-like value
    model.meta.engagement.partnership_lead = 'jane@example.com';

    sanitisePII(model);

    // partnership_lead must NOT be redacted (verbatim pass-through)
    expect(model.meta.engagement.partnership_lead).toBe('jane@example.com');
    // Restore
    model.meta.engagement.partnership_lead = originalLead;
  }, 20000);
});

// ---------------------------------------------------------------------------
// 5. Lens filter: signals filtered by active lenses
// ---------------------------------------------------------------------------
describe('lens filter', () => {
  it('filters signals to only enabled pass prefixes when lenses are active', async () => {
    // Create a temp run dir with a .swao.yml at ../../../.swao.yml
    // that sets assessment.lenses: ['security-focus']
    // security-focus covers: SBOM, CRYPTO, EGR
    const base = mkdtempSync(join(tmpdir(), 'swao-lens-test-'));
    const appDir = join(base, 'apps', 'test-app');
    const runDir = join(appDir, 'wsp', 'runs', '2026-01-01T00-00-00');
    mkdirSync(runDir, { recursive: true });
    mkdirSync(join(runDir, 'passes'), { recursive: true });

    const minimalWsp = `
schema_version: '0.10'
app_id: test-app
run_id: '2026-01-01T00:00:00.000Z'
assessed_at: '2026-01-01'
iter: 1
workload:
  name: test-app
  business_domain: ''
  business_criticality: ''
overall:
  seven_r_label: ''
  modernization_position: ''
  coverage_score: ''
  cloud_native_score: ''
  portability_score: ''
  confidence: ''
landing_zone:
  primary: ''
engagement:
  name: Test Engagement
  client_code: test
  partnership_lead: test@example.com
  start_date: 2026-01-01T00:00:00.000Z
`;
    writeFileSync(join(runDir, 'wsp.yaml'), minimalWsp);

    // Write passes: one INV signal and one SBOM signal
    const invPass = `
pass:
  id: 1
  name: inventory
  signal_prefix: INV
  status: complete
  iter: 1
signals:
  - id: INV-05
    source: static_analysis
    category: infrastructure_platform
    severity: high
    derivation: No container config found. Deployment type unknown.
    evidence: []
    confidence: low
    outcome: negative
assessment: {}
`;
    writeFileSync(join(runDir, 'passes', '01-inv.yaml'), invPass);

    const sbomPass = `
pass:
  id: 5
  name: sbom_cve
  signal_prefix: SBOM
  status: complete
  iter: 1
signals:
  - id: SBOM-01
    source: static_analysis
    category: application
    severity: medium
    derivation: No SBOM artifact found. CVE exposure cannot be determined without a dependency lockfile.
    evidence: []
    confidence: low
    outcome: negative
assessment: {}
`;
    writeFileSync(join(runDir, 'passes', '05-sbom.yaml'), sbomPass);

    // Write .swao.yml at apps/test-app/.swao.yml (3 levels up from runDir)
    const swaoYml = `
assessment:
  lenses:
    - security-focus
`;
    writeFileSync(join(appDir, '.swao.yml'), swaoYml);

    const model = await extractPublicationModel(runDir);

    // Only SBOM signals should survive; INV should be filtered out
    const ids = model.signals.map(s => s.id);
    expect(ids).not.toContain('INV-05');
    expect(ids).toContain('SBOM-01');
  });
});

// ---------------------------------------------------------------------------
// 6. #0732 landing_zone schema separation: lzr.overall + lz_status
// ---------------------------------------------------------------------------
describe('#0732 landing_zone schema separation', () => {
  it('sets lzr.overall to Not Assessed and lz_status to slug when no lz-catalogue-fit', async () => {
    const base = mkdtempSync(join(tmpdir(), 'swao-0732-new-'));
    const runDir = join(base, 'apps', 'test-app', 'wsp', 'runs', '2026-01-01T00-00-00');
    mkdirSync(runDir, { recursive: true });
    // New schema: primary null, status = LLM slug
    const wsp = `
schema_version: '0.10'
app_id: test-app
run_id: '2026-01-01T00:00:00.000Z'
assessed_at: '2026-01-01'
iter: 1
workload:
  name: test-app
  business_domain: ''
  business_criticality: ''
overall:
  seven_r_label: ''
  modernization_position: ''
  coverage_score: ''
  cloud_native_score: ''
  portability_score: ''
  confidence: ''
landing_zone:
  primary: null
  status: meshstack_otc_health_sovereign
`;
    writeFileSync(join(runDir, 'wsp.yaml'), wsp);
    const model = await extractPublicationModel(runDir);
    expect(model.lzr.overall).toBe('Not Assessed');
    expect(model.lzr.lz_status).toBe('meshstack_otc_health_sovereign');
    expect(model.lzr.blockers).toBe(0);
  });

  it('backward compat: sets lz_status from primary when status absent (old wsp.yaml)', async () => {
    const base = mkdtempSync(join(tmpdir(), 'swao-0732-old-'));
    const runDir = join(base, 'apps', 'test-app', 'wsp', 'runs', '2026-01-01T00-00-00');
    mkdirSync(runDir, { recursive: true });
    // Old schema: primary = LLM slug, no status field
    const wsp = `
schema_version: '0.10'
app_id: test-app
run_id: '2026-01-01T00:00:00.000Z'
assessed_at: '2026-01-01'
iter: 1
workload:
  name: test-app
  business_domain: ''
  business_criticality: ''
overall:
  seven_r_label: ''
  modernization_position: ''
  coverage_score: ''
  cloud_native_score: ''
  portability_score: ''
  confidence: ''
landing_zone:
  primary: meshstack_otc_eu-de-1_health_sovereign
`;
    writeFileSync(join(runDir, 'wsp.yaml'), wsp);
    const model = await extractPublicationModel(runDir);
    expect(model.lzr.overall).toBe('Not Assessed');
    expect(model.lzr.lz_status).toBe('meshstack_otc_eu-de-1_health_sovereign');
  });
});

// ---------------------------------------------------------------------------
// 7. #0923 multi-target LZ readiness: lz-catalogue-fit-*.yaml aggregation
// ---------------------------------------------------------------------------
describe('#0923 multi-target LZ readiness', () => {
  const minimalWsp = `
schema_version: '0.10'
app_id: test-app
run_id: '2026-01-01T00:00:00.000Z'
assessed_at: '2026-01-01'
iter: 1
workload:
  name: test-app
  business_domain: ''
  business_criticality: ''
overall:
  seven_r_label: ''
  modernization_position: ''
  coverage_score: ''
  cloud_native_score: ''
  portability_score: ''
  confidence: ''
landing_zone:
  primary: null
  status: aws_multi
`;

  it('aggregates 3 per-region files: worst verdict wins, blockers summed, regions populated', async () => {
    const base = mkdtempSync(join(tmpdir(), 'swao-0923-'));
    const runDir = join(base, 'apps', 'test-app', 'wsp', 'runs', '2026-01-01T00-00-00');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'wsp.yaml'), minimalWsp);

    // Region A: READY, 2 services, 0 blockers
    writeFileSync(join(runDir, 'lz-catalogue-fit-aws-us-east-1.yaml'), `
provider: aws
region: us-east-1
overall: READY
items:
  - service_code: postgresql
    verdict: SUPPORTED
    detail: available
  - service_code: s3
    verdict: SUPPORTED
    detail: available
sovereignty_statement: ''
generated_at: '2026-01-01'
`);

    // Region B: READY_WITH_CHANGES, 2 services, 0 blockers (AVAILABLE_NOT_ENABLED is not_applicable)
    writeFileSync(join(runDir, 'lz-catalogue-fit-aws-eu-west-1.yaml'), `
provider: aws
region: eu-west-1
overall: READY_WITH_CHANGES
items:
  - service_code: bedrock
    verdict: AVAILABLE_NOT_ENABLED
    detail: needs activation
  - service_code: s3
    verdict: SUPPORTED
    detail: available
sovereignty_statement: ''
generated_at: '2026-01-01'
`);

    // Region C: BLOCKED, 1 service, 1 blocker (NOT_AVAILABLE = fail)
    writeFileSync(join(runDir, 'lz-catalogue-fit-stackit-eu01.yaml'), `
provider: stackit
region: eu01
overall: BLOCKED
items:
  - service_code: proprietary-db
    verdict: NOT_AVAILABLE
    detail: not offered in this region
sovereignty_statement: ''
generated_at: '2026-01-01'
`);

    const model = await extractPublicationModel(runDir);

    // Worst verdict across [READY, READY_WITH_CHANGES, BLOCKED] = BLOCKED
    expect(model.lzr.overall).toBe('Blocked');
    // Sum of per-region blockers: 0 + 0 + 1 = 1
    expect(model.lzr.blockers).toBe(1);
    // regions array must have 3 entries
    expect(model.lzr.regions).toBeDefined();
    expect(model.lzr.regions!.length).toBe(3);
    // Single-target checks table is empty (not used in multi-target path)
    expect(model.lzr.checks).toHaveLength(0);
    // lz_catalogue must be absent (multi-target path)
    expect(model.lzr.lz_catalogue).toBeUndefined();

    const stackit = model.lzr.regions!.find(r => r.region === 'eu01');
    expect(stackit).toBeDefined();
    expect(stackit!.overall_verdict).toBe('BLOCKED');
    expect(stackit!.blockers).toBe(1);
    expect(stackit!.service_count).toBe(1);
  });

  it('returns Not Assessed when no lz-catalogue-fit files exist at all', async () => {
    const base = mkdtempSync(join(tmpdir(), 'swao-0923-none-'));
    const runDir = join(base, 'apps', 'test-app', 'wsp', 'runs', '2026-01-01T00-00-00');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'wsp.yaml'), minimalWsp);

    const model = await extractPublicationModel(runDir);
    expect(model.lzr.overall).toBe('Not Assessed');
    expect(model.lzr.blockers).toBe(0);
    expect(model.lzr.regions).toBeUndefined();
  });

  it('single-target backward compat: lz-catalogue-fit.yaml still produces checks table', async () => {
    const base = mkdtempSync(join(tmpdir(), 'swao-0923-single-'));
    const runDir = join(base, 'apps', 'test-app', 'wsp', 'runs', '2026-01-01T00-00-00');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'wsp.yaml'), minimalWsp);

    writeFileSync(join(runDir, 'lz-catalogue-fit.yaml'), `
provider: aws
region: us-east-1
overall: READY
items:
  - service_code: postgresql
    verdict: SUPPORTED
    detail: available
sovereignty_statement: ''
generated_at: '2026-01-01'
`);

    const model = await extractPublicationModel(runDir);
    expect(model.lzr.overall).toBe('Ready');
    expect(model.lzr.blockers).toBe(0);
    expect(model.lzr.checks).toHaveLength(1);
    expect(model.lzr.lz_catalogue).toBeDefined();
    expect(model.lzr.regions).toBeUndefined();
  });
});

describe('#1380 LZ-catalog extractor carries audit-coverage region fields', () => {
  it('populates coverage_warning, blocker_category, assessment_mode, sovereignty_active on regions[]', async () => {
    const base = mkdtempSync(join(tmpdir(), 'swao-1380-'));
    const runDir = join(base, 'apps', 'test-app', 'wsp', 'runs', '2026-08-05T00-00-00');
    mkdirSync(join(runDir, 'passes'), { recursive: true });

    writeFileSync(join(runDir, 'passes', 'lz-fit-stackit-eu01.yaml'), `
assessment:
  provider: stackit
  region: eu01
  overall: READY
  assessment_mode: full
  sovereignty_active: true
  items:
    - service_code: postgresql
      signalId: INV-10
      verdict: SUPPORTED
      detail: postgresql is offered in eu01
  sovereignty_statement: Region eu01 satisfies the sovereignty requirements.
  generated_at: '2026-08-05'
  coverage_warning: service footprint incomplete -- missing compute, network, storage
signals: []
`);
    writeFileSync(join(runDir, 'passes', 'lz-fit-aws-eu-central-1.yaml'), `
assessment:
  provider: aws
  region: eu-central-1
  overall: SOVEREIGNTY_BLOCKED
  assessment_mode: full
  sovereignty_active: true
  blocker_category: structural
  items:
    - service_code: postgresql
      signalId: INV-10
      verdict: SOVEREIGNTY_GAP
      detail: region fails sovereignty requirements
  sovereignty_statement: Region eu-central-1 FAILS sovereignty requirements.
  generated_at: '2026-08-05'
signals: []
`);

    const model = await extractLzCatalogPublicationModel(runDir);
    expect(model.block_profile).toBe('lz-catalog');
    const regions = (model.lzr as Record<string, unknown>)['regions'] as Array<Record<string, unknown>>;
    expect(regions).toHaveLength(2);
    const stackit = regions.find(r => r['provider'] === 'stackit')!;
    expect(stackit['coverage_warning']).toContain('service footprint incomplete');
    expect(stackit['assessment_mode']).toBe('full');
    expect(stackit['sovereignty_active']).toBe(true);
    expect(stackit['blocker_category']).toBeUndefined();
    const aws = regions.find(r => r['provider'] === 'aws')!;
    expect(aws['blocker_category']).toBe('structural');
    // signal_source provenance per check (#1364/#1375) stays intact.
    const checks = (model.lzr as Record<string, unknown>)['checks'] as Array<Record<string, unknown>>;
    expect(checks.some(c => c['signal_source'] === 'INV-10')).toBe(true);
    // #1595: pass-file derived evidence entries must be present.
    const derivedEvidence = model.evidence.filter(e => e.type === 'derived');
    expect(derivedEvidence.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// #1595 LZ evidence gallery -- derived pass-file entries + catalogue certs
// ---------------------------------------------------------------------------
describe('#1595 buildLzEvidence populates evidence gallery', () => {
  it('adds derived entries for each pass file and imported_artifact for catalogue certs', async () => {
    const base = mkdtempSync(join(tmpdir(), 'swao-1595-'));
    const runDir = join(base, 'apps', 'test-app', 'wsp', 'runs', '2026-08-12T00-00-00');
    mkdirSync(join(runDir, 'passes'), { recursive: true });

    writeFileSync(join(runDir, 'passes', 'lz-fit-stackit-eu01.yaml'), `
assessment:
  provider: stackit
  region: eu01
  overall: READY
  assessment_mode: full
  sovereignty_active: true
  items:
    - service_code: postgresql
      signalId: INV-10
      verdict: SUPPORTED
      detail: postgresql is offered in eu01
  sovereignty_statement: Region eu01 satisfies the sovereignty requirements.
  generated_at: '2026-08-12'
signals: []
`);

    const model = await extractLzCatalogPublicationModel(runDir);
    // At least one derived entry per pass file.
    const derived = model.evidence.filter(e => e.type === 'derived');
    expect(derived.length).toBeGreaterThanOrEqual(1);
    expect(derived[0]?.file).toContain('lz-fit-stackit-eu01.yaml');
    // STACKIT has bsi_c5 attested with evidence_url; expect at least one imported_artifact.
    const imported = model.evidence.filter(e => e.type === 'imported_artifact');
    expect(imported.length).toBeGreaterThanOrEqual(1);
  });
});
