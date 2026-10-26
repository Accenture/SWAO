// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3430 (decision on the #3429 follow-up): SYNTH lists target-capability gaps
// in a section of their own; prompts without such signals are unchanged.

import { describe, it, expect } from 'vitest';
import type { Signal } from '@swao/core';
import { buildSynthPrompt } from './pass-09-synth.js';

const base: Signal = {
  id: 'CTX-01', source: 'llm_inference', category: 'infrastructure_platform', severity: 'medium',
  derivation: 'The candidate landing zone offers no managed Kafka.', evidence: ['infra/target/lz.json'], confidence: 'medium',
};

describe('SYNTH prompt and target-capability gaps (#3430)', () => {
  it('adds the target-platform section only when tagged signals exist', () => {
    const plain = buildSynthPrompt([base], 'app');
    expect(plain).not.toContain('TARGET-PLATFORM GAPS');
    const tagged = buildSynthPrompt([{ ...base, implies: ['gap_type:target_capability'] }], 'app');
    expect(tagged).toContain('--- TARGET-PLATFORM GAPS (gap_type:target_capability) ---');
    expect(tagged).toContain('Do not count them in migration_blockers');
    expect(tagged).toContain('CTX-01: The candidate landing zone offers no managed Kafka.');
    // Everything before the new section is byte-identical.
    expect(tagged.startsWith(plain)).toBe(true);
  });
});
