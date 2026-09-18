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

import { describe, it, expect } from 'vitest';
import {
  AssessmentTypeRouter,
  UnknownAssessmentTypeError,
  KNOWN_ASSESSMENT_TYPES,
  DEFAULT_ASSESSMENT_TYPE,
} from '../assess-router.js';
import type { AssessmentTypeContribution, WspResult } from '../plugin-types.js';

const stubWsp: WspResult = { wsp_version: '0', generated_at: '', signals: [] };

const applicationContribution: AssessmentTypeContribution = {
  type: 'application',
  run: async () => stubWsp,
};

describe('AssessmentTypeRouter', () => {
  it('defaults to application when type is absent / empty', () => {
    const router = new AssessmentTypeRouter();
    router.register(applicationContribution);
    expect(router.normalizeType(undefined)).toBe('application');
    expect(router.normalizeType('')).toBe('application');
    expect(router.normalizeType('   ')).toBe('application');
    expect(DEFAULT_ASSESSMENT_TYPE).toBe('application');
  });

  it('normalises the deprecated source-code alias to application', () => {
    const router = new AssessmentTypeRouter();
    expect(router.normalizeType('source-code')).toBe('application');
    expect(router.normalizeType('SOURCE-CODE')).toBe('application');
  });

  it('normalises the deprecated human alias to audit (#0559)', () => {
    const router = new AssessmentTypeRouter();
    expect(router.normalizeType('human')).toBe('audit');
    expect(router.normalizeType('HUMAN')).toBe('audit');
  });

  it('routes a registered runnable type to kind:run', () => {
    const router = new AssessmentTypeRouter();
    router.register(applicationContribution);
    const decision = router.route('application');
    expect(decision.kind).toBe('run');
    if (decision.kind === 'run') {
      expect(decision.type).toBe('application');
      expect(decision.contribution).toBe(applicationContribution);
    }
  });

  it('routes source-code through to the application contribution', () => {
    const router = new AssessmentTypeRouter();
    router.register(applicationContribution);
    const decision = router.route('source-code');
    expect(decision.kind).toBe('run');
    if (decision.kind === 'run') expect(decision.type).toBe('application');
  });

  it('returns coming-soon for a known but unregistered type', () => {
    const router = new AssessmentTypeRouter();
    router.register(applicationContribution);
    for (const t of ['llm', 'audit', 'landing-zone-catalog', 'landing-zone-customer', 'hybrid'] as const) {
      const decision = router.route(t);
      expect(decision.kind).toBe('coming-soon');
      if (decision.kind === 'coming-soon') {
        expect(decision.type).toBe(t);
        expect(decision.message.length).toBeGreaterThan(0);
      }
    }
  });

  it('normalises the deprecated landing-zone alias to landing-zone-catalog (ADR-0051)', () => {
    const router = new AssessmentTypeRouter();
    expect(router.normalizeType('landing-zone')).toBe('landing-zone-catalog');
    expect(router.normalizeType('LANDING-ZONE')).toBe('landing-zone-catalog');
  });

  it('honours a comingSoon flag on a registered contribution', () => {
    const router = new AssessmentTypeRouter();
    router.register({
      type: 'llm',
      run: async () => stubWsp,
      comingSoon: true,
      description: 'LLM rapid assessment, soon.',
    });
    const decision = router.route('llm');
    expect(decision.kind).toBe('coming-soon');
    if (decision.kind === 'coming-soon') {
      expect(decision.message).toBe('LLM rapid assessment, soon.');
    }
  });

  it('lets a real registration override a coming-soon placeholder', () => {
    const router = new AssessmentTypeRouter();
    router.register({ type: 'llm', run: async () => stubWsp, comingSoon: true });
    router.register({ type: 'llm', run: async () => stubWsp });
    const decision = router.route('llm');
    expect(decision.kind).toBe('run');
  });

  it('throws UnknownAssessmentTypeError for an unrecognised type', () => {
    const router = new AssessmentTypeRouter();
    router.register(applicationContribution);
    expect(() => router.route('workshop')).toThrow(UnknownAssessmentTypeError);
    try {
      router.route('workshop');
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownAssessmentTypeError);
      const message = (err as UnknownAssessmentTypeError).message;
      for (const t of KNOWN_ASSESSMENT_TYPES) expect(message).toContain(t);
      expect(message).toContain('application'); // a registered runnable type
    }
  });

  it('registeredTypes lists only runnable (non-coming-soon) registrations', () => {
    const router = new AssessmentTypeRouter();
    router.register(applicationContribution);
    router.register({ type: 'llm', run: async () => stubWsp, comingSoon: true });
    expect(router.registeredTypes()).toEqual(['application']);
  });

  it('registerAll tolerates undefined', () => {
    const router = new AssessmentTypeRouter();
    router.registerAll(undefined);
    expect(router.registeredTypes()).toEqual([]);
  });
});
