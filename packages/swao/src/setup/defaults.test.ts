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

// #4190 / #4198 (Design 125 section 5.7): the readers of the values each
// branch stores, with the fallbacks to the older fields.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readApplicationDefaults, readServiceDefaults, readLzCatalogDefaults, readLzLiveDefaults, readLlmDefaults, resolveAssessDefaults, readStoredServiceIntake } from './defaults.js';

const dirs: string[] = [];
function ws(yml: string, apps: string[] = []): string {
  const d = mkdtempSync(join(tmpdir(), 'swao-setup-defaults-'));
  dirs.push(d);
  writeFileSync(join(d, '.swao.yml'), yml, 'utf-8');
  for (const a of apps) {
    mkdirSync(join(d, 'apps', a), { recursive: true });
    writeFileSync(join(d, 'apps', a, '.swao.yml'), 'assessment:\n  type: application\n', 'utf-8');
  }
  return d;
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('setup defaults readers (#4190, section 5.7)', () => {
  it('application: apps with a .swao.yml and the test-code mode', () => {
    const d = ws('assessment:\n  test_code:\n    mode: tag\n', ['web', 'api']);
    mkdirSync(join(d, 'apps', 'no-config'));
    expect(readApplicationDefaults(d)).toEqual({ apps: ['api', 'web'], serviceApps: 0, testCodeMode: 'tag' });
    expect(readApplicationDefaults(ws('engagement:\n  name: X\n'))).toEqual({ apps: [], serviceApps: 0 });
  });

  it('service: intake wins over source; mapping read as is', () => {
    expect(readServiceDefaults(ws('service_portfolio:\n  source: old.xlsx\n  intake: new.xlsx\n  mapping: map.yml\n'))).toEqual({ intake: 'new.xlsx', mapping: 'map.yml' });
    expect(readServiceDefaults(ws('service_portfolio:\n  source: old.xlsx\n'))).toEqual({ intake: 'old.xlsx' });
    // `swao service init` writes mapping: null without a column map.
    expect(readServiceDefaults(ws('service_portfolio:\n  source: old.xlsx\n  mapping: null\n'))).toEqual({ intake: 'old.xlsx' });
    expect(readServiceDefaults(ws('engagement: {}\n'))).toEqual({});
  });

  it('service: the stored intake as absolute paths, only when the files exist (#4198)', () => {
    const d = ws('service_portfolio:\n  intake: wsp/inputs/service-intake/portfolio.xlsx\n  mapping: map.yml\n');
    expect(readStoredServiceIntake(d)).toEqual({});
    mkdirSync(join(d, 'wsp', 'inputs', 'service-intake'), { recursive: true });
    writeFileSync(join(d, 'wsp', 'inputs', 'service-intake', 'portfolio.xlsx'), 'x');
    expect(readStoredServiceIntake(d)).toEqual({ intake: join(d, 'wsp', 'inputs', 'service-intake', 'portfolio.xlsx') });
    writeFileSync(join(d, 'map.yml'), 'x');
    expect(readStoredServiceIntake(d)).toEqual({ intake: join(d, 'wsp', 'inputs', 'service-intake', 'portfolio.xlsx'), mapping: join(d, 'map.yml') });
  });

  it('service: the intake picker default prefers the stored workbook over the folder scan (#4198)', async () => {
    const { defaultServiceIntake } = await import('../tui/screens/ServiceInitScreen.js');
    const d = ws('service_portfolio:\n  intake: chosen.xlsx\n');
    writeFileSync(join(d, 'chosen.xlsx'), 'x');
    expect(defaultServiceIntake(d)).toEqual({ intake: join(d, 'chosen.xlsx'), mapping: '' });
    // The cold import of the whole ServiceInitScreen module graph takes over 20 s under a
    // parallel workspace run (night run 2026-11-15); the assertion itself is instant.
  }, 90_000);

  it('lz-catalog: the workspace targets', () => {
    expect(readLzCatalogDefaults(ws('assessment:\n  landing_zone:\n    targets:\n      - otc:eu-de\n')).targets).toEqual(['otc:eu-de']);
  });

  it('lz-live: landing zones with scopes and frameworks', () => {
    const d = ws('landing_zones:\n  - id: otc-prod\n    provider: otc\n    frameworks: [CLIENT_LZ_POLICY_BASELINE]\n    scopes:\n      - id: platform\n        kind: platform\n        auth: iam-password-token\n');
    expect(readLzLiveDefaults(d)).toEqual({ landingZones: [{ id: 'otc-prod', provider: 'otc', scopes: ['platform'], frameworks: ['CLIENT_LZ_POLICY_BASELINE'] }] });
  });

  it('llm: saved llm_assessment.legs win over the candidates (#4403); the subject prefers assessment.llm; llm_assessment is the fallback', () => {
    const both = ws('assessment:\n  llm:\n    candidates:\n      - connector: anthropic\n      - connector: ollama\n        model: llama3\n    subject_app: web\nllm_assessment:\n  default_app: api\n  legs:\n    - connector: a\n    - connector: b\n');
    expect(readLlmDefaults(both)).toEqual({ candidates: [{ connector: 'a' }, { connector: 'b' }], subjectApp: 'web', source: 'assessment.llm', candidatesFrom: 'llm_assessment' });
    const candidatesOnly = ws('assessment:\n  llm:\n    candidates:\n      - connector: anthropic\n      - connector: ollama\n        model: llama3\nllm_assessment:\n  legs: []\n');
    expect(readLlmDefaults(candidatesOnly)).toEqual({ candidates: [{ connector: 'anthropic' }, { connector: 'ollama', model: 'llama3' }], source: 'assessment.llm', candidatesFrom: 'assessment.llm' });
    const legacy = ws('llm_assessment:\n  default_app: api\n  legs:\n    - connector: a\n    - connector: b\n      model: m\n');
    expect(readLlmDefaults(legacy)).toEqual({ candidates: [{ connector: 'a' }, { connector: 'b', model: 'm' }], subjectApp: 'api', source: 'llm_assessment', candidatesFrom: 'llm_assessment' });
    expect(readLlmDefaults(ws('engagement: {}\n'))).toEqual({ candidates: [], source: 'none', candidatesFrom: 'none' });
  });
});

describe('preselection never writes back (#4198, Design 125 section 11)', () => {
  it('reading every default and resolving the CLI defaults leaves .swao.yml byte for byte unchanged', async () => {
    const yml = '# keep\nservice_portfolio:\n  intake: chosen.xlsx\nassessment:\n  llm:\n    subject_app: web\nlanding_zones:\n  - id: otc-prod\n    provider: otc\n    frameworks: [BSI_C5]\n    scopes:\n      - id: platform\n        kind: platform\n        auth: iam-password-token\n';
    const d = ws(yml, ['web']);
    writeFileSync(join(d, 'chosen.xlsx'), 'x');
    const { defaultServiceIntake } = await import('../tui/screens/ServiceInitScreen.js');
    readApplicationDefaults(d); readServiceDefaults(d); readStoredServiceIntake(d); defaultServiceIntake(d);
    readLzCatalogDefaults(d); readLzLiveDefaults(d); readLlmDefaults(d);
    resolveAssessDefaults(d, {}); resolveAssessDefaults(d, { type: 'llm' }); resolveAssessDefaults(d, { type: 'landing-zone-live', lz: 'otc-prod' });
    expect(readFileSync(join(d, '.swao.yml'), 'utf-8')).toBe(yml);
  });
});

describe('resolveAssessDefaults: CLI defaults of omitted flags (#4198)', () => {
  it('application: a single app is chosen; two apps or an explicit --app are left alone', () => {
    expect(resolveAssessDefaults(ws('engagement: {}\n', ['web']), {})).toMatchObject({ app: 'web', notes: [expect.stringContaining('only app')] });
    expect(resolveAssessDefaults(ws('engagement: {}\n', ['web', 'api']), {})).toEqual({ notes: [] });
    expect(resolveAssessDefaults(ws('engagement: {}\n', ['web']), { app: 'other' })).toEqual({ notes: [] });
    expect(resolveAssessDefaults(ws('engagement: {}\n', ['web']), { portfolio: true })).toEqual({ notes: [] });
    expect(resolveAssessDefaults(ws('engagement: {}\n', ['web']), { type: 'service' })).toEqual({ notes: [] });
  });

  it('llm: the stored subject app', () => {
    const d = ws('assessment:\n  llm:\n    subject_app: api\n', ['web', 'api']);
    expect(resolveAssessDefaults(d, { type: 'llm' })).toMatchObject({ app: 'api' });
    expect(resolveAssessDefaults(d, { type: 'llm', app: 'web' })).toEqual({ notes: [] });
  });

  it('lz-live: frameworks of the chosen landing zone; the landing zone is never implied', () => {
    const d = ws('landing_zones:\n  - id: otc-prod\n    provider: otc\n    frameworks: [CLIENT_LZ_POLICY_BASELINE, BSI_C5]\n    scopes:\n      - id: platform\n        kind: platform\n        auth: iam-password-token\n');
    expect(resolveAssessDefaults(d, { type: 'landing-zone-live', lz: 'otc-prod' })).toMatchObject({ frameworks: 'CLIENT_LZ_POLICY_BASELINE,BSI_C5' });
    expect(resolveAssessDefaults(d, { type: 'landing-zone-live', lz: 'otc-prod', frameworks: 'DORA' })).toEqual({ notes: [] });
    expect(resolveAssessDefaults(d, { type: 'landing-zone-live' })).toEqual({ notes: [] });
  });
});
