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

// llm_assessment config block schema (#1419, Design 092 s4).

import { describe, it, expect } from 'vitest';
import { SwaoYmlLlmAssessmentSchema, SwaoYmlSchema } from '../swao-yml.js';

const validBlock = {
  default_app: 'sovereign-health',
  legs: [
    { connector: 'openrouter', model: 'anthropic/claude-sonnet-4', primary: true },
    { connector: 'openrouter', model: 'deepseek/deepseek-v4-flash' },
    { connector: 'ollama', model: 'llama3.3' },
  ],
  execution: 'serial',
  repeat: 1,
  prompt_size_probe: false,
  keep_leg_wsp: false,
  interpretation: true,
  weights: { quality: 0.5, reliability: 0.2, performance: 0.15, cost: 0.15 },
};

describe('SwaoYmlLlmAssessmentSchema (#1419)', () => {
  it('accepts the reference configuration from Design 092 s4', () => {
    const r = SwaoYmlLlmAssessmentSchema.safeParse(validBlock);
    expect(r.success, JSON.stringify(!r.success && r.error.issues)).toBe(true);
  });

  it('accepts an empty block (all fields optional; target chosen at run time)', () => {
    expect(SwaoYmlLlmAssessmentSchema.safeParse({}).success).toBe(true);
  });

  it('rejects fewer than 2 legs', () => {
    const r = SwaoYmlLlmAssessmentSchema.safeParse({ legs: [{ connector: 'openrouter' }] });
    expect(r.success).toBe(false);
  });

  it('rejects more than 5 legs', () => {
    const legs = Array.from({ length: 6 }, (_, i) => ({ connector: `c${i}` }));
    expect(SwaoYmlLlmAssessmentSchema.safeParse({ legs }).success).toBe(false);
  });

  it('rejects two primary legs', () => {
    const r = SwaoYmlLlmAssessmentSchema.safeParse({
      legs: [
        { connector: 'a', primary: true },
        { connector: 'b', primary: true },
      ],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => /at most one leg/.test(i.message))).toBe(true);
    }
  });

  it('accepts legs with no explicit primary (first leg is primary by convention)', () => {
    const r = SwaoYmlLlmAssessmentSchema.safeParse({
      legs: [{ connector: 'a' }, { connector: 'b' }],
    });
    expect(r.success).toBe(true);
  });

  it('rejects an empty connector id', () => {
    const r = SwaoYmlLlmAssessmentSchema.safeParse({
      legs: [{ connector: '' }, { connector: 'b' }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown execution modes and non-positive repeat', () => {
    expect(SwaoYmlLlmAssessmentSchema.safeParse({ execution: 'burst' }).success).toBe(false);
    expect(SwaoYmlLlmAssessmentSchema.safeParse({ repeat: 0 }).success).toBe(false);
    expect(SwaoYmlLlmAssessmentSchema.safeParse({ repeat: 11 }).success).toBe(false);
  });

  it('is reachable from the top-level SwaoYmlSchema under llm_assessment', () => {
    const r = SwaoYmlSchema.safeParse({ llm_assessment: validBlock });
    expect(r.success).toBe(true);
  });

  it('top-level parse fails on an invalid llm_assessment block (not silently dropped)', () => {
    const r = SwaoYmlSchema.safeParse({
      llm_assessment: { legs: [{ connector: 'a', primary: true }, { connector: 'b', primary: true }] },
    });
    expect(r.success).toBe(false);
  });
});
