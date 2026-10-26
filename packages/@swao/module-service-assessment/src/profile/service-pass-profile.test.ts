// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Service assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Phase 3 pass profile suite (#3093-#3098, Design 103 §5, ADR-0064).
import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssessmentTypeRouter, PassFileSchema } from '@swao/core';
import { serviceAssessmentType } from '../index.js';
import { SERVICE_PASS_PROFILE, buildServiceScopeCoverage, formatSkippedSummary, planServicePasses } from './service-pass-profile.js';
import { runServiceCryptoPass, runServiceDataPass } from './service-passes.js';

const DEFAULT_PASSES = ['inv', 'state', 'data', 'ctx', 'sbom', 'tf', 'egr', 'crypto', 'dynamic', 'comp', 'blocks', 'synth', 'scope'];
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function appDir(files: Record<string, string> = {}, yml = 'assessment:\n  type: service\n'): string {
  const d = mkdtempSync(join(tmpdir(), 'swao-svc-profile-'));
  dirs.push(d);
  writeFileSync(join(d, '.swao.yml'), yml);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(d, rel, '..'), { recursive: true });
    writeFileSync(join(d, rel), content);
  }
  return d;
}

const keysByMode = (mode: string) => SERVICE_PASS_PROFILE.filter((p) => p.mode === mode).map((p) => p.num);

describe('ServicePassProfile (#3093, #3098)', () => {
  it('encodes the Design 103 §5 table', () => {
    // #3405: Pass 26 code health is source-only as well.
    expect(keysByMode('skipped')).toEqual(['01', '02', '06', '07', '26']);
    // #3419: Pass 14 twice: the default secret scan and the opt-in full malware scan.
    expect(keysByMode('conditional')).toEqual(['03', '05', '08', '10', '14', '14']);
    expect(keysByMode('always')).toEqual(['00', '04', '09', '11', '12', '13']);
    expect(keysByMode('external')).toEqual(['24', '25']);
    for (const p of SERVICE_PASS_PROFILE) expect(p.reason.length).toBeGreaterThan(10);
  });

  it('keeps the host order, drops source-only passes, and skips conditional passes without inputs', () => {
    const plan = planServicePasses(appDir(), DEFAULT_PASSES);
    expect(plan.run).toEqual(['ctx', 'comp', 'blocks', 'synth', 'scope']);
    expect(plan.skipped.map((s) => s.key)).toEqual(['inv', 'state', 'data', 'sbom', 'tf', 'egr', 'crypto', 'dynamic', 'quality']);
    expect(plan.external.map((e) => e.num)).toEqual(['24', '25']);
    expect(formatSkippedSummary(plan)).toBe('Service passes skipped: 9 (01, 02, 06, 07, 26: no source code; 03 DATA, 05 SBOM, 08 CRYPTO, 10 DYNAMIC: inputs not supplied)');
  });

  it('reports the source-only passes even when the selection did not request them', () => {
    const plan = planServicePasses(appDir(), ['ctx', 'synth']);
    expect(plan.skipped.map((s) => s.num)).toEqual(['01', '02', '06', '07', '26']);
  });

  it('runs DATA on data-flow inputs or declared data fields (Pass 03 guard, #3095)', () => {
    const withFlow = appDir({ 'ingestion/data-flow/erd.md': 'Patient(id)' });
    const p1 = planServicePasses(withFlow, ['data']);
    expect(p1.run).toEqual(['data']);
    expect(p1.sourceOverrides['data']).toBe(join(withFlow, 'ingestion', 'data-flow'));
    const declared = planServicePasses(appDir({}, 'assessment:\n  type: service\ndata:\n  health_data: true\n'), ['data']);
    expect(declared.run).toEqual(['data']);
    expect(declared.sourceOverrides['data']).toBeUndefined();
    expect(planServicePasses(appDir(), ['data']).skipped.find((s) => s.key === 'data')?.reason).toMatch(/no data-flow inputs/);
  });

  it('without hint folders: documents and installers dropped into ingestion/ enable DATA and the binary passes (#3212)', () => {
    const d = appDir({ 'ingestion/Vendor Handbook.md': 'Data export to the archive', 'ingestion/setup.msi': 'MSI' });
    const plan = planServicePasses(d, ['data', 'crypto', 'malware']);
    expect(plan.run).toEqual(['data', 'crypto', 'malware']);
    // DATA reads Pass 00's routed and extracted copies; the binary passes read ingestion/ itself
    expect(plan.sourceOverrides['data']).toBe(join(d, 'wsp', 'inputs'));
    expect(plan.sourceOverrides['crypto']).toBe(join(d, 'ingestion'));
  });

  it('Pass 00 housekeeping files in ingestion/ do not count as dropped documents (#3212)', () => {
    const d = appDir({ 'ingestion/ingestion-manifest.json': '{}', 'ingestion/README.md': 'drop files here' });
    expect(planServicePasses(d, ['data']).skipped.find((s) => s.key === 'data')?.reason).toMatch(/no data-flow inputs/);
  });

  it('runs CRYPTO, SBOM, and MALWARE on binary inputs (Pass 08 guard, #3096)', () => {
    const d = appDir({ 'wsp/inputs/binary/config/app.ini': 'x=1', 'wsp/inputs/binary/app.cdx.json': '{}', 'wsp/inputs/binary/setup.msi': 'MZ' });
    const plan = planServicePasses(d, ['sbom', 'crypto', 'malware']);
    expect(plan.run).toEqual(['sbom', 'crypto', 'malware']);
    expect(plan.sourceOverrides['crypto']).toBe(join(d, 'wsp', 'inputs', 'binary'));
    expect(Object.keys(plan.runners).sort()).toEqual(['crypto', 'data']);
  });

  it('#3419: the default secret scan runs on supplied config or binary inputs and is skipped (never a false all-clear) without them', () => {
    const none = planServicePasses(appDir(), ['ctx', 'secrets']);
    expect(none.run).toEqual(['ctx']);
    expect(none.skipped.find((s) => s.key === 'secrets')?.reason).toMatch(/no config or binary inputs/);
    const d = appDir({ 'wsp/inputs/binary/config/app.ini': 'password=x' });
    const plan = planServicePasses(d, ['secrets']);
    expect(plan.run).toEqual(['secrets']);
    expect(plan.sourceOverrides['secrets']).toBe(join(d, 'wsp', 'inputs', 'binary'));
  });

  it('runs DYNAMIC only for an analyst-configured crawl of a saas or hybrid portal (G-08)', () => {
    const saas = 'assessment:\n  type: service\nvendor_type: saas\n';
    expect(planServicePasses(appDir({}, saas), ['dynamic'], { vendor_type: 'saas' }).run).toEqual([]);
    expect(planServicePasses(appDir({}, saas), ['dynamic'], { vendor_type: 'saas', crawl: { target_url_key: 'k' } }).run).toEqual(['dynamic']);
    expect(planServicePasses(appDir(), ['dynamic'], { vendor_type: 'on-premises', crawl: {} }).run).toEqual([]);
  });

  it('builds the SCOPE coverage report with skipped and external passes (#3097)', () => {
    const plan = planServicePasses(appDir(), ['ctx', 'synth', 'scope']);
    const report = buildServiceScopeCoverage(plan, { ctx: 'complete', synth: 'complete' });
    expect(report.assessment_type).toBe('service');
    expect(report.skipped_passes).toHaveLength(5); // #3405: + Pass 26
    expect(report.run_passes).toEqual([{ key: 'ctx', status: 'complete' }, { key: 'synth', status: 'complete' }, { key: 'scope', status: 'not_run' }]);
    expect(report.external_passes.map((e) => e.key)).toEqual(['research', 'binary']);
  });
});

describe('AssessmentTypeRouter with the service registration (#3094)', () => {
  it('routes service and application to runnable decisions', () => {
    const router = new AssessmentTypeRouter();
    router.register({ type: 'application', run: async () => ({ wsp_version: '0', generated_at: '', signals: [] }) });
    router.register(serviceAssessmentType);
    expect(router.route('service')).toMatchObject({ kind: 'run', type: 'service' });
    expect(router.route('application')).toMatchObject({ kind: 'run', type: 'application' });
    expect(() => router.route('workshop')).toThrow(/Unknown assessment type "workshop"/);
  });
});

describe('service-mode runners (#3095, #3096)', () => {
  const ctxFor = (dir: string, sourcePath: string) => ({ appId: 'hosapp001', sourcePath, workspacePath: dir, iter: 1, assessedAt: '2026-10-10' });

  it('CRYPTO flags MD5, cleartext endpoints, and hard-coded credentials without copying the secret', async () => {
    const d = appDir({ 'ingestion/binary/config/app.ini': '[db]\nhash=md5\nurl=http://db.internal:8080\npassword=SuperSecret123\n' });
    const result = await runServiceCryptoPass(ctxFor(d, join(d, 'ingestion', 'binary')));
    expect(() => PassFileSchema.parse(result)).not.toThrow();
    expect(result.pass).toMatchObject({ id: 8, name: 'crypto_posture', signal_prefix: 'CRYPTO' });
    expect(result.signals.map((s) => s.derivation.match(/CRYPTO\.(\w+)/)?.[1])).toEqual(['WEAK_ALGORITHM', 'CLEARTEXT_ENDPOINT', 'HARDCODED_SECRET']);
    expect(result.signals[0]!.evidence).toEqual(['ingestion/binary/config/app.ini:2']);
    expect(JSON.stringify(result)).not.toContain('SuperSecret123');
  });

  it('CRYPTO reports expired certificates from Pass 25 and is indeterminate on a clean sample', async () => {
    const d = appDir({
      'wsp/inputs/binary/config/clean.ini': 'url=https://vendor.example\n',
      'wsp/inputs/binary/binary-analysis.json': JSON.stringify({ files: [{ path: 'setup.msi', sha256: 'a'.repeat(64), certificates: [{ subject: 'CN=Vendor', not_after: '2024-01-01T00:00:00Z' }] }] }),
    });
    const withCert = await runServiceCryptoPass(ctxFor(d, join(d, 'wsp', 'inputs', 'binary')));
    expect(withCert.signals.map((s) => s.derivation)).toEqual([expect.stringMatching(/CRYPTO\.EXPIRED_CERT/)]);
    const clean = appDir({ 'wsp/inputs/binary/config/clean.ini': 'url=https://vendor.example\n' });
    const none = await runServiceCryptoPass(ctxFor(clean, join(clean, 'wsp', 'inputs', 'binary')));
    expect(none.signals).toEqual([expect.objectContaining({ outcome: 'indeterminate' })]);
  });

  it('DATA flags declared health data and personal fields in data-flow documents', async () => {
    const d = appDir({ 'ingestion/data-flow/erd.md': '# ERD\nPatient(id, birth_date, diagnosis)\n' }, 'assessment:\n  type: service\ndata:\n  health_data: true\n  pii: true\n');
    const result = await runServiceDataPass(ctxFor(d, join(d, 'ingestion', 'data-flow')));
    expect(() => PassFileSchema.parse(result)).not.toThrow();
    expect(result.signals.map((s) => [s.id, s.severity])).toEqual([['DATA-01', 'high'], ['DATA-02', 'medium']]);
    expect(result.signals[0]!.evidence).toContain('ingestion/data-flow/erd.md:2');
  });

  it('DATA is indeterminate when nothing indicates personal data', async () => {
    const d = appDir({}, 'assessment:\n  type: service\ndata:\n  health_data: false\n');
    const result = await runServiceDataPass(ctxFor(d, join(d, 'wsp', 'service-no-source')));
    expect(result.signals).toEqual([expect.objectContaining({ outcome: 'indeterminate' })]);
  });
});
