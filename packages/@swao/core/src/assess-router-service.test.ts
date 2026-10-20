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


// Service Portfolio Assessment type registration (ADR-0064, #3073).
// Colocated so it runs under the default include; src/__tests__/ is excluded.
import { describe, it, expect } from 'vitest';
import { AssessmentTypeRouter, KNOWN_ASSESSMENT_TYPES } from './assess-router.js';
import type { WspResult } from './plugin-types.js';

const stubWsp: WspResult = { wsp_version: '0', generated_at: '', signals: [] };

describe('AssessmentTypeRouter -- service type (ADR-0064)', () => {
  it('recognises service as canonical and keeps audit for legacy manifests', () => {
    expect(KNOWN_ASSESSMENT_TYPES).toContain('service');
    expect(KNOWN_ASSESSMENT_TYPES).toContain('audit');
    expect(new AssessmentTypeRouter().normalizeType('SERVICE')).toBe('service');
  });

  it('routes service to coming-soon until a module registers it, then to run', () => {
    const router = new AssessmentTypeRouter();
    router.register({ type: 'application', run: async () => stubWsp });
    const before = router.route('service');
    expect(before.kind).toBe('coming-soon');
    if (before.kind === 'coming-soon') expect(before.message).toContain('Service Portfolio Assessment');

    router.register({ type: 'service', run: async () => stubWsp });
    expect(router.route('service').kind).toBe('run');
    expect(router.route('application').kind).toBe('run');
  });
});

describe('SwaoYmlSchema -- service app .swao.yml (ADR-0064)', () => {
  it('accepts assessment.type service and passes service blocks through unchanged', async () => {
    const { SwaoYmlSchema } = await import('./swao-yml.js');
    const parsed = SwaoYmlSchema.parse({
      assessment: { type: 'service' },
      vendor: { name: 'Example Vendor', support_phone_present: true },
      hardware: { cpu_cores: 4, memory_mb: 8192 },
    });
    expect(parsed.assessment?.type).toBe('service');
    expect((parsed as Record<string, unknown>)['vendor']).toEqual({ name: 'Example Vendor', support_phone_present: true });
  });
});
